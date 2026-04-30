import { useEffect, useRef, useState } from "react";
import { AlertCircle, MapPin } from "lucide-react";
import { hasAmapBrowserKey, loadAmap } from "./amap";
import type { Coordinate, RouteCandidate, SavedRoute } from "./shared/types";

type MapCanvasProps = {
  origin: Coordinate;
  candidates: RouteCandidate[];
  selectedRouteId: string | null;
  history: SavedRoute[];
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
      title: "起点"
    });
    overlaysRef.current.push(originMarker);

    if (showHistory) {
      for (const route of history) {
        const historyLine = new AMap.Polyline({
          path: route.path.map(toLngLat),
          strokeColor: "#8d99a6",
          strokeOpacity: 0.28,
          strokeWeight: 5,
          lineJoin: "round"
        });
        overlaysRef.current.push(historyLine);
      }
    }

    const selected =
      candidates.find((candidate) => candidate.id === selectedRouteId) ??
      candidates[0];
    if (selected) {
      const plannedLine = new AMap.Polyline({
        path: selected.path.map(toLngLat),
        strokeColor: "#0f8b8d",
        strokeOpacity: 0.95,
        strokeWeight: 8,
        lineJoin: "round"
      });
      overlaysRef.current.push(plannedLine);
    }

    map.add(overlaysRef.current);
    const visiblePoints = [
      origin,
      ...(selected?.path ?? []),
      ...(showHistory ? history.flatMap((route) => route.path) : [])
    ];
    if (visiblePoints.length > 1) {
      map.setFitView(overlaysRef.current, false, [60, 60, 60, 420], 15);
    } else {
      map.setCenter(toLngLat(origin));
    }
  }, [origin, candidates, selectedRouteId, history, showHistory]);

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
