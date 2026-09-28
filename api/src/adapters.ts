// Pluggable edges of the system. Each has a SIM version and a REAL version.
// REAL versions that depend on unbuilt parts (on-chain program, Privy) throw a clear error.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import bs58 from "bs58";
import type { Db } from "./db";
import type { SnapshotEntry } from "./core/voting";
import type { PayoutAttestation } from "./core/payout";
import type { MockX } from "./sim/mockX";

const run = promisify(execFile);

/** Turns a post's video into text. */
export interface VideoPipeline { transcribe(mp4Url: string): Promise<string> }

export class SimVideo implements VideoPipeline {
  constructor(private x: MockX) {}
  async transcribe(url: string) { return this.x.transcripts.get(url) ?? ""; }
}

/** Download mp4, extract audio with ffmpeg, send to a Whisper-compatible /v1/audio/transcriptions endpoint. */
export class WhisperVideo implements VideoPipeline {
  constructor(private url: string, private key: string) {}
  async transcribe(mp4Url: string) {
    if (!this.url) throw new Error("WHISPER_URL not configured");
    const dir = await mkdtemp(path.join(tmpdir(), "bp-"));
    try {
      const vid = path.join(dir, "v.mp4"), aud = path.join(dir, "a.mp3");
      const res = await fetch(mp4Url);
      if (!res.ok) throw new Error(`video download failed ${res.status}`);
      await writeFile(vid, Buffer.from(await res.arrayBuffer()));
      await run("ffmpeg", ["-y", "-v", "error", "-i", vid, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k", aud]);
      const form = new FormData();
      form.append("file", new Blob([await readFile(aud)]), "a.mp3");
      form.append("model", "whisper-1");
      const r = await fetch(this.url, { method: "POST", body: form, headers: this.key ? { Authorization: `Bearer ${this.key}` } : {} });
      if (!r.ok) throw new Error(`transcription failed ${r.status}`);
      return String(((await r.json()) as any).text ?? "");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

/** Token balances at a moment, excluding pool/curve, creator and platform wallets. */
export interface HolderSource { snapshot(tokenId: string, exclude: string[]): Promise<SnapshotEntry[]> }

export class DbHolders implements HolderSource {
  constructor(private db: Db) {}
  async snapshot(tokenId: string, exclude: string[]) {
    const rows = await this.db.query(`select wallet, balance::text as balance from holders where token_id=$1 and balance > 0`, [tokenId]);
    return rows.filter((r) => !exclude.includes(r.wallet)).map((r) => ({ wallet: r.wallet, balance: BigInt(r.balance.split(".")[0]) }));
  }
}

/** Sends released funds on-chain. */
export interface PayoutExecutor { release(a: PayoutAttestation, sigs: { signer: string; signature: string }[]): Promise<string> }

export class SimPayouts implements PayoutExecutor {
  async release() { return "sim" + bs58.encode(randomBytes(40)).slice(0, 80); }
}

export class OnchainPayouts implements PayoutExecutor {
  async release(): Promise<string> {
    throw new Error("On-chain escrow release not built yet (programs/, milestone 4)");
  }
}
