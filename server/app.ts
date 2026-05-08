import express from "express";
import { timingSafeEqual } from "node:crypto";
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
    steps: z
      .array(
        z.object({
          id: z.string(),
          instruction: z.string(),
          road: z.string().optional(),
          action: z.string().optional(),
          assistantAction: z.string().optional(),
          distanceM: z.number(),
          durationS: z.number().optional(),
          path: z.array(coordinateSchema)
        })
      )
      .optional(),
    warnings: z.array(z.string())
  })
});

const renameRouteSchema = z.object({
  name: z.string().trim().min(1).max(80)
});

type AppOptions = {
  store?: RouteStore;
  provider?: WalkingRouteProvider;
  amapKey?: string;
  accessToken?: string;
};

function errorResponse(code: string, message: string, details?: unknown): ApiError {
  return { code, message, details };
}

function extractAccessToken(header?: string): string | null {
  if (!header) {
    return null;
  }

  const [scheme, value] = header.split(/\s+/, 2);
  if (scheme?.toLowerCase() === "bearer" && value) {
    return value;
  }

  return header;
}

function tokensMatch(actual: string | null, expected: string): boolean {
  if (!actual) {
    return false;
  }

  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

export function createApp(options: AppOptions = {}) {
  const app = express();
  const store = options.store ?? new RouteStore();
  const accessToken = options.accessToken ?? process.env.API_ACCESS_TOKEN ?? "";
  const amapKey = options.amapKey ?? process.env.AMAP_WEB_SERVICE_KEY;
  const provider = options.provider ?? (amapKey ? new AmapWalkingClient(amapKey) : undefined);

  app.use(express.json({ limit: "2mb" }));

  app.get("/api/health", (_request, response) => {
    response.json({
      ok: true,
      amapConfigured: Boolean(provider),
      authRequired: Boolean(accessToken)
    });
  });

  app.use("/api/routes", (request, response, next) => {
    if (!accessToken) {
      next();
      return;
    }

    const headerToken =
      extractAccessToken(request.header("authorization")) ??
      request.header("x-api-access-token") ??
      null;
    if (!tokensMatch(headerToken, accessToken)) {
      response
        .status(401)
        .json(errorResponse("auth_required", "需要访问令牌后才能使用路线接口。"));
      return;
    }

    next();
  });

  app.post("/api/routes/plan", async (request, response) => {
    const parsed = planRouteSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json(
        errorResponse("invalid_request", "路线参数不完整或格式不正确。", parsed.error.flatten())
      );
      return;
    }

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

  app.delete("/api/routes/history", (_request, response) => {
    response.json({ deleted: store.clearRoutes() });
  });

  app.post("/api/routes/save", (request, response) => {
    const parsed = saveRouteSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json(
        errorResponse("invalid_request", "保存路线参数不完整或格式不正确。", parsed.error.flatten())
      );
      return;
    }

    const saved = store.saveRoute(
      { ...parsed.data.route, steps: parsed.data.route.steps ?? [] },
      parsed.data.name
    );
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

  app.put("/api/routes/history/:id", (request, response) => {
    const parsed = renameRouteSchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json(
        errorResponse("invalid_request", "路线名称不能为空，且不能超过 80 个字符。", parsed.error.flatten())
      );
      return;
    }

    const route = store.renameRoute(request.params.id, parsed.data.name);
    if (!route) {
      response.status(404).json(errorResponse("not_found", "没有找到这条历史路线。"));
      return;
    }
    response.json({ route });
  });

  return { app, store };
}
