import { appendPath, parseAmapPolyline, pathDistanceM } from "./geometry";
import type { Coordinate } from "../src/shared/types";

type AmapDirectionStep = {
  polyline?: string;
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
};

export type WalkingRouteProvider = {
  getWalkingRoute(points: Coordinate[]): Promise<WalkingRoute>;
};

const formatPoint = (point: Coordinate) => `${point.lng},${point.lat}`;

export class AmapWalkingClient implements WalkingRouteProvider {
  private lastRequestAt = 0;
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

    for (let index = 1; index < points.length; index += 1) {
      const leg = await this.getWalkingLeg(points[index - 1], points[index]);
      path = appendPath(path, leg.path);
      distanceM += leg.distanceM;
    }

    return { path, distanceM };
  }

  private async getWalkingLeg(
    origin: Coordinate,
    destination: Coordinate
  ): Promise<WalkingRoute> {
    await this.waitForRateLimit();

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

      const points =
        bestPath.steps?.flatMap((step) => parseAmapPolyline(step.polyline ?? "")) ??
        [];
      const path = points.length >= 2 ? points : [origin, destination];
      const distanceM = Number(bestPath.distance) || pathDistanceM(path);

      return { path, distanceM };
    } finally {
      this.lastRequestAt = Date.now();
      clearTimeout(timeout);
    }
  }

  private async waitForRateLimit(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestAt;
    const delayMs = this.minRequestIntervalMs - elapsed;
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
