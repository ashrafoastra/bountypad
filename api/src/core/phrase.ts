import { RULES } from "@bountypad/shared";

function words(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019]/g, "'")
    // Spoken contractions: "I'm holding" must match "I am holding".
    .replace(/n't\b/g, " not").replace(/'m\b/g, " am").replace(/'re\b/g, " are")
    .replace(/'ve\b/g, " have").replace(/'ll\b/g, " will").replace(/'s\b/g, " is")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\bim\b/g, "i am") // transcripts often drop the apostrophe
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

const sim = (a: string, b: string) => 1 - levenshtein(a, b) / Math.max(a.length, b.length);

/** Best character-level similarity of the phrase against any window of the transcript. */
function windowScore(p: string[], t: string[]): number {
  const target = p.join(" ");
  let best = 0;
  for (const size of [p.length - 1, p.length, p.length + 1]) {
    if (size < 1) continue;
    for (let i = 0; i + size <= Math.max(t.length, size); i++) {
      best = Math.max(best, sim(target, t.slice(i, i + size).join(" ")));
    }
  }
  return best;
}

/**
 * How much of the phrase was actually said: each phrase word is matched to its closest spoken
 * word (near-misses like "rockit" still count), weighted by length so the words that carry
 * meaning ("holding", "rocket") matter more than "I" or "a". Words 60% similar or less count 0.
 */
function wordCoverage(p: string[], t: string[]): number {
  let got = 0, total = 0;
  for (const w of p) {
    const s = Math.max(...t.map((x) => sim(w, x)));
    got += (s > 0.6 ? s : 0) * w.length;
    total += w.length;
  }
  return total ? got / total : 0;
}

/**
 * How well a transcript contains the required phrase, 0-100.
 * Both must be high: the phrase appears as a sequence (window score) AND its words were
 * actually spoken (word coverage). Character similarity alone rates any English sentence
 * around 30-50%, which would send unrelated videos to a vote.
 */
export function phraseMatchScore(phrase: string, transcript: string): number {
  const p = words(phrase);
  const t = words(transcript);
  if (!p.length || !t.length) return 0;
  return Math.round(Math.max(0, Math.min(windowScore(p, t), wordCoverage(p, t))) * 100);
}

export type VideoDecision = "AUTO_APPROVE" | "AUTO_REJECT" | "VOTE";

export function videoDecision(score: number, rules = RULES.video): VideoDecision {
  if (score >= rules.autoApproveScore) return "AUTO_APPROVE";
  if (score <= rules.autoRejectScore) return "AUTO_REJECT";
  return "VOTE";
}
