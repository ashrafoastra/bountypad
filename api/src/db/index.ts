import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export interface Db {
  query<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

const here = path.dirname(fileURLToPath(import.meta.url));

/** Real Postgres when DATABASE_URL is set; embedded Postgres (PGlite) otherwise, for zero-setup dev. */
export async function createDb(databaseUrl: string): Promise<Db> {
  let db: Db;
  if (databaseUrl) {
    const { default: pg } = await import("pg");
    const pool = new pg.Pool({ connectionString: databaseUrl });
    db = {
      query: async (sql, params) => (await pool.query(sql, params as any[])).rows,
      close: () => pool.end(),
    };
  } else {
    const { PGlite } = await import("@electric-sql/pglite");
    const dir = path.resolve(here, "../../.data/pg");
    mkdirSync(dir, { recursive: true });
    const lite = new PGlite(dir);
    db = {
      query: async (sql, params) => (await lite.query(sql, params as any[])).rows as any[],
      close: () => lite.close(),
    };
  }
  const schema = readFileSync(path.join(here, "schema.sql"), "utf8");
  for (const stmt of schema.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) await db.query(stmt);
  return db;
}

export const iso = (v: unknown): string => new Date(v as string).toISOString();
export const str = (v: unknown): string => (v == null ? "0" : String(v));
