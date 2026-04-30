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
  return_to_start: number;
  created_at: string;
  geometry_json: string;
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
        `select id, name, distance_m, return_to_start, created_at, geometry_json, segment_keys_json
         from routes
         order by created_at desc`
      )
      .all() as RouteRow[];

    return rows.map(rowToSavedRoute);
  }

  getRoute(id: string): SavedRoute | null {
    const row = this.db
      .prepare(
        `select id, name, distance_m, return_to_start, created_at, geometry_json, segment_keys_json
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
      returnToStart: route.returnToStart,
      createdAt,
      path: route.path,
      segmentKeys
    };

    this.db
      .prepare(
        `insert into routes
           (id, name, distance_m, return_to_start, created_at, geometry_json, segment_keys_json)
         values (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        saved.id,
        saved.name,
        saved.distanceM,
        saved.returnToStart ? 1 : 0,
        saved.createdAt,
        JSON.stringify(saved.path),
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
        return_to_start integer not null,
        created_at text not null,
        geometry_json text not null,
        segment_keys_json text not null
      );
    `);
  }
}

function rowToSavedRoute(row: RouteRow): SavedRoute {
  return {
    id: row.id,
    name: row.name,
    distanceM: row.distance_m,
    returnToStart: row.return_to_start === 1,
    createdAt: row.created_at,
    path: JSON.parse(row.geometry_json),
    segmentKeys: JSON.parse(row.segment_keys_json)
  };
}
