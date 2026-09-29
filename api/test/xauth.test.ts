// "Log in with X" (OAuth 2.0 + PKCE with our own X app) and the X reader, against a fake X server
// that enforces the same rules as the real one (PKCE S256, exact redirect_uri, Basic client auth).
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import http from "node:http";
import { createHash } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { createDb } from "../src/db";
import { env } from "../src/env";
import type { Ctx } from "../src/app";
import { MockX } from "../src/sim/mockX";
import { DbHolders, SimPayouts, SimVideo } from "../src/adapters";
import { routes } from "../src/routes";
import { authRoutes } from "../src/routes/auth";
import { XOAuth } from "../src/x/oauth";
import { RealX } from "../src/x/real";
import { verifyPost } from "../src/core/verifier";
import { buildSearchQuery } from "../src/core/query";

vi.spyOn(console, "log").mockImplementation(() => {});
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 }); // first in-memory Postgres boot can be slow

const CLIENT = { clientId: "client-123", clientSecret: "secret-456", callbackUrl: "http://127.0.0.1:4000/api/auth/x/callback" };
const WEB = "http://localhost:3000";
const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// ---------------------------------------------------------------- fake X
const codes = new Map<string, { challenge: string; redirect: string }>();
const revoked: string[] = [];
let posts: Record<string, any> = {};
let lastQuery: URLSearchParams | null = null;
let server: http.Server;
let base = "";

function fakeX(req: http.IncomingMessage, res: http.ServerResponse) {
  const u = new URL(req.url!, base);
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const json = (status: number, b: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(b)); };
    if (u.pathname === "/2/oauth2/token") {
      const f = new URLSearchParams(body);
      const basic = "Basic " + Buffer.from(`${CLIENT.clientId}:${CLIENT.clientSecret}`).toString("base64");
      if (req.headers.authorization !== basic) return json(401, { error: "unauthorized_client" });
      const c = codes.get(f.get("code") ?? "");
      if (!c) return json(400, { error: "invalid_request", error_description: "bad code" });
      if (f.get("redirect_uri") !== c.redirect) return json(400, { error: "invalid_request", error_description: "redirect_uri mismatch" });
      if (b64url(createHash("sha256").update(f.get("code_verifier") ?? "").digest()) !== c.challenge) return json(400, { error: "invalid_request", error_description: "pkce" });
      codes.delete(f.get("code")!);
      return json(200, { token_type: "bearer", access_token: "user-token", expires_in: 7200, scope: "users.read tweet.read" });
    }
    if (u.pathname === "/2/oauth2/revoke") { revoked.push(new URLSearchParams(body).get("token")!); return json(200, { revoked: true }); }
    if (u.pathname === "/2/users/me") {
      if (req.headers.authorization !== "Bearer user-token") return json(401, {});
      return json(200, { data: { id: "44196397", username: "realperson", name: "Real Person", profile_image_url: "https://pbs.twimg.com/x_normal.jpg", verified: true } });
    }
    if (u.pathname.startsWith("/2/tweets/search/recent")) { lastQuery = u.searchParams; return json(200, { data: Object.values(posts) }); }
    if (u.pathname.startsWith("/2/tweets/")) {
      lastQuery = u.searchParams;
      const id = u.pathname.split("/").pop()!;
      if (id === "500") return json(200, { errors: [{ title: "Authorization Error", type: "https://api.x.com/2/problems/not-authorized-for-resource" }] });
      const p = posts[id];
      return p ? json(200, { data: p }) : json(200, { errors: [{ title: "Not Found Error", type: "https://api.x.com/2/problems/resource-not-found" }] });
    }
    json(404, {});
  });
}

beforeAll(async () => {
  server = http.createServer(fakeX);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(() => server.close());

// ---------------------------------------------------------------- app
let app: FastifyInstance;
let ctx: Ctx;
beforeEach(async () => {
  const db = await createDb("", { memory: true });
  const x = new MockX();
  ctx = {
    db, x, mockX: null, video: new SimVideo(x), holders: new DbHolders(db), payouts: new SimPayouts(), privy: null, chain: null,
    xOAuth: new XOAuth(CLIENT, base, base),
    env: { ...env, webOrigin: WEB, devTools: false, publicApiUrl: "http://127.0.0.1:4000" },
  };
  app = Fastify();
  await routes(app, ctx);
  await authRoutes(app, ctx);
});

/** Walk the whole login like a browser: our API -> X -> our API -> website -> our API. */
async function login() {
  const start = await app.inject({ method: "GET", url: "/api/auth/x/login?return=/claim" });
  expect(start.statusCode).toBe(302);
  const auth = new URL(start.headers.location as string);
  // X shows its consent screen; the user approves; X issues a code bound to the PKCE challenge.
  const code = "x-code-" + Math.random();
  codes.set(code, { challenge: auth.searchParams.get("code_challenge")!, redirect: auth.searchParams.get("redirect_uri")! });
  const cb = await app.inject({ method: "GET", url: `/api/auth/x/callback?state=${auth.searchParams.get("state")}&code=${code}` });
  expect(cb.statusCode).toBe(302);
  const hop = new URL(cb.headers.location as string);
  return { auth, hop, cb };
}

describe("Log in with X (OAuth 2.0 + PKCE)", () => {
  it("sends the user to X with every required parameter", async () => {
    const r = await app.inject({ method: "GET", url: "/api/auth/x/login" });
    const u = new URL(r.headers.location as string);
    expect(u.origin + u.pathname).toBe(`${base}/i/oauth2/authorize`);
    expect(Object.fromEntries(u.searchParams)).toMatchObject({
      response_type: "code", client_id: "client-123", redirect_uri: CLIENT.callbackUrl, scope: "users.read tweet.read", code_challenge_method: "S256",
    });
    expect(u.searchParams.get("state")!.length).toBeGreaterThanOrEqual(24);
    expect(u.searchParams.get("code_challenge")!.length).toBe(43);
  });

  it("full login: X proves the account, the token is revoked, a session cookie identifies the claimant", async () => {
    const { hop } = await login();
    expect(hop.origin + hop.pathname).toBe(`${WEB}/auth/x`);
    expect(revoked).toContain("user-token"); // we never keep a claimant's X token

    const done = await app.inject({ method: "POST", url: "/api/auth/x/complete", headers: { origin: WEB }, payload: { code: hop.searchParams.get("code") } });
    expect(done.statusCode).toBe(200);
    expect(done.json()).toMatchObject({ x: { xUserId: "44196397", username: "realperson", verified: true }, returnTo: "/claim" });
    const cookie = String(done.headers["set-cookie"]);
    expect(cookie).toMatch(/^bp_session=[\w-]{40,}; Path=\/; HttpOnly; SameSite=Lax/);
    const c = cookie.split(";")[0];

    const s = await app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie: c } });
    expect(s.json().x.username).toBe("realperson");
    const claims = await app.inject({ method: "GET", url: "/api/me/claims", headers: { cookie: c } });
    expect(claims.statusCode).toBe(200);
    expect(claims.json().profile.xUserId).toBe("44196397");

    // The one-time code can't be replayed.
    const again = await app.inject({ method: "POST", url: "/api/auth/x/complete", headers: { origin: WEB }, payload: { code: hop.searchParams.get("code") } });
    expect(again.statusCode).toBe(400);

    await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie: c, origin: WEB } });
    expect((await app.inject({ method: "GET", url: "/api/auth/session", headers: { cookie: c } })).json().x).toBeNull();
    expect((await app.inject({ method: "GET", url: "/api/me/claims", headers: { cookie: c } })).statusCode).toBe(401);
  });

  it("rejects a forged or reused state (CSRF) and a cancelled login", async () => {
    const forged = await app.inject({ method: "GET", url: "/api/auth/x/callback?state=nope&code=abc" });
    expect(forged.headers.location).toMatch(/\/auth\/x\?error=.*expired/);
    const { auth } = await login();
    const reuse = await app.inject({ method: "GET", url: `/api/auth/x/callback?state=${auth.searchParams.get("state")}&code=zzz` });
    expect(reuse.headers.location).toMatch(/error=/);
    const cancel = await app.inject({ method: "GET", url: "/api/auth/x/callback?error=access_denied&state=x" });
    expect(decodeURIComponent(cancel.headers.location as string)).toMatch(/cancelled/);
  });

  it("a code for one PKCE verifier can't be redeemed with another login's state", async () => {
    const a = await app.inject({ method: "GET", url: "/api/auth/x/login" });
    const b = await app.inject({ method: "GET", url: "/api/auth/x/login" });
    const ua = new URL(a.headers.location as string), ub = new URL(b.headers.location as string);
    codes.set("stolen", { challenge: ua.searchParams.get("code_challenge")!, redirect: CLIENT.callbackUrl });
    const r = await app.inject({ method: "GET", url: `/api/auth/x/callback?state=${ub.searchParams.get("state")}&code=stolen` });
    expect(r.headers.location).toMatch(/error=/);
  });

  it("session cookies are refused from other websites, and fake cookies identify nobody", async () => {
    const { hop } = await login();
    const evil = await app.inject({ method: "POST", url: "/api/auth/x/complete", headers: { origin: "https://evil.example" }, payload: { code: hop.searchParams.get("code") } });
    expect(evil.statusCode).toBe(403);
    const fake = await app.inject({ method: "GET", url: "/api/me/claims", headers: { cookie: "bp_session=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } });
    expect(fake.statusCode).toBe(401);
  });

  it("only returns to paths on our own site", async () => {
    const r = await app.inject({ method: "GET", url: "/api/auth/x/login?return=https://evil.example/x" });
    const state = new URL(r.headers.location as string).searchParams.get("state");
    expect((await ctx.db.query(`select return_to from oauth_states where state=$1`, [state]))[0].return_to).toBe("/claim");
  });
});

describe("X reader (real API adapter)", () => {
  const post = (o: Record<string, unknown>) => ({ id: "700", author_id: "111", created_at: "2026-09-02T00:00:00Z", text: "hi", edit_history_tweet_ids: ["700"], ...o });
  const vctx = { action: "TWEET_CASHTAG" as const, targetXUserId: "111", targetUsername: "t", ticker: "BOUNTY", mint: "Mint11111111111111111111111111111111111111", launchPostId: null, tokenCreatedAt: "2026-09-01T00:00:00Z" };
  const x = () => new RealX("app-bearer", "tweet", `${base}/2`);

  it("reads the full text and cashtags of long posts (note_tweet)", async () => {
    posts = { 700: post({ text: "a long intro…", note_tweet: { text: "a long intro… then finally $BOUNTY", entities: { cashtags: [{ tag: "BOUNTY" }] } } }) };
    const p = (await x().getPost("700"))!;
    expect(p.text).toContain("$BOUNTY");
    expect(verifyPost(p, vctx).pass).toBe(true);
    expect(lastQuery!.get("tweet.fields")).toContain("note_tweet");
  });

  it("finds the contract address inside a link hidden behind t.co", async () => {
    posts = { 700: post({ text: "look https://t.co/abc", entities: { urls: [{ url: "https://t.co/abc", expanded_url: `https://pump.fun/coin/${vctx.mint}` }] } }) };
    const p = (await x().getPost("700"))!;
    expect(verifyPost(p, { ...vctx, action: "TWEET_CONTRACT" }).pass).toBe(true);
    expect(buildSearchQuery({ action: "TWEET_CONTRACT", username: "t", ticker: "", mint: vctx.mint, launchPostId: null })).toContain(`url:"${vctx.mint}"`);
  });

  it("deleted = null (fails the recheck); any other X error throws (retried, never a false rejection)", async () => {
    posts = {};
    expect(await x().getPost("701")).toBeNull();
    await expect(x().getPost("500")).rejects.toThrow(/unavailable/);
  });

  it("search never reads posts from before the launch (start_time), then continues from since_id", async () => {
    posts = {};
    await x().searchRecent("from:t $BOUNTY -is:retweet", null, new Date(Date.now() - 3600_000).toISOString());
    expect(lastQuery!.get("start_time")).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    expect(lastQuery!.get("since_id")).toBeNull();
    await x().searchRecent("from:t $BOUNTY -is:retweet", "12345", new Date().toISOString());
    expect(lastQuery!.get("since_id")).toBe("12345");
    expect(lastQuery!.get("start_time")).toBeNull();
  });
});
