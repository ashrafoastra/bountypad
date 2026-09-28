# programs/ (on-chain dev)

Anchor escrow program. Not started. It must:
1. Hold each coin's bounty pot in a PDA vault.
2. Release only with 2 of 3 valid ed25519 verifier signatures over the attestation bytes defined in `api/src/core/payout.ts` (use the ed25519 verify instruction + instruction introspection).
3. Burn the pot on EXPIRED / OPTED_OUT.
4. Put the upgrade authority behind the 2-of-3 Squads multisig.

Put the generated IDL in `shared/idl/`.
