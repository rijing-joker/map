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

export type RouteInstructionStep = {
  id: string;
  instruction: string;
  road?: string;
  action?: string;
  assistantAction?: string;
  distanceM: number;
  durationS?: number;
  path: Coordinate[];
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
  steps: RouteInstructionStep[];
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
