import type { XPost, XProvider, XUser } from "../x/types";

/** Fictional accounts only. Never real people in the simulator. */
export const SIM_USERS: XUser[] = [
  { id: "1001", username: "novareyes", name: "Nova Reyes", avatarUrl: null, verified: true, protected: false, parody: false },
  { id: "1002", username: "jaxkimura", name: "Jax Kimura", avatarUrl: null, verified: true, protected: false, parody: false },
  { id: "1003", username: "alinamarsh", name: "Alina Marsh", avatarUrl: null, verified: true, protected: false, parody: false },
  { id: "1004", username: "theo_voss", name: "Theo Voss", avatarUrl: null, verified: false, protected: false, parody: false },
  { id: "1005", username: "sofiaokafor", name: "Sofia Okafor", avatarUrl: null, verified: true, protected: false, parody: false },
  { id: "1006", username: "bytezen", name: "ByteZen", avatarUrl: null, verified: true, protected: false, parody: false },
  { id: "1007", username: "lockedlena", name: "Lena (private)", avatarUrl: null, verified: false, protected: true, parody: false },
  { id: "1008", username: "novaparody", name: "Nova Reyes (parody)", avatarUrl: null, verified: false, protected: false, parody: true },
  { id: "1999", username: "bountypad", name: "Bounty Pad", avatarUrl: null, verified: true, protected: false, parody: false },
];

/**
 * In-memory stand-in for the X API. Understands the exact query shapes built by core/query.ts,
 * so the real watcher code runs unchanged against it.
 */
export class MockX implements XProvider {
  posts = new Map<string, XPost>();
  deleted = new Set<string>();
  transcripts = new Map<string, string>();
  private seq = 5_000_000_000_000_000_000n;

  nextId() { this.seq += BigInt(1 + Math.floor(Math.random() * 1000)); return this.seq.toString(); }
  userById(id: string) { return SIM_USERS.find((u) => u.id === id) ?? null; }
  userByName(n: string) { return SIM_USERS.find((u) => u.username.toLowerCase() === n.toLowerCase()) ?? null; }

  createPost(p: { username: string; text: string; quoteOf?: string; replyTo?: string; repost?: string; video?: { transcript: string; durationSec: number } }) {
    const u = this.userByName(p.username);
    if (!u) throw new Error(`unknown sim user @${p.username}`);
    const id = this.nextId();
    const cashtags = [...p.text.matchAll(/\$([A-Za-z]{1,6})(?![A-Za-z0-9_])/g)].map((m) => m[1].toUpperCase());
    const referenced = [
      ...(p.quoteOf ? [{ type: "quoted" as const, id: p.quoteOf }] : []),
      ...(p.replyTo ? [{ type: "replied_to" as const, id: p.replyTo }] : []),
      ...(p.repost ? [{ type: "retweeted" as const, id: p.repost }] : []),
    ];
    const media = p.video ? [{ type: "video", durationMs: p.video.durationSec * 1000, mp4Url: `sim://video/${id}` }] : [];
    if (p.video) this.transcripts.set(`sim://video/${id}`, p.video.transcript);
    const post: XPost = { id, authorId: u.id, text: p.text, createdAt: new Date().toISOString(), cashtags, referenced, editHistoryIds: [id], media };
    this.posts.set(id, post);
    return post;
  }

  /** Editing creates a new version id, like X does. */
  editPost(id: string, text: string) {
    const orig = this.posts.get(id);
    if (!orig) throw new Error("post not found");
    const nid = this.nextId();
    const cashtags = [...text.matchAll(/\$([A-Za-z]{1,6})(?![A-Za-z0-9_])/g)].map((m) => m[1].toUpperCase());
    const hist = [...orig.editHistoryIds, nid];
    const v: XPost = { ...orig, id: nid, text, cashtags, editHistoryIds: hist };
    for (const pid of hist.slice(0, -1)) { const p = this.posts.get(pid); if (p) p.editHistoryIds = hist; }
    this.posts.set(nid, v);
    return v;
  }

  deletePost(id: string) {
    const p = this.posts.get(id);
    for (const pid of p?.editHistoryIds ?? [id]) this.deleted.add(pid);
  }

  private live() { return [...this.posts.values()].filter((p) => !this.deleted.has(p.id)); }

  async lookupUser(username: string) { return this.userByName(username); }

  async getPost(id: string) { return this.deleted.has(id) ? null : this.posts.get(id) ?? null; }

  async getUserPosts(userId: string, sinceId?: string | null) {
    return this.live()
      .filter((p) => p.authorId === userId && (!sinceId || BigInt(p.id) > BigInt(sinceId)))
      .filter((p) => p.editHistoryIds.at(-1) === p.id)
      .sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1));
  }

  async searchRecent(query: string, sinceId?: string | null) {
    const from = /from:(\S+)/.exec(query)?.[1];
    const cashtag = /(?:^|\s)\$([A-Za-z]+)/.exec(query)?.[1];
    const phrase = /"([^"]+)"/.exec(query)?.[1];
    const quotes = /quotes_of_tweet_id:(\d+)/.exec(query)?.[1];
    const noRt = query.includes("-is:retweet");
    const u = from ? this.userByName(from) : null;
    return this.live()
      .filter((p) => p.editHistoryIds.at(-1) === p.id)
      .filter((p) => !sinceId || BigInt(p.id) > BigInt(sinceId))
      .filter((p) => !u || p.authorId === u.id)
      .filter((p) => !cashtag || p.cashtags.includes(cashtag.toUpperCase()))
      .filter((p) => !phrase || p.text.includes(phrase))
      .filter((p) => !quotes || p.referenced.some((r) => r.type === "quoted" && r.id === quotes))
      .filter((p) => !noRt || !p.referenced.some((r) => r.type === "retweeted"))
      .sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1));
  }
}
