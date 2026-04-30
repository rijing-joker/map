import type { Coordinate } from "../src/shared/types";

const EARTH_RADIUS_M = 6371008.8;
const METERS_PER_DEGREE_LAT = 111320;

const toRad = (value: number) => (value * Math.PI) / 180;
const toDeg = (value: number) => (value * 180) / Math.PI;

export function haversineDistanceM(a: Coordinate, b: Coordinate): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function pathDistanceM(path: Coordinate[]): number {
  let distance = 0;
  for (let index = 1; index < path.length; index += 1) {
    distance += haversineDistanceM(path[index - 1], path[index]);
  }
  return distance;
}

export function destinationPoint(
  origin: Coordinate,
  bearingDegrees: number,
  distanceM: number
): Coordinate {
  const bearing = toRad(bearingDegrees);
  const angularDistance = distanceM / EARTH_RADIUS_M;
  const lat1 = toRad(origin.lat);
  const lng1 = toRad(origin.lng);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
      Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing)
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
    );

  return {
    lng: Number(toDeg(lng2).toFixed(6)),
    lat: Number(toDeg(lat2).toFixed(6))
  };
}

export function parseAmapPolyline(polyline: string): Coordinate[] {
  if (!polyline.trim()) {
    return [];
  }

  return polyline
    .split(";")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const [lng, lat] = pair.split(",").map(Number);
      return { lng, lat };
    })
    .filter((point) => Number.isFinite(point.lng) && Number.isFinite(point.lat));
}

export function appendPath(base: Coordinate[], next: Coordinate[]): Coordinate[] {
  if (base.length === 0) {
    return [...next];
  }
  if (next.length === 0) {
    return [...base];
  }

  const last = base[base.length - 1];
  const first = next[0];
  const isDuplicate =
    Math.abs(last.lng - first.lng) < 0.000001 &&
    Math.abs(last.lat - first.lat) < 0.000001;

  return isDuplicate ? [...base, ...next.slice(1)] : [...base, ...next];
}

export function samplePolyline(path: Coordinate[], everyM = 20): Coordinate[] {
  if (path.length <= 1) {
    return [...path];
  }

  const samples: Coordinate[] = [path[0]];
  let distanceSinceSample = 0;

  for (let index = 1; index < path.length; index += 1) {
    const start = path[index - 1];
    const end = path[index];
    const segmentDistance = haversineDistanceM(start, end);
    if (segmentDistance === 0) {
      continue;
    }

    let cursor = everyM - distanceSinceSample;
    while (cursor <= segmentDistance) {
      const ratio = cursor / segmentDistance;
      samples.push({
        lng: start.lng + (end.lng - start.lng) * ratio,
        lat: start.lat + (end.lat - start.lat) * ratio
      });
      cursor += everyM;
    }

    distanceSinceSample = (distanceSinceSample + segmentDistance) % everyM;
  }

  const last = path[path.length - 1];
  const tail = samples[samples.length - 1];
  if (haversineDistanceM(tail, last) > 1) {
    samples.push(last);
  }

  return samples;
}

export function pointGridKey(point: Coordinate, gridSizeM = 25): string {
  const latMeters = point.lat * METERS_PER_DEGREE_LAT;
  const lngMeters =
    point.lng * METERS_PER_DEGREE_LAT * Math.cos(toRad(point.lat));
  return `${Math.round(lngMeters / gridSizeM)}:${Math.round(
    latMeters / gridSizeM
  )}`;
}

export function segmentKeysForPath(path: Coordinate[]): string[] {
  const keys = new Set<string>();
  for (const point of samplePolyline(path, 20)) {
    keys.add(pointGridKey(point, 25));
  }
  return [...keys];
}

export function overlapPct(candidateKeys: string[], historyKeys: Set<string>): number {
  if (candidateKeys.length === 0 || historyKeys.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const key of candidateKeys) {
    if (historyKeys.has(key)) {
      overlap += 1;
    }
  }

  return (overlap / candidateKeys.length) * 100;
}
