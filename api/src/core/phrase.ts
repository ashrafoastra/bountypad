import { RULES } from "@bountypad/shared";

function words(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

/**
 * How well a transcript contains the required phrase, 0-100.
 * Slides a window the size of the phrase over the transcript and takes the best
 * character-level similarity, so small transcription errors ("rockit") still match.
 */
export function phraseMatchScore(phrase: string, transcript: string): number {
  const p = words(phrase);
  const t = words(transcript);
  if (!p.length || !t.length) return 0;
  const target = p.join(" ");
  let best = 0;
  for (const size of [p.length - 1, p.length, p.length + 1]) {
    if (size < 1) continue;
    for (let i = 0; i + size <= Math.max(t.length, size); i++) {
      const win = t.slice(i, i + size).join(" ");
      const dist = levenshtein(target, win);
      const sim = 1 - dist / Math.max(target.length, win.length);
      if (sim > best) best = sim;
    }
  }
  return Math.round(Math.max(0, best) * 100);
}

export type VideoDecision = "AUTO_APPROVE" | "AUTO_REJECT" | "VOTE";

export function videoDecision(score: number, rules = RULES.video): VideoDecision {
  if (score >= rules.autoApproveScore) return "AUTO_APPROVE";
  if (score <= rules.autoRejectScore) return "AUTO_REJECT";
  return "VOTE";
}
