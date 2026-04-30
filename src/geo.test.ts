import { describe, expect, it } from "vitest";
import {
  distanceM,
  distanceToPathM,
  distanceToStepM,
  formatAccuracy,
  getNavigationProgress,
  isUsableLocationAccuracy,
  nearestStepIndex
} from "./geo";
import type { RouteInstructionStep } from "./shared/types";

const steps: RouteInstructionStep[] = [
  {
    id: "one",
    instruction: "向东步行",
    distanceM: 100,
    path: [
      { lng: 121.4737, lat: 31.2304 },
      { lng: 121.4747, lat: 31.2304 }
    ]
  },
  {
    id: "two",
    instruction: "向北步行",
    distanceM: 100,
    path: [
      { lng: 121.4747, lat: 31.2304 },
      { lng: 121.4747, lat: 31.2314 }
    ]
  }
];

describe("navigation geo helpers", () => {
  it("finds the nearest instruction step", () => {
    expect(nearestStepIndex({ lng: 121.4747, lat: 31.2313 }, steps)).toBe(1);
  });

  it("reports distance to a step path", () => {
    const distance = distanceToStepM({ lng: 121.4737, lat: 31.2304 }, steps[0]);

    expect(distance).toBe(0);
    expect(distanceM(steps[0].path[0], steps[0].path[1])).toBeGreaterThan(90);
  });

  it("reports distance to a route path", () => {
    expect(distanceToPathM(steps[0].path[0], steps[0].path)).toBe(0);
    expect(distanceToPathM({ lng: 122, lat: 32 }, [])).toBeNull();
  });

  it("reports route progress from the nearest route segment", () => {
    const progress = getNavigationProgress(
      { lng: 121.4747, lat: 31.2313 },
      steps.flatMap((step, index) =>
        index === 0 ? step.path : step.path.slice(1)
      ),
      steps
    );

    expect(progress?.activeStepIndex).toBe(1);
    expect(progress?.remainingDistanceM).toBeLessThan(30);
    expect(progress?.progressPct).toBeGreaterThan(80);
  });

  it("rejects very low accuracy browser positions", () => {
    expect(isUsableLocationAccuracy(80)).toBe(true);
    expect(isUsableLocationAccuracy(100000)).toBe(false);
    expect(formatAccuracy(100000)).toBe("100.0 公里");
  });
});
