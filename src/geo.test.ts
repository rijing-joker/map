import { describe, expect, it } from "vitest";
import { distanceM, distanceToStepM, nearestStepIndex } from "./geo";
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
});
