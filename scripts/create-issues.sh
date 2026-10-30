#!/usr/bin/env bash
# Creates the Stanza contributor backlog (Drips Wave + good first issues).
#
#   gh auth login
#   REPO=stanza-labs/stanza ./scripts/create-issues.sh
#
# Use DRY_RUN=true to print instead of creating.
set -euo pipefail

REPO="${REPO:-stanza-labs/stanza}"
DRY_RUN="${DRY_RUN:-false}"

command -v gh >/dev/null 2>&1 || {
  echo "GitHub CLI (gh) is required: https://cli.github.com" >&2
  exit 1
}

label() {
  gh label create "$1" --repo "$REPO" --color "$2" --description "$3" --force >/dev/null 2>&1 || true
}

if [[ "$DRY_RUN" != "true" ]]; then
  label "Stellar Wave" "7B3FE4" "Scoped for the Stellar Drips Wave program"
  label "good first issue" "7057ff" "Small, well-bounded change"
  label "complexity: low" "0E8A16" "A few hours"
  label "complexity: mid" "FBCA04" "A day or two"
  label "complexity: high" "B60205" "Several days, design involved"
  label "contract" "5319E7" "Soroban contract (Rust)"
  label "sdk" "1D76DB" "TypeScript SDK"
  label "indexer" "006B75" "Event indexer and REST API"
  label "web" "C5DEF5" "Next.js application"
  label "docs" "D4C5F9" "Documentation"
  label "testing" "BFD4F2" "Tests and CI"
fi

issue() {
  local title="$1"
  local labels="$2"
  local body="$3"
  if [[ "$DRY_RUN" == "true" ]]; then
    printf '\n[dry-run] %s\nlabels: %s\n' "$title" "$labels"
  else
    gh issue create --repo "$REPO" --title "$title" --body "$body" --label "$labels"
  fi
}

issue "contract: return a dedicated error when the allowance is missing" \
"contract,Stellar Wave,complexity: mid" \
"$(cat <<'EOF'
**Context.** `charge` currently lets the token contract reject an expired or
exhausted allowance, which surfaces as an opaque host error in the UI.

**Task.** Add a best-effort allowance pre-check in `charge` using
`token::Client::try_allowance(subscriber, contract)`. When the token implements
`allowance` and the value is below `plan.amount`, return a new
`Error::InsufficientAllowance` instead of calling `transfer_from`. Tokens without
the optional `allowance` method must keep working (ignore the probe error).

**Acceptance**
- New error variant documented in `docs/contract-reference.md` and mapped in
  `CONTRACT_ERRORS` in `packages/sdk/src/client.ts`.
- Tests: exhausted allowance → `InsufficientAllowance`; token without allowance → charge still works.
- `pnpm contract:test` and `pnpm --filter @stanza/sdk test` pass.
EOF
)"

issue "contract: add an optional plan end date" \
"contract,Stellar Wave,complexity: mid" \
"$(cat <<'EOF'
**Context.** Plans can be retired by the merchant, but they cannot expire on
their own. Time-boxed offers (a 6-month promo) need manual intervention.

**Task.** Add `end_time: u64` (`0` = never) to `Plan` and `create_plan`.
`charge` must reject after `end_time`, and `subscribe` must reject once the plan
has expired. Keep `max_cycles` behavior unchanged.

**Acceptance**
- Storage layout change is written to `docs/protocol.md` and `docs/contract-reference.md`.
- New tests: charge after end date fails; subscribe after end date fails; end_time = 0 means unbounded.
- SDK types, `createPlanTx`, parsers, and `billingProgress` updated.
- Note the contract-id bump in the PR (the contract is immutable).
EOF
)"

issue "contract: expose per-plan revenue and subscriber counters" \
"contract,complexity: low" \
"$(cat <<'EOF'
**Context.** The plan page shows subscribers, but aggregate revenue requires
replaying every `charged` event.

**Task.** Add read-only `plan_stats(plan_id) -> PlanStats { subscribers: u32,
cycles_charged: u32, total_volume: i128 }`, maintained incrementally on
`subscribe` and `charge`. No new auth, no new events.

**Acceptance**
- Counters stay correct across cancel, pause, and completion.
- Unit tests cover multiple subscriptions per plan.
- SDK method + type, and the plan page displays the totals.
EOF
)"

issue "contract: property tests for charge accounting" \
"contract,testing,complexity: high" \
"$(cat <<'EOF'
**Context.** The unit tests cover scenarios; the accounting rules deserve
property-based coverage.

**Task.** Add `proptest`-style tests (or a deterministic generator) over random
plan prices, periods, trials, caps, and charge timestamps. Assert:

1. `total_paid == cycles_charged * amount` for every subscription.
2. The contract token balance is always zero.
3. `cycles_charged` never exceeds `max_cycles`.
4. A charge never happens before `next_charge_at`.
5. Total transferred to the merchant equals the sum of charged amounts.

**Acceptance**
- At least 256 generated cases, deterministic seed in CI.
- Runs under `cargo test` in reasonable time (< 60s).
EOF
)"

issue "contract: add a batch charge helper for keepers" \
"contract,Stellar Wave,complexity: mid" \
"$(cat <<'EOF'
**Context.** Keepers drain the due queue one transaction per subscription.

**Task.** Add `charge_many(sub_ids: Vec<u64>) -> Vec<ChargeOutcome>` that skips
(does not revert) subscriptions that are not due, and reports per-id success.
Cap the batch size (e.g. 20) to bound CPU.

**Acceptance**
- Not-due or inactive ids do not abort the batch.
- One event per successful charge, same shape as single `charge`.
- Tests for partial success and batch-size limit.
- SDK helper `chargeManyTx`.
EOF
)"

issue "sdk: publish the package to npm with dual ESM/CJS output" \
"sdk,Stellar Wave,complexity: low" \
"$(cat <<'EOF'
**Context.** `@stanza/sdk` is workspace-only today.

**Task.** Configure `tsup` (or two `tsc` targets) to emit ESM + CJS + `.d.ts`,
set `exports`, `files`, and `publishConfig`, add a `prepublishOnly` build, and
document install/usage in `docs/developers/sdk.md`.

**Acceptance**
- `npm pack` contains only `dist` + README + LICENSE.
- Both `import` and `require` work in a scratch project.
- CI builds the package on every PR.
EOF
)"

issue "sdk: add a waitForTransaction helper" \
"sdk,StellarWave,complexity: low" \
"$(cat <<'EOF'
**Context.** Every caller re-implements the send/poll loop (the web app does it
twice).

**Task.** Add `waitForTransaction(hash, { attempts, intervalMs })` (or
`submitAndWait(signedXdr)`) that polls `getTransaction` with backoff and returns a
typed result, throwing a descriptive error on `FAILED` or timeout.

**Acceptance**
- Unit tests with a stubbed RPC server (no network).
- Web app uses the helper instead of its local loop.
- Documented in the SDK reference.
EOF
)"

issue "sdk: React hooks package for plans and subscriptions" \
"sdk,complexity: mid" \
"$(cat <<'EOF'
**Context.** The app composes reads by hand in each page.

**Task.** Add `packages/react` (`@stanza/react`) exposing:

- `usePlan(client, planId)` and `useSubscription(client, subId)`
- `useDueCycles(plan, sub)` with a one-second tick
- `useAllowance(token, owner, spender)`

**Acceptance**
- No data-fetching dependency required; plain hooks with abort handling.
- SSR-safe (no `window` at module scope).
- Tests with `@testing-library/react`.
- The web app migrates at least one page to the hooks.
EOF
)"

issue "indexer: idempotent event ingestion and replay tests" \
"indexer,Stellar Wave,complexity: mid" \
"$(cat <<'EOF'
**Context.** Restarts resume from the stored cursor, but re-processing the same
event (crash between write and cursor update) can double-insert charges.

**Task.** Make ingestion idempotent using a unique constraint on
`(ledger, tx_hash, event_type, sub_id)` and `INSERT OR IGNORE`. Add tests that
replay the same batch twice and assert counts are unchanged.

**Acceptance**
- Replay of any prefix produces the same database state.
- `GET /api/subscriptions/:id/charges` never duplicates a charge.
- Migration note for existing SQLite files.
EOF
)"

issue "indexer: Postgres adapter alongside SQLite" \
"indexer,complexity: mid" \
"$(cat <<'EOF'
**Context.** SQLite requires a persistent disk and single-writer host. Many
managed Node hosts prefer Postgres.

**Task.** Introduce a storage interface with two implementations: the current
SQLite one and a Postgres one selected by `DATABASE_URL`. Keep the REST contract
identical.

**Acceptance**
- Same API responses from both backends (contract tests against each).
- Schema migration script or `CREATE TABLE IF NOT EXISTS` bootstrap.
- Deployment docs updated with a Postgres option.
EOF
)"

issue "indexer: publish an OpenAPI schema" \
"indexer,docs,complexity: low" \
"$(cat <<'EOF'
**Context.** The REST API is documented by hand in MkDocs.

**Task.** Add an OpenAPI 3.1 document generated from the Express routes (or
maintained as `indexer/openapi.yaml` with a CI check that every documented route
exists). Serve it at `GET /openapi.json` and render it in the docs.

**Acceptance**
- Schema validates with `swagger-cli validate`.
- CI fails if a route is missing from the schema.
- `docs/developers/api.md` links to the schema.
EOF
)"

issue "web: allowance expiry and low-allowance warnings" \
"web,Stellar Wave,complexity: low" \
"$(cat <<'EOF'
**Context.** A subscriber only discovers an expired allowance when a charge
fails.

**Task.** On the subscription page, compare the approved allowance with the
remaining cycles and the allowance's expiry ledger. Show an inline warning and a
one-click top-up when fewer than two cycles are covered, or when the allowance
expires before the next charge.

**Acceptance**
- Handles tokens without an `allowance` method gracefully.
- Copy explains the consequence in plain language.
- No layout shift on mobile.
EOF
)"

issue "web: merchant charge queue with batch settlement" \
"web,complexity: mid" \
"$(cat <<'EOF'
**Context.** The keeper tab lists due subscriptions one card at a time.

**Task.** Build a queue view that groups due subscriptions by plan, lets the
merchant select many, and settles them sequentially with per-item status and a
final summary. Use the SDK's batch helper when available, otherwise loop.

**Acceptance**
- Partial failures are visible per subscription, not a single alert.
- Refreshes on-chain state after each settlement.
- Works without the indexer (falls back to `plansOf` + `subsOfPlan`).
EOF
)"

issue "web: CSV export of settlements for accounting" \
"web,complexity: low" \
"$(cat <<'EOF'
**Context.** Merchants need a record for bookkeeping.

**Task.** Add an export button on a plan page that downloads a CSV of charges:
subscription id, subscriber, amount in base units and decimal, cycle number,
ledger, closed-at timestamp, tx hash.

**Acceptance**
- Filename includes the plan id and date range.
- Amounts are exported as exact decimal strings (no floats).
- Uses indexer data when available, with a notice when the API is offline.
EOF
)"

issue "web: responsive and accessibility pass" \
"web,good first issue,Stellar Wave,complexity: low" \
"$(cat <<'EOF'
**Context.** The app is desktop-first; several panels assume wide screens.

**Task.** Audit the dashboard, create-plan, plan, and subscription pages at
360px, 768px, and 1280px. Fix overflow, tap targets, table wrapping, and focus
states. Add `aria-live` to transaction notices and label every form control.

**Acceptance**
- No horizontal scroll at 360px.
- Keyboard-only flow works end to end.
- Lighthouse accessibility ≥ 95 on the four pages.
EOF
)"

issue "docs: sequence diagrams for publish, subscribe, and charge" \
"docs,good first issue,Stellar Wave,complexity: low" \
"$(cat <<'EOF'
**Context.** The protocol page explains the rules in prose and a table.

**Task.** Add Mermaid sequence diagrams to `docs/protocol.md` for:

1. Merchant publishes a plan.
2. Subscriber approves and subscribes (two transactions).
3. Keeper charges a due cycle, including the token `transfer_from`.
4. Subscriber cancels and revokes the allowance.

**Acceptance**
- Diagrams render with `mkdocs build --strict`.
- Labels use the real function names and arguments.
EOF
)"

issue "docs: 3-minute walkthrough video and README GIF" \
"docs,complexity: low" \
"$(cat <<'EOF'
**Context.** Reviewers and new contributors cannot see the product without
running it.

**Task.** Record a walkthrough on testnet: publish a plan, subscribe from a
second account, charge a cycle, pause, resume, cancel. Add a GIF to the README
and embed the video in `docs/index.md`.

**Acceptance**
- Under 3 minutes, no audio required, captions for key steps.
- Assets stored in `docs/assets/` with a source link.
EOF
)"

issue "testing: end-to-end flow against a local Soroban network" \
"testing,complexity: high" \
"$(cat <<'EOF'
**Context.** Contract tests cover the contract, and the SDK has unit tests, but
nothing exercises the real transaction path (approve → subscribe → charge) with
the actual SDK and a deployed wasm.

**Task.** Add a `workflow_dispatch` CI job that starts a local network
(`stellar network container start` or `stellar network local`), deploys the
built wasm, creates and funds two accounts, and runs a Node script through the
full lifecycle using `@stanza/sdk`.

**Acceptance**
- Job is opt-in (not on every push) and completes in < 10 minutes.
- Asserts balances, subscription state, and emitted events.
- Script lives in `scripts/e2e-local.mjs` and is documented.
EOF
)"

issue "testing: scheduled testnet smoke test" \
"testing,complexity: mid" \
"$(cat <<'EOF'
**Context.** The committed testnet contract could drift from `main`.

**Task.** Add a scheduled workflow that:

1. Builds the wasm from `main`.
2. Deploys to testnet with a funded throwaway key.
3. Runs `create_plan` → `approve` → `subscribe` → `charge` via the CLI.
4. Fails if the wasm hash does not match `deployments/testnet.json`, and opens an
   issue when it does not.

**Acceptance**
- Weekly schedule plus manual dispatch.
- Secrets never printed; the key is generated per run.
- Failure output links to the failing transaction.
EOF
)"

echo
echo "Done. Backlog created for ${REPO}."
