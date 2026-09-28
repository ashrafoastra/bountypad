// Normalized shapes. The X API adapter (x/real.ts) maps raw API responses into these,
// so the verification logic never depends on raw field names.

export interface XUser {
  id: string;
  username: string;
  name: string;
  avatarUrl: string | null;
  verified: boolean;
  protected: boolean;
  parody: boolean;
}

export type RefType = "retweeted" | "quoted" | "replied_to";

export interface XMedia {
  type: "video" | "photo" | "animated_gif" | string;
  durationMs: number | null;
  /** Highest-bitrate video/mp4 variant, if any. */
  mp4Url: string | null;
}

export interface XPost {
  id: string;
  authorId: string;
  text: string;
  createdAt: string;
  cashtags: string[];
  referenced: { type: RefType; id: string }[];
  /** Oldest to newest. The last id is the latest edited version. */
  editHistoryIds: string[];
  media: XMedia[];
}

export interface XProvider {
  lookupUser(username: string): Promise<XUser | null>;
  /** Recent search (last 7 days). Returns newest first. */
  searchRecent(query: string, sinceId?: string | null): Promise<XPost[]>;
  /** Returns null if the post no longer exists (deleted). */
  getPost(id: string): Promise<XPost | null>;
  /** A user's own posts, newest first. */
  getUserPosts(userId: string, sinceId?: string | null): Promise<XPost[]>;
}
