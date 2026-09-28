import { upsertProfile } from "./db/repo";
import type { FastifyRequest } from "fastify";
import type { Ctx } from "./app";

export interface Caller {
  via: "privy" | "dev";
  /** Permanent numeric X user ID, if the caller logged in with (or linked) X. */
  xUserId: string | null;
  /** Solana wallets on the caller's Privy account. */
  wallets: string[];
}

/**
 * Who is calling. REAL: a Privy access token in `Authorization: Bearer`, verified server-side;
 * the X account comes from Privy's linked twitter_oauth account, never from the client.
 * SIM only: the `x-dev-x-user-id` header (dev login without Privy).
 */
export async function identify(ctx: Ctx, req: FastifyRequest): Promise<Caller | null> {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ") && ctx.privy) {
    try {
      const id = await ctx.privy.identify(auth.slice(7));
      if (id.x) {
        await ctx.db.query(
          `insert into profiles (x_user_id, username, name, avatar_url) values ($1,$2,$3,$4)
           on conflict (x_user_id) do update set username=$2, name=$3, avatar_url=coalesce($4, profiles.avatar_url), updated_at=now()`,
          [id.x.id, id.x.username, id.x.name, id.x.avatarUrl],
        );
        // SIM: your real X account becomes a sim account you can target and post as in /dev.
        ctx.mockX?.addUser({ id: id.x.id, username: id.x.username, name: id.x.name, avatarUrl: id.x.avatarUrl, verified: false, protected: false, parody: false });
      }
      return { via: "privy", xUserId: id.x?.id ?? null, wallets: id.solanaWallets };
    } catch {
      return null;
    }
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
  return null;
}
