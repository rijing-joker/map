import { loadAmap } from "./amap";
import type { Coordinate } from "./shared/types";

type AMapNamespace = Record<string, any>;

export type LocationFix = {
  coordinate: Coordinate;
  accuracyM: number;
  source: "amap" | "browser";
  sourceLabel: string;
  locationType?: string;
  isCoarse: boolean;
};

type WatchHandlers = {
  onLocation: (location: LocationFix) => void;
  onError: (error: unknown) => void;
  intervalMs?: number;
};

const AMAP_LOCATION_OPTIONS = {
  enableHighAccuracy: true,
  timeout: 12000,
  maximumAge: 3000,
  convert: true,
  GeoLocationFirst: true,
  getCityWhenFail: true,
  noIpLocate: 0,
  showButton: false,
  showMarker: false,
  panToLocation: false
};

export function isCoarseLocationType(locationType?: string): boolean {
  const normalized = locationType?.toLowerCase() ?? "";
  return normalized.includes("ip") || normalized.includes("city");
}

function toCoordinate(position: any): Coordinate | null {
  if (!position) {
    return null;
  }

  const lng =
    typeof position.getLng === "function"
      ? position.getLng()
      : Array.isArray(position)
        ? position[0]
        : position.lng;
  const lat =
    typeof position.getLat === "function"
      ? position.getLat()
      : Array.isArray(position)
        ? position[1]
        : position.lat;

  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    return null;
  }

  return {
    lng: Number(lng.toFixed(6)),
    lat: Number(lat.toFixed(6))
  };
}

function normalizeAccuracy(accuracy: unknown): number {
  const value = Number(accuracy);
  return Number.isFinite(value) ? Math.round(value) : Number.POSITIVE_INFINITY;
}

function getAmapLocation(AMap: AMapNamespace): Promise<LocationFix> {
  return new Promise((resolve, reject) => {
    const geolocation = new AMap.Geolocation(AMAP_LOCATION_OPTIONS);
    geolocation.getCurrentPosition((status: string, result: any) => {
      if (status !== "complete") {
        reject(new Error(result?.message ?? result?.info ?? "高德在线定位失败。"));
        return;
      }

      const coordinate = toCoordinate(result.position);
      if (!coordinate) {
        reject(new Error("高德在线定位未返回可用坐标。"));
        return;
      }

      const locationType = String(result.location_type ?? result.locationType ?? "");
      const isCoarse = isCoarseLocationType(locationType);
      resolve({
        coordinate,
        accuracyM: normalizeAccuracy(result.accuracy),
        source: "amap",
        sourceLabel: isCoarse ? "高德城市级定位" : "高德在线定位",
        locationType,
        isCoarse
      });
    });
  });
}

function convertGpsToAmap(
  AMap: AMapNamespace,
  coordinate: Coordinate
): Promise<Coordinate> {
  if (typeof AMap.convertFrom !== "function") {
    return Promise.resolve(coordinate);
  }

  return new Promise((resolve) => {
    AMap.convertFrom(
      [coordinate.lng, coordinate.lat],
      "gps",
      (status: string, result: any) => {
        const converted = status === "complete" ? toCoordinate(result?.locations?.[0]) : null;
        resolve(converted ?? coordinate);
      }
    );
  });
}

async function getBrowserLocation(AMap?: AMapNamespace): Promise<LocationFix> {
  if (!navigator.geolocation) {
    throw new Error("当前浏览器不支持定位。");
  }

  const position = await new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 3000
    });
  });

  const rawCoordinate = {
    lng: Number(position.coords.longitude.toFixed(6)),
    lat: Number(position.coords.latitude.toFixed(6))
  };
  const coordinate = AMap
    ? await convertGpsToAmap(AMap, rawCoordinate)
    : rawCoordinate;

  return {
    coordinate,
    accuracyM: normalizeAccuracy(position.coords.accuracy),
    source: "browser",
    sourceLabel: AMap ? "浏览器定位（已转高德坐标）" : "浏览器定位",
    locationType: "browser",
    isCoarse: false
  };
}

export async function getCurrentLocation(): Promise<LocationFix> {
  try {
    const AMap = await loadAmap();
    try {
      return await getAmapLocation(AMap);
    } catch {
      return await getBrowserLocation(AMap);
    }
  } catch {
    return getBrowserLocation();
  }
}

export function startLocationTracking({
  onLocation,
  onError,
  intervalMs = 4000
}: WatchHandlers): () => void {
  let stopped = false;
  let pending = false;
  const timerId = window.setInterval(() => {
    void tick();
  }, intervalMs);

  async function tick() {
    if (stopped || pending) {
      return;
    }

    pending = true;
    try {
      const location = await getCurrentLocation();
      if (!stopped) {
        onLocation(location);
      }
    } catch (error) {
      if (!stopped) {
        onError(error);
      }
    } finally {
      pending = false;
    }
  }

  void tick();

  return () => {
    stopped = true;
    window.clearInterval(timerId);
  };
}
