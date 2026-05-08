import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { RouteCandidate, SavedRoute } from "../src/shared/types";
import { segmentKeysForPath } from "./geometry";

const DEFAULT_DB_PATH = resolve("data", "routes.sqlite");

type RouteRow = {
  id: string;
  name: string;
  distance_m: number;
  target_distance_m?: number | null;
  overlap_pct?: number | null;
  score?: number | null;
  return_to_start: number;
  created_at: string;
  geometry_json: string;
  waypoints_json?: string | null;
  steps_json?: string | null;
  warnings_json?: string | null;
  segment_keys_json: string;
};

export class RouteStore {
  private readonly db: DatabaseSync;

  constructor(dbPath = process.env.ROUTE_DB_PATH ?? DEFAULT_DB_PATH) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.migrate();
  }

  listRoutes(): SavedRoute[] {
    const rows = this.db
      .prepare(
        `select id, name, distance_m, target_distance_m, overlap_pct, score, return_to_start,
                created_at, geometry_json, waypoints_json, steps_json, warnings_json,
                segment_keys_json
         from routes
         order by created_at desc`
      )
      .all() as RouteRow[];

    return rows.map(rowToSavedRoute);
  }

  getRoute(id: string): SavedRoute | null {
    const row = this.db
      .prepare(
        `select id, name, distance_m, target_distance_m, overlap_pct, score, return_to_start,
                created_at, geometry_json, waypoints_json, steps_json, warnings_json,
                segment_keys_json
         from routes
         where id = ?`
      )
      .get(id) as RouteRow | undefined;

    return row ? rowToSavedRoute(row) : null;
  }

  saveRoute(route: RouteCandidate, name?: string): SavedRoute {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const segmentKeys = segmentKeysForPath(route.path);
    const saved: SavedRoute = {
      id,
      name: name?.trim() || route.name,
      distanceM: route.distanceM,
      targetDistanceM: route.targetDistanceM,
      overlapPct: route.overlapPct,
      score: route.score,
      returnToStart: route.returnToStart,
      createdAt,
      path: route.path,
      waypoints: route.waypoints,
      steps: route.steps,
      warnings: route.warnings,
      segmentKeys
    };

    this.db
      .prepare(
        `insert into routes
           (id, name, distance_m, target_distance_m, overlap_pct, score, return_to_start,
            created_at, geometry_json, waypoints_json, steps_json, warnings_json, segment_keys_json)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        saved.id,
        saved.name,
        saved.distanceM,
        saved.targetDistanceM,
        saved.overlapPct,
        saved.score,
        saved.returnToStart ? 1 : 0,
        saved.createdAt,
        JSON.stringify(saved.path),
        JSON.stringify(saved.waypoints),
        JSON.stringify(saved.steps),
        JSON.stringify(saved.warnings),
        JSON.stringify(saved.segmentKeys)
      );

    return saved;
  }

  deleteRoute(id: string): boolean {
    const result = this.db.prepare("delete from routes where id = ?").run(id);
    return result.changes > 0;
  }

  renameRoute(id: string, name: string): SavedRoute | null {
    const result = this.db
      .prepare("update routes set name = ? where id = ?")
      .run(name, id);
    return result.changes > 0 ? this.getRoute(id) : null;
  }

  clearRoutes(): number {
    const result = this.db.prepare("delete from routes").run();
    return Number(result.changes);
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      create table if not exists routes (
        id text primary key,
        name text not null,
        distance_m integer not null,
        target_distance_m integer,
        overlap_pct real,
        score integer,
        return_to_start integer not null,
        created_at text not null,
        geometry_json text not null,
        waypoints_json text,
        steps_json text,
        warnings_json text,
        segment_keys_json text not null
      );
    `);
    this.addColumnIfMissing("routes", "target_distance_m", "integer");
    this.addColumnIfMissing("routes", "overlap_pct", "real");
    this.addColumnIfMissing("routes", "score", "integer");
    this.addColumnIfMissing("routes", "waypoints_json", "text");
    this.addColumnIfMissing("routes", "steps_json", "text");
    this.addColumnIfMissing("routes", "warnings_json", "text");
  }

  private addColumnIfMissing(table: string, column: string, type: string): void {
    const columns = this.db.prepare(`pragma table_info(${table})`).all() as Array<{
      name: string;
    }>;
    if (!columns.some((item) => item.name === column)) {
      this.db.exec(`alter table ${table} add column ${column} ${type}`);
    }
  }
}

function rowToSavedRoute(row: RouteRow): SavedRoute {
  const path = JSON.parse(row.geometry_json);
  const steps =
    row.steps_json && row.steps_json.trim()
      ? JSON.parse(row.steps_json)
      : [
          {
            id: `${row.id}-legacy-step`,
            instruction: row.return_to_start === 1 ? "沿历史环线前行" : "沿历史路线前行",
            distanceM: row.distance_m,
            path
          }
        ];
  const waypoints =
    row.waypoints_json && row.waypoints_json.trim()
      ? JSON.parse(row.waypoints_json)
      : path.length > 1
        ? [path[0], path[path.length - 1]]
        : path;

  return {
    id: row.id,
    name: row.name,
    distanceM: row.distance_m,
    targetDistanceM: row.target_distance_m ?? row.distance_m,
    overlapPct: row.overlap_pct ?? 0,
    score: row.score ?? 0,
    returnToStart: row.return_to_start === 1,
    createdAt: row.created_at,
    path,
    waypoints,
    steps,
    warnings:
      row.warnings_json && row.warnings_json.trim()
        ? JSON.parse(row.warnings_json)
        : [],
    segmentKeys: JSON.parse(row.segment_keys_json)
  };
}
