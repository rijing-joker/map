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
  focusRequest: number;
  originFocusRequest: number;
  showHistory: boolean;
  onOriginChange: (origin: Coordinate) => void;
};

type AMapNamespace = Record<string, any>;

const toLngLat = (point: Coordinate) => [point.lng, point.lat];
const isMobileViewport = () => window.matchMedia("(max-width: 860px)").matches;

function mapPadding(isNavigating: boolean): [number, number, number, number] {
  if (!isMobileViewport()) {
    return [60, 60, 60, 60];
  }

  const panelHeight = Math.min(
    window.innerHeight * (isNavigating ? 0.66 : 0.58),
    isNavigating ? 640 : 560
  );
  return [56, 24, Math.round(panelHeight + 36), 24];
}

function fitOverlays(
  map: any,
  overlays: any[],
  isNavigating: boolean,
  maxZoom: number
) {
  if (overlays.length === 0) {
    return;
  }
  map.setFitView(overlays, false, mapPadding(isNavigating), maxZoom);
}

function focusOriginInVisibleMap(
  map: any,
  origin: Coordinate,
  zoom: number
) {
  if (map.setZoomAndCenter) {
    map.setZoomAndCenter(zoom, toLngLat(origin));
  } else {
    map.setZoom?.(zoom);
    map.setCenter?.(toLngLat(origin));
  }
}

export function MapCanvas({
  origin,
  candidates,
  selectedRouteId,
  history,
  focusedHistoryId,
  currentPosition,
  activeStepIndex,
  isNavigating,
  focusRequest,
  originFocusRequest,
  showHistory,
  onOriginChange
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const amapRef = useRef<AMapNamespace | null>(null);
  const overlaysRef = useRef<any[]>([]);
  const originMarkerRef = useRef<any>(null);
  const currentMarkerRef = useRef<any>(null);
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
    originMarkerRef.current = null;
    currentMarkerRef.current = null;

    const originMarker = new AMap.Marker({
      position: toLngLat(origin),
      anchor: "bottom-center",
      title: "起点",
      zIndex: 120,
      content: '<div class="map-point map-point-origin">起</div>'
    });
    originMarkerRef.current = originMarker;
    overlaysRef.current.push(originMarker);

    if (showHistory) {
      for (const route of history) {
        const isFocused = route.id === focusedHistoryId;
        overlaysRef.current.push(
          new AMap.Polyline({
            path: route.path.map(toLngLat),
            strokeColor: isFocused ? "#b7791f" : "#8d99a6",
            strokeOpacity: isFocused ? 0.82 : 0.24,
            strokeWeight: isFocused ? 7 : 4,
            showDir: isFocused,
            zIndex: isFocused ? 30 : 10,
            lineJoin: "round"
          })
        );
      }
    }

    const selected =
      candidates.find((candidate) => candidate.id === selectedRouteId) ??
      candidates[0];

    for (const candidate of candidates) {
      if (candidate.id === selected?.id) {
        continue;
      }

      overlaysRef.current.push(
        new AMap.Polyline({
          path: candidate.path.map(toLngLat),
          strokeColor: "#586f7c",
          strokeOpacity: 0.32,
          strokeWeight: 4,
          showDir: true,
          zIndex: 20,
          lineJoin: "round"
        })
      );
    }

    if (selected) {
      overlaysRef.current.push(
        new AMap.Polyline({
          path: selected.path.map(toLngLat),
          strokeColor: "#0f8b8d",
          strokeOpacity: 0.92,
          strokeWeight: 8,
          showDir: true,
          zIndex: 40,
          lineJoin: "round"
        })
      );

      const activeStep = selected.steps[activeStepIndex];
      if (activeStep?.path.length) {
        overlaysRef.current.push(
          new AMap.Polyline({
            path: activeStep.path.map(toLngLat),
            strokeColor: "#e25d2a",
            strokeOpacity: 0.96,
            strokeWeight: 9,
            showDir: true,
            zIndex: 50,
            lineJoin: "round"
          })
        );
      }

      selected.waypoints.forEach((waypoint, index) => {
        const isFirst = index === 0;
        const isLast = index === selected.waypoints.length - 1;
        const label = isFirst
          ? "起"
          : isLast
            ? selected.returnToStart
              ? "回"
              : "终"
            : String(index);
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
            zIndex: isFirst || isLast ? 130 : 125,
            content: `<div class="map-point ${markerClass}">${label}</div>`
          })
        );
      });
    }

    if (currentPosition) {
      const currentMarker = new AMap.Marker({
        position: toLngLat(currentPosition),
        anchor: "center",
        title: "我的位置",
        zIndex: 140,
        content: '<div class="map-point map-point-current">我</div>'
      });
      currentMarkerRef.current = currentMarker;
      overlaysRef.current.push(currentMarker);
    }

    map.add(overlaysRef.current);
    if (isNavigating && currentMarkerRef.current) {
      fitOverlays(map, [currentMarkerRef.current], true, 17);
    } else if (overlaysRef.current.length > 1) {
      fitOverlays(map, overlaysRef.current, isNavigating, 15);
    } else if (originMarkerRef.current) {
      fitOverlays(map, [originMarkerRef.current], isNavigating, 16);
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

  useEffect(() => {
    const map = mapRef.current;
    if (!map || focusRequest === 0) {
      return;
    }

    if (currentMarkerRef.current) {
      fitOverlays(map, [currentMarkerRef.current], true, 17);
      return;
    }

    if (overlaysRef.current.length > 1) {
      fitOverlays(map, overlaysRef.current, isNavigating, 15);
    } else if (originMarkerRef.current) {
      fitOverlays(map, [originMarkerRef.current], isNavigating, 16);
    }
  }, [focusRequest, isNavigating]);

  useEffect(() => {
    mapRef.current?.resize?.();
  }, [isNavigating]);

  useEffect(() => {
    const map = mapRef.current;
    if (
      !map ||
      originFocusRequest === 0 ||
      !originMarkerRef.current
    ) {
      return;
    }

    focusOriginInVisibleMap(map, origin, 16);
  }, [originFocusRequest, origin]);

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
