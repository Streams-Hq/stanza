# Change report: StellarStream → Stanza

**Prepared for:** Drips Wave re-submission
**Date:** 29 October 2026
**Previous submission:** `Streams-Hq/stellar-stream-app` — StellarStream
**New project:** `stanza-labs/stanza` — **Stanza, non-custodial recurring subscriptions on Stellar**
**Status at time of writing:** contract deployed and exercised on Stellar testnet; contract tests, SDK tests, docs build, and the full monorepo build pass.

---

## 1. Executive summary

The previous submission was an application layer around a streaming-payment
contract that lived in a different repository. It was a thin frontend over an
external dependency: no contract in the repo, nothing deployed by the project
itself, and no Stellar-specific mechanism beyond calling one contract.

This submission replaces the product. Stanza is a **self-contained Soroban
protocol for recurring subscriptions**, rebuilt from the contract up:

- A new Rust/Soroban contract is in this repository, with **15 passing unit
  tests** covering the full lifecycle against a real Stellar Asset Contract.
- The contract is **deployed on Stellar testnet** and a complete
  plan → approve → subscribe → charge cycle has been executed on-chain.
- The product is built on Stellar primitives that did not exist in the previous
  submission: **SEP-41 allowances** (`approve` / `transfer_from`), SAC tokens,
  ledger-time enforcement, Soroban persistent storage with TTL management, and
  contract events consumed over Soroban RPC.
- The TypeScript SDK, indexer, and web app were all rewritten around the new
  protocol, with **16 passing SDK tests** and a green production build.
- Documentation, README, security policy, CI, repository settings, and a
  **19-issue contributor backlog** were regenerated to match the new product.
- The project, packages, environment variables, repositories, and organization
  are renamed, with an executable rename script and a step-by-step migration
  plan in [§10](#10-repository-and-organization-renames).

The result is a protocol with a clear market gap (Stellar has no native
recurring billing), a real on-chain artifact reviewers can inspect, and a
contribution surface that is large enough to sustain a Wave cohort.

---

## 2. Why the previous submission was rejected

The rejection did not come with a detailed rubric, so this section states the
diagnosis the rebuild is based on. Each point is addressed directly later.

| Likely objection | What it looked like before | What changed |
| --- | --- | --- |
| The repo was an app around someone else's contract | The `stream` contract lived in `Deyanju23/stellar-stream-contract`; this repo only built transactions against it | The contract is now in `contracts/stanza`, versioned with the SDK and app that use it |
| Nothing was deployed by the project | No contract id, no deployment record, docs said "populated post-deploy" | Live testnet contract, committed `deployments/testnet.json`, demo plan and subscription, transaction hashes |
| Thin Stellar integration | The app signed and submitted transactions; the only Stellar-specific logic was in an external contract | SEP-41 allowance mandate, SAC asset support, ledger-clock charging, TTL-managed storage, typed event indexing, permissionless keeper settlement |
| Generic category with weak differentiation | "Payment streaming" is a crowded, app-level category on every chain | Recurring subscription billing is a named gap on Stellar and requires allowance semantics, not a generic escrow |
| Scaffold-quality repository | Missing end-to-end artifact, docs predicted a contract that was not verifiable from this repo | Contract + tests + deployment + SDK + indexer + app + docs + CI in one repository, all runnable |
| Unclear contributor surface | Backlog mirrored the thin app layer | 19 scoped issues across contract, SDK, indexer, web, docs, and testing, labelled for Wave |

The response is not a reskin. The previous product shape (push payments that
accrue every second) was replaced with the opposite shape (a small, discrete,
repeating pull that the subscriber can revoke), because that is where the
Stellar-native gap actually is.

---

## 3. Product pivot

| | Before (StellarStream) | After (Stanza) |
| --- | --- | --- |
| Product | Continuous linear payment streams | Recurring subscription billing |
| Money movement | Sender locks the full deposit in the contract; recipient withdraws as it accrues | Subscriber keeps funds; contract pulls one cycle at a time via SEP-41 `transfer_from` |
| Custody | Contract custodies the entire stream balance | Contract never holds a token balance (asserted by a test) |
| Trust boundary | Contract accrual math | Token-level allowance, capped by amount and expiry |
| Cancellation | Sender cancels; recipient is paid accrued remainder | Subscriber cancels unilaterally; nothing to refund |
| Who triggers settlement | The recipient withdraws | Anyone can charge a due cycle (permissionless keeper) |
| Contract location | Separate repository | `contracts/stanza` in this monorepo |
| Deployment | None by the project | Live on testnet, with recorded ids and transactions |
| Frontend | Dashboard + 60fps balance visualizer | Merchant plans, plan discovery, subscribe-with-allowance, subscriber controls, keeper queue |
| Indexer | Stream events → SQLite | Plan/subscription/charge events → SQLite, plus a `/due` keeper queue |

---

## 4. What Stanza does

A **merchant** publishes a reusable plan: token, price per cycle, cycle length,
optional trial, optional cap on paid cycles. Plan parameters are immutable; to
change a price the merchant retires the plan and publishes a new one.

A **subscriber** grants the Stanza contract a SEP-41 allowance for a few cycles
and calls `subscribe`. The contract stores `next_charge_at` and the cycle
counter. The subscriber's money stays in their own wallet.

Once a cycle is due, **anyone** calls `charge`. The contract:

1. verifies the subscription is active, the plan is live, the cap is not
   reached, and `ledger.timestamp() >= next_charge_at`;
2. writes the new cycle count, total paid, and next due timestamp **before**
   touching the token (checks-effects-interactions);
3. pulls exactly one cycle price with
   `transfer_from(contract, subscriber, merchant, amount)`.

Subscribers can pause (time paused is never billed), resume, cancel, and top up
or revoke the allowance. Merchants can retire a plan. The contract has no admin,
no upgrade path, and no custody.

---

## 5. How the product depends on Stellar and Soroban

Every core behavior is a Stellar primitive. This is the section that matters for
ecosystem fit.

| Stellar / Soroban primitive | How Stanza uses it | Where |
| --- | --- | --- |
| **SEP-41 `approve`** | Subscriber grants a capped, expiring mandate to the contract | `approveAllowanceTx` in the SDK, `subscribe` flow in the plan page |
| **SEP-41 `transfer_from`** | The contract is the spender and pulls exactly one cycle price per charge | `charge` in `contracts/stanza/src/lib.rs` |
| **Stellar Asset Contract** | XLM and any Stellar asset are billable through the same path; tests use a real SAC | `src/test.rs`, default token env var |
| **Ledger timestamp** | Due-ness is `env.ledger().timestamp() >= next_charge_at`; no server clock | `charge`, `is_due`, `cycles_due` |
| **Soroban persistent storage + TTL** | Plans and subscriptions are persistent entries extended 30-day threshold / 120-day extension on every access | `load_plan`, `store_plan`, `load_sub`, `store_sub`, index vectors |
| **Soroban contract events** | 7 typed events (`plan_new`, `sub_new`, `charged`, `paused`, `resumed`, `canceled`, `plan_act`) | `env.events().publish` |
| **Soroban RPC** | Reads are simulations; writes are prepared transactions; the indexer polls `getEvents` | SDK client, indexer |
| **Freighter** | Wallet authorization for `approve`, `subscribe`, `pause/resume/cancel`, `charge` | `apps/web/src/hooks/useFreighter.ts` |
| **Stellar CLI** | Deploy and smoke-test the contract; the build path requires `stellar contract build` | `scripts/deploy-testnet.mjs`, docs |

There is no database-backed scheduler, no off-chain signing service, no card
processor, and no bridge. If Soroban and SEP-41 disappeared, Stanza would not
have a product.

---

## 6. Contract design and live evidence

### 6.1 Deployed artifact

| | |
| --- | --- |
| Contract id | `CDGIYCP56ZAC5ZVTJVHJQ5H7OLZSCDU3DFA77VWXT74N47MW6ZBV4FDP` |
| Network | Stellar testnet (`Test SDF Network ; September 2015`) |
| RPC | `https://soroban-testnet.stellar.org` |
| Wasm SHA-256 | `4638029cba67555f31ef4404e3c08b3fa507f987cf291308a7dfc445245ebf38` |
| Deployer | `GANMJTFQPOG2XD4VEXO3IBEDANFX6FKLA5TKY3W2B6DTVEKT7I6FQRL5` |
| Deployment record | [`deployments/testnet.json`](./deployments/testnet.json) |
| Explorer | https://stellar.expert/explorer/testnet/contract/CDGIYCP56ZAC5ZVTJVHJQ5H7OLZSCDU3DFA77VWXT74N47MW6ZBV4FDP |

### 6.2 Executed on-chain lifecycle

These are real testnet transactions, not fixture data.

| Step | Ledger | Transaction |
| --- | --- | --- |
| Deploy wasm + create contract | — | [`ecb8c29af6a1c8f285fa0a8c46985dca02d320e09c07bdfb3fa77e57d544a276`](https://stellar.expert/explorer/testnet/tx/ecb8c29af6a1c8f285fa0a8c46985dca02d320e09c07bdfb3fa77e57d544a276) |
| `create_plan` (plan `#0`, 1 XLM / 30 days, cap 12) | 5458669 | [`1b6a5320dc8511a33431425815836a396ba2535bc5ab4642d3bd1ee85f6c3275`](https://stellar.expert/explorer/testnet/tx/1b6a5320dc8511a33431425815836a396ba2535bc5ab4642d3bd1ee85f6c3275) |
| `approve` (3 cycles of XLM SAC allowance) | — | executed immediately before `subscribe`; visible on the subscriber's account history |
| `subscribe` (subscription `#0`) | 5458673 | [`cc4bb6f22d706993ff88030259b65ef45c641be28f9a050f74f879f97066e001`](https://stellar.expert/explorer/testnet/tx/cc4bb6f22d706993ff88030259b65ef45c641be28f9a050f74f879f97066e001) |
| `charge` (cycle 1) | 5458674 | [`6e8ef4bc38bf166d2ab779e5e5632fe62e2d25e09863bdb5f157b50b062104e4`](https://stellar.expert/explorer/testnet/tx/6e8ef4bc38bf166d2ab779e5e5632fe62e2d25e09863bdb5f157b50b062104e4) |

Resulting subscription state, read back from the contract:

```json
{
  "id": 0,
  "plan_id": 0,
  "subscriber": "GBQDDMHXSFGASUDNGDCMFGV2LO2GJONZD2CNYRDDAHXO2QQZWS5OGFUK",
  "next_charge_at": 1795909005,
  "started_at": 1793317005,
  "cycles_charged": 1,
  "total_paid": "10000000",
  "status": 0
}
```

The `charged` event emitted by that transaction:

```json
{
  "sub_id": "0",
  "plan_id": "0",
  "subscriber": "GBQDDMHXSFGASUDNGDCMFGV2LO2GJONZD2CNYRDDAHXO2QQZWS5OGFUK",
  "merchant": "GANMJTFQPOG2XD4VEXO3IBEDANFX6FKLA5TKY3W2B6DTVEKT7I6FQRL5",
  "amount": "10000000",
  "cycles_charged": 1,
  "next_charge_at": "1795909005",
  "total_paid": "10000000"
}
```

One cycle of 1 XLM moved from the subscriber to the merchant, the next charge
moved forward by exactly 30 days, and the contract's own token balance remained
zero.

### 6.3 Contract surface

Functions: `create_plan`, `set_plan_active`, `subscribe`, `charge`, `pause`,
`resume`, `cancel`, `get_plan`, `get_subscription`, `is_due`, `cycles_due`,
`plan_count`, `subscription_count`, `plans_of`, `subs_of`, `subs_of_plan`.

Design decisions worth noting:

- **Permissionless charging.** The plan fixes the price and recipient, so a third
  party settling a due cycle cannot change the outcome.
- **Effects before interactions.** State is written before `transfer_from`, so a
  malicious token cannot re-enter into a second charge.
- **Backlog safety.** One charge settles exactly one cycle and advances
  `next_charge_at` by exactly one period; `cycles_due` reports the backlog.
- **Paused time is free.** `resume` sets `next_charge_at = now + period`.
- **No allowance check at subscribe.** Deliberate: tokens may not implement the
  optional `allowance` method. The app always approves first, and the first
  charge fails at the token if the mandate is missing. This is documented as a
  known property in `SECURITY.md` and queued as an issue with a dedicated error.

---

## 7. Verification log

Run on 29 October 2026 in this repository. Failures and limitations are listed
in [§13](#13-risks-and-limitations); nothing below is asserted without a run.

| Check | Command | Result |
| --- | --- | --- |
| Contract unit tests | `cargo test` (in `contracts/stanza`) | **15 passed, 0 failed** |
| Contract formatting | `cargo fmt --check` | pass (after `cargo fmt`) |
| Deployable wasm | `stellar contract build` | **14,850 bytes**, `stellar 25.2.0` |
| Testnet deployment | `stellar contract deploy` | contract id above |
| On-chain lifecycle | `create_plan` → `approve` → `subscribe` → `charge` | `cycles_charged = 1`, `total_paid = 10000000` |
| SDK build | `pnpm --filter @stanza/sdk build` | pass |
| SDK tests | `pnpm --filter @stanza/sdk test` | **16 passed, 0 failed** |
| Indexer build | `pnpm --filter @stanza/indexer build` | pass |
| Web build | `pnpm --filter web build` | pass (5 routes) |
| Full monorepo build | `pnpm build` | **3/3 tasks successful** |
| Docs | `mkdocs build --strict` | pass, no warnings |
| Event read-back | Soroban RPC `getEvents` | 3 typed events decoded |
| Indexer runtime | `node indexer/dist/server.js` + live contract | `/health`, `/api/plans`, `/api/subscriptions`, `/api/events/0`, `/api/stats`, `/api/subscriptions/due` returned the live plan, subscription, both events with tx hashes, and `volume = 10000000` |

Contract tests (all passing): plan creation fields, invalid parameters, trial
delay, immediate due state, one-cycle charge with balance assertions, not-due
rejection, backlog draining, cycle cap completion, pause/resume billing reset,
cancel permanence, retired plan blocking, index vectors, not-found errors,
missing-allowance panic, and zero contract balance.

SDK tests (all passing): due at boundary, backlog counting, cycle cap, inactive
states, progress/countdown/remaining, unit round-trips, period labels,
countdowns, committed value, and typed event decoding for every event kind.

---

## 8. Repository changes

### 8.1 Structure

Added:

```
contracts/stanza/            Rust contract crate (Cargo.toml, rust-toolchain.toml, src/lib.rs, src/test.rs)
deployments/testnet.json     committed deployment record
packages/sdk/src/events.ts   typed event decoding shared by app and indexer
apps/web/src/lib/api.ts      indexer client + record mappers
apps/web/src/components/PlanCard.tsx
apps/web/src/components/SubscriptionCard.tsx
apps/web/src/components/StatusBadge.tsx
apps/web/src/app/plans/new/page.tsx
apps/web/src/app/plans/[id]/page.tsx
apps/web/src/app/subscriptions/[id]/page.tsx
docs/protocol.md
docs/guides/merchant.md
docs/guides/subscriber.md
scripts/deploy-testnet.mjs
scripts/rename-repo.sh
vercel.json
change.md                    this document
```

Removed (replaced by the new product):

```
apps/web/src/app/create/page.tsx
apps/web/src/app/stream/[id]/page.tsx
apps/web/src/components/StreamCard.tsx
apps/web/src/components/StreamVisualizer.tsx
apps/web/src/hooks/useStreamBalance.ts
docs/protocol-mechanics.md
docs/guides/sender.md
docs/guides/recipient.md
```

Rewritten: root `package.json`, `README.md`, `CONTRIBUTING.md`, `SECURITY.md`,
`LICENSE`, `mkdocs.yml`, `.github/workflows/ci.yml`, `.gitignore`,
`apps/web/*`, `packages/sdk/*`, `indexer/*`, `scripts/create-issues.sh`,
`scripts/setup-repo-settings.sh`, and every documentation page.

### 8.2 Packages

| Before | After |
| --- | --- |
| root `stellar-stream-app` | root `stanza` |
| `@stellar-stream/sdk` | `@stanza/sdk` |
| `indexer` (unscoped) | `@stanza/indexer` |
| `web` (unchanged name, new code) | `web` |

### 8.3 Code-level corrections made during the rebuild

- Upgraded `@stellar/stellar-sdk` from 13.x to **17.4.0** across the workspace.
  Version 13 cannot decode protocol-25 transaction meta (`Bad union switch: 4`),
  which would have broken every write from the app. This was found during the
  testnet deployment and fixed.
- Pinned `soroban-sdk` to **29.0.1** and documented that `soroban-sdk` 29
  requires Stellar CLI ≥ 25.2.0 to build wasm; CI and docs use
  `stellar contract build` rather than a bare `cargo build`.
- Contract errors are mapped to readable messages in the SDK
  (`CONTRACT_ERRORS`, `StanzaError`) instead of surfacing host errors.
- Event decoding lives once in the SDK and is consumed by both the indexer and
  the app, so the two cannot drift.
- The indexer's SQLite dependency was upgraded to `better-sqlite3` 13.0.3, with
  `node-gyp` declared and `onlyBuiltDependencies` set in `pnpm-workspace.yaml`,
  so `pnpm install` compiles the native binding instead of silently skipping it.
- Two runtime defects found while indexing the live contract were fixed:
  event bodies containing `i128`/`u64` values are serialized with a bigint-safe
  replacer, and the stats volume is summed with `bigint` rather than SQL
  `REAL`, so no amount ever passes through a float.

---

## 9. Documentation and contributor backlog

### 9.1 Documentation

The MkDocs site was rewritten end to end (11 pages):

| Page | Purpose |
| --- | --- |
| `docs/index.md` | product, live deployment, entry points |
| `docs/introduction.md` | problem, design, why the primitives are Stellar-specific |
| `docs/protocol.md` | plan/subscription objects, state machine, charge rule, worked example, invariants, failure modes, error table |
| `docs/contract-reference.md` | storage, errors, events, every function, CLI examples |
| `docs/guides/merchant.md` | publish, charge, retire, costs, tips |
| `docs/guides/subscriber.md` | approve, subscribe, pause/cancel, allowance management, verification |
| `docs/developers/local-setup.md` | toolchain (Rust, wasm target, Stellar CLI), build, run, troubleshooting |
| `docs/developers/environment.md` | every variable with the live contract id |
| `docs/developers/deployment.md` | contract, Vercel, indexer, wiring checklist, post-deploy verification |
| `docs/developers/sdk.md` | reads, writes, allowance helpers, events, math, types |
| `docs/developers/api.md` | every REST endpoint with response shapes |

`README.md` now leads with the live contract, the wasm hash, the demo plan, and
the architecture; it no longer references a contract in another repository.

### 9.2 Issue backlog (19 issues)

`scripts/create-issues.sh` creates the backlog with labels `Stellar Wave`,
`good first issue`, `complexity: low|mid|high`, and area labels.

**Contract (5):** allowance pre-check error, optional plan end date, per-plan
stats, property-based accounting tests, batch charge helper for keepers.

**SDK (3):** publish to npm with dual ESM/CJS, `waitForTransaction` helper, React
hooks package.

**Indexer (3):** idempotent ingestion with replay tests, Postgres adapter,
OpenAPI schema.

**Web (4):** allowance expiry/low-balance warnings, merchant batch charge queue,
CSV settlement export, responsive/accessibility pass.

**Docs (2):** Mermaid sequence diagrams, 3-minute walkthrough video and README
GIF.

**Testing (2):** end-to-end flow against a local Soroban network, scheduled
testnet smoke test.

Every issue has context, a task, and acceptance criteria, and the mix is
deliberate: enough low-complexity work for first-time contributors, and
high-complexity work (property tests, e2e network) for experienced ones.

---

## 10. Repository and organization renames

### 10.1 Names

| Kind | Before | After |
| --- | --- | --- |
| Product | StellarStream | **Stanza** |
| GitHub organization | `Streams-Hq` | **`stanza-labs`** |
| Main repository | `Streams-Hq/stellar-stream-app` | **`stanza-labs/stanza`** |
| Contract repository | `Deyanju23/stellar-stream-contract` | **folded into `contracts/stanza`**; old repo archived with a pointer |
| Docs site | `deyanju23.github.io/stellar-stream-app` | **`stanza-labs.github.io/stanza`** |
| npm scope | `@stellar-stream/*` | **`@stanza/*`** |
| Indexer package | `indexer` | `@stanza/indexer` |
| Env var (web) | `NEXT_PUBLIC_STREAM_CONTRACT_ID` | `NEXT_PUBLIC_STANZA_CONTRACT_ID` |
| Env var (indexer) | `STREAM_CONTRACT_ID` | `STANZA_CONTRACT_ID` |
| SQLite file | `stellar_stream.sqlite` | `stanza.sqlite` |
| Docs nav / branding | "StellarStream" | "Stanza" |

If the org name `stanza-labs` is taken, pick another and run the rename script
with overrides (below). Nothing in the code hardcodes the org except URLs in
docs and `mkdocs.yml`.

### 10.2 Executable rename tool

`scripts/rename-repo.sh` rewrites every remaining identifier and prints the
GitHub steps:

```bash
./scripts/rename-repo.sh            # dry run: lists files still containing old identifiers
./scripts/rename-repo.sh --apply    # rewrite identifiers

# different target names
NEW_ORG=your-user NEW_REPO=stanza ./scripts/rename-repo.sh --apply
```

The script covers: repo URLs, org names, docs site URL, `@stellar-stream`
scope, `stellar-stream` package names, `StellarStream` prose, the old personal
account reference, and the old contract repo reference. It excludes
`node_modules`, `target`, the lockfile, and itself. A dry run at the time of
writing reports **no source-file leftovers outside the script itself**.

### 10.3 GitHub steps (manual, cannot be done from this environment)

1. **Create the organization** `stanza-labs` (or choose a name and run the
   script with `NEW_ORG=...`).
2. **Rename the repository:**
   ```bash
   gh repo rename stanza --repo Streams-Hq/stellar-stream-app
   ```
3. **Transfer it to the org** (if it is not already there):
   ```bash
   gh repo transfer stanza-labs/stanza stanza-labs
   ```
   GitHub keeps redirects from the old org/repo path, but do not rely on them
   for the Wave submission.
4. **Update the local remote:**
   ```bash
   git remote set-url origin https://github.com/stanza-labs/stanza.git
   ```
5. **Reinstall** so the workspace links the renamed SDK:
   ```bash
   pnpm install
   ```
6. **Re-enable Pages** for the new org: Settings → Pages → Source: GitHub
   Actions. The existing `docs.yml` workflow then publishes
   `https://stanza-labs.github.io/stanza/`.
7. **Update the Wave submission** with the new project URL, repository, and
   description (see §11.3).
8. **Archive the old contract repo** with a README pointing at
   `contracts/stanza`, so old links do not imply the contract lives elsewhere.
9. **Update badges and links** anywhere outside the repo (Drips profile, X/GitHub
   bio, grant docs). `scripts/rename-repo.sh --apply` already handled the repo
   contents.
10. **Rename local CLI identities** (optional, local only): the testnet keys used
    for deployment are `stanza-deployer` and `stanza-subscriber`.

### 10.4 What intentionally still says "stellar-stream"

- `scripts/rename-repo.sh` — it must contain the old strings to find them.
- Git history and commit messages — left intact for auditability.
- `package-lock.json` (untracked, git-ignored) — regenerated by npm, not used by
  the repo.

---

## 11. Deployment status and what remains

### 11.1 Done

| Component | Status |
| --- | --- |
| Soroban contract | **Deployed to Stellar testnet**, `CDGIYCP5…4FDP`, wasm hash recorded |
| On-chain lifecycle | **Executed**: plan `#0`, subscription `#0`, one charged cycle |
| Contract tests | **15 passing** |
| SDK + indexer + web builds | **passing** |
| Documentation build | **passing (`--strict`)** |
| Deployment record | committed at `deployments/testnet.json` |
| Vercel configuration | `vercel.json` committed (build command + output dir) |

### 11.2 Not deployed from this environment

No credentials for Vercel, GitHub Pages, or any indexer host were available
here. These are the only remaining deployment actions, and they are enumerated
so they can be completed in minutes.

**Web app on Vercel (needs your Vercel account):**

1. Import `stanza-labs/stanza` at https://vercel.com/new.
2. Root Directory: **repository root** (not `apps/web`); `vercel.json` builds
   `@stanza/sdk` then `web`.
3. Add these environment variables for Production and Preview:

   ```
   NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE = Test SDF Network ; September 2015
   NEXT_PUBLIC_SOROBAN_RPC_URL            = https://soroban-testnet.stellar.org
   NEXT_PUBLIC_STANZA_CONTRACT_ID         = CDGIYCP56ZAC5ZVTJVHJQ5H7OLZSCDU3DFA77VWXT74N47MW6ZBV4FDP
   NEXT_PUBLIC_INDEXER_URL                = <deployed indexer URL>
   NEXT_PUBLIC_DEFAULT_TOKEN_ADDRESS      = CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC
   NEXT_PUBLIC_TOKEN_DECIMALS             = 7
   NEXT_PUBLIC_EXPLORER_BASE              = https://stellar.expert/explorer/testnet
   ```

4. Deploy, then **redeploy after any `NEXT_PUBLIC_*` change** (values are
   inlined at build time).
5. Without a deployed indexer the app still works: reads fall back to Soroban
   RPC simulations, and only the curated Explore list is limited to the 24 most
   recent plans. Set `NEXT_PUBLIC_INDEXER_URL` to an empty-ish placeholder or the
   local URL until the indexer is hosted.

**Indexer (optional, needed for cached lists, event history, and `/due`):**

Any process host with a persistent disk (Render, Fly.io, Railway):

```
Root:      indexer
Build:     pnpm install --frozen-lockfile && pnpm --filter @stanza/indexer build
Start:     node dist/server.js
Health:    GET /health
Env:       STANZA_CONTRACT_ID, SOROBAN_RPC_URL, STELLAR_NETWORK_PASSPHRASE, DB_PATH
Disk:      mount for DB_PATH
```

Then set the web app's `NEXT_PUBLIC_INDEXER_URL` to its public HTTPS URL and
redeploy.

**GitHub Pages:** push, then run the `Docs` workflow or let it trigger on
`docs/**`. Confirm Settings → Pages → Source is "GitHub Actions".

### 11.3 Drips Wave submission update

Update the submission with:

- **Project name:** Stanza
- **Repository:** `https://github.com/stanza-labs/stanza`
- **Description:** Non-custodial recurring subscriptions on Stellar Soroban,
  settled with SEP-41 allowances and a permissionless keeper.
- **Live artifact:** contract id above, plus the deploy transaction.
- **Docs:** `https://stanza-labs.github.io/stanza/`
- **Issue filters:** `label:"Stellar Wave"`, `label:"good first issue"`
- **Attach:** this `change.md` as the change/re-submission summary.

---

## 12. Why this meets the Wave bar

| Criterion | Evidence |
| --- | --- |
| Built on Stellar / Soroban | SEP-41 allowances, SAC, ledger clock, persistent storage TTL, contract events, RPC, Freighter; contract in-repo |
| Real, verifiable deployment | Contract id + wasm hash + deploy tx + charged cycle on testnet |
| Open source | MIT, all code and docs in one repository |
| Meaningful scope | Contract, SDK, indexer, web app, docs, CI, deployment tooling |
| Contributor-ready | 19 labelled issues with context, task, and acceptance criteria; low/mid/high mix |
| Maintainable | Single source of truth for errors and events; typed SDK; contract tests assert invariants |
| Differentiated | Named Stellar gap (recurring billing), opposite custody model to streaming, keeper-friendly |
| Documentation | 11-page docs site, strict build, README with live ids, security policy, contributor guide |
| Honest limitations | Unaudited, testnet-only, no upgrade path, remaining deployment steps listed |

---

## 13. Risks and limitations

Stated plainly, because an appeal that hides these is not credible:

1. **Unaudited.** No external review. Testnet only. Documented in `SECURITY.md`
   and in the docs banner.
2. **No upgrade path.** The contract is immutable. A bug requires a new
   deployment; plans are per-contract, so migration is a data-migration problem.
3. **No allowance pre-check at `subscribe`.** A charge fails at the token if the
   mandate is missing. This is deliberate, documented, and queued as an issue
   with a dedicated error.
4. **Unbounded index vectors.** `plans_of`, `subs_of`, and `subs_of_plan` grow
   without bound. Fine at testnet scale, a scalability limit at production
   scale; tracked in the backlog.
5. **Indexer is not hosted yet.** The app has an RPC fallback, but the event
   history and the keeper queue need a host.
6. **SDK is not on npm yet.** It is consumed as a workspace package; publishing
   is an issue, not a claim.
7. **Web app is not on Vercel yet.** Configuration is committed; the deploy
   needs the account.
8. **Untested on a local multi-node network.** Contract tests run against the
   in-process Soroban host with a real SAC; an end-to-end local-network test is
   in the backlog.
9. **One asset path exercised on testnet.** XLM SAC was used for the live demo;
   arbitrary SEP-41 tokens are supported by the interface but not yet exercised
   end-to-end on testnet.

---

## 14. Roadmap

**Next 30 days**

- Host the indexer and deploy the web app on Vercel; publish the docs site.
- Publish `@stanza/sdk` to npm.
- Land the allowance pre-check error and the plan end date (contract v2 on a new
  deployment id).
- Add the local-network end-to-end test to CI.

**60 days**

- Property-based accounting tests.
- Batch charging and a public keeper guide.
- Merchant CSV export and allowance-expiry warnings.
- A second asset (a Stellar-issued token) exercised end to end.

**90 days**

- External review of the contract before any mainnet consideration.
- Migration tooling for plan/subscription state between contract versions.
- Indexer Postgres adapter and OpenAPI schema.
- Public demo video and a written integration guide for other Stellar apps.

---

## 15. Reviewer quick verification

```bash
git clone https://github.com/stanza-labs/stanza && cd stanza
pnpm install

# 1. Contract tests (15)
pnpm contract:test

# 2. SDK tests (16)
pnpm --filter @stanza/sdk test

# 3. Build everything
pnpm build

# 4. Read the live contract state
stellar contract invoke \
  --id CDGIYCP56ZAC5ZVTJVHJQ5H7OLZSCDU3DFA77VWXT74N47MW6ZBV4FDP \
  --network testnet -- get_subscription --sub_id 0
```

Expected: subscription `#0`, `cycles_charged = 1`, `total_paid = 10000000`,
`status = 0`.

---

## Appendix A — File map of the new product

| Path | Responsibility |
| --- | --- |
| `contracts/stanza/src/lib.rs` | Plan/subscription storage, charge accounting, pause/resume/cancel, events, TTL |
| `contracts/stanza/src/test.rs` | 15 lifecycle and invariant tests against a real SAC |
| `packages/sdk/src/client.ts` | Reads, prepared writes, allowance helper, event fetch |
| `packages/sdk/src/math.ts` | `cyclesDue`, `isDue`, `billingProgress`, unit formatting |
| `packages/sdk/src/events.ts` | Typed decoding for all 7 events |
| `packages/sdk/src/xdr.ts` | ScVal conversion and record parsers |
| `indexer/src/indexer.ts` | RPC event poller |
| `indexer/src/db.ts` | SQLite read model + due queue query |
| `indexer/src/server.ts` | REST API |
| `apps/web/src/app/page.tsx` | Dashboard: my plans, my subscriptions, explore, keeper queue |
| `apps/web/src/app/plans/new/page.tsx` | Publish a plan |
| `apps/web/src/app/plans/[id]/page.tsx` | Plan detail, subscribe, retire, charge |
| `apps/web/src/app/subscriptions/[id]/page.tsx` | Billing progress, controls, allowance, history |
| `scripts/deploy-testnet.mjs` | Testnet wasm upload + contract creation |
| `scripts/create-issues.sh` | 19-issue Wave backlog |
| `scripts/rename-repo.sh` | Old-identifier rewriter with dry run |
| `scripts/setup-repo-settings.sh` | Labels, branch protection, merge policy, Pages |
| `deployments/testnet.json` | Live deployment record |

## Appendix B — Contract ABI

```rust
create_plan(merchant, token, amount: i128, period: u64, trial_period: u64, max_cycles: u32) -> u64
set_plan_active(plan_id: u64, active: bool)
subscribe(subscriber, plan_id: u64) -> u64
charge(sub_id: u64)
pause(sub_id: u64)
resume(sub_id: u64)
cancel(sub_id: u64)
get_plan(plan_id: u64) -> Plan
get_subscription(sub_id: u64) -> Subscription
is_due(sub_id: u64) -> bool
cycles_due(sub_id: u64) -> u32
plan_count() -> u64
subscription_count() -> u64
plans_of(merchant) -> Vec<u64>
subs_of(subscriber) -> Vec<u64>
subs_of_plan(plan_id: u64) -> Vec<u64>
```

Errors: `PlanNotFound(1)`, `SubNotFound(2)`, `InvalidAmount(3)`,
`InvalidPeriod(4)`, `PlanInactive(5)`, `SubNotActive(6)`, `NotDue(7)`,
`CycleLimitReached(8)`, `MathOverflow(9)`, `NotSubscriber(10)`.
