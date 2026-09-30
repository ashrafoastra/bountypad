import type { BountyAction, BountyStatus } from "@bountypad/shared";

export const sol = (lamports: string | bigint | number) => Number(lamports) / 1e9;

export function fmtSol(lamports: string | bigint | number, digits = 2) {
  const v = sol(lamports);
  return v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtUsd(v: number) {
  if (v >= 1_000_000) return "$" + (v / 1_000_000).toFixed(2) + "M";
  if (v >= 1_000) return "$" + (v / 1000).toFixed(2) + "K"; // like trading terminals: $3.94K
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function ago(iso: string) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function countdown(iso: string) {
  const s = Math.max(0, (Date.parse(iso) - Date.now()) / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${String(sec).padStart(2, "0")}s`;
}

export const short = (a: string, n = 4) => (a.length > 2 * n + 1 ? `${a.slice(0, n)}…${a.slice(-n)}` : a);

export function actionText(action: BountyAction, ticker: string, phrase?: string | null) {
  switch (action) {
    case "TWEET_CASHTAG": return `Post $${ticker} on X`;
    case "TWEET_CONTRACT": return "Post the contract address on X";
    case "QUOTE_LAUNCH": return "Quote the coin's launch post";
    case "VIDEO_PHRASE": return `Say “${phrase ?? ""}” in a video`;
    case "BIO_CONTRACT": return "Put the contract address in their X bio";
    case "REPOST_POST": return "Repost the post on X";
  }
}

export const STATUS: Record<BountyStatus, { label: string; tone: "green" | "gold" | "blue" | "mute" | "red" }> = {
  OPEN: { label: "Waiting", tone: "gold" },
  DETECTED_CONFIRMING: { label: "Post found · confirming", tone: "blue" },
  VOTING: { label: "Holders voting", tone: "blue" },
  VERIFIED: { label: "Verified", tone: "green" },
  CHALLENGE_WINDOW: { label: "Verified · releasing", tone: "green" },
  PAID: { label: "Paid", tone: "green" },
  EXPIRED: { label: "Expired", tone: "mute" },
  OPTED_OUT: { label: "Opted out", tone: "mute" },
  FROZEN: { label: "Frozen", tone: "red" },
};

const SUB = "₀₁₂₃₄₅₆₇₈₉";
/** Tiny prices the way trading terminals show them: 0.0₇2795 = 0.00000002795. */
export function fmtPrice(v: number | null | undefined) {
  if (v === null || v === undefined || !Number.isFinite(v) || v <= 0) return "—";
  if (v >= 1) return v.toLocaleString("en-US", { maximumFractionDigits: 4 });
  if (v >= 0.001) return v.toFixed(6).replace(/0+$/, "");
  // zeros between the decimal point and the first significant digit
  const zeros = Math.floor(-Math.log10(v));
  const digits = Math.round(v * 10 ** (zeros + 4)).toString().slice(0, 4);
  return `0.0${String(zeros).split("").map((d) => SUB[Number(d)]).join("")}${digits}`;
}

/** 1234 -> 1.23K, 1234567 -> 1.23M */
export function fmtCompact(v: number | null | undefined, digits = 2) {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(digits) + "B";
  if (a >= 1e6) return (v / 1e6).toFixed(digits) + "M";
  if (a >= 1e3) return (v / 1e3).toFixed(digits) + "K";
  return v.toFixed(a >= 100 ? 0 : a >= 1 ? digits : 3);
}
