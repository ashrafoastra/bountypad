# programs/ (on-chain)

`escrow/`: the Bounty Pad escrow (Anchor 0.32.1). Program id `BPADDJVZ2YAYgBG1hngg7a6YL5KPYaicKyzbk7AjRQ1Y`.
Rules and reasons: `docs/decisions.md` → "On-chain build".

| Instruction | Who | What |
|---|---|---|
| `initialize_config` / `update_config` | admin | verifiers (3), threshold (2), challenge window, deadline grace, burn treasury, our Meteora DBC config |
| `create_bounty` | coin creator, in the launch transaction | writes the terms once; checks the Meteora pool (owner, discriminator, our config, mint, creator) |
| `deposit` | anyone (the keeper) | adds SOL to a pot |
| `verify` | anyone, with 2 of 3 attestations | OPEN → VERIFIED, starts the challenge window, sets the payout wallet if known |
| `assign_wallet` | anyone, with 2 of 3 attestations | sets the payout wallet later (Path 2) |
| `release` | anyone | after the window: whole pot to the attested wallet (and later fees too) |
| `expire` | anyone | after deadline + grace: pot to the burn treasury |
| `opt_out` | anyone, with 2 of 3 attestations | pot to the burn treasury |
| `freeze` / `unfreeze` / `cancel` | admin | safety valve during the challenge window |

```bash
anchor build && cp target/deploy/bounty_escrow.so build/   # needs the program key in keys/ for the right id
scripts/start-local-validator.sh                            # local Solana with Meteora + Metaplex + escrow
```
The API's `npm run chain:setup -w api` deploys `build/bounty_escrow.so` to devnet. IDL: `shared/idl/bounty_escrow.json`.
