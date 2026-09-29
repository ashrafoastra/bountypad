import type { XPost, XProvider, XUser, XMedia, RefType } from "./types";

/**
 * X API v2 adapter. Docs: https://docs.x.com
 * Field naming: X's current OpenAPI spec shows "post.fields"/"referenced_posts" while most live
 * integrations use "tweet.fields"/"referenced_tweets". FIELD_STYLE picks which to send; the parser
 * accepts both. Confirm with one live call before launch (docs/decisions.md, Test C).
 */
export class RealX implements XProvider {
  constructor(private bearer: string, private style: "tweet" | "post" = "tweet", private base = "https://api.x.com/2", private consumer?: { key: string; secret: string; kind?: "api-key" }) {}

  /**
   * App-only auth. Uses X_BEARER_TOKEN, or exchanges the API Key + Secret for one
   * (POST /oauth2/token, grant_type=client_credentials: https://docs.x.com/fundamentals/authentication/oauth-2-0/application-only).
   * (The OAuth 2.0 Client ID/Secret are for "Log in with X", see x/oauth.ts; X refuses them here.)
   */
  /** Exchange/validate credentials now (startup check). */
  async authCheck() { await this.token(); }

  private async token(): Promise<string> {
    if (this.bearer) return this.bearer;
    if (!this.consumer) throw new Error("X credentials missing: set X_BEARER_TOKEN (or X_API_KEY + X_API_SECRET)");
    const res = await fetch(new URL("/oauth2/token", this.base).toString(), {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${encodeURIComponent(this.consumer.key)}:${encodeURIComponent(this.consumer.secret)}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: "grant_type=client_credentials",
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok || !body.access_token) {
      throw new Error(`X rejected the API Key/Secret (${res.status}${body.error ? ` ${body.error}` : ""}). Check them in the developer portal, or use X_BEARER_TOKEN.`);
    }
    this.bearer = body.access_token;
    return this.bearer;
  }

  private get postParams() {
    const t = this.style === "tweet";
    return {
      [t ? "tweet.fields" : "post.fields"]: ["author_id", "created_at", "entities", t ? "referenced_tweets" : "referenced_posts",
        t ? "edit_history_tweet_ids" : "edit_history_post_ids", "attachments", t ? "note_tweet" : "note_post"].join(","),
      expansions: "attachments.media_keys",
      "media.fields": "type,duration_ms,variants",
    };
  }

  /**
   * X renamed "tweet" fields to "post" fields in its docs. If X ever rejects the names we send,
   * switch to the other naming once and retry, so detection keeps working either way.
   */
  private async getPosts(path: string, params: Record<string, string | undefined>) {
    try {
      return await this.get(path, { ...params, ...this.postParams });
    } catch (e) {
      if (!/^X API 400/.test((e as Error).message) || !/(tweet|post)\.fields|referenced_|edit_history|note_/.test((e as Error).message)) throw e;
      this.style = this.style === "tweet" ? "post" : "tweet";
      console.warn(`[x] switched field naming to "${this.style}.fields"`);
      return this.get(path, { ...params, ...this.postParams });
    }
  }

  private async get(path: string, params: Record<string, string | undefined> = {}) {
    const u = new URL(this.base + path);
    for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
    const res = await fetch(u, { headers: { Authorization: `Bearer ${await this.token()}` } });
    if (res.status === 401) throw new Error("X API 401: the bearer token is invalid or revoked");
    if (res.status === 402 || res.status === 403) {
      const t = await res.text();
      throw new Error(`X API ${res.status}: ${t.slice(0, 200)} (check your pay-per-use credits and app permissions in the developer portal)`);
    }
    if (res.status === 404) return null;
    if (res.status === 429) throw new Error("X API rate limited");
    const body: any = await res.json();
    if (!res.ok) throw new Error(`X API ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
    return body;
  }

  async lookupUser(username: string): Promise<XUser | null> {
    const b = await this.get(`/users/by/username/${encodeURIComponent(username)}`, { "user.fields": USER_FIELDS });
    return b?.data ? parseUser(b.data) : null;
  }

  /** By permanent ID: used to keep a target's current handle fresh (handles can change). */
  async lookupUserById(id: string): Promise<XUser | null> {
    const b = await this.get(`/users/${encodeURIComponent(id)}`, { "user.fields": USER_FIELDS });
    return b?.data ? parseUser(b.data) : null;
  }

  /** GET /2/users/:id with description + entities: the bio text and its expanded links. */
  async getUserBio(id: string): Promise<{ text: string; urls: string[] } | null> {
    const b = await this.get(`/users/${encodeURIComponent(id)}`, { "user.fields": "description,entities,url" });
    if (!b?.data) return null;
    const e = b.data.entities ?? {};
    const urls = [...(e.description?.urls ?? []), ...(e.url?.urls ?? [])].map((u: any) => String(u.expanded_url ?? u.url ?? ""));
    return { text: String(b.data.description ?? ""), urls };
  }

  /**
   * Recent search (last 7 days). `startTime` limits reads to posts after the coin launched: with
   * pay-per-use, every post returned costs money, so we never read older ones.
   */
  async searchRecent(query: string, sinceId?: string | null, startTime?: string | null): Promise<XPost[]> {
    const params: Record<string, string | undefined> = { query, max_results: "25" };
    if (sinceId) params.since_id = sinceId;
    else if (startTime) params.start_time = clampStart(startTime);
    return parsePosts(await this.getPosts(`/tweets/search/recent`, params));
  }

  /**
   * One post. Returns null ONLY when X says the post doesn't exist (deleted): X answers 200 with
   * an errors[] entry of type ".../resource-not-found" and no data. Any other error (suspended or
   * protected account, outage) throws, so a recheck is retried instead of failing the bounty.
   */
  async getPost(id: string): Promise<XPost | null> {
    const b = await this.getPosts(`/tweets/${id}`, {});
    if (b?.data) return parsePosts({ data: [b.data], includes: b.includes })[0] ?? null;
    const errs: any[] = b?.errors ?? [];
    if (!b || errs.some((e) => String(e.type ?? "").endsWith("/resource-not-found"))) return null;
    throw new Error(`X API: post ${id} unavailable (${errs.map((e) => e.title ?? e.type).join(", ") || "no data"})`);
  }

  async getUserPosts(userId: string, sinceId?: string | null): Promise<XPost[]> {
    return parsePosts(await this.getPosts(`/users/${userId}/tweets`, { since_id: sinceId ?? undefined, max_results: "20" }));
  }
}

const USER_FIELDS = "protected,verified,profile_image_url,parody";
function parseUser(u: any): XUser {
  return {
    id: String(u.id), username: u.username, name: u.name, avatarUrl: u.profile_image_url ? String(u.profile_image_url).replace("_normal", "_400x400") : null,
    verified: !!u.verified, protected: !!u.protected, parody: !!u.parody,
  };
}

/** X recent search only accepts start_time within the last 7 days (and at least 10s ago). */
function clampStart(iso: string) {
  const min = Date.now() - 7 * 86400_000 + 60_000, max = Date.now() - 15_000;
  return new Date(Math.min(max, Math.max(min, Date.parse(iso)))).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function parsePosts(body: any): XPost[] {
  if (!body?.data) return [];
  const media = new Map<string, any>((body.includes?.media ?? []).map((m: any) => [m.media_key, m]));
  return (body.data as any[]).map((d) => {
    const refs = (d.referenced_tweets ?? d.referenced_posts ?? []) as { type: RefType; id: string }[];
    const keys: string[] = d.attachments?.media_keys ?? [];
    const med: XMedia[] = keys.map((k) => media.get(k)).filter(Boolean).map((m: any) => {
      const mp4 = (m.variants ?? [])
        .filter((v: any) => v.content_type === "video/mp4" && v.url)
        .sort((a: any, b: any) => (b.bit_rate ?? 0) - (a.bit_rate ?? 0))[0];
      return { type: m.type, durationMs: m.duration_ms ?? null, mp4Url: mp4?.url ?? null };
    });
    // Long posts (over 280 characters): the full text and its entities are in note_tweet / note_post.
    const note = d.note_tweet ?? d.note_post ?? null;
    const ents = [d.entities, note?.entities].filter(Boolean);
    return {
      id: d.id,
      authorId: d.author_id,
      text: note?.text ?? d.text ?? "",
      createdAt: d.created_at,
      cashtags: [...new Set(ents.flatMap((e: any) => (e.cashtags ?? []).map((c: any) => String(c.tag))))],
      urls: [...new Set(ents.flatMap((e: any) => (e.urls ?? []).map((x: any) => String(x.expanded_url ?? x.url ?? ""))).filter(Boolean))],
      referenced: refs.map((r) => ({ type: r.type, id: r.id })),
      editHistoryIds: d.edit_history_tweet_ids ?? d.edit_history_post_ids ?? [d.id],
      media: med,
    };
  });
}
