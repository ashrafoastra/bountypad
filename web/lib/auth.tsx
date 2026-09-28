"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import { toSolanaWalletConnectors, useSignMessage, useSignTransaction, useWallets } from "@privy-io/react-auth/solana";
import bs58 from "bs58";
import { API } from "./api";

/**
 * One auth interface for the whole app.
 *  - PRIVY mode (NEXT_PUBLIC_PRIVY_APP_ID set): connect a Solana wallet (Phantom, Solflare, …),
 *    email with an auto-created wallet, or log in with X. The API verifies Privy's token.
 *  - DEV mode (no app id, API in SIM): pick a simulated wallet / X account. No real keys.
 */
export interface XAccount { id: string; username: string; name: string; avatarUrl: string | null }

export interface Auth {
  mode: "privy" | "dev";
  ready: boolean;
  authenticated: boolean;
  /** Active Solana wallet address. */
  wallet: string | null;
  /** Linked X account (Privy) or the simulated X account (dev). */
  x: XAccount | null;
  /** Open the connect modal (wallet / email / X). */
  login: () => void;
  /** Log in with X, or link X to the current account. */
  loginWithX: () => void;
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
export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || "";

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
        loginMethods: ["wallet", "twitter", "email"],
        appearance: {
          theme: "dark",
          accentColor: "#3dffa2",
          walletChainType: "solana-only",
          showWalletLoginFirst: true,
          landingHeader: "Connect to Bounty Pad",
        },
        embeddedWallets: { solana: { createOnLogin: "users-without-wallets" } },
        externalWallets: { solana: { connectors: toSolanaWalletConnectors() } },
      }}
    >
      <PrivyAuth>{children}</PrivyAuth>
    </PrivyProvider>
  );
}

function PrivyAuth({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, user, login, logout, getAccessToken, linkTwitter } = usePrivy();
  const { wallets } = useWallets();
  const { signMessage } = useSignMessage();
  const { signTransaction } = useSignTransaction();
  const wallet = wallets[0] ?? null;
  const tw = user?.twitter;

  const value = useMemo<Auth>(() => ({
    mode: "privy",
    ready,
    authenticated,
    wallet: wallet?.address ?? null,
    x: tw ? { id: tw.subject, username: tw.username ?? "", name: tw.name ?? tw.username ?? "", avatarUrl: tw.profilePictureUrl?.replace("_normal", "") ?? null } : null,
    login: () => login(),
    loginWithX: () => (authenticated ? linkTwitter() : login({ loginMethods: ["twitter"] })),
    logout,
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
  }), [ready, authenticated, wallet, tw, login, logout, linkTwitter, signMessage, signTransaction, getAccessToken]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const LS = "bountypad-dev-auth";
function DevAuth({ children }: { children: React.ReactNode }) {
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
    ready,
    authenticated: !!wallet || !!x,
    wallet,
    x,
    login,
    loginWithX: () => { location.href = "/claim"; },
    logout: async () => { setWallet(null); setX(null); save(null, null); },
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
      if (x) h["x-dev-x-user-id"] = x.id;
      return h;
    },
    devSetX: (xa) => { setX(xa); save(wallet, xa); },
  }), [ready, wallet, x, login]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
