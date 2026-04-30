import type { Coordinate, RouteInstructionStep } from "./shared/types";

const EARTH_RADIUS_M = 6371008.8;
export const MAX_USABLE_LOCATION_ACCURACY_M = 250;
export const MAX_ROUTE_FOLLOW_DISTANCE_M = 500;

const toRad = (value: number) => (value * Math.PI) / 180;

export type NavigationProgress = {
  activeStepIndex: number;
  distanceToRouteM: number;
  progressPct: number;
  remainingDistanceM: number;
  routeDistanceM: number;
  traveledDistanceM: number;
};

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

function toLocalMeters(point: Coordinate, origin: Coordinate) {
  const lat = toRad(origin.lat);
  return {
    x: toRad(point.lng - origin.lng) * EARTH_RADIUS_M * Math.cos(lat),
    y: toRad(point.lat - origin.lat) * EARTH_RADIUS_M
  };
}

function segmentProjection(
  point: Coordinate,
  start: Coordinate,
  end: Coordinate
) {
  const localPoint = toLocalMeters(point, start);
  const localEnd = toLocalMeters(end, start);
  const segmentLengthSq =
    localEnd.x * localEnd.x + localEnd.y * localEnd.y;
  const ratio =
    segmentLengthSq === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            (localPoint.x * localEnd.x + localPoint.y * localEnd.y) /
              segmentLengthSq
          )
        );
  const closestX = localEnd.x * ratio;
  const closestY = localEnd.y * ratio;
  const dx = localPoint.x - closestX;
  const dy = localPoint.y - closestY;

  return {
    distanceM: Math.sqrt(dx * dx + dy * dy),
    ratio
  };
}

export function pathDistanceM(path: Coordinate[]): number {
  let total = 0;
  for (let index = 1; index < path.length; index += 1) {
    total += distanceM(path[index - 1], path[index]);
  }
  return total;
}

function nearestPathProgress(position: Coordinate, path: Coordinate[]) {
  if (path.length === 0) {
    return null;
  }

  if (path.length === 1) {
    return {
      distanceToRouteM: distanceM(position, path[0]),
      routeDistanceM: 0,
      traveledDistanceM: 0
    };
  }

  let walkedBeforeSegmentM = 0;
  let bestDistanceM = Number.POSITIVE_INFINITY;
  let bestTraveledDistanceM = 0;

  for (let index = 1; index < path.length; index += 1) {
    const start = path[index - 1];
    const end = path[index];
    const segmentLengthM = distanceM(start, end);
    const projection = segmentProjection(position, start, end);
    if (projection.distanceM < bestDistanceM) {
      bestDistanceM = projection.distanceM;
      bestTraveledDistanceM =
        walkedBeforeSegmentM + projection.ratio * segmentLengthM;
    }
    walkedBeforeSegmentM += segmentLengthM;
  }

  return {
    distanceToRouteM: bestDistanceM,
    routeDistanceM: walkedBeforeSegmentM,
    traveledDistanceM: bestTraveledDistanceM
  };
}

function stepIndexForDistance(
  traveledDistanceM: number,
  steps: RouteInstructionStep[]
): number {
  if (steps.length === 0) {
    return 0;
  }

  let stepEndM = 0;
  for (let index = 0; index < steps.length; index += 1) {
    stepEndM += Math.max(0, steps[index].distanceM);
    if (traveledDistanceM <= stepEndM) {
      return index;
    }
  }

  return steps.length - 1;
}

export function getNavigationProgress(
  position: Coordinate,
  path: Coordinate[],
  steps: RouteInstructionStep[]
): NavigationProgress | null {
  const progress = nearestPathProgress(position, path);
  if (!progress) {
    return null;
  }

  const routeDistanceM = progress.routeDistanceM || pathDistanceM(path);
  if (routeDistanceM <= 0) {
    return {
      activeStepIndex: 0,
      distanceToRouteM: Math.round(progress.distanceToRouteM),
      progressPct: 0,
      remainingDistanceM: 0,
      routeDistanceM: 0,
      traveledDistanceM: 0
    };
  }

  const traveledDistanceM = Math.min(
    routeDistanceM,
    Math.max(0, progress.traveledDistanceM)
  );
  const remainingDistanceM = Math.max(0, routeDistanceM - traveledDistanceM);

  return {
    activeStepIndex: stepIndexForDistance(traveledDistanceM, steps),
    distanceToRouteM: Math.round(progress.distanceToRouteM),
    progressPct: Math.min(
      100,
      Math.max(0, (traveledDistanceM / routeDistanceM) * 100)
    ),
    remainingDistanceM: Math.round(remainingDistanceM),
    routeDistanceM: Math.round(routeDistanceM),
    traveledDistanceM: Math.round(traveledDistanceM)
  };
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

export function distanceToPathM(
  position: Coordinate,
  path: Coordinate[]
): number | null {
  const progress = nearestPathProgress(position, path);
  return progress ? Math.round(progress.distanceToRouteM) : null;
}

export function isUsableLocationAccuracy(accuracyM: number): boolean {
  return Number.isFinite(accuracyM) && accuracyM <= MAX_USABLE_LOCATION_ACCURACY_M;
}

export function formatAccuracy(accuracyM: number): string {
  if (accuracyM >= 1000) {
    return `${(accuracyM / 1000).toFixed(1)} 公里`;
  }
  return `${Math.round(accuracyM)} 米`;
}
