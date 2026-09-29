import { createHash, randomBytes } from "node:crypto";

/**
 * X OAuth 2.0 Authorization Code Flow with PKCE, confidential client ("Web App" in the X portal).
 * Docs (checked 2026-09-29):
 *   authorize  https://x.com/i/oauth2/authorize   (response_type, client_id, redirect_uri, scope, state, code_challenge, code_challenge_method=S256)
 *   token      POST https://api.x.com/2/oauth2/token  Basic base64(client_id:client_secret), form body: code, grant_type=authorization_code, client_id, redirect_uri, code_verifier
 *   refresh    POST same URL, grant_type=refresh_token (needs the offline.access scope); refresh tokens rotate
 *   revoke     POST https://api.x.com/2/oauth2/revoke  token, client_id
 *   identity   GET  https://api.x.com/2/users/me  (scopes tweet.read + users.read)
 *   post       POST https://api.x.com/2/tweets     (scope tweet.write)
 * Access tokens last 2 hours.
 */
export const LOGIN_SCOPES = ["users.read", "tweet.read"];
/** The platform account (@bountypad): posts launch announcements and verified receipts. */
export const PLATFORM_SCOPES = ["users.read", "tweet.read", "tweet.write", "offline.access"];

export interface XTokens { accessToken: string; refreshToken: string | null; expiresAt: Date; scope: string }
export interface XMe { id: string; username: string; name: string; avatarUrl: string | null; verified: boolean; protected: boolean }

const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const newVerifier = () => b64url(randomBytes(48)); // 64 chars, within PKCE's 43..128
export const challengeOf = (verifier: string) => b64url(createHash("sha256").update(verifier).digest());
export const newState = () => b64url(randomBytes(24));

export class XOAuth {
  constructor(
    private cfg: { clientId: string; clientSecret: string; callbackUrl: string },
    private authBase: string = "https://x.com",
    private apiBase: string = "https://api.x.com",
  ) {}

  get callbackUrl() { return this.cfg.callbackUrl; }

  authorizeUrl(state: string, verifier: string, scopes: string[]) {
    const u = new URL("/i/oauth2/authorize", this.authBase);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("client_id", this.cfg.clientId);
    u.searchParams.set("redirect_uri", this.cfg.callbackUrl);
    u.searchParams.set("scope", scopes.join(" "));
    u.searchParams.set("state", state);
    u.searchParams.set("code_challenge", challengeOf(verifier));
    u.searchParams.set("code_challenge_method", "S256");
    return u.toString();
  }

  private basic() {
    return "Basic " + Buffer.from(`${encodeURIComponent(this.cfg.clientId)}:${encodeURIComponent(this.cfg.clientSecret)}`).toString("base64");
  }

  private async tokenCall(form: Record<string, string>): Promise<XTokens> {
    const res = await fetch(`${this.apiBase}/2/oauth2/token`, {
      method: "POST",
      headers: { Authorization: this.basic(), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...form, client_id: this.cfg.clientId }).toString(),
    });
    const b: any = await res.json().catch(() => ({}));
    if (!res.ok || !b.access_token) {
      throw new Error(`X token endpoint ${res.status}: ${b.error_description ?? b.error ?? "no access token"}`);
    }
    return {
      accessToken: b.access_token,
      refreshToken: b.refresh_token ?? null,
      expiresAt: new Date(Date.now() + Number(b.expires_in ?? 7200) * 1000),
      scope: String(b.scope ?? ""),
    };
  }

  exchange(code: string, verifier: string) {
    return this.tokenCall({ grant_type: "authorization_code", code, redirect_uri: this.cfg.callbackUrl, code_verifier: verifier });
  }

  refresh(refreshToken: string) {
    return this.tokenCall({ grant_type: "refresh_token", refresh_token: refreshToken });
  }

  /** Best effort: we don't keep claimants' tokens, so we revoke them right after reading /users/me. */
  async revoke(token: string) {
    await fetch(`${this.apiBase}/2/oauth2/revoke`, {
      method: "POST",
      headers: { Authorization: this.basic(), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token, client_id: this.cfg.clientId, token_type_hint: "access_token" }).toString(),
    }).catch(() => {});
  }

  async me(accessToken: string): Promise<XMe> {
    const res = await fetch(`${this.apiBase}/2/users/me?user.fields=profile_image_url,verified,protected`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const b: any = await res.json().catch(() => ({}));
    if (!res.ok || !b.data?.id) throw new Error(`X /users/me ${res.status}: ${b.detail ?? b.title ?? "no user"}`);
    const u = b.data;
    return {
      id: String(u.id), username: u.username, name: u.name ?? u.username,
      avatarUrl: u.profile_image_url ? String(u.profile_image_url).replace("_normal", "_400x400") : null,
      verified: !!u.verified, protected: !!u.protected,
    };
  }

  /** Post as the platform account. `replyTo` makes it a reply. Returns the new post id. */
  async post(accessToken: string, text: string, replyTo?: string | null): Promise<string> {
    const res = await fetch(`${this.apiBase}/2/tweets`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(replyTo ? { text, reply: { in_reply_to_tweet_id: replyTo } } : { text }),
    });
    const b: any = await res.json().catch(() => ({}));
    if (!res.ok || !b.data?.id) throw new Error(`X POST /2/tweets ${res.status}: ${b.detail ?? b.title ?? JSON.stringify(b).slice(0, 200)}`);
    return String(b.data.id);
  }
}
