import type {
  ApiError,
  PlanRouteRequest,
  PlanRouteResponse,
  RouteCandidate,
  SavedRoute
} from "./shared/types";

async function parseResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = data as ApiError | null;
    throw new Error(error?.message ?? `请求失败：${response.status}`);
  }
  return data as T;
}

export async function getHealth(): Promise<{ ok: boolean; amapConfigured: boolean }> {
  const response = await fetch("/api/health");
  return parseResponse(response);
}

export async function planRoute(
  request: PlanRouteRequest
): Promise<PlanRouteResponse> {
  const response = await fetch("/api/routes/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request)
  });
  return parseResponse(response);
}

export async function getHistory(): Promise<SavedRoute[]> {
  const response = await fetch("/api/routes/history");
  const data = await parseResponse<{ routes: SavedRoute[] }>(response);
  return data.routes;
}

export async function saveRoute(
  route: RouteCandidate,
  name?: string
): Promise<SavedRoute> {
  const response = await fetch("/api/routes/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ route, name })
  });
  const data = await parseResponse<{ route: SavedRoute }>(response);
  return data.route;
}

export async function deleteHistoryRoute(id: string): Promise<void> {
  const response = await fetch(`/api/routes/history/${id}`, {
    method: "DELETE"
  });
  if (!response.ok) {
    await parseResponse(response);
  }
}

export async function renameHistoryRoute(
  id: string,
  name: string
): Promise<SavedRoute> {
  const response = await fetch(`/api/routes/history/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  });
  const data = await parseResponse<{ route: SavedRoute }>(response);
  return data.route;
}

export async function clearHistoryRoutes(): Promise<number> {
  const response = await fetch("/api/routes/history", {
    method: "DELETE"
  });
  const data = await parseResponse<{ deleted: number }>(response);
  return data.deleted;
}
