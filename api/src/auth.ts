import { upsertProfile } from "./db/repo";
import type { FastifyRequest } from "fastify";
import type { Ctx } from "./app";

export const SESSION_COOKIE = "bp_session";

/** The "Log in with X" session in the httpOnly cookie, if valid. */
export async function sessionFrom(ctx: Ctx, req: FastifyRequest): Promise<{ id: string; xUserId: string } | null> {
  const raw = req.headers.cookie;
  if (!raw) return null;
  const m = raw.split(/;\s*/).find((c) => c.startsWith(SESSION_COOKIE + "="));
  const id = m?.slice(SESSION_COOKIE.length + 1);
  if (!id || id.length < 20) return null;
  const s = (await ctx.db.query(`select id, x_user_id from sessions where id=$1 and expires_at > now()`, [id]))[0];
  return s ? { id: s.id, xUserId: s.x_user_id } : null;
}

export interface Caller {
  via: "x" | "privy" | "dev";
  /** Permanent numeric X user ID, if the caller logged in with (or linked) X. */
  xUserId: string | null;
  /** Solana wallets on the caller's Privy account. */
  wallets: string[];
}

/**
 * Who is calling.
 *  - The X account (what claims, opt-outs and payout wallets hang on) comes ONLY from our own
 *    "Log in with X" session cookie (OAuth 2.0 with our X app; X confirms the account).
 *  - A Privy access token (`Authorization: Bearer`) only proves which wallets the caller has.
 *  - SIM only: the `x-dev-x-user-id` header (dev login as a simulated X account).
 */
export async function identify(ctx: Ctx, req: FastifyRequest): Promise<Caller | null> {
  const session = await sessionFrom(ctx, req);
  let wallets: string[] = [];
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ") && ctx.privy) {
    try { wallets = (await ctx.privy.identify(auth.slice(7))).solanaWallets; } catch { /* wallets are optional */ }
  }
  if (session) {
    if (ctx.mockX) {
      // SIM: your real X account becomes a sim account you can target and post as in /dev.
      const p = (await ctx.db.query(`select * from profiles where x_user_id=$1`, [session.xUserId]))[0];
      if (p && !ctx.mockX.userById(p.x_user_id)) ctx.mockX.addUser({ id: p.x_user_id, username: p.username, name: p.name, avatarUrl: p.avatar_url, verified: p.verified, protected: false, parody: false });
    }
    return { via: "x", xUserId: session.xUserId, wallets };
  }
  // Dev login (simulated X only): pretend to be one of the simulated X accounts.
  if (ctx.env.devTools && ctx.mockX) {
    const dev = req.headers["x-dev-x-user-id"] as string | undefined;
    const u = dev ? ctx.mockX.userById(dev) : null;
    if (u) {
      // Same as a real X login: the profile exists from the first login, even before any coin names them.
      await upsertProfile(ctx.db, u);
      return { via: "dev", xUserId: u.id, wallets: [] };
    }
  }
  return wallets.length ? { via: "privy", xUserId: null, wallets } : null;
}
