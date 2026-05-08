import type {
  ApiError,
  PlanRouteRequest,
  PlanRouteResponse,
  RouteCandidate,
  SavedRoute
} from "./shared/types";

const ACCESS_TOKEN_STORAGE_KEY = "map-route-planner.accessToken";

function getStoredAccessToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY);
}

function setStoredAccessToken(token: string): void {
  window.localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, token);
}

function clearStoredAccessToken(): void {
  window.localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
}

function authHeaders(): HeadersInit {
  const token = getStoredAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function parseResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = data as ApiError | null;
    if (response.status === 401 && error?.code === "auth_required") {
      clearStoredAccessToken();
      throw new Error("需要访问令牌，请先输入后重试。");
    }
    throw new Error(error?.message ?? `请求失败：${response.status}`);
  }
  return data as T;
}

async function authedFetch<T>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<T> {
  const withHeaders = {
    ...init,
    headers: {
      ...authHeaders(),
      ...(init?.headers ?? {})
    }
  };
  const response = await fetch(input, withHeaders);
  return parseResponse(response);
}

export function hasStoredAccessToken(): boolean {
  return Boolean(getStoredAccessToken());
}

export function promptForAccessToken(): boolean {
  const token = window.prompt("请输入路线访问令牌");
  if (!token?.trim()) {
    return false;
  }

  setStoredAccessToken(token.trim());
  return true;
}

export async function getHealth(): Promise<{
  ok: boolean;
  amapConfigured: boolean;
  authRequired: boolean;
}> {
  const response = await fetch("/api/health");
  return parseResponse(response);
}

export async function planRoute(
  request: PlanRouteRequest
): Promise<PlanRouteResponse> {
  return authedFetch("/api/routes/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request)
  });
}

export async function getHistory(): Promise<SavedRoute[]> {
  const data = await authedFetch<{ routes: SavedRoute[] }>("/api/routes/history");
  return data.routes;
}

export async function saveRoute(
  route: RouteCandidate,
  name?: string
): Promise<SavedRoute> {
  const data = await authedFetch<{ route: SavedRoute }>("/api/routes/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ route, name })
  });
  return data.route;
}

export async function deleteHistoryRoute(id: string): Promise<void> {
  await authedFetch(`/api/routes/history/${id}`, {
    method: "DELETE"
  });
}

export async function renameHistoryRoute(
  id: string,
  name: string
): Promise<SavedRoute> {
  const data = await authedFetch<{ route: SavedRoute }>(`/api/routes/history/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  });
  return data.route;
}

export async function clearHistoryRoutes(): Promise<number> {
  const data = await authedFetch<{ deleted: number }>("/api/routes/history", {
    method: "DELETE"
  });
  return data.deleted;
}
