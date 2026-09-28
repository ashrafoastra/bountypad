"use client";
// Minimal Phantom-compatible wallet access (window.phantom.solana / window.solana).
// Full Solana wallet adapter + Privy embedded wallets come with milestone 2 / Test A.

type Provider = {
  isPhantom?: boolean;
  publicKey?: { toString(): string };
  connect(): Promise<{ publicKey: { toString(): string } }>;
  signMessage(msg: Uint8Array, enc?: string): Promise<{ signature: Uint8Array }>;
};

export function getProvider(): Provider | null {
  if (typeof window === "undefined") return null;
  const w = window as any;
  return w.phantom?.solana ?? (w.solana?.isPhantom ? w.solana : null);
}

export async function connectWallet(): Promise<string> {
  const p = getProvider();
  if (!p) throw new Error("No Solana wallet found. Install Phantom, or use the dev tools in SIM mode.");
  const r = await p.connect();
  return r.publicKey.toString();
}

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function b58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) + BigInt(b);
  let s = "";
  while (n > 0n) { s = ALPHABET[Number(n % 58n)] + s; n /= 58n; }
  for (const b of bytes) { if (b === 0) s = "1" + s; else break; }
  return s;
}

export async function signText(text: string): Promise<string> {
  const p = getProvider();
  if (!p) throw new Error("No Solana wallet found");
  const { signature } = await p.signMessage(new TextEncoder().encode(text), "utf8");
  return b58(signature);
}
