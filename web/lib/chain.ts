"use client";
import type { Health } from "@bountypad/shared";
import { api } from "./api";

/** Solscan link for a transaction / account on the API's cluster. */
export function explorer(health: Health | null | undefined, kind: "tx" | "account" | "token", id: string) {
  const c = health?.cluster;
  const q = !c || c === "mainnet-beta" ? "" : c === "localnet" ? "?cluster=custom&customUrl=http%3A%2F%2F127.0.0.1%3A8899" : `?cluster=${c}`;
  return `https://solscan.io/${kind}/${id}${q}`;
}

/** prepare -> the wallet signs -> the API sends and confirms. */
export async function signAndSubmit<P extends { transaction: string }, R>(
  prepare: () => Promise<P>,
  sign: (b64: string) => Promise<string>,
  submit: (prepared: P, signed: string) => Promise<R>,
  onStage?: (s: "preparing" | "signing" | "confirming") => void,
): Promise<R> {
  onStage?.("preparing");
  const p = await prepare();
  onStage?.("signing");
  const signed = await sign(p.transaction);
  onStage?.("confirming");
  return submit(p, signed);
}

export const balanceOf = (wallet: string, mint?: string) =>
  api<{ lamports: string; tokenAmount: string | null }>(`/api/chain/balance?wallet=${wallet}${mint ? `&mint=${mint}` : ""}`);

/** Test SOL on localnet/devnet (dev tools only; devnet's faucet is rate limited). */
export const airdrop = (wallet: string, sol = 2) => api<{ ok: boolean; balance: number }>("/api/dev/airdrop", { method: "POST", json: { wallet, sol } });
