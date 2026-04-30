import { describe, expect, it } from "vitest";
import {
  appendPath,
  destinationPoint,
  haversineDistanceM,
  overlapPct,
  parseAmapPolyline,
  segmentKeysForPath
} from "./geometry";

describe("geometry utilities", () => {
  it("calculates approximate meter distance", () => {
    const start = { lng: 121.4737, lat: 31.2304 };
    const end = destinationPoint(start, 90, 1000);

    expect(haversineDistanceM(start, end)).toBeGreaterThan(995);
    expect(haversineDistanceM(start, end)).toBeLessThan(1005);
  });

  it("parses AMap polyline strings", () => {
    expect(parseAmapPolyline("121.1,31.1;121.2,31.2")).toEqual([
      { lng: 121.1, lat: 31.1 },
      { lng: 121.2, lat: 31.2 }
    ]);
  });

  it("appends paths without duplicating the connecting point", () => {
    const path = appendPath(
      [
        { lng: 1, lat: 1 },
        { lng: 2, lat: 2 }
      ],
      [
        { lng: 2, lat: 2 },
        { lng: 3, lat: 3 }
      ]
    );

    expect(path).toHaveLength(3);
    expect(path[2]).toEqual({ lng: 3, lat: 3 });
  });

  it("computes overlap against historical segment keys", () => {
    const path = [
      { lng: 121.4737, lat: 31.2304 },
      destinationPoint({ lng: 121.4737, lat: 31.2304 }, 90, 500)
    ];
    const keys = segmentKeysForPath(path);

    expect(keys.length).toBeGreaterThan(5);
    expect(overlapPct(keys, new Set(keys))).toBe(100);
    expect(overlapPct(keys, new Set())).toBe(0);
  });
});
