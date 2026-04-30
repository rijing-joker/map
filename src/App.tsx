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
  formatAccuracy,
  isUsableLocationAccuracy,
  MAX_ROUTE_FOLLOW_DISTANCE_M,
  distanceToPathM,
  distanceToStepM,
  nearestStepIndex
} from "./geo";
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

function formatDistance(distanceM: number): string {
  return `${(distanceM / 1000).toFixed(2)} km`;
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
  const [currentPosition, setCurrentPosition] = useState<Coordinate | null>(null);
  const [positionAccuracyM, setPositionAccuracyM] = useState<number | null>(null);
  const [navigationStatus, setNavigationStatus] = useState<string | null>(null);
  const [editingHistoryId, setEditingHistoryId] = useState<string | null>(null);
  const [editingHistoryName, setEditingHistoryName] = useState("");
  const [amapConfigured, setAmapConfigured] = useState<boolean | null>(null);
  const watchIdRef = useRef<number | null>(null);

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
  const totalHistoryDistanceM = history.reduce(
    (total, route) => total + route.distanceM,
    0
  );
  const activeStepIndex = useMemo(
    () =>
      currentPosition && selectedRoute
        ? nearestStepIndex(currentPosition, selectedRoute.steps)
        : 0,
    [currentPosition, selectedRoute]
  );
  const activeStep = selectedRoute?.steps[activeStepIndex] ?? null;
  const activeStepDistanceM = currentPosition
    ? distanceToStepM(currentPosition, activeStep ?? undefined)
    : null;

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

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
    } catch (planError) {
      setError(planError instanceof Error ? planError.message : "路线规划失败。");
    } finally {
      setIsPlanning(false);
    }
  }

  function handleStartNavigation() {
    setError(null);
    setNavigationStatus(null);

    if (!selectedRoute) {
      setError("请先生成并选择一条路线。");
      return;
    }
    if (!navigator.geolocation) {
      setError("当前浏览器不支持定位，无法开始导航。");
      return;
    }

    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }

    setIsNavigating(true);
    setCurrentPosition(null);
    setPositionAccuracyM(null);
    setNavigationStatus("正在获取当前位置...");
    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const accuracyM = Math.round(position.coords.accuracy);
        setPositionAccuracyM(accuracyM);

        if (!isUsableLocationAccuracy(accuracyM)) {
          setNavigationStatus(
            `定位精度太低（约 ${formatAccuracy(accuracyM)}），地图未跟随，继续等待更准定位`
          );
          return;
        }

        const nextPosition = {
          lng: Number(position.coords.longitude.toFixed(6)),
          lat: Number(position.coords.latitude.toFixed(6))
        };
        const routeDistanceM = distanceToPathM(nextPosition, selectedRoute.path);
        if (
          routeDistanceM !== null &&
          routeDistanceM > MAX_ROUTE_FOLLOW_DISTANCE_M
        ) {
          setNavigationStatus(
            `当前位置距路线约 ${formatDistance(routeDistanceM)}，地图未跟随。请确认起点或靠近路线后再导航`
          );
          return;
        }

        setCurrentPosition(nextPosition);
        setNavigationStatus("导航中");
      },
      (geoError) => {
        const messages: Record<number, string> = {
          [geoError.PERMISSION_DENIED]: "定位权限被拒绝，无法导航。",
          [geoError.POSITION_UNAVAILABLE]: "暂时无法获取当前位置。",
          [geoError.TIMEOUT]: "定位超时，请稍后重试。"
        };
        setError(messages[geoError.code] ?? "导航定位失败。");
        handleStopNavigation();
      },
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 3000
      }
    );
  }

  function handleStopNavigation() {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setIsNavigating(false);
    setNavigationStatus(null);
    setCurrentPosition(null);
    setPositionAccuracyM(null);
  }

  function handleLocate() {
    setError(null);
    setLocationStatus(null);

    if (!navigator.geolocation) {
      setError("当前浏览器不支持定位，请继续手动点地图或输入坐标。");
      return;
    }

    setIsLocating(true);
    setLocationStatus("正在请求浏览器定位...");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const accuracyM = Math.round(position.coords.accuracy);
        if (!isUsableLocationAccuracy(accuracyM)) {
          setLocationStatus(
            `定位精度太低（约 ${formatAccuracy(accuracyM)}），未更新起点。请在地图上手动点选。`
          );
          setIsLocating(false);
          return;
        }

        setOrigin({
          lng: Number(position.coords.longitude.toFixed(6)),
          lat: Number(position.coords.latitude.toFixed(6))
        });
        setLocationStatus(`已定位，精度约 ${formatAccuracy(accuracyM)}`);
        setIsLocating(false);
      },
      (geoError) => {
        const messages: Record<number, string> = {
          [geoError.PERMISSION_DENIED]: "定位权限被拒绝。",
          [geoError.POSITION_UNAVAILABLE]: "暂时无法获取当前位置。",
          [geoError.TIMEOUT]: "定位超时，请稍后重试。"
        };
        setError(messages[geoError.code] ?? "定位失败。");
        setLocationStatus(null);
        setIsLocating(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 60000
      }
    );
  }

  async function handleSave() {
    if (!selectedRoute) {
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const saved = await saveRoute(
        selectedRoute,
        `${formatDistance(selectedRoute.distanceM)} ${selectedRoute.returnToStart ? "环线" : "路线"}`
      );
      setHistory((routes) => [saved, ...routes]);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存失败。");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteHistory(id: string) {
    try {
      await deleteHistoryRoute(id);
      setHistory((routes) => routes.filter((route) => route.id !== id));
      if (focusedHistoryId === id) {
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
    <main className="app-shell">
      <MapCanvas
        origin={origin}
        candidates={candidates}
        selectedRouteId={selectedRoute?.id ?? null}
        history={history}
        focusedHistoryId={focusedHistoryId}
        currentPosition={currentPosition}
        activeStepIndex={activeStepIndex}
        isNavigating={isNavigating}
        showHistory={showHistory}
        onOriginChange={setOrigin}
      />

      <aside className="control-panel">
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
            onChange={(event) => setDistanceKm(Number(event.target.value))}
          />

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
        </section>

        <section className="control-section">
          <div className="section-title">
            <h2>候选路线</h2>
            {selectedRoute ? (
              <button className="icon-button" onClick={handleSave} disabled={isSaving}>
                {isSaving ? <Loader2 className="spin" size={17} /> : <Save size={17} />}
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
                <span>偏差</span>
                <strong>{selectedRouteDeviationPct > 0 ? "+" : ""}{selectedRouteDeviationPct.toFixed(1)}%</strong>
              </div>
              <div>
                <span>重复</span>
                <strong>{selectedRoute.overlapPct}%</strong>
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
                  onClick={() => setSelectedRouteId(candidate.id)}
                >
                  <span>{candidate.name}</span>
                  <strong>{formatDistance(candidate.distanceM)}</strong>
                  <small>
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
          <section className="control-section navigation-section">
            <div className="section-title">
              <h2>跟走导航</h2>
              {isNavigating ? (
                <button
                  className="icon-button danger"
                  onClick={handleStopNavigation}
                  aria-label="结束导航"
                  type="button"
                >
                  <Square size={16} />
                </button>
              ) : (
                <button
                  className="icon-button"
                  onClick={handleStartNavigation}
                  aria-label="开始导航"
                  type="button"
                >
                  <Navigation size={17} />
                </button>
              )}
            </div>
            <div className="navigation-card">
              <span className="navigation-state">
                {navigationStatus ?? "选择路线后可开始跟走"}
              </span>
              <strong>{activeStep?.instruction ?? "暂无分步指令"}</strong>
              <small>
                {activeStep
                  ? `${Math.round(activeStep.distanceM)} 米 · 第 ${activeStepIndex + 1}/${selectedRoute.steps.length || 1} 步`
                  : "当前路线没有返回导航步骤"}
              </small>
              {activeStepDistanceM !== null ? (
                <small>距当前步骤约 {activeStepDistanceM} 米</small>
              ) : null}
              {positionAccuracyM !== null ? (
                <small>定位精度约 {formatAccuracy(positionAccuracyM)}</small>
              ) : null}
            </div>
            <div className="step-list">
              {selectedRoute.steps.length === 0 ? (
                <p className="empty-state">暂无导航步骤</p>
              ) : (
                selectedRoute.steps.slice(0, 12).map((step, index) => (
                  <button
                    className={`step-item ${
                      index === activeStepIndex ? "active" : ""
                    }`}
                    key={step.id}
                    type="button"
                  >
                    <span>{index + 1}</span>
                    <strong>{step.instruction}</strong>
                    <small>
                      {Math.round(step.distanceM)} 米
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
                        aria-label="历史路线名称"
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
                        onClick={() => void handleDeleteHistory(route.id)}
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
