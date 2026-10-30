# Local setup

This page gets the contract, SDK, indexer, and app running against Stellar
testnet.

## Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| Node.js | 20+ | app, SDK, indexer |
| pnpm | 10.30.1 | pinned by `packageManager` |
| Rust | stable | contract tests |
| `wasm32v1-none` target | — | `rustup target add wasm32v1-none` |
| Stellar CLI | 25.2.0+ | required by `soroban-sdk` 29 to build wasm |
| Freighter | latest | browser wallet |

Install the Stellar CLI with a prebuilt binary (fastest) or Cargo:

```bash
# binary release
curl -sL https://github.com/stellar/stellar-cli/releases/download/v25.2.0/stellar-cli-25.2.0-x86_64-unknown-linux-gnu.tar.gz \
  | tar -xz -C /tmp && sudo install /tmp/stellar /usr/local/bin/stellar

# or
cargo install --locked stellar-cli --version 25.2.0
```

## Clone and install

```bash
git clone https://github.com/stanza-labs/stanza.git
cd stanza
pnpm install
```

## Contract

```bash
pnpm contract:test     # 15 unit tests on a real SAC token
pnpm contract:build    # stellar contract build → wasm
```

The wasm lands in
`contracts/stanza/target/wasm32v1-none/release/stanza_subscriptions.wasm`.

## Configure environment

```bash
cp apps/web/.env.example apps/web/.env.local
cp indexer/.env.example indexer/.env
```

Both files already point at the current testnet deployment. To deploy your own
contract, see [Deployment](deployment.md) and replace the id in both files.

## Run

```bash
pnpm dev
```

This starts:

- the SDK in watch mode,
- the indexer and REST API on `http://localhost:3001`,
- the web app on `http://localhost:3000`.

Or individually:

```bash
pnpm --filter @stanza/sdk build
pnpm --filter @stanza/indexer dev
pnpm --filter web dev
```

Open `http://localhost:3000`, connect Freighter on testnet, and publish a plan.

## Checks

```bash
pnpm contract:test                       # Rust unit tests
pnpm --filter @stanza/sdk test           # 16 TypeScript tests
pnpm build                               # SDK + indexer + web
pnpm docs:build                          # mkdocs --strict
```

## Common problems

- **`soroban-sdk requires stellar-cli v25.2.0+`** — plain `cargo build` for wasm
  is blocked by the SDK. Use `stellar contract build` (wired as `pnpm contract:build`).
- **`better-sqlite3` bindings missing** — the repo allows the native build via
  `onlyBuiltDependencies` in `pnpm-workspace.yaml`. If a binding is still
  missing, run `pnpm rebuild better-sqlite3`; it needs `node-gyp`, Python 3,
  `make`, and a C++ compiler.
- **Web app shows empty lists** — the indexer starts 100 ledgers behind the tip,
  so recent activity appears on the next poll. Pages still fall back to direct
  RPC reads.
- **`NEXT_PUBLIC_*` changes have no effect** — they are inlined at build time.
  Restart `next dev`, or rebuild and redeploy the app.
- **Freighter rejects the network** — set the extension to testnet; the app signs
  for `Test SDF Network ; September 2015`.
