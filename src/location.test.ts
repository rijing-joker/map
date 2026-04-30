import { describe, expect, it } from "vitest";
import { isCoarseLocationType } from "./location";

describe("location quality helpers", () => {
  it("treats IP and city results as coarse", () => {
    expect(isCoarseLocationType("ip")).toBe(true);
    expect(isCoarseLocationType("ipcity")).toBe(true);
    expect(isCoarseLocationType("h5")).toBe(false);
    expect(isCoarseLocationType("sdk")).toBe(false);
  });
});
