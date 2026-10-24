import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { MIGRATIONS } from "./migrations";

export type DB = Database.Database;

export function openDb(dataDir: string): DB {
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(path.join(dataDir, "uploads"), { recursive: true });
  const db = new Database(path.join(dataDir, "diligence.sqlite"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  return db;
}

/** Applies pending migrations. Never drops or reseeds existing data. */
export function migrate(db: DB): number[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)`);
  const applied = new Set(
    (db.prepare("SELECT version FROM schema_migrations").all() as { version: number }[]).map((r) => r.version),
  );
  const ran: number[] = [];
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
        m.version,
        m.name,
        new Date().toISOString(),
      );
    })();
    ran.push(m.version);
  }
  return ran;
}

export const now = () => new Date().toISOString();
export const uid = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
export const j = (v: unknown) => JSON.stringify(v ?? null);
export function pj<T>(s: string | null | undefined, fallback: T): T {
  if (s == null) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
