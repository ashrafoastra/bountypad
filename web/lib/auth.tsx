"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import { toSolanaWalletConnectors, useSignMessage, useSignTransaction, useWallets } from "@privy-io/react-auth/solana";
import bs58 from "bs58";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import { API } from "./api";

/**
 * One auth interface for the whole app. Two separate things:
 *  - WALLET: Privy (NEXT_PUBLIC_PRIVY_APP_ID set): Phantom, Solflare, … or email with an auto-created
 *    wallet. DEV mode (no app id, API in SIM): a simulated wallet.
 *  - X ACCOUNT: "Log in with X" through OUR X app (OAuth 2.0 + PKCE, handled by the API). X itself
 *    confirms the account; the API keeps an httpOnly session cookie. Privy is not in that path.
 *    SIM without an X app: pick a simulated X account.
 */
export interface XAccount { id: string; username: string; name: string; avatarUrl: string | null; verified?: boolean }

export interface Auth {
  mode: "privy" | "dev";
  ready: boolean;
  authenticated: boolean;
  /** Active Solana wallet address. */
  wallet: string | null;
  /** The X account proven by "Log in with X" (or the simulated X account in dev). */
  x: XAccount | null;
  /** Open the connect modal (wallet / email / X). */
  login: () => void;
  /** Log in with X (redirects to X, comes back to this page). */
  loginWithX: () => void;
  /** Log out of X only (the wallet stays connected). */
  logoutX: () => Promise<void>;
  /** Log out of everything. */
  logout: () => Promise<void>;
  /** Sign a UTF-8 message with the active wallet; returns a base58 ed25519 signature. */
  signMessage: (text: string) => Promise<string>;
  /** Sign a transaction the API prepared (base64 in, base64 out). The API sends it. */
  signTransaction: (base64: string) => Promise<string>;
  /** Headers proving who the caller is, for /api/me/* routes. */
  authHeaders: () => Promise<Record<string, string>>;
  /** DEV only: pretend to be this X account. */
  devSetX?: (x: XAccount | null) => void;
}

const Ctx = createContext<Auth | null>(null);
/** Which Solana network Privy should show when signing ("solana:devnet" until mainnet is approved). */
const SOLANA_CHAIN = (process.env.NEXT_PUBLIC_SOLANA_CHAIN || "solana:devnet") as "solana:devnet" | "solana:mainnet";
const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const bytesToB64 = (bytes: Uint8Array) => { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
const SOLANA_RPCS = {
  "solana:mainnet": { rpc: createSolanaRpc("https://api.mainnet-beta.solana.com"), rpcSubscriptions: createSolanaRpcSubscriptions("wss://api.mainnet-beta.solana.com"), blockExplorerUrl: "https://solscan.io" },
  "solana:devnet": { rpc: createSolanaRpc("https://api.devnet.solana.com"), rpcSubscriptions: createSolanaRpcSubscriptions("wss://api.devnet.solana.com"), blockExplorerUrl: "https://solscan.io/?cluster=devnet" },
};
export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || "";

/** The "Log in with X" session, read from the API (the cookie is httpOnly). */
function useXSession() {
  const [x, setX] = useState<XAccount | null>(null);
  const [ready, setReady] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const r = await fetch(API + "/api/auth/session", { credentials: "include", cache: "no-store" });
      const b = await r.json();
      setX(b.x ? { id: b.x.xUserId, username: b.x.username, name: b.x.name, avatarUrl: b.x.avatarUrl, verified: !!b.x.verified } : null);
    } catch { setX(null); }
    setReady(true);
  }, []);
  useEffect(() => {
    refresh();
    window.addEventListener("bp-x-session", refresh);
    return () => window.removeEventListener("bp-x-session", refresh);
  }, [refresh]);
  const loginWithX = useCallback(() => {
    const back = location.pathname + location.search;
    location.href = `${API}/api/auth/x/login?return=${encodeURIComponent(back)}`;
  }, []);
  const logoutX = useCallback(async () => {
    await fetch(API + "/api/auth/logout", { method: "POST", credentials: "include" }).catch(() => {});
    setX(null);
  }, []);
  return { x, ready, loginWithX, logoutX };
}
/** Tell every mounted auth provider the X session changed (after /auth/x completes the login). */
export const announceXSession = () => window.dispatchEvent(new Event("bp-x-session"));

export function useAuth(): Auth {
  const a = useContext(Ctx);
  if (!a) throw new Error("useAuth outside <Providers>");
  return a;
}

export function Providers({ children }: { children: React.ReactNode }) {
  if (!PRIVY_APP_ID) return <DevAuth>{children}</DevAuth>;
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        // X login is NOT done by Privy: it goes through our own X app (see useXSession).
        loginMethods: ["wallet", "email"],
        appearance: {
          theme: "dark",
          accentColor: "#f2f1ee",
          walletChainType: "solana-only",
          showWalletLoginFirst: true,
          // Solana wallets first (the chain Bounty Pad runs on), installed ones right after.
          walletList: ["phantom", "solflare", "backpack", "jupiter", "detected_solana_wallets", "okx_wallet", "bitget_wallet", "wallet_connect_qr_solana"],
          landingHeader: "Connect to Bounty Pad",
        },
        embeddedWallets: { solana: { createOnLogin: "users-without-wallets" } },
        externalWallets: { solana: { connectors: toSolanaWalletConnectors() } },
        // Privy needs an RPC per network to show and sign transactions (public endpoints: no API key in the browser).
        solana: { rpcs: SOLANA_RPCS },
      }}
    >
      <PrivyAuth>{children}</PrivyAuth>
    </PrivyProvider>
  );
}

function PrivyAuth({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, login, logout, getAccessToken } = usePrivy();
  const xs = useXSession();
  const { wallets } = useWallets();
  const { signMessage } = useSignMessage();
  const { signTransaction } = useSignTransaction();
  const wallet = wallets[0] ?? null;

  const value = useMemo<Auth>(() => ({
    mode: "privy",
    ready: ready && xs.ready,
    authenticated: authenticated || !!xs.x,
    wallet: wallet?.address ?? null,
    x: xs.x,
    login: () => login(),
    loginWithX: xs.loginWithX,
    logoutX: xs.logoutX,
    logout: async () => { await xs.logoutX(); await logout(); },
    signMessage: async (text) => {
      if (!wallet) throw new Error("Connect a wallet first");
      const { signature } = await signMessage({ message: new TextEncoder().encode(text), wallet });
      return bs58.encode(signature);
    },
    signTransaction: async (b64) => {
      if (!wallet) throw new Error("Connect a wallet first");
      const { signedTransaction } = await signTransaction({ transaction: b64ToBytes(b64), wallet, chain: SOLANA_CHAIN });
      return bytesToB64(signedTransaction);
    },
    authHeaders: async () => {
      const t = await getAccessToken();
      const h: Record<string, string> = {};
      if (t) h.Authorization = `Bearer ${t}`;
      return h;
    },
  }), [ready, authenticated, wallet, xs, login, logout, signMessage, signTransaction, getAccessToken]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const LS = "bountypad-dev-auth";
function DevAuth({ children }: { children: React.ReactNode }) {
  const xs = useXSession();
  const [wallet, setWallet] = useState<string | null>(null);
  const [x, setX] = useState<XAccount | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try { const s = JSON.parse(localStorage.getItem(LS) ?? "{}"); setWallet(s.wallet ?? null); setX(s.x ?? null); } catch {}
    setReady(true);
  }, []);
  const save = (w: string | null, xa: XAccount | null) => { try { localStorage.setItem(LS, JSON.stringify({ wallet: w, x: xa })); } catch {} };

  const login = useCallback(async () => {
    // A simulated wallet with a real ed25519 key held by the SIM API.
    try {
      const ws: string[] = await (await fetch(API + "/api/dev/wallets")).json();
      const w = ws[5];
      setWallet(w); save(w, x);
    } catch { alert("Dev login needs the API running in SIM mode. For real wallets, set NEXT_PUBLIC_PRIVY_APP_ID."); }
  }, [x]);

  const value = useMemo<Auth>(() => ({
    mode: "dev",
    ready: ready && xs.ready,
    authenticated: !!wallet || !!x || !!xs.x,
    wallet,
    // A real "Log in with X" session wins over a simulated account.
    x: xs.x ?? x,
    login,
    loginWithX: xs.loginWithX,
    logoutX: async () => { await xs.logoutX(); setX(null); save(wallet, null); },
    logout: async () => { await xs.logoutX(); setWallet(null); setX(null); save(null, null); },
    signMessage: async (text) => {
      if (!wallet) throw new Error("Connect a wallet first");
      const r = await fetch(API + "/api/dev/sign", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet, message: text }) });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error ?? "sign failed");
      return b.signature;
    },
    signTransaction: async (b64) => {
      if (!wallet) throw new Error("Connect a wallet first");
      const r = await fetch(API + "/api/dev/sign-tx", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet, transaction: b64 }) });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error ?? "sign failed");
      return b.signedTransaction;
    },
    authHeaders: async () => {
      const h: Record<string, string> = {};
      if (x && !xs.x) h["x-dev-x-user-id"] = x.id;
      return h;
    },
    devSetX: (xa) => { setX(xa); save(wallet, xa); },
  }), [ready, wallet, x, login, xs]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
