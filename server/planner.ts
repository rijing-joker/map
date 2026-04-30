import type {
  Coordinate,
  PlanRouteRequest,
  RouteCandidate,
  SavedRoute
} from "../src/shared/types";
import {
  destinationPoint,
  overlapPct,
  pathDistanceM,
  segmentKeysForPath
} from "./geometry";
import type { WalkingRouteProvider } from "./amapClient";

const MAX_ATTEMPTS = 12;
const DISTANCE_TOLERANCE_PCT = 5;
const TARGET_CANDIDATE_COUNT = 3;

type CandidateShape = {
  id: string;
  name: string;
  waypoints: Coordinate[];
};

function buildHistoryKeySet(history: SavedRoute[]): Set<string> {
  const keys = new Set<string>();
  for (const route of history) {
    for (const key of route.segmentKeys) {
      keys.add(key);
    }
  }
  return keys;
}

function ringShapes(origin: Coordinate, targetDistanceM: number): CandidateShape[] {
  const shapes: CandidateShape[] = [];
  const bearings = [0, 35, 70, 110, 145, 190, 230, 275, 315, 340];

  for (let index = 0; index < bearings.length; index += 1) {
    const bearing = bearings[index];
    const triangleRadius = targetDistanceM / (2 * 3 * Math.sin(Math.PI / 3));
    const squareRadius = targetDistanceM / (2 * 4 * Math.sin(Math.PI / 4));
    const triangleScale = 0.88 + (index % 4) * 0.06;
    const squareScale = 0.9 + (index % 3) * 0.08;

    shapes.push({
      id: `ring-triangle-${index}`,
      name: `环线 ${index + 1}`,
      waypoints: [
        origin,
        destinationPoint(origin, bearing, triangleRadius * triangleScale),
        destinationPoint(origin, bearing + 120, triangleRadius * triangleScale),
        origin
      ]
    });

    shapes.push({
      id: `ring-square-${index}`,
      name: `环线 ${index + 11}`,
      waypoints: [
        origin,
        destinationPoint(origin, bearing, squareRadius * squareScale),
        destinationPoint(origin, bearing + 90, squareRadius * squareScale),
        destinationPoint(origin, bearing + 180, squareRadius * squareScale),
        origin
      ]
    });
  }

  return shapes.slice(0, MAX_ATTEMPTS);
}

function pointToPointShapes(
  origin: Coordinate,
  targetDistanceM: number
): CandidateShape[] {
  const shapes: CandidateShape[] = [];
  const bearings = [0, 25, 55, 90, 130, 170, 215, 260, 300, 335];

  for (let index = 0; index < bearings.length; index += 1) {
    const bearing = bearings[index];
    const scale = 0.9 + (index % 4) * 0.05;
    const end = destinationPoint(origin, bearing, targetDistanceM * scale);
    const mid = destinationPoint(origin, bearing + (index % 2 === 0 ? 22 : -22), targetDistanceM * 0.48);

    shapes.push({
      id: `line-${index}`,
      name: `路线 ${index + 1}`,
      waypoints: [origin, mid, end]
    });
  }

  return shapes.slice(0, MAX_ATTEMPTS);
}

function scoreCandidate(
  distanceM: number,
  targetDistanceM: number,
  overlap: number
): number {
  const distanceErrorPct = Math.abs(distanceM - targetDistanceM) / targetDistanceM * 100;
  const score = 100 - distanceErrorPct * 3 - overlap * 1.8;
  return Math.max(0, Math.round(score));
}

export async function planRoutes(
  request: PlanRouteRequest,
  history: SavedRoute[],
  provider: WalkingRouteProvider
): Promise<{ candidates: RouteCandidate[]; warnings: string[] }> {
  const targetDistanceM = request.distanceKm * 1000;
  const historyKeys = buildHistoryKeySet(history);
  const shapes = request.returnToStart
    ? ringShapes(request.origin, targetDistanceM)
    : pointToPointShapes(request.origin, targetDistanceM);
  const candidates: RouteCandidate[] = [];
  const warnings: string[] = [];
  let rateLimitWarningAdded = false;

  for (const shape of shapes) {
    try {
      const route = await provider.getWalkingRoute(shape.waypoints);
      const path = route.path.length >= 2 ? route.path : shape.waypoints;
      const distanceM = route.distanceM || pathDistanceM(path);
      const segmentKeys = segmentKeysForPath(path);
      const overlap = overlapPct(segmentKeys, historyKeys);
      const distanceErrorPct = Math.abs(distanceM - targetDistanceM) / targetDistanceM * 100;
      const routeWarnings: string[] = [];

      if (distanceErrorPct > DISTANCE_TOLERANCE_PCT) {
        routeWarnings.push(`距离偏差 ${distanceErrorPct.toFixed(1)}%`);
      }
      if (overlap > request.maxOverlapPct) {
        routeWarnings.push(`重复率超过上限 ${overlap.toFixed(1)}%`);
      }

      candidates.push({
        id: shape.id,
        name: shape.name,
        distanceM: Math.round(distanceM),
        targetDistanceM,
        overlapPct: Number(overlap.toFixed(1)),
        score: scoreCandidate(distanceM, targetDistanceM, overlap),
        returnToStart: request.returnToStart,
        path,
        waypoints: shape.waypoints,
        steps: route.steps ?? [],
        warnings: routeWarnings
      });

      const qualifiedCandidates = candidates.filter((candidate) => {
        const distanceErrorPct =
          Math.abs(candidate.distanceM - targetDistanceM) / targetDistanceM * 100;
        return (
          distanceErrorPct <= DISTANCE_TOLERANCE_PCT &&
          candidate.overlapPct <= request.maxOverlapPct
        );
      });

      if (qualifiedCandidates.length >= TARGET_CANDIDATE_COUNT) {
        break;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("CUQPS_HAS_EXCEEDED_THE_LIMIT")) {
        if (!rateLimitWarningAdded) {
          warnings.push("高德路径规划请求过快，已停止继续尝试并返回当前可用候选。");
          rateLimitWarningAdded = true;
        }
        break;
      }
      warnings.push(`${shape.name} 规划失败：${message}`);
    }
  }

  const sorted = candidates.sort((a, b) => {
    const aPasses =
      Math.abs(a.distanceM - targetDistanceM) / targetDistanceM * 100 <=
        DISTANCE_TOLERANCE_PCT && a.overlapPct <= request.maxOverlapPct;
    const bPasses =
      Math.abs(b.distanceM - targetDistanceM) / targetDistanceM * 100 <=
        DISTANCE_TOLERANCE_PCT && b.overlapPct <= request.maxOverlapPct;

    if (aPasses !== bPasses) {
      return aPasses ? -1 : 1;
    }
    return b.score - a.score;
  });

  const selected = sorted.slice(0, 3);
  if (selected.length === 0) {
    warnings.push("没有找到可用路线，请换一个起点或放宽距离/重复率限制。");
  } else if (selected.every((candidate) => candidate.warnings.length > 0)) {
    warnings.push("未找到完全满足条件的路线，已返回当前评分最高的候选。");
  }

  return { candidates: selected, warnings };
}
