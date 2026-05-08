import { appendPath, parseAmapPolyline, pathDistanceM } from "./geometry";
import type { Coordinate, RouteInstructionStep } from "../src/shared/types";

type AmapDirectionStep = {
  instruction?: string;
  orientation?: string;
  road?: string;
  distance?: string;
  duration?: string;
  polyline?: string;
  action?: string;
  assistant_action?: string;
};

type AmapDirectionPath = {
  distance?: string;
  steps?: AmapDirectionStep[];
};

type AmapWalkingResponse = {
  status: string;
  info?: string;
  infocode?: string;
  route?: {
    paths?: AmapDirectionPath[];
  };
};

export type WalkingRoute = {
  path: Coordinate[];
  distanceM: number;
  steps: RouteInstructionStep[];
};

export type WalkingRouteProvider = {
  getWalkingRoute(points: Coordinate[]): Promise<WalkingRoute>;
};

const formatPoint = (point: Coordinate) => `${point.lng},${point.lat}`;
const textValue = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean).join("、") || undefined;
  }
  if (value === null || value === undefined) {
    return undefined;
  }
  return String(value).trim() || undefined;
};

export class AmapWalkingClient implements WalkingRouteProvider {
  private lastRequestAt = 0;
  private requestQueue: Promise<void> = Promise.resolve();
  private readonly minRequestIntervalMs = Number(
    process.env.AMAP_REQUEST_INTERVAL_MS ?? 450
  );

  constructor(private readonly apiKey: string) {}

  async getWalkingRoute(points: Coordinate[]): Promise<WalkingRoute> {
    if (points.length < 2) {
      throw new Error("At least two points are required to plan a walking route.");
    }

    let path: Coordinate[] = [];
    let distanceM = 0;
    const steps: RouteInstructionStep[] = [];

    for (let index = 1; index < points.length; index += 1) {
      const leg = await this.getWalkingLeg(points[index - 1], points[index]);
      path = appendPath(path, leg.path);
      distanceM += leg.distanceM;
      steps.push(...leg.steps);
    }

    return { path, distanceM, steps };
  }

  private async getWalkingLeg(
    origin: Coordinate,
    destination: Coordinate
  ): Promise<WalkingRoute> {
    return this.runRateLimited(async () => {
      const url = new URL("https://restapi.amap.com/v3/direction/walking");
      url.searchParams.set("key", this.apiKey);
      url.searchParams.set("origin", formatPoint(origin));
      url.searchParams.set("destination", formatPoint(destination));
      url.searchParams.set("output", "json");

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`AMap returned HTTP ${response.status}.`);
        }

        const data = (await response.json()) as AmapWalkingResponse;
        if (data.status !== "1") {
          throw new Error(
            `AMap walking route failed: ${data.info ?? "unknown"} (${data.infocode ?? "no code"}).`
          );
        }

        const bestPath = data.route?.paths?.[0];
        if (!bestPath) {
          throw new Error("AMap did not return a walking path.");
        }

        const steps = (bestPath.steps ?? []).map((step, index) => {
          const stepPath = parseAmapPolyline(step.polyline ?? "");
          const distanceM = Number(step.distance) || pathDistanceM(stepPath);
          const instruction = textValue(step.instruction);
          const action = textValue(step.action);
          return {
            id: crypto.randomUUID(),
            instruction:
              instruction ||
              action ||
              `继续前行 ${Math.round(distanceM)} 米`,
            road: textValue(step.road),
            action,
            assistantAction: textValue(step.assistant_action),
            distanceM: Math.round(distanceM),
            durationS: Number(step.duration) || undefined,
            path: stepPath,
            index
          };
        });

        const points = steps.flatMap((step) => step.path);
        const path = points.length >= 2 ? points : [origin, destination];
        const distanceM = Number(bestPath.distance) || pathDistanceM(path);

        return { path, distanceM, steps };
      } finally {
        clearTimeout(timeout);
      }
    });
  }

  private async runRateLimited<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.requestQueue.then(async () => {
      await this.waitForRateLimit();
      try {
        return await operation();
      } finally {
        this.lastRequestAt = Date.now();
      }
    });
    this.requestQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private async waitForRateLimit(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestAt;
    const delayMs = this.minRequestIntervalMs - elapsed;
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
