import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/** Anything that can run a query: the pool, or a transaction. */
export interface Q {
  query<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface Db extends Q {
  /** Run fn in one transaction: all its writes commit together or not at all. */
  tx<T>(fn: (q: Q) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Real Postgres when DATABASE_URL is set; embedded Postgres (PGlite) otherwise, for zero-setup dev.
 * `memory: true` = throwaway in-memory database (tests).
 */
export async function createDb(databaseUrl: string, opts: { memory?: boolean } = {}): Promise<Db> {
  let db: Db;
  if (databaseUrl) {
    const { default: pg } = await import("pg");
    const pool = new pg.Pool({ connectionString: databaseUrl });
    db = {
      query: async (sql, params) => (await pool.query(sql, params as any[])).rows,
      tx: async (fn) => {
        const client = await pool.connect();
        try {
          await client.query("begin");
          const out = await fn({ query: async (sql, params) => (await client.query(sql, params as any[])).rows });
          await client.query("commit");
          return out;
        } catch (e) {
          await client.query("rollback");
          throw e;
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
  } else {
    const { PGlite } = await import("@electric-sql/pglite");
    let dir: string | undefined;
    if (!opts.memory) {
      dir = path.resolve(here, "../../.data/pg");
      mkdirSync(dir, { recursive: true });
    }
    const lite = new PGlite(dir);
    db = {
      query: async (sql, params) => (await lite.query(sql, params as any[])).rows as any[],
      tx: (fn) => lite.transaction((t) => fn({ query: async (sql, params) => (await t.query(sql, params as any[])).rows as any[] })),
      close: () => lite.close(),
    };
  }
  const schema = readFileSync(path.join(here, "schema.sql"), "utf8");
  for (const stmt of schema.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) await db.query(stmt);
  return db;
}

export const iso = (v: unknown): string => new Date(v as string).toISOString();
export const str = (v: unknown): string => (v == null ? "0" : String(v));
