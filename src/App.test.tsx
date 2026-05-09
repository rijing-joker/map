import { fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

function mockInitialRequests() {
  vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/health") {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            ok: true,
            amapConfigured: false,
            authRequired: false
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );
    }

    if (url === "/api/routes/history") {
      return Promise.resolve(
        new Response(JSON.stringify({ routes: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      );
    }

    return Promise.reject(new Error(`Unexpected fetch: ${url}`));
  });
}

describe("App inputs", () => {
  beforeEach(() => {
    mockInitialRequests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("allows numeric fields to be cleared and retyped before blur normalization", async () => {
    const { container } = render(<App />);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/routes/history", expect.anything()));

    const lngInput = container.querySelector<HTMLInputElement>("#lng");
    const distanceInput = container.querySelector<HTMLInputElement>("#distance");
    const overlapInput = container.querySelector<HTMLInputElement>("#overlap");

    expect(lngInput).not.toBeNull();
    expect(distanceInput).not.toBeNull();
    expect(overlapInput).not.toBeNull();

    fireEvent.change(lngInput!, { target: { value: "" } });
    expect(lngInput).toHaveValue(null);

    fireEvent.change(lngInput!, { target: { value: "121.5" } });
    expect(lngInput).toHaveValue(121.5);

    fireEvent.blur(lngInput!);
    expect(lngInput).toHaveValue(121.5);

    fireEvent.change(distanceInput!, { target: { value: "" } });
    expect(distanceInput).toHaveValue(null);

    fireEvent.change(distanceInput!, { target: { value: "7.5" } });
    expect(distanceInput).toHaveValue(7.5);

    fireEvent.blur(distanceInput!);
    expect(distanceInput).toHaveValue(7.5);

    fireEvent.change(overlapInput!, { target: { value: "" } });
    expect(overlapInput).toHaveValue(null);

    fireEvent.change(overlapInput!, { target: { value: "35" } });
    expect(overlapInput).toHaveValue(35);

    fireEvent.blur(overlapInput!);
    expect(overlapInput).toHaveValue(35);
  });
});
