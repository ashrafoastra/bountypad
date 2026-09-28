import { RULES } from "./config";

/** X only recognizes cashtags of 1 to 6 letters (CLAUDE.md §6.1). */
export function normalizeTicker(input: string): string {
  return input.trim().replace(/^\$/, "").toUpperCase();
}

export function tickerError(input: string): string | null {
  const t = normalizeTicker(input);
  if (!t) return "Ticker is required";
  if (!/^[A-Z]+$/.test(t)) return "Letters only (A-Z)";
  if (t.length > RULES.tickerMaxLength) return `Max ${RULES.tickerMaxLength} letters, or X won't detect the cashtag`;
  return null;
}

export function normalizeHandle(input: string): string {
  return input.trim().replace(/^@/, "").replace(/^https?:\/\/(x|twitter)\.com\//i, "").split(/[/?]/)[0].toLowerCase();
}

export function handleError(input: string): string | null {
  const h = normalizeHandle(input);
  if (!h) return "Handle is required";
  if (!/^[a-z0-9_]{1,15}$/.test(h)) return "Not a valid X handle";
  return null;
}
