export type Coordinate = {
  lng: number;
  lat: number;
};

export type PlanRouteRequest = {
  origin: Coordinate;
  distanceKm: number;
  returnToStart: boolean;
  maxOverlapPct: number;
};

export type RouteCandidate = {
  id: string;
  name: string;
  distanceM: number;
  targetDistanceM: number;
  overlapPct: number;
  score: number;
  returnToStart: boolean;
  path: Coordinate[];
  waypoints: Coordinate[];
  warnings: string[];
};

export type SavedRoute = {
  id: string;
  name: string;
  distanceM: number;
  returnToStart: boolean;
  createdAt: string;
  path: Coordinate[];
  segmentKeys: string[];
};

export type PlanRouteResponse = {
  candidates: RouteCandidate[];
  historyCount: number;
  warnings: string[];
};

export type SaveRouteRequest = {
  name?: string;
  route: RouteCandidate;
};

export type ApiError = {
  code: string;
  message: string;
  details?: unknown;
};
