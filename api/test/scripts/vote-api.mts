// Manual check: signed votes through the HTTP endpoint. Usage: npx tsx test/scripts/vote-api.mts <roundId>
import nacl from "tweetnacl"; import bs58 from "bs58"; import { voteMessage } from "@bountypad/shared"; import { SIM_WALLETS } from "../../src/sim/sim";
const round = process.argv[2]; const url = "http://localhost:4000/api/votes/" + round;
async function vote(i: number, choice: "YES" | "NO", forge = false) {
  const w = SIM_WALLETS[i];
  const sig = forge ? bs58.encode(new Uint8Array(64)) : bs58.encode(nacl.sign.detached(new TextEncoder().encode(voteMessage(round, choice)), w.secretKey));
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet: w.address, choice, signature: sig }) });
  return res.status + " " + (await res.text()).slice(0, 100);
}
for (let i = 1; i < SIM_WALLETS.length; i++) { const out = await vote(i, "YES"); if (out.startsWith("200")) { console.log("snapshot holder votes:", out); break; } }
console.log("forged signature:     ", await vote(3, "NO", true));
console.log("creator (excluded):   ", await vote(0, "YES"));
