import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  Edit3,
  History,
  LocateFixed,
  Loader2,
  MapPin,
  Navigation,
  RefreshCw,
  Route,
  Save,
  Square,
  Trash2,
  X
} from "lucide-react";
import {
  distanceM,
  formatAccuracy,
  getNavigationProgress,
  isUsableLocationAccuracy,
  MAX_ROUTE_FOLLOW_DISTANCE_M,
  type NavigationProgress
} from "./geo";
import {
  getCurrentLocation,
  startLocationTracking,
  type LocationFix
} from "./location";
import {
  clearHistoryRoutes,
  deleteHistoryRoute,
  getHealth,
  getHistory,
  planRoute,
  renameHistoryRoute,
  saveRoute
} from "./api";
import { MapCanvas } from "./MapCanvas";
import type {
  Coordinate,
  PlanRouteResponse,
  RouteCandidate,
  SavedRoute
} from "./shared/types";
import "./styles.css";

const DEFAULT_ORIGIN: Coordinate = { lng: 121.4737, lat: 31.2304 };
const DISTANCE_PRESETS_KM = [3, 5, 8, 10];
const SIMULATION_TICK_MS = 700;
const SIMULATION_MIN_STEP_M = 55;
const SIMULATION_TARGET_TICKS = 30;

type WakeLockSentinelLike = {
  release: () => Promise<void>;
  addEventListener?: (
    type: "release",
    listener: () => void,
    options?: AddEventListenerOptions
  ) => void;
};

type WakeLockNavigator = Navigator & {
  wakeLock?: {
    request: (type: "screen") => Promise<WakeLockSentinelLike>;
  };
};

function formatDistance(distanceM: number): string {
  return `${(distanceM / 1000).toFixed(2)} km`;
}

function formatDuration(durationS: number): string {
  const minutes = Math.max(1, Math.round(durationS / 60));
  if (minutes < 60) {
    return `${minutes} 分钟`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes === 0
    ? `${hours} 小时`
    : `${hours} 小时 ${remainingMinutes} 分钟`;
}

function routeDurationS(route: RouteCandidate): number {
  const stepDurationS = route.steps.reduce(
    (total, step) => total + (step.durationS ?? 0),
    0
  );
  return stepDurationS > 0 ? stepDurationS : route.distanceM / 1.2;
}

function stepDurationLabel(durationS?: number): string {
  return durationS ? ` · ${formatDuration(durationS)}` : "";
}

function pathLengthM(path: Coordinate[]): number {
  let total = 0;
  for (let index = 1; index < path.length; index += 1) {
    total += distanceM(path[index - 1], path[index]);
  }
  return total;
}

function pointAlongPath(path: Coordinate[], targetDistanceM: number): Coordinate | null {
  if (path.length === 0) {
    return null;
  }

  if (path.length === 1 || targetDistanceM <= 0) {
    return path[0];
  }

  let walkedM = 0;
  for (let index = 1; index < path.length; index += 1) {
    const start = path[index - 1];
    const end = path[index];
    const segmentM = distanceM(start, end);
    if (walkedM + segmentM >= targetDistanceM) {
      const ratio = segmentM === 0 ? 0 : (targetDistanceM - walkedM) / segmentM;
      return {
        lng: Number((start.lng + (end.lng - start.lng) * ratio).toFixed(6)),
        lat: Number((start.lat + (end.lat - start.lat) * ratio).toFixed(6))
      };
    }
    walkedM += segmentM;
  }

  return path[path.length - 1];
}

function routeSaveKey(route: RouteCandidate): string {
  const first = route.path[0];
  const last = route.path[route.path.length - 1];
  return [
    route.id,
    route.distanceM,
    route.targetDistanceM,
    first ? `${first.lng},${first.lat}` : "",
    last ? `${last.lng},${last.lat}` : ""
  ].join("|");
}

function formatLocationAccuracy(accuracyM: number): string {
  return Number.isFinite(accuracyM) ? formatAccuracy(accuracyM) : "未知";
}

function getLocationErrorMessage(error: unknown, fallback: string): string {
  const code = Number((error as { code?: unknown })?.code);
  const messages: Record<number, string> = {
    1: "定位权限被拒绝。",
    2: "暂时无法获取当前位置。",
    3: "定位超时，请稍后重试。"
  };
  return messages[code] ?? (error instanceof Error ? error.message : fallback);
}

export default function App() {
  const [origin, setOrigin] = useState<Coordinate>(DEFAULT_ORIGIN);
  const [distanceKm, setDistanceKm] = useState(5);
  const [returnToStart, setReturnToStart] = useState(true);
  const [maxOverlapPct, setMaxOverlapPct] = useState(25);
  const [showHistory, setShowHistory] = useState(true);
  const [history, setHistory] = useState<SavedRoute[]>([]);
  const [candidates, setCandidates] = useState<RouteCandidate[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [focusedHistoryId, setFocusedHistoryId] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [locationStatus, setLocationStatus] = useState<string | null>(null);
  const [isPlanning, setIsPlanning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [currentPosition, setCurrentPosition] = useState<Coordinate | null>(null);
  const [positionAccuracyM, setPositionAccuracyM] = useState<number | null>(null);
  const [navigationStatus, setNavigationStatus] = useState<string | null>(null);
  const [wakeLockStatus, setWakeLockStatus] = useState<string | null>(null);
  const [mapFocusRequest, setMapFocusRequest] = useState(0);
  const [editingHistoryId, setEditingHistoryId] = useState<string | null>(null);
  const [editingHistoryName, setEditingHistoryName] = useState("");
  const [amapConfigured, setAmapConfigured] = useState<boolean | null>(null);
  const [savedRouteKey, setSavedRouteKey] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const stopLocationWatchRef = useRef<(() => void) | null>(null);
  const simulationTimerRef = useRef<number | null>(null);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);
  const activeStepButtonRef = useRef<HTMLButtonElement | null>(null);
  const routeResultsRef = useRef<HTMLElement | null>(null);
  const navigationSectionRef = useRef<HTMLElement | null>(null);

  const selectedRoute = useMemo(
    () =>
      candidates.find((candidate) => candidate.id === selectedRouteId) ??
      candidates[0] ??
      null,
    [candidates, selectedRouteId]
  );

  const selectedRouteDeviationPct = selectedRoute
    ? ((selectedRoute.distanceM - selectedRoute.targetDistanceM) /
        selectedRoute.targetDistanceM) *
      100
    : 0;
  const selectedRouteDurationS = selectedRoute ? routeDurationS(selectedRoute) : 0;
  const selectedRouteSaveKey = selectedRoute ? routeSaveKey(selectedRoute) : null;
  const selectedRouteSaved =
    selectedRouteSaveKey !== null && selectedRouteSaveKey === savedRouteKey;
  const totalHistoryDistanceM = history.reduce(
    (total, route) => total + route.distanceM,
    0
  );
  const navigationProgress = useMemo<NavigationProgress | null>(
    () =>
      currentPosition && selectedRoute
        ? getNavigationProgress(
            currentPosition,
            selectedRoute.path,
            selectedRoute.steps
          )
        : null,
    [currentPosition, selectedRoute]
  );
  const activeStepIndex = navigationProgress?.activeStepIndex ?? 0;
  const activeStep = selectedRoute?.steps[activeStepIndex] ?? null;
  const nextStep = selectedRoute?.steps[activeStepIndex + 1] ?? null;
  const displayedSteps = useMemo(() => {
    if (!selectedRoute) {
      return [];
    }

    const stepWindowSize = 12;
    const steps = selectedRoute.steps;
    if (steps.length <= stepWindowSize) {
      return steps.map((step, index) => ({ index, step }));
    }

    const start = Math.min(
      Math.max(activeStepIndex - 4, 0),
      steps.length - stepWindowSize
    );
    return steps
      .slice(start, start + stepWindowSize)
      .map((step, offset) => ({ index: start + offset, step }));
  }, [activeStepIndex, selectedRoute]);

  useEffect(() => {
    return () => {
      stopLocationWatchRef.current?.();
      if (simulationTimerRef.current !== null) {
        window.clearInterval(simulationTimerRef.current);
      }
      void wakeLockRef.current?.release().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    if (isNavigating && window.matchMedia("(max-width: 860px)").matches) {
      return;
    }

    activeStepButtonRef.current?.scrollIntoView({
      block: "nearest",
      behavior: isNavigating ? "smooth" : "auto"
    });
  }, [activeStepIndex, isNavigating]);

  useEffect(() => {
    let disposed = false;

    async function syncWakeLock() {
      if (!isNavigating || isSimulating) {
        await wakeLockRef.current?.release().catch(() => undefined);
        wakeLockRef.current = null;
        setWakeLockStatus(null);
        return;
      }

      const wakeLock = (navigator as WakeLockNavigator).wakeLock;
      if (!wakeLock) {
        setWakeLockStatus("当前浏览器不支持屏幕常亮");
        return;
      }

      if (wakeLockRef.current) {
        return;
      }

      try {
        const lock = await wakeLock.request("screen");
        if (disposed || !isNavigating || isSimulating) {
          await lock.release().catch(() => undefined);
          return;
        }

        wakeLockRef.current = lock;
        setWakeLockStatus("屏幕常亮已开启");
        lock.addEventListener?.(
          "release",
          () => {
            if (wakeLockRef.current === lock) {
              wakeLockRef.current = null;
            }
            if (!disposed && isNavigating && !isSimulating && wakeLockRef.current === null) {
              setWakeLockStatus("屏幕常亮已被系统暂停");
            }
          },
          { once: true }
        );
      } catch {
        if (!disposed) {
          setWakeLockStatus("屏幕常亮开启失败");
        }
      }
    }

    void syncWakeLock();

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void syncWakeLock();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isNavigating, isSimulating]);

  useEffect(() => {
    Promise.all([getHistory(), getHealth()])
      .then(([routes, health]) => {
        setHistory(routes);
        setAmapConfigured(health.amapConfigured);
      })
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "初始化失败。");
      });
  }, []);

  async function handlePlan() {
    setIsPlanning(true);
    setError(null);
    setWarnings([]);
    setSaveStatus(null);

    try {
      const result: PlanRouteResponse = await planRoute({
        origin,
        distanceKm,
        returnToStart,
        maxOverlapPct
      });
      handleStopNavigation();
      setCandidates(result.candidates);
      setSelectedRouteId(result.candidates[0]?.id ?? null);
      setWarnings(result.warnings);
      setSavedRouteKey(null);
      if (window.matchMedia("(max-width: 860px)").matches) {
        window.setTimeout(() => {
          routeResultsRef.current?.scrollIntoView({
            block: "start",
            behavior: "smooth"
          });
        }, 120);
      }
    } catch (planError) {
      setError(planError instanceof Error ? planError.message : "路线规划失败。");
    } finally {
      setIsPlanning(false);
    }
  }

  function handleFocusNavigationMap() {
    setMapFocusRequest((request) => request + 1);
  }

  function scrollNavigationSectionIntoView() {
    if (!window.matchMedia("(max-width: 860px)").matches) {
      return;
    }

    window.setTimeout(() => {
      navigationSectionRef.current?.scrollIntoView({
        block: "start",
        behavior: "smooth"
      });
    }, 120);
  }

  function handleNavigationLocation(location: LocationFix) {
    if (!selectedRoute) {
      return;
    }

    setPositionAccuracyM(location.accuracyM);

    if (location.isCoarse) {
      setNavigationStatus(
        `${location.sourceLabel} 只到城市/区域级别，地图未跟随。请允许精确定位或靠近路线后重试。`
      );
      return;
    }

    if (!isUsableLocationAccuracy(location.accuracyM)) {
      setNavigationStatus(
        `${location.sourceLabel} 精度太低（约 ${formatLocationAccuracy(location.accuracyM)}），地图未跟随，继续等待更准定位。`
      );
      return;
    }

    const progress = getNavigationProgress(
      location.coordinate,
      selectedRoute.path,
      selectedRoute.steps
    );
    if (!progress) {
      setNavigationStatus("当前路线缺少可用轨迹，地图未跟随。");
      return;
    }

    if (
      progress.distanceToRouteM > MAX_ROUTE_FOLLOW_DISTANCE_M
    ) {
      setNavigationStatus(
        `当前位置距路线约 ${formatDistance(progress.distanceToRouteM)}，地图未跟随。请确认起点或靠近路线后再导航。`
      );
      return;
    }

    setCurrentPosition(location.coordinate);
    setNavigationStatus(
      progress.remainingDistanceM <= 35
        ? `${location.sourceLabel} 已接近终点，精度约 ${formatLocationAccuracy(location.accuracyM)}`
        : `${location.sourceLabel} 导航中，剩余 ${formatDistance(progress.remainingDistanceM)}，精度约 ${formatLocationAccuracy(location.accuracyM)}`
    );
  }

  function handleStartNavigation() {
    setError(null);
    setNavigationStatus(null);

    if (!selectedRoute) {
      setError("请先生成并选择一条路线。");
      return;
    }

    stopLocationWatchRef.current?.();
    if (simulationTimerRef.current !== null) {
      window.clearInterval(simulationTimerRef.current);
      simulationTimerRef.current = null;
    }
    setIsSimulating(false);
    setIsNavigating(true);
    setCurrentPosition(null);
    setPositionAccuracyM(null);
    setNavigationStatus("正在通过高德在线定位获取当前位置...");
    scrollNavigationSectionIntoView();
    stopLocationWatchRef.current = startLocationTracking({
      onLocation: handleNavigationLocation,
      onError: (locationError) => {
        setError(getLocationErrorMessage(locationError, "导航定位失败。"));
        handleStopNavigation();
      }
    });
  }

  function handleStartSimulation() {
    setError(null);
    setNavigationStatus(null);

    if (!selectedRoute) {
      setError("请先生成并选择一条路线。");
      return;
    }

    if (selectedRoute.path.length < 2) {
      setError("当前路线缺少可模拟的轨迹。");
      return;
    }

    stopLocationWatchRef.current?.();
    stopLocationWatchRef.current = null;
    if (simulationTimerRef.current !== null) {
      window.clearInterval(simulationTimerRef.current);
    }

    const path = selectedRoute.path;
    const totalM = pathLengthM(path);
    const stepM = Math.max(SIMULATION_MIN_STEP_M, totalM / SIMULATION_TARGET_TICKS);
    let traveledM = 0;

    setIsSimulating(true);
    setIsNavigating(true);
    setCurrentPosition(path[0]);
    setPositionAccuracyM(8);
    setNavigationStatus("模拟跟走中，正在沿当前路线预演...");
    setMapFocusRequest((request) => request + 1);
    scrollNavigationSectionIntoView();

    simulationTimerRef.current = window.setInterval(() => {
      traveledM = Math.min(totalM, traveledM + stepM);
      const position = pointAlongPath(path, traveledM);
      if (position) {
        setCurrentPosition(position);
      }

      const remainingM = Math.max(0, totalM - traveledM);
      setNavigationStatus(
        remainingM <= 35
          ? "模拟已到达终点"
          : `模拟跟走中，剩余 ${formatDistance(remainingM)}`
      );

      if (traveledM >= totalM) {
        if (simulationTimerRef.current !== null) {
          window.clearInterval(simulationTimerRef.current);
          simulationTimerRef.current = null;
        }
        setIsNavigating(false);
        setIsSimulating(false);
      }
    }, SIMULATION_TICK_MS);
  }

  function handleStopNavigation() {
    stopLocationWatchRef.current?.();
    stopLocationWatchRef.current = null;
    if (simulationTimerRef.current !== null) {
      window.clearInterval(simulationTimerRef.current);
      simulationTimerRef.current = null;
    }
    void wakeLockRef.current?.release().catch(() => undefined);
    wakeLockRef.current = null;
    setIsNavigating(false);
    setIsSimulating(false);
    setNavigationStatus(null);
    setWakeLockStatus(null);
    setCurrentPosition(null);
    setPositionAccuracyM(null);
  }

  async function handleLocate() {
    setError(null);
    setLocationStatus(null);
    setIsLocating(true);
    setLocationStatus("正在请求高德在线定位...");

    try {
      const location = await getCurrentLocation();
      if (location.isCoarse) {
        setLocationStatus(
          `${location.sourceLabel} 只到城市/区域级别，未更新起点。请在地图上手动点选精确起点。`
        );
        return;
      }

      if (!isUsableLocationAccuracy(location.accuracyM)) {
        setLocationStatus(
          `${location.sourceLabel} 精度太低（约 ${formatLocationAccuracy(location.accuracyM)}），未更新起点。请在地图上手动点选。`
        );
        return;
      }

      setOrigin(location.coordinate);
      setLocationStatus(
        `已使用${location.sourceLabel}，精度约 ${formatLocationAccuracy(location.accuracyM)}`
      );
    } catch (locationError) {
      setError(getLocationErrorMessage(locationError, "定位失败。"));
      setLocationStatus(null);
    } finally {
      setIsLocating(false);
    }
  }

  async function handleSave() {
    if (!selectedRoute) {
      return;
    }

    setIsSaving(true);
    setError(null);
    setSaveStatus(null);
    try {
      const saved = await saveRoute(
        selectedRoute,
        `${formatDistance(selectedRoute.distanceM)} ${selectedRoute.returnToStart ? "环线" : "路线"}`
      );
      setHistory((routes) => [saved, ...routes]);
      setFocusedHistoryId(saved.id);
      setSavedRouteKey(routeSaveKey(selectedRoute));
      setSaveStatus("已保存到历史路线");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存失败。");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteHistory(route: SavedRoute) {
    if (!window.confirm(`删除「${route.name}」？`)) {
      return;
    }

    try {
      await deleteHistoryRoute(route.id);
      setHistory((routes) => routes.filter((item) => item.id !== route.id));
      if (focusedHistoryId === route.id) {
        setFocusedHistoryId(null);
      }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除失败。");
    }
  }

  async function handleRenameHistory(id: string) {
    const name = editingHistoryName.trim();
    if (!name) {
      setError("路线名称不能为空。");
      return;
    }

    try {
      const renamed = await renameHistoryRoute(id, name);
      setHistory((routes) =>
        routes.map((route) => (route.id === id ? renamed : route))
      );
      setEditingHistoryId(null);
      setEditingHistoryName("");
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : "重命名失败。");
    }
  }

  async function handleClearHistory() {
    if (history.length === 0 || !window.confirm("清空全部历史路线？")) {
      return;
    }

    try {
      await clearHistoryRoutes();
      setHistory([]);
      setFocusedHistoryId(null);
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : "清空失败。");
    }
  }

  return (
    <main className={`app-shell ${isNavigating ? "is-navigating" : ""}`}>
      <MapCanvas
        origin={origin}
        candidates={candidates}
        selectedRouteId={selectedRoute?.id ?? null}
        history={history}
        focusedHistoryId={focusedHistoryId}
        currentPosition={currentPosition}
        activeStepIndex={activeStepIndex}
        isNavigating={isNavigating}
        focusRequest={mapFocusRequest}
        showHistory={showHistory}
        onOriginChange={setOrigin}
      />

      <aside className={`control-panel ${isNavigating ? "navigation-active" : ""}`}>
        <header className="panel-header">
          <div>
            <p>Route Planner</p>
            <h1>路线规划</h1>
          </div>
          <Route size={28} aria-hidden="true" />
        </header>

        <section className="control-section">
          <div className="field-label">
            <span className="label-title">
              <MapPin size={16} />
              起点坐标
            </span>
            <button
              className="mini-action"
              onClick={handleLocate}
              disabled={isLocating}
              type="button"
            >
              {isLocating ? <Loader2 className="spin" size={15} /> : <LocateFixed size={15} />}
              定位
            </button>
          </div>
          <div className="coordinate-grid">
            <input
              id="lng"
              type="number"
              step="0.000001"
              value={origin.lng}
              onChange={(event) =>
                setOrigin((current) => ({
                  ...current,
                  lng: Number(event.target.value)
                }))
              }
            />
            <input
              aria-label="纬度"
              type="number"
              step="0.000001"
              value={origin.lat}
              onChange={(event) =>
                setOrigin((current) => ({
                  ...current,
                  lat: Number(event.target.value)
                }))
              }
            />
          </div>
          {locationStatus ? <p className="location-status">{locationStatus}</p> : null}

          <label className="field-label" htmlFor="distance">
            目标距离
            <strong>{distanceKm.toFixed(1)} km</strong>
          </label>
          <input
            id="distance"
            type="range"
            min="1"
            max="30"
            step="0.5"
            value={distanceKm}
            disabled={isPlanning}
            onChange={(event) => setDistanceKm(Number(event.target.value))}
          />
          <div className="preset-row" aria-label="常用距离">
            {DISTANCE_PRESETS_KM.map((preset) => (
              <button
                className={`preset-chip ${distanceKm === preset ? "selected" : ""}`}
                key={preset}
                onClick={() => setDistanceKm(preset)}
                type="button"
              >
                {preset} km
              </button>
            ))}
          </div>

          <label className="field-label" htmlFor="overlap">
            最大重复率
            <strong>{maxOverlapPct}%</strong>
          </label>
          <input
            id="overlap"
            type="range"
            min="0"
            max="80"
            step="5"
            value={maxOverlapPct}
            disabled={isPlanning}
            onChange={(event) => setMaxOverlapPct(Number(event.target.value))}
          />

          <div className="switch-row">
            <label>
              <input
                type="checkbox"
                checked={returnToStart}
                onChange={(event) => setReturnToStart(event.target.checked)}
              />
              返回起点
            </label>
            <label>
              <input
                type="checkbox"
                checked={showHistory}
                onChange={(event) => setShowHistory(event.target.checked)}
              />
              历史路线
            </label>
          </div>

          <button className="primary-action" onClick={handlePlan} disabled={isPlanning}>
            {isPlanning ? <Loader2 className="spin" size={18} /> : <RefreshCw size={18} />}
            生成路线
          </button>

          {amapConfigured === false ? (
            <p className="notice warning">
              <AlertCircle size={16} />
              后端缺少 AMAP_WEB_SERVICE_KEY
            </p>
          ) : null}
          {error ? (
            <p className="notice error">
              <AlertCircle size={16} />
              {error}
            </p>
          ) : null}
          {warnings.map((warning) => (
            <p className="notice" key={warning}>
              <AlertCircle size={16} />
              {warning}
            </p>
          ))}
          {saveStatus ? (
            <p className="notice success">
              <Check size={16} />
              {saveStatus}
            </p>
          ) : null}
        </section>

        <section className="control-section route-results-section" ref={routeResultsRef}>
          <div className="section-title">
            <h2>候选路线</h2>
            {selectedRoute ? (
              <button
                className={`icon-button ${selectedRouteSaved ? "saved" : ""}`}
                onClick={handleSave}
                disabled={isSaving || selectedRouteSaved}
                aria-label={selectedRouteSaved ? "已保存" : "保存路线"}
                title={selectedRouteSaved ? "已保存" : "保存路线"}
                type="button"
              >
                {isSaving ? (
                  <Loader2 className="spin" size={17} />
                ) : selectedRouteSaved ? (
                  <Check size={17} />
                ) : (
                  <Save size={17} />
                )}
              </button>
            ) : null}
          </div>
          {selectedRoute ? (
            <div className="route-summary" aria-label="当前路线摘要">
              <div>
                <span>实际距离</span>
                <strong>{formatDistance(selectedRoute.distanceM)}</strong>
              </div>
              <div>
                <span>预计用时</span>
                <strong>{formatDuration(selectedRouteDurationS)}</strong>
              </div>
              <div>
                <span>偏差</span>
                <strong>{selectedRouteDeviationPct > 0 ? "+" : ""}{selectedRouteDeviationPct.toFixed(1)}%</strong>
              </div>
              <div>
                <span>重复</span>
                <strong>{selectedRoute.overlapPct}%</strong>
              </div>
              <div>
                <span>步骤</span>
                <strong>{selectedRoute.steps.length || "--"}</strong>
              </div>
              <div>
                <span>评分</span>
                <strong>{selectedRoute.score}</strong>
              </div>
            </div>
          ) : null}
          <div className="route-list">
            {candidates.length === 0 ? (
              <p className="empty-state">暂无候选</p>
            ) : (
              candidates.map((candidate) => (
                <button
                  className={`route-item ${
                    selectedRoute?.id === candidate.id ? "selected" : ""
                  }`}
                  key={candidate.id}
                  onClick={() => {
                    handleStopNavigation();
                    setSelectedRouteId(candidate.id);
                    setSaveStatus(null);
                  }}
                >
                  <span>{candidate.name}</span>
                  <strong>{formatDistance(candidate.distanceM)}</strong>
                  <small>
                    {formatDuration(routeDurationS(candidate))} · {candidate.steps.length || 0} 步 ·
                    重复 {candidate.overlapPct}% · 评分 {candidate.score}
                  </small>
                  {candidate.warnings.length > 0 ? (
                    <em>{candidate.warnings.join("，")}</em>
                  ) : null}
                </button>
              ))
            )}
          </div>
        </section>

        {selectedRoute ? (
          <section
            className="control-section navigation-section"
            ref={navigationSectionRef}
          >
            <div className="section-title">
              <h2>跟走导航</h2>
              <div className="navigation-actions">
                {isNavigating ? (
                  <>
                    <button
                      className="icon-button"
                      onClick={handleFocusNavigationMap}
                      aria-label="回到当前位置"
                      type="button"
                    >
                      <LocateFixed size={16} />
                    </button>
                    <button
                      className="icon-button danger"
                      onClick={handleStopNavigation}
                      aria-label="结束导航"
                      type="button"
                    >
                      <Square size={16} />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="navigation-command secondary"
                      onClick={handleStartSimulation}
                      aria-label="模拟跟走"
                      type="button"
                    >
                      <RefreshCw size={16} />
                      模拟跟走
                    </button>
                    <button
                      className="navigation-command"
                      onClick={handleStartNavigation}
                      aria-label="开始导航"
                      type="button"
                    >
                      <Navigation size={17} />
                      开始跟走
                    </button>
                  </>
                )}
              </div>
            </div>
            <div className="navigation-card">
              <span className="navigation-state">
                {navigationStatus ?? "选择路线后可开始跟走"}
              </span>
              {wakeLockStatus ? (
                <span className="navigation-state subtle">{wakeLockStatus}</span>
              ) : null}
              <strong>{activeStep?.instruction ?? "暂无分步指令"}</strong>
              <small>
                {activeStep
                  ? `${Math.round(activeStep.distanceM)} 米${stepDurationLabel(activeStep.durationS)} · 第 ${activeStepIndex + 1}/${selectedRoute.steps.length || 1} 步`
                  : "当前路线没有返回导航步骤"}
              </small>
              {nextStep ? <small>下一步：{nextStep.instruction}</small> : null}
              <div className="navigation-progress">
                <span
                  style={{
                    width: `${navigationProgress?.progressPct ?? 0}%`
                  }}
                />
              </div>
              <div className="navigation-metrics">
                <div>
                  <span>剩余</span>
                  <strong>
                    {navigationProgress
                      ? formatDistance(navigationProgress.remainingDistanceM)
                      : formatDistance(selectedRoute.distanceM)}
                  </strong>
                </div>
                <div>
                  <span>完成</span>
                  <strong>
                    {navigationProgress
                      ? `${navigationProgress.progressPct.toFixed(0)}%`
                      : "0%"}
                  </strong>
                </div>
                <div>
                  <span>距路线</span>
                  <strong>
                    {navigationProgress
                      ? `${navigationProgress.distanceToRouteM} 米`
                      : "--"}
                  </strong>
                </div>
                <div>
                  <span>精度</span>
                  <strong>
                    {positionAccuracyM !== null
                      ? formatLocationAccuracy(positionAccuracyM)
                      : "--"}
                  </strong>
                </div>
              </div>
            </div>
            <div className="step-list">
              {selectedRoute.steps.length === 0 ? (
                <p className="empty-state">暂无导航步骤</p>
              ) : (
                displayedSteps.map(({ step, index }) => (
                  <button
                    className={`step-item ${
                      index === activeStepIndex ? "active" : ""
                    }`}
                    key={step.id}
                    ref={index === activeStepIndex ? activeStepButtonRef : null}
                    type="button"
                  >
                    <span>{index + 1}</span>
                    <strong>{step.instruction}</strong>
                    <small>
                      {Math.round(step.distanceM)} 米
                      {stepDurationLabel(step.durationS)}
                      {step.road ? ` · ${step.road}` : ""}
                    </small>
                  </button>
                ))
              )}
            </div>
          </section>
        ) : null}

        <section className="control-section history-section">
          <div className="section-title">
            <h2>历史路线</h2>
            <div className="section-actions">
              <History size={18} />
              {history.length > 0 ? (
                <button
                  className="icon-button subtle"
                  onClick={handleClearHistory}
                  aria-label="清空历史路线"
                  type="button"
                >
                  <Trash2 size={16} />
                </button>
              ) : null}
            </div>
          </div>
          <div className="history-stats">
            <span>{history.length} 条</span>
            <span>累计 {formatDistance(totalHistoryDistanceM)}</span>
          </div>
          <div className="history-list">
            {history.length === 0 ? (
              <p className="empty-state">暂无历史</p>
            ) : (
              history.slice(0, 8).map((route) => (
                <div
                  className={`history-item ${
                    focusedHistoryId === route.id ? "focused" : ""
                  }`}
                  key={route.id}
                >
                  {editingHistoryId === route.id ? (
                    <>
                      <input
                        className="history-name-input"
                        value={editingHistoryName}
                        onChange={(event) =>
                          setEditingHistoryName(event.target.value)
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            void handleRenameHistory(route.id);
                          }
                          if (event.key === "Escape") {
                            setEditingHistoryId(null);
                            setEditingHistoryName("");
                          }
                        }}
                        aria-label="历史路线名称"
                        autoFocus
                      />
                      <button
                        className="icon-button subtle"
                        onClick={() => void handleRenameHistory(route.id)}
                        aria-label="保存名称"
                        type="button"
                      >
                        <Check size={16} />
                      </button>
                      <button
                        className="icon-button subtle"
                        onClick={() => {
                          setEditingHistoryId(null);
                          setEditingHistoryName("");
                        }}
                        aria-label="取消重命名"
                        type="button"
                      >
                        <X size={16} />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="history-main"
                        onClick={() =>
                          setFocusedHistoryId((current) =>
                            current === route.id ? null : route.id
                          )
                        }
                        type="button"
                      >
                        <span>{route.name}</span>
                        <small>
                          {formatDistance(route.distanceM)} ·{" "}
                          {route.returnToStart ? "环线" : "路线"}
                        </small>
                      </button>
                      <button
                        className="icon-button subtle"
                        onClick={() => {
                          setEditingHistoryId(route.id);
                          setEditingHistoryName(route.name);
                        }}
                        aria-label={`重命名 ${route.name}`}
                        type="button"
                      >
                        <Edit3 size={16} />
                      </button>
                      <button
                        className="icon-button subtle"
                        onClick={() => void handleDeleteHistory(route)}
                        aria-label={`删除 ${route.name}`}
                        type="button"
                      >
                        <Trash2 size={16} />
                      </button>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </section>
      </aside>
    </main>
  );
}
