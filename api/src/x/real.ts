import type { XPost, XProvider, XUser, XMedia, RefType } from "./types";

/**
 * X API v2 adapter. Docs: https://docs.x.com
 * Field naming: X's current OpenAPI spec shows "post.fields"/"referenced_posts" while most live
 * integrations use "tweet.fields"/"referenced_tweets". FIELD_STYLE picks which to send; the parser
 * accepts both. Confirm with one live call before launch (docs/decisions.md, Test C).
 */
export class RealX implements XProvider {
  constructor(private bearer: string, private style: "tweet" | "post" = "tweet", private base = "https://api.x.com/2") {}

  private get postParams() {
    const f = this.style === "tweet" ? "tweet.fields" : "post.fields";
    const ref = this.style === "tweet" ? "referenced_tweets" : "referenced_posts";
    const edit = this.style === "tweet" ? "edit_history_tweet_ids" : "edit_history_post_ids";
    return {
      [f]: ["author_id", "created_at", "entities", ref, edit, "attachments"].join(","),
      expansions: "attachments.media_keys",
      "media.fields": "type,duration_ms,variants",
    };
  }

  private async get(path: string, params: Record<string, string | undefined> = {}) {
    const u = new URL(this.base + path);
    for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
    const res = await fetch(u, { headers: { Authorization: `Bearer ${this.bearer}` } });
    if (res.status === 404) return null;
    if (res.status === 429) throw new Error("X API rate limited");
    const body: any = await res.json();
    if (!res.ok) throw new Error(`X API ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
    return body;
  }

  async lookupUser(username: string): Promise<XUser | null> {
    const b = await this.get(`/users/by/username/${encodeURIComponent(username)}`, {
      "user.fields": "protected,verified,profile_image_url,parody",
    });
    const u = b?.data;
    if (!u) return null;
    return {
      id: u.id, username: u.username, name: u.name, avatarUrl: u.profile_image_url ?? null,
      verified: !!u.verified, protected: !!u.protected, parody: !!u.parody,
    };
  }

  async searchRecent(query: string, sinceId?: string | null): Promise<XPost[]> {
    const b = await this.get(`/tweets/search/recent`, { query, since_id: sinceId ?? undefined, max_results: "25", ...this.postParams });
    return parsePosts(b);
  }

  async getPost(id: string): Promise<XPost | null> {
    const b = await this.get(`/tweets/${id}`, this.postParams);
    if (!b || !b.data) return null; // deleted posts come back as errors with no data
    return parsePosts({ data: [b.data], includes: b.includes })[0] ?? null;
  }

  async getUserPosts(userId: string, sinceId?: string | null): Promise<XPost[]> {
    const b = await this.get(`/users/${userId}/tweets`, { since_id: sinceId ?? undefined, max_results: "20", ...this.postParams });
    return parsePosts(b);
  }
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
    return {
      id: d.id,
      authorId: d.author_id,
      text: d.text ?? "",
      createdAt: d.created_at,
      cashtags: (d.entities?.cashtags ?? []).map((c: any) => String(c.tag)),
      referenced: refs.map((r) => ({ type: r.type, id: r.id })),
      editHistoryIds: d.edit_history_tweet_ids ?? d.edit_history_post_ids ?? [d.id],
      media: med,
    };
  });
}
