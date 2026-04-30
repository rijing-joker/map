import { useEffect, useRef, useState } from "react";
import { AlertCircle, MapPin } from "lucide-react";
import { hasAmapBrowserKey, loadAmap } from "./amap";
import type { Coordinate, RouteCandidate, SavedRoute } from "./shared/types";

type MapCanvasProps = {
  origin: Coordinate;
  candidates: RouteCandidate[];
  selectedRouteId: string | null;
  history: SavedRoute[];
  focusedHistoryId: string | null;
  currentPosition: Coordinate | null;
  activeStepIndex: number;
  isNavigating: boolean;
  showHistory: boolean;
  onOriginChange: (origin: Coordinate) => void;
};

type AMapNamespace = Record<string, any>;

const toLngLat = (point: Coordinate) => [point.lng, point.lat];

export function MapCanvas({
  origin,
  candidates,
  selectedRouteId,
  history,
  focusedHistoryId,
  currentPosition,
  activeStepIndex,
  isNavigating,
  showHistory,
  onOriginChange
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const amapRef = useRef<AMapNamespace | null>(null);
  const overlaysRef = useRef<any[]>([]);
  const [loadError, setLoadError] = useState<string | null>(
    hasAmapBrowserKey() ? null : "缺少 VITE_AMAP_JS_KEY，地图暂不可用。"
  );

  useEffect(() => {
    if (!containerRef.current || !hasAmapBrowserKey()) {
      return;
    }

    let disposed = false;

    loadAmap()
      .then((AMap) => {
        if (disposed || !containerRef.current) {
          return;
        }

        amapRef.current = AMap;
        mapRef.current = new AMap.Map(containerRef.current, {
          center: toLngLat(origin),
          zoom: 14,
          viewMode: "2D"
        });

        mapRef.current.addControl(new AMap.Scale());
        mapRef.current.addControl(new AMap.ToolBar({ position: "RB" }));
        mapRef.current.on("click", (event: any) => {
          onOriginChange({
            lng: Number(event.lnglat.lng.toFixed(6)),
            lat: Number(event.lnglat.lat.toFixed(6))
          });
        });
      })
      .catch((error) => {
        setLoadError(error instanceof Error ? error.message : "地图加载失败。");
      });

    return () => {
      disposed = true;
      mapRef.current?.destroy?.();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const AMap = amapRef.current;
    const map = mapRef.current;
    if (!AMap || !map) {
      return;
    }

    overlaysRef.current.forEach((overlay) => map.remove(overlay));
    overlaysRef.current = [];

    const originMarker = new AMap.Marker({
      position: toLngLat(origin),
      anchor: "bottom-center",
      title: "起点",
      content: '<div class="map-point map-point-origin">起</div>'
    });
    overlaysRef.current.push(originMarker);

    if (showHistory) {
      for (const route of history) {
        const isFocused = route.id === focusedHistoryId;
        const historyLine = new AMap.Polyline({
          path: route.path.map(toLngLat),
          strokeColor: isFocused ? "#b7791f" : "#8d99a6",
          strokeOpacity: isFocused ? 0.82 : 0.26,
          strokeWeight: isFocused ? 7 : 5,
          lineJoin: "round"
        });
        overlaysRef.current.push(historyLine);
      }
    }

    const selected =
      candidates.find((candidate) => candidate.id === selectedRouteId) ??
      candidates[0];

    for (const candidate of candidates) {
      if (candidate.id === selected?.id) {
        continue;
      }

      const candidateLine = new AMap.Polyline({
        path: candidate.path.map(toLngLat),
        strokeColor: "#2f9ea3",
        strokeOpacity: 0.22,
        strokeWeight: 5,
        lineJoin: "round"
      });
      overlaysRef.current.push(candidateLine);
    }

    if (selected) {
      const plannedLine = new AMap.Polyline({
        path: selected.path.map(toLngLat),
        strokeColor: "#0f8b8d",
        strokeOpacity: 0.82,
        strokeWeight: 7,
        lineJoin: "round"
      });
      overlaysRef.current.push(plannedLine);

      const activeStep = selected.steps[activeStepIndex];
      if (activeStep?.path.length) {
        overlaysRef.current.push(
          new AMap.Polyline({
            path: activeStep.path.map(toLngLat),
            strokeColor: "#e25d2a",
            strokeOpacity: 0.96,
            strokeWeight: 9,
            lineJoin: "round"
          })
        );
      }

      selected.waypoints.forEach((waypoint, index) => {
        const isFirst = index === 0;
        const isLast = index === selected.waypoints.length - 1;
        const label = isFirst ? "起" : isLast ? (selected.returnToStart ? "回" : "终") : "途";
        const markerClass = isFirst
          ? "map-point-origin"
          : isLast
            ? "map-point-end"
            : "map-point-waypoint";
        overlaysRef.current.push(
          new AMap.Marker({
            position: toLngLat(waypoint),
            anchor: "center",
            title: label,
            content: `<div class="map-point ${markerClass}">${label}</div>`
          })
        );
      });
    }

    if (currentPosition) {
      overlaysRef.current.push(
        new AMap.Marker({
          position: toLngLat(currentPosition),
          anchor: "center",
          title: "当前位置",
          content: '<div class="map-point map-point-current">我</div>'
        })
      );
    }

    map.add(overlaysRef.current);
    const visiblePoints = [
      origin,
      ...(selected?.path ?? []),
      ...(currentPosition ? [currentPosition] : []),
      ...(showHistory ? history.flatMap((route) => route.path) : [])
    ];
    if (isNavigating && currentPosition) {
      map.setCenter(toLngLat(currentPosition));
      map.setZoom(Math.max(map.getZoom?.() ?? 16, 16));
    } else if (visiblePoints.length > 1) {
      map.setFitView(overlaysRef.current, false, [60, 60, 60, 420], 15);
    } else {
      map.setCenter(toLngLat(origin));
    }
  }, [
    origin,
    candidates,
    selectedRouteId,
    history,
    focusedHistoryId,
    currentPosition,
    activeStepIndex,
    isNavigating,
    showHistory
  ]);

  return (
    <section className="map-surface" aria-label="路线地图">
      <div ref={containerRef} className="map-root" />
      {loadError ? (
        <div className="map-empty">
          <AlertCircle size={22} />
          <span>{loadError}</span>
        </div>
      ) : null}
      <div className="origin-chip">
        <MapPin size={16} />
        <span>
          {origin.lng.toFixed(5)}, {origin.lat.toFixed(5)}
        </span>
      </div>
    </section>
  );
}
