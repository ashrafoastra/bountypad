#!/bin/bash
# Local Solana network with Meteora DBC + Metaplex + our escrow, for development and tests.
#   programs/scripts/start-local-validator.sh
# Needs the Solana CLI. Meteora + Metaplex programs are copied from mainnet on first run.
set -e
cd "$(dirname "$0")/.."
mkdir -p .fixtures
DBC=dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN
MPL=metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s
[ -f .fixtures/dbc.so ] || solana program dump -u m $DBC .fixtures/dbc.so
[ -f .fixtures/metaplex.so ] || solana program dump -u m $MPL .fixtures/metaplex.so
exec solana-test-validator --reset --ledger .fixtures/ledger \
  --bpf-program $DBC .fixtures/dbc.so \
  --bpf-program $MPL .fixtures/metaplex.so \
  --bpf-program BPADDJVZ2YAYgBG1hngg7a6YL5KPYaicKyzbk7AjRQ1Y build/bounty_escrow.so
