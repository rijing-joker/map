import type { Coordinate, RouteInstructionStep } from "./shared/types";

const EARTH_RADIUS_M = 6371008.8;

const toRad = (value: number) => (value * Math.PI) / 180;

export function distanceM(a: Coordinate, b: Coordinate): number {
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

export function nearestStepIndex(
  position: Coordinate,
  steps: RouteInstructionStep[]
): number {
  if (steps.length === 0) {
    return 0;
  }

  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  steps.forEach((step, index) => {
    const points = step.path.length > 0 ? step.path : [];
    for (const point of points) {
      const candidateDistance = distanceM(position, point);
      if (candidateDistance < bestDistance) {
        bestDistance = candidateDistance;
        bestIndex = index;
      }
    }
  });

  return bestIndex;
}

export function distanceToStepM(
  position: Coordinate,
  step?: RouteInstructionStep
): number | null {
  if (!step || step.path.length === 0) {
    return null;
  }

  return Math.round(
    Math.min(...step.path.map((point) => distanceM(position, point)))
  );
}
