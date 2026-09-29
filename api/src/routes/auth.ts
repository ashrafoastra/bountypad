import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Ctx } from "../app";
import { upsertProfile, mapProfile } from "../db/repo";
import { LOGIN_SCOPES, PLATFORM_SCOPES, newState, newVerifier } from "../x/oauth";
import { SESSION_COOKIE, sessionFrom } from "../auth";

const STATE_TTL_MIN = 10, CODE_TTL_SEC = 120;
const safeReturn = (r: unknown) => (typeof r === "string" && /^\/(?!\/)[\w\-/?=&%.#]*$/.test(r) ? r : "/claim");

/**
 * "Log in with X" with OUR X app (OAuth 2.0 Authorization Code + PKCE). No third party is in the
 * trust path: X itself tells us which account logged in, via GET /2/users/me with the user's token.
 *
 *   GET  /api/auth/x/login?return=/claim   -> 302 to x.com/i/oauth2/authorize
 *   GET  /api/auth/x/callback              <- X redirects here (X_CALLBACK_URL, registered in the X app)
 *                                           -> 302 to WEB_ORIGIN/auth/x?code=… (one-time, 2 min)
 *   POST /api/auth/x/complete {code}       -> sets the httpOnly session cookie on the API's host
 *   GET  /api/auth/session                 -> { x: Profile | null }
 *   POST /api/auth/logout
 *
 * The one-time code hop keeps the X callback host independent from the site's host
 * (X is strict about callback URLs; the cookie must live where the website calls the API).
 */
export async function authRoutes(app: FastifyInstance, ctx: Ctx) {
  const { db } = ctx;
  const web = ctx.env.webOrigin.replace(/\/$/, "");

  const fail = (reply: FastifyReply, reason: string) => reply.redirect(`${web}/auth/x?error=${encodeURIComponent(reason)}`);
  // State-changing auth calls must come from our website (SameSite=Lax cookies + this check).
  const fromSite = (req: FastifyRequest) => !req.headers.origin || req.headers.origin === web;

  app.get("/api/auth/x/login", async (req, reply) => {
    if (!ctx.xOAuth) return fail(reply, "X login isn't configured on this server (X_CLIENT_ID / X_CLIENT_SECRET)");
    const state = newState(), verifier = newVerifier();
    await db.query(`delete from oauth_states where created_at < now() - interval '${STATE_TTL_MIN} minutes'`);
    await db.query(`insert into oauth_states (state, verifier, purpose, return_to) values ($1,$2,'login',$3)`, [state, verifier, safeReturn((req.query as any).return)]);
    return reply.redirect(ctx.xOAuth.authorizeUrl(state, verifier, LOGIN_SCOPES));
  });

  app.get("/api/auth/x/callback", async (req, reply) => {
    if (!ctx.xOAuth) return fail(reply, "X login isn't configured");
    const q = req.query as Record<string, string | undefined>;
    if (q.error) return fail(reply, q.error === "access_denied" ? "You cancelled the X login." : `X said: ${q.error}`);
    if (!q.state || !q.code) return fail(reply, "X didn't return a login code.");
    const st = (await db.query(
      `delete from oauth_states where state=$1 and created_at > now() - interval '${STATE_TTL_MIN} minutes' returning *`, [q.state],
    ))[0];
    if (!st) return fail(reply, "This login link expired. Try again.");

    let tokens;
    try { tokens = await ctx.xOAuth.exchange(q.code, st.verifier); }
    catch (e) { req.log.warn(e); return fail(reply, "X refused the login code. Try again."); }
    const me = await ctx.xOAuth.me(tokens.accessToken).catch((e) => { req.log.warn(e); return null; });
    if (!me) return fail(reply, "Couldn't read your X account.");

    if (st.purpose === "platform") {
      // The platform's own account: keep its tokens to post launch announcements and receipts.
      await db.query(
        `insert into platform_x (id, x_user_id, username, access_token, refresh_token, expires_at) values (1,$1,$2,$3,$4,$5)
         on conflict (id) do update set x_user_id=$1, username=$2, access_token=$3, refresh_token=$4, expires_at=$5, updated_at=now()`,
        [me.id, me.username, tokens.accessToken, tokens.refreshToken, tokens.expiresAt.toISOString()],
      );
      console.log(new Date().toISOString(), `[x] platform account connected: @${me.username} (scopes: ${tokens.scope})`);
      return reply.redirect(`${web}/auth/x?platform=${encodeURIComponent(me.username)}`);
    }

    // Claimants: we only need to know who they are. Their token is revoked right away.
    await ctx.xOAuth.revoke(tokens.accessToken);
    await upsertProfile(db, { id: me.id, username: me.username, name: me.name, avatarUrl: me.avatarUrl, verified: me.verified });
    const code = randomBytes(24).toString("base64url");
    await db.query(`delete from login_codes where created_at < now() - interval '${CODE_TTL_SEC} seconds'`);
    await db.query(`insert into login_codes (code, x_user_id, return_to) values ($1,$2,$3)`, [code, me.id, st.return_to]);
    return reply.redirect(`${web}/auth/x?code=${encodeURIComponent(code)}`);
  });

  app.post("/api/auth/x/complete", async (req, reply) => {
    if (!fromSite(req)) return reply.status(403).send({ error: "bad origin" });
    const { code } = z.object({ code: z.string().min(10).max(100) }).parse(req.body);
    const c = (await db.query(`delete from login_codes where code=$1 and created_at > now() - interval '${CODE_TTL_SEC} seconds' returning *`, [code]))[0];
    if (!c) return reply.status(400).send({ error: "This login expired. Log in with X again." });
    const id = randomBytes(32).toString("base64url");
    const expires = new Date(Date.now() + ctx.env.sessionDays * 86400_000);
    await db.query(`insert into sessions (id, x_user_id, expires_at) values ($1,$2,$3)`, [id, c.x_user_id, expires.toISOString()]);
    setSessionCookie(reply, id, expires, secure(ctx));
    const p = (await db.query(`select * from profiles where x_user_id=$1`, [c.x_user_id]))[0];
    return { x: mapProfile(p), returnTo: c.return_to };
  });

  app.get("/api/auth/session", async (req) => {
    const s = await sessionFrom(ctx, req);
    if (!s) return { x: null };
    const p = (await db.query(`select * from profiles where x_user_id=$1`, [s.xUserId]))[0];
    return { x: p ? mapProfile(p) : null };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    if (!fromSite(req)) return reply.status(403).send({ error: "bad origin" });
    const s = await sessionFrom(ctx, req);
    if (s) await db.query(`delete from sessions where id=$1`, [s.id]);
    reply.header("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure(ctx) ? "; Secure" : ""}`);
    return { ok: true };
  });

  // ---- admin: connect the platform's X account (the one that posts launches and receipts) ----
  app.post("/api/admin/x/platform/start", async (req, reply) => {
    if (!ctx.env.adminKey || req.headers["x-admin-key"] !== ctx.env.adminKey) return reply.status(401).send({ error: "admin only" });
    if (!ctx.xOAuth) return reply.status(400).send({ error: "Set X_CLIENT_ID and X_CLIENT_SECRET first" });
    const state = newState(), verifier = newVerifier();
    await db.query(`insert into oauth_states (state, verifier, purpose) values ($1,$2,'platform')`, [state, verifier]);
    return { url: ctx.xOAuth.authorizeUrl(state, verifier, PLATFORM_SCOPES), callback: ctx.xOAuth.callbackUrl };
  });

  app.get("/api/admin/x/platform", async (req, reply) => {
    if (!ctx.env.adminKey || req.headers["x-admin-key"] !== ctx.env.adminKey) return reply.status(401).send({ error: "admin only" });
    const p = (await db.query(`select x_user_id, username, expires_at, updated_at from platform_x where id=1`))[0];
    return { connected: !!p, account: p ?? null };
  });
}

const secure = (ctx: Ctx) => ctx.env.publicApiUrl.startsWith("https://");

function setSessionCookie(reply: FastifyReply, id: string, expires: Date, isSecure: boolean) {
  reply.header("Set-Cookie", `${SESSION_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires.toUTCString()}${isSecure ? "; Secure" : ""}`);
}
