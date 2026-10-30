<div align="center">

# Stanza

**Recurring subscriptions on Stellar. Non-custodial by construction.**

A merchant publishes a plan once. A subscriber approves a capped SEP-41
allowance. Every cycle, anyone can settle the charge — and the contract pulls
exactly one cycle's price, straight from the subscriber's wallet to the
merchant's.

[![CI](https://github.com/Streams-Hq/stanza/actions/workflows/ci.yml/badge.svg)](https://github.com/Streams-Hq/stanza/actions/workflows/ci.yml)
[![Docs](https://github.com/Streams-Hq/stanza/actions/workflows/docs.yml/badge.svg)](https://streams-hq.github.io/stanza/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Stellar](https://img.shields.io/badge/Stellar-testnet-7B3FE4.svg)](https://stellar.org)
[![Soroban](https://img.shields.io/badge/Soroban-soroban--sdk%2029-00E5FF.svg)](https://soroban.stellar.org)
[![Next.js](https://img.shields.io/badge/Next.js-14-black.svg)](https://nextjs.org/)

**[Documentation](https://streams-hq.github.io/stanza/)** ·
**[Contract on Stellar.Expert](https://stellar.expert/explorer/testnet/contract/CDGIYCP56ZAC5ZVTJVHJQ5H7OLZSCDU3DFA77VWXT74N47MW6ZBV4FDP)** ·
**[Drips Wave backlog](https://github.com/Streams-Hq/stanza/issues)**

</div>

## Live on testnet

| | |
| --- | --- |
| Contract | [`CDGIYCP56ZAC5ZVTJVHJQ5H7OLZSCDU3DFA77VWXT74N47MW6ZBV4FDP`](https://stellar.expert/explorer/testnet/contract/CDGIYCP56ZAC5ZVTJVHJQ5H7OLZSCDU3DFA77VWXT74N47MW6ZBV4FDP) |
| Wasm hash | `4638029cba67555f31ef4404e3c08b3fa507f987cf291308a7dfc445245ebf38` |
| Deploy tx | [`ecb8c29a…`](https://stellar.expert/explorer/testnet/tx/ecb8c29af6a1c8f285fa0a8c46985dca02d320e09c07bdfb3fa77e57d544a276) |
| Demo plan | plan `#0` — 1 XLM / 30 days, 12-cycle cap |
| Demo subscription | subscription `#0` — 1 cycle charged (`total_paid = 10,000,000` stroops) |
| Network | Stellar testnet (`Test SDF Network ; September 2015`) |

The full record lives in [`deployments/testnet.json`](./deployments/testnet.json).

## Why this exists

Stellar has payments, assets, and streaming-style escrows, but no native way to
bill a subscription. The alternatives are manual transfers every month, a
custodial processor that holds the mandate, or prepaying a balance to the
merchant.

Stanza is the missing primitive:

- **The mandate is an allowance.** SEP-41 `approve` grants the contract a capped,
  expiring, revocable right to pull. It is enforced by the token contract, not by
  a backend.
- **The money never leaves the wallet.** Between charges the subscriber's funds
  stay in their own account. The contract holds no balance, has no admin key, and
  cannot move funds anywhere except subscriber → merchant for the plan price.
- **The clock is the ledger.** A charge is valid only when
  `ledger.timestamp() >= next_charge_at`. No cron, no keeper trust.
- **Charging is permissionless.** Merchants, subscribers, and public keepers all
  settle the same cycle with the same result.
- **Cancelling is unilateral.** One signature, effective immediately, with
  nothing to refund.

## How a cycle settles

```
merchant:  create_plan(token, amount, period, trial, max_cycles)
subscriber: approve(stanza, amount * N cycles)      ← SEP-41 allowance
subscriber: subscribe(plan_id)
anyone:     charge(sub_id)  → transfer_from(subscriber → merchant, amount)
subscriber: pause | resume | cancel | approve more
merchant:   set_plan_active(false)                  ← retire the plan
```

Each successful `charge` moves exactly one `amount`, advances `next_charge_at`
by exactly one `period`, increments `cycles_charged`, and marks the subscription
`completed` when the plan's cycle cap is reached. See
[How billing works](https://streams-hq.github.io/stanza/protocol/).

## Architecture

This repository is self-contained: the Soroban contract is here, not in a
separate repo.

```
stanza/
├── contracts/
│   └── stanza/               # Soroban contract (Rust, soroban-sdk 29)
│       ├── src/lib.rs        # plans, subscriptions, charges, events
│       └── src/test.rs       # 15 unit tests against a real SAC token
├── packages/
│   └── sdk/                  # @stanza/sdk — typed client + billing math
│       └── src/
│           ├── client.ts     # reads, writes, allowance, events
│           ├── xdr.ts        # ScVal conversion + record parsers
│           ├── math.ts       # cycle math mirrored from Rust
│           ├── events.ts     # typed event decoding
│           └── types.ts      # Plan, Subscription, event shapes
├── indexer/                  # @stanza/indexer — events → SQLite → REST
│   └── src/
│       ├── indexer.ts        # Soroban RPC event poller
│       ├── db.ts             # plans, subscriptions, charges, events
│       └── server.ts         # API incl. /api/subscriptions/due
├── apps/
│   └── web/                  # Next.js 14 app (Tailwind, Freighter)
│       └── src/
│           ├── app/          # dashboard, create plan, plan + subscription pages
│           ├── components/   # PlanCard, SubscriptionCard, StatusBadge, wallet
│           ├── hooks/        # useFreighter
│           └── lib/          # RPC config, SDK client, indexer API
├── docs/                     # MkDocs Material documentation site
├── deployments/              # committed testnet deployment records
├── scripts/                  # testnet deploy, issue backlog, repo rename/settings
└── mkdocs.yml
```

## Quick start

Prerequisites: Node 20+, pnpm 10, Rust stable, the `wasm32v1-none` target, and
Stellar CLI 25.2.0+ (required by `soroban-sdk` 29 to build wasm).

```bash
git clone https://github.com/Streams-Hq/stanza.git
cd stanza
pnpm install

pnpm contract:test     # 15 Rust unit tests
pnpm contract:build    # stellar contract build → wasm

cp apps/web/.env.example apps/web/.env.local
cp indexer/.env.example indexer/.env

pnpm dev               # web :3000, indexer :3001, SDK watcher
```

Open `http://localhost:3000`, connect Freighter on testnet, publish a plan, and
subscribe from a second account. To use your own contract instead of the
committed testnet one, run `pnpm deploy:testnet` and update both env files.

### Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | web app + indexer + SDK watcher |
| `pnpm build` | build SDK, indexer, and web |
| `pnpm test` | workspace tests (SDK math + event decoding) |
| `pnpm contract:test` | contract unit tests |
| `pnpm contract:build` | build the deployable wasm |
| `pnpm deploy:testnet` | deploy the contract to Stellar testnet |
| `pnpm docs:serve` / `docs:build` | docs preview / strict build |

## Deployment

- **Contract:** `pnpm contract:build && pnpm deploy:testnet`, or
  `stellar contract deploy`. Details in
  [Deployment](https://streams-hq.github.io/stanza/developers/deployment/).
- **Web app:** Vercel, with **Root Directory `apps/web`** and "Include files
  outside the Root Directory" enabled; `apps/web/vercel.json` installs from the
  workspace root and builds the SDK before the app. Set the `NEXT_PUBLIC_*`
  variables **before** building. The app also runs anywhere Node 20 runs.
- **Indexer:** any host that keeps a process alive with a persistent disk
  (Render, Fly.io, Railway). It is a cache; the app falls back to Soroban RPC
  simulations when it is unavailable.

## Environment

| Variable | Purpose | Default |
| --- | --- | --- |
| `NEXT_PUBLIC_STANZA_CONTRACT_ID` | Deployed contract | testnet deployment above |
| `NEXT_PUBLIC_SOROBAN_RPC_URL` | Soroban RPC | `https://soroban-testnet.stellar.org` |
| `NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE` | Network | `Test SDF Network ; September 2015` |
| `NEXT_PUBLIC_INDEXER_URL` | Indexer REST base | `http://localhost:3001` |
| `NEXT_PUBLIC_DEFAULT_TOKEN_ADDRESS` | Default asset (XLM SAC) | `CDLZFC3S…GCYSC` |
| `STANZA_CONTRACT_ID` | Contract the indexer follows | testnet deployment above |

Full tables: [Environment variables](https://streams-hq.github.io/stanza/developers/environment/).

## Contributing

Stanza takes part in the Stellar Drips Wave program. The backlog is generated by
[`scripts/create-issues.sh`](./scripts/create-issues.sh) and labelled
`Stellar Wave`, `good first issue`, and `complexity: low|mid|high`.

Read [`CONTRIBUTING.md`](./CONTRIBUTING.md). One logical change per PR,
Conventional Commits, green CI, one maintainer review.

```bash
# contract
pnpm contract:test
cargo fmt --manifest-path contracts/stanza/Cargo.toml --check

# TypeScript
pnpm --filter @stanza/sdk test
pnpm build
```

## Security

Unaudited, testnet-only software. The contract holds no funds and has no admin
key, but it has not been externally reviewed. Read
[`SECURITY.md`](./SECURITY.md) before using it for anything of value.

## License

MIT — see [`LICENSE`](./LICENSE).
