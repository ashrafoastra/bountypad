import { PrivyClient } from "@privy-io/node";

export interface PrivyIdentity {
  privyUserId: string;
  /** The X account linked to this Privy user (subject = permanent numeric X user ID). */
  x: { id: string; username: string; name: string; avatarUrl: string | null } | null;
  /** Solana wallet addresses on this Privy user (embedded first). */
  solanaWallets: string[];
}

type AnyAccount = Record<string, any>;

function parseUser(u: { id: string; linked_accounts: AnyAccount[] }): PrivyIdentity {
  const tw = u.linked_accounts.find((a) => a.type === "twitter_oauth");
  const sol = u.linked_accounts
    .filter((a) => a.type === "wallet" && a.chain_type === "solana" && a.address)
    .sort((a, b) => (a.connector_type === "embedded" ? -1 : 0) - (b.connector_type === "embedded" ? -1 : 0))
    .map((a) => String(a.address));
  return {
    privyUserId: u.id,
    x: tw ? { id: String(tw.subject), username: tw.username ?? "", name: tw.name ?? tw.username ?? "", avatarUrl: tw.profile_picture_url ?? null } : null,
    solanaWallets: sol,
  };
}

/**
 * Server-side Privy (https://docs.privy.io). Verifies the web app's access tokens and reads
 * the user's linked X account + wallets. Also does Path 1: a wallet tied to an X account
 * before that person ever logs in (CLAUDE.md §6.6, Test A).
 */
export class PrivyGateway {
  private client: PrivyClient;
  private cache = new Map<string, { until: number; id: PrivyIdentity }>();

  constructor(appId: string, appSecret: string) {
    this.client = new PrivyClient({ appId, appSecret });
  }

  /** Verify an access token and return who it belongs to. Throws if invalid. */
  async identify(accessToken: string): Promise<PrivyIdentity> {
    const hit = this.cache.get(accessToken);
    if (hit && hit.until > Date.now()) return hit.id;
    const claims = await this.client.utils().auth().verifyAccessToken(accessToken);
    const user = await this.client.users()._get(claims.user_id);
    const id = parseUser(user as any);
    this.cache.set(accessToken, { until: Math.min(Date.now() + 60_000, claims.expiration * 1000), id });
    if (this.cache.size > 5000) this.cache.clear();
    return id;
  }

  /**
   * Path 1: find the Privy user for this X account, or create one with the X account linked
   * and a Solana wallet. When the person later logs in with X, Privy matches the same X ID,
   * so the wallet (and anything sent to it) is already theirs.
   */
  async walletForX(x: { id: string; username: string; name: string }): Promise<string> {
    let user: any;
    try {
      user = await this.client.users().getByTwitterSubject({ subject: x.id });
    } catch (e: any) {
      if (e?.status !== 404) throw e;
      user = await this.client.users().create({
        linked_accounts: [{ type: "twitter_oauth", subject: x.id, username: x.username, name: x.name }],
        wallets: [{ chain_type: "solana" }],
      });
    }
    let parsed = parseUser(user);
    if (!parsed.solanaWallets.length) {
      user = await this.client.users().pregenerateWallets(user.id, { wallets: [{ chain_type: "solana" }] });
      parsed = parseUser(user);
    }
    if (!parsed.solanaWallets.length) throw new Error("Privy returned no Solana wallet");
    return parsed.solanaWallets[0];
  }
}
