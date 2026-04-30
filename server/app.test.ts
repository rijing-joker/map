// @vitest-environment node
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AddressInfo } from "node:net";
import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import type { WalkingRouteProvider } from "./amapClient";
import type { Coordinate, RouteCandidate, SavedRoute } from "../src/shared/types";
import { pathDistanceM } from "./geometry";
import { RouteStore } from "./storage";

const provider: WalkingRouteProvider = {
  async getWalkingRoute(points: Coordinate[]) {
    return {
      path: points,
      distanceM: pathDistanceM(points)
    };
  }
};

const stores: RouteStore[] = [];

afterEach(() => {
  while (stores.length > 0) {
    stores.pop()?.close();
  }
});

async function callApi(
  path: string,
  init?: RequestInit,
  store = makeStore()
): Promise<Response> {
  const { app } = createApp({ provider, store });
  const server = createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address() as AddressInfo;
  try {
    return await fetch(`http://127.0.0.1:${address.port}${path}`, init);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function makeStore(): RouteStore {
  const dbPath = join(mkdtempSync(join(tmpdir(), "map-route-test-")), "routes.sqlite");
  const store = new RouteStore(dbPath);
  stores.push(store);
  return store;
}

describe("route API", () => {
  it("reports health", async () => {
    const response = await callApi("/api/health");
    const body = (await response.json()) as {
      ok: boolean;
      amapConfigured: boolean;
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.amapConfigured).toBe(true);
  });

  it("plans, saves, renames, lists, and deletes a route", async () => {
    const store = makeStore();
    const planResponse = await callApi(
      "/api/routes/plan",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origin: { lng: 121.4737, lat: 31.2304 },
          distanceKm: 5,
          returnToStart: true,
          maxOverlapPct: 25
        })
      },
      store
    );
    const planBody = (await planResponse.json()) as {
      candidates: RouteCandidate[];
    };

    expect(planResponse.status).toBe(200);
    expect(planBody.candidates.length).toBeGreaterThan(0);

    const saveResponse = await callApi(
      "/api/routes/save",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "morning loop",
          route: planBody.candidates[0]
        })
      },
      store
    );
    const saveBody = (await saveResponse.json()) as {
      route: SavedRoute;
    };

    expect(saveResponse.status).toBe(201);
    expect(saveBody.route.name).toBe("morning loop");

    const renameResponse = await callApi(
      `/api/routes/history/${saveBody.route.id}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "renamed loop" })
      },
      store
    );
    const renameBody = (await renameResponse.json()) as {
      route: SavedRoute;
    };

    expect(renameResponse.status).toBe(200);
    expect(renameBody.route.name).toBe("renamed loop");

    const historyResponse = await callApi("/api/routes/history", undefined, store);
    const historyBody = (await historyResponse.json()) as {
      routes: SavedRoute[];
    };

    expect(historyBody.routes).toHaveLength(1);

    const deleteResponse = await callApi(
      `/api/routes/history/${saveBody.route.id}`,
      { method: "DELETE" },
      store
    );

    expect(deleteResponse.status).toBe(204);
    expect(store.listRoutes()).toHaveLength(0);
  });

  it("clears all history routes", async () => {
    const store = makeStore();
    const planResponse = await callApi(
      "/api/routes/plan",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origin: { lng: 121.4737, lat: 31.2304 },
          distanceKm: 5,
          returnToStart: true,
          maxOverlapPct: 25
        })
      },
      store
    );
    const planBody = (await planResponse.json()) as {
      candidates: RouteCandidate[];
    };

    store.saveRoute(planBody.candidates[0], "one");
    store.saveRoute(planBody.candidates[0], "two");

    const clearResponse = await callApi(
      "/api/routes/history",
      { method: "DELETE" },
      store
    );
    const clearBody = (await clearResponse.json()) as {
      deleted: number;
    };

    expect(clearResponse.status).toBe(200);
    expect(clearBody.deleted).toBe(2);
    expect(store.listRoutes()).toHaveLength(0);
  });
});
