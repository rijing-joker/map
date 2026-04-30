import { describe, expect, it } from "vitest";
import type { Coordinate } from "../src/shared/types";
import type { WalkingRouteProvider } from "./amapClient";
import { destinationPoint, pathDistanceM, segmentKeysForPath } from "./geometry";
import { planRoutes } from "./planner";

const provider: WalkingRouteProvider = {
  async getWalkingRoute(points: Coordinate[]) {
    return {
      path: points,
      distanceM: pathDistanceM(points)
    };
  }
};

describe("route planner", () => {
  it("returns scored loop candidates", async () => {
    const result = await planRoutes(
      {
        origin: { lng: 121.4737, lat: 31.2304 },
        distanceKm: 5,
        returnToStart: true,
        maxOverlapPct: 25
      },
      [],
      provider
    );

    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.length).toBeLessThanOrEqual(3);
    expect(result.candidates[0].returnToStart).toBe(true);
    expect(result.candidates[0].distanceM).toBeGreaterThan(4500);
    expect(result.candidates[0].distanceM).toBeLessThan(5500);
  });

  it("uses history overlap in candidate scoring", async () => {
    const origin = { lng: 121.4737, lat: 31.2304 };
    const savedPath = [
      origin,
      destinationPoint(origin, 0, 900),
      destinationPoint(origin, 120, 900),
      origin
    ];

    const result = await planRoutes(
      {
        origin,
        distanceKm: 5,
        returnToStart: true,
        maxOverlapPct: 1
      },
      [
        {
          id: "history-1",
          name: "history",
          distanceM: 5000,
          returnToStart: true,
          createdAt: new Date().toISOString(),
          path: savedPath,
          segmentKeys: segmentKeysForPath(savedPath)
        }
      ],
      provider
    );

    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates[0].score).toBeGreaterThanOrEqual(0);
  });
});
