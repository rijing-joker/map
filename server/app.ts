import express from "express";
import { z } from "zod";
import { AmapWalkingClient, type WalkingRouteProvider } from "./amapClient";
import { planRoutes } from "./planner";
import { RouteStore } from "./storage";
import type { ApiError, PlanRouteRequest } from "../src/shared/types";

const coordinateSchema = z.object({
  lng: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90)
});

const planRouteSchema = z.object({
  origin: coordinateSchema,
  distanceKm: z.number().min(0.5).max(50),
  returnToStart: z.boolean(),
  maxOverlapPct: z.number().min(0).max(100)
});

const saveRouteSchema = z.object({
  name: z.string().trim().max(80).optional(),
  route: z.object({
    id: z.string(),
    name: z.string(),
    distanceM: z.number(),
    targetDistanceM: z.number(),
    overlapPct: z.number(),
    score: z.number(),
    returnToStart: z.boolean(),
    path: z.array(coordinateSchema).min(2),
    waypoints: z.array(coordinateSchema).min(2),
    warnings: z.array(z.string())
  })
});

type AppOptions = {
  store?: RouteStore;
  provider?: WalkingRouteProvider;
  amapKey?: string;
};

function errorResponse(code: string, message: string, details?: unknown): ApiError {
  return { code, message, details };
}

export function createApp(options: AppOptions = {}) {
  const app = express();
  const store = options.store ?? new RouteStore();

  app.use(express.json({ limit: "2mb" }));

  app.get("/api/health", (_request, response) => {
    response.json({
      ok: true,
      amapConfigured: Boolean(options.provider || options.amapKey || process.env.AMAP_WEB_SERVICE_KEY)
    });
  });

  app.post("/api/routes/plan", async (request, response) => {
    const parsed = planRouteSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json(
        errorResponse("invalid_request", "路线参数不完整或格式不正确。", parsed.error.flatten())
      );
      return;
    }

    const amapKey = options.amapKey ?? process.env.AMAP_WEB_SERVICE_KEY;
    const provider = options.provider ?? (amapKey ? new AmapWalkingClient(amapKey) : undefined);
    if (!provider) {
      response.status(503).json(
        errorResponse(
          "missing_amap_key",
          "缺少 AMAP_WEB_SERVICE_KEY，请在 .env 中配置高德 Web 服务 Key 后再生成真实路线。"
        )
      );
      return;
    }

    try {
      const routeRequest: PlanRouteRequest = parsed.data;
      const result = await planRoutes(routeRequest, store.listRoutes(), provider);
      response.json({
        candidates: result.candidates,
        historyCount: store.listRoutes().length,
        warnings: result.warnings
      });
    } catch (error) {
      response.status(500).json(
        errorResponse(
          "route_planning_failed",
          error instanceof Error ? error.message : "路线规划失败。"
        )
      );
    }
  });

  app.get("/api/routes/history", (_request, response) => {
    response.json({ routes: store.listRoutes() });
  });

  app.post("/api/routes/save", (request, response) => {
    const parsed = saveRouteSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json(
        errorResponse("invalid_request", "保存路线参数不完整或格式不正确。", parsed.error.flatten())
      );
      return;
    }

    const saved = store.saveRoute(parsed.data.route, parsed.data.name);
    response.status(201).json({ route: saved });
  });

  app.delete("/api/routes/history/:id", (request, response) => {
    const deleted = store.deleteRoute(request.params.id);
    if (!deleted) {
      response.status(404).json(errorResponse("not_found", "没有找到这条历史路线。"));
      return;
    }
    response.status(204).send();
  });

  return { app, store };
}
