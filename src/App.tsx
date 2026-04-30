import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  History,
  Loader2,
  MapPin,
  RefreshCw,
  Route,
  Save,
  Trash2
} from "lucide-react";
import {
  deleteHistoryRoute,
  getHealth,
  getHistory,
  planRoute,
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
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPlanning, setIsPlanning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [amapConfigured, setAmapConfigured] = useState<boolean | null>(null);

  const selectedRoute = useMemo(
    () =>
      candidates.find((candidate) => candidate.id === selectedRouteId) ??
      candidates[0] ??
      null,
    [candidates, selectedRouteId]
  );

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
      setCandidates(result.candidates);
      setSelectedRouteId(result.candidates[0]?.id ?? null);
      setWarnings(result.warnings);
    } catch (planError) {
      setError(planError instanceof Error ? planError.message : "路线规划失败。");
    } finally {
      setIsPlanning(false);
    }
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
    await deleteHistoryRoute(id);
    setHistory((routes) => routes.filter((route) => route.id !== id));
  }

  return (
    <main className="app-shell">
      <MapCanvas
        origin={origin}
        candidates={candidates}
        selectedRouteId={selectedRoute?.id ?? null}
        history={history}
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
          <label className="field-label" htmlFor="lng">
            <MapPin size={16} />
            起点坐标
          </label>
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
                </button>
              ))
            )}
          </div>
        </section>

        <section className="control-section history-section">
          <div className="section-title">
            <h2>历史路线</h2>
            <History size={18} />
          </div>
          <div className="history-list">
            {history.length === 0 ? (
              <p className="empty-state">暂无历史</p>
            ) : (
              history.slice(0, 8).map((route) => (
                <div className="history-item" key={route.id}>
                  <span>{route.name}</span>
                  <small>{formatDistance(route.distanceM)}</small>
                  <button
                    className="icon-button subtle"
                    onClick={() => void handleDeleteHistory(route.id)}
                    aria-label={`删除 ${route.name}`}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))
            )}
          </div>
        </section>
      </aside>
    </main>
  );
}
