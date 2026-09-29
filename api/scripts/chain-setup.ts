/**
 * One-command on-chain setup (devnet by default).
 *
 *   npm run chain:setup -w api                 # devnet
 *   npm run chain:setup -w api -- localnet     # a local validator on :8899
 *
 * Creates (once, then reuses) the platform keys in api/.chain/<cluster>/, deploys the escrow
 * program if it isn't there, creates our Meteora DBC launchpad config and the escrow config,
 * then writes the settings into api/.env. Safe to run again: every step is skipped if done.
 * Never commit api/.chain/ (it holds private keys).
 */
import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bs58 from "bs58";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { Launchpad } from "../src/chain/launchpad";
import { EscrowClient, ESCROW_PROGRAM_ID } from "../src/chain/escrow";

const here = path.dirname(fileURLToPath(import.meta.url));
const apiDir = path.resolve(here, "..");
const repo = path.resolve(apiDir, "..");
const cluster = (process.argv[2] || process.env.SOLANA_CLUSTER || "devnet") as "devnet" | "localnet";
const rpc = process.env.SOLANA_RPC_URL && process.argv[2] === undefined ? process.env.SOLANA_RPC_URL : cluster === "localnet" ? "http://127.0.0.1:8899" : "https://api.devnet.solana.com";
const demo = !process.env.X_BEARER_TOKEN || process.env.X_MODE === "mock";
const keyDir = path.join(apiDir, ".chain", cluster);
const soPath = path.join(repo, "programs", "build", "bounty_escrow.so");
const programKeyPath = path.join(repo, "programs", "keys", "bounty_escrow-keypair.json");

const say = (s: string) => console.log(s);
const ok = (s: string) => console.log(`  ✓ ${s}`);

function key(name: string): Keypair {
  mkdirSync(keyDir, { recursive: true });
  const f = path.join(keyDir, `${name}.json`);
  if (existsSync(f)) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(f, "utf8"))));
  const k = Keypair.generate();
  writeFileSync(f, JSON.stringify(Array.from(k.secretKey)), { mode: 0o600 });
  return k;
}

function setEnv(values: Record<string, string>) {
  const f = path.join(apiDir, ".env");
  let lines = existsSync(f) ? readFileSync(f, "utf8").split("\n") : [];
  for (const [k, v] of Object.entries(values)) {
    const i = lines.findIndex((l) => l.startsWith(`${k}=`));
    if (i >= 0) lines[i] = `${k}=${v}`; else lines.push(`${k}=${v}`);
  }
  writeFileSync(f, lines.filter((l, i, a) => l !== "" || i < a.length - 1).join("\n") + "\n", { mode: 0o600 });
}

/** The `solana` binary: on the PATH, or where the official installer puts it (new terminals only get the PATH). */
function solanaCli(): string | null {
  const home = process.env.HOME || "";
  for (const c of ["solana", path.join(home, ".local/share/solana/install/active_release/bin/solana")]) {
    try { execFileSync(c, ["--version"], { stdio: "ignore" }); return c; } catch { /* next */ }
  }
  return null;
}

async function main() {
  say(`\nBounty Pad on-chain setup: ${cluster} (${rpc})\n`);
  const conn = new Connection(rpc, "confirmed");
  try { await conn.getVersion(); } catch {
    throw new Error(cluster === "localnet" ? "No local validator on :8899. Start one: programs/scripts/start-local-validator.sh" : `Can't reach ${rpc}`);
  }

  const keeper = key("keeper");
  const verifierMain = key("verifier-main");
  const verifierBackup = key("verifier-backup");
  const verifierAdmin = key("verifier-admin");
  const dbcConfig = key("dbc-config");
  ok(`keys in api/.chain/${cluster}/ (keeper ${keeper.publicKey.toBase58()})`);

  // 1. Fund the keeper. Deploying the 320 KB escrow program needs ~2.3 SOL of rent plus a temporary
  //    buffer of the same size (refunded after the deploy), so about 5 SOL the first time.
  let bal = await conn.getBalance(keeper.publicKey);
  const programInfo = await conn.getAccountInfo(ESCROW_PROGRAM_ID);
  const need = (programInfo ? 0.2 : 5) * LAMPORTS_PER_SOL;
  if (bal < need) {
    try {
      const sig = await conn.requestAirdrop(keeper.publicKey, (cluster === "localnet" ? 100 : 2) * LAMPORTS_PER_SOL);
      await conn.confirmTransaction(sig, "confirmed");
      bal = await conn.getBalance(keeper.publicKey);
    } catch { /* devnet faucet is rate limited */ }
  }
  if (bal < need) {
    say(`\n  The keeper needs about ${need / LAMPORTS_PER_SOL} SOL on ${cluster} and has ${bal / LAMPORTS_PER_SOL}.`);
    say(`  Get free devnet SOL at https://faucet.solana.com (sign in with GitHub for 5 SOL) for this address, then run this again:\n\n    ${keeper.publicKey.toBase58()}\n`);
    process.exit(2);
  }
  ok(`keeper balance ${bal / LAMPORTS_PER_SOL} SOL`);

  // 2. Escrow program.
  if (!programInfo?.executable) {
    if (!existsSync(soPath)) throw new Error(`Missing ${soPath}. Build it: cd programs && anchor build && cp target/deploy/bounty_escrow.so build/`);
    if (!existsSync(programKeyPath)) throw new Error(`Missing ${programKeyPath} (the program's address key; ask the on-chain dev for it)`);
    say("  Deploying the escrow program (takes a minute)...");
    const keeperFile = path.join(keyDir, "keeper.json");
    const cli = solanaCli();
    if (!cli) {
      throw new Error("The Solana CLI isn't installed (or not on your PATH). Install it, open a NEW terminal, check `solana --version`, then run this again:\n\n    sh -c \"$(curl -sSfL https://release.anza.xyz/stable/install)\"");
    }
    try {
      execFileSync(cli, ["program", "deploy", soPath, "--program-id", programKeyPath, "--keypair", keeperFile, "--url", rpc, "--commitment", "confirmed"], { stdio: "inherit" });
    } catch (e) {
      throw new Error(`Deploy failed (${(e as Error).message.split("\n")[0]}). The Solana CLI output above says why. Common fixes: wait a minute and run this again (devnet is busy), or top up the keeper if it ran out of SOL.`);
    }
  }
  ok(`escrow program ${ESCROW_PROGRAM_ID.toBase58()}`);

  // 3. Our Meteora DBC launchpad config (fee claimer = keeper).
  const lp = new Launchpad(conn, dbcConfig.publicKey);
  if (!(await conn.getAccountInfo(dbcConfig.publicKey))) {
    const tx = await lp.createConfigTx(dbcConfig, keeper.publicKey, keeper.publicKey);
    await sendAndConfirmTransaction(conn, tx, [keeper, dbcConfig], { commitment: "confirmed" });
  }
  ok(`Meteora launchpad config ${dbcConfig.publicKey.toBase58()}`);

  // 4. Escrow config: 2 of 3 verifiers, challenge window, grace covering recheck + vote + extension.
  const challengeWindowSec = Number(process.env.CHALLENGE_WINDOW_SEC || (demo ? 20 : 48 * 3600));
  const recheck = Number(process.env.RECHECK_AFTER_SEC || (demo ? 20 : 24 * 3600));
  const vote = Number(process.env.VOTE_WINDOW_SEC || (demo ? 60 : 48 * 3600));
  const deadlineGraceSec = recheck + 2 * vote + 3600;
  const escrow = new EscrowClient(conn);
  const args = {
    verifiers: [verifierMain.publicKey, verifierBackup.publicKey, verifierAdmin.publicKey] as [PublicKey, PublicKey, PublicKey],
    threshold: 2, challengeWindowSec, deadlineGraceSec, treasury: keeper.publicKey, dbcConfig: dbcConfig.publicKey,
  };
  const existing = await escrow.config();
  if (!existing) {
    await sendAndConfirmTransaction(conn, new Transaction().add(await escrow.initializeConfig(keeper.publicKey, args)), [keeper], { commitment: "confirmed" });
  } else if (existing.admin.equals(keeper.publicKey)) {
    await sendAndConfirmTransaction(conn, new Transaction().add(await escrow.updateConfig(keeper.publicKey, args, keeper.publicKey)), [keeper], { commitment: "confirmed" });
  } else {
    say(`  ! escrow config exists with another admin (${existing.admin.toBase58()}); left unchanged`);
  }
  ok(`escrow config: 2 of 3 verifiers, challenge window ${challengeWindowSec}s, deadline grace ${deadlineGraceSec}s`);

  // 5. api/.env
  const b58 = (k: Keypair) => bs58.encode(k.secretKey);
  setEnv({
    CHAIN: "solana",
    SOLANA_CLUSTER: cluster,
    SOLANA_RPC_URL: rpc,
    DBC_CONFIG: dbcConfig.publicKey.toBase58(),
    KEEPER_SECRET_KEY: b58(keeper),
    ESCROW_ADMIN_SECRET_KEY: b58(keeper),
    VERIFIER_SECRET_KEY: b58(verifierMain),
    VERIFIER_BACKUP_SECRET_KEY: b58(verifierBackup),
    VERIFIER_ALLOWED_SIGNERS: args.verifiers.map((v) => v.toBase58()).join(","),
    CHALLENGE_WINDOW_SEC: String(challengeWindowSec),
  });
  ok("api/.env updated (CHAIN=solana). Restart the API.");
  say(`\n  To go back to the simulation: set CHAIN=sim in api/.env\n`);
}

main().catch((e) => {
  console.error(`\n✗ ${(e as Error).message}\n`);
  process.exit(1);
});
