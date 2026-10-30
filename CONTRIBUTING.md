# Contributing to Stanza

Thanks for taking the time to contribute. Stanza is an open-source Soroban
protocol in the Stellar Drips Wave program, and the issue backlog is labelled so
you can pick work at a comfortable level.

By participating you agree to be respectful and constructive. Harassment or
personal attacks are not tolerated in issues, PRs, or discussions.

## Ways to contribute

- **Code:** contract, SDK, indexer, web app.
- **Tests:** invariants for the contract, property tests for the billing math,
  end-to-end flows against a local network.
- **Docs:** the MkDocs site, guides, and code comments.
- **Review:** reading other people's PRs is a contribution.
- **Bug reports:** a minimal reproduction is worth more than a long description.

## Pick an issue

1. Browse [issues](https://github.com/Streams-Hq/stanza/issues) and filter by
   `good first issue` or `Stellar Wave`.
2. Comment on the issue to claim it. Wait for a maintainer to assign it before
   starting large work.
3. If you want to work on something that is not filed, open an issue first so we
   can agree on scope.

## Set up

```bash
git clone https://github.com/Streams-Hq/stanza.git
cd stanza
pnpm install

# contract toolchain
rustup target add wasm32v1-none
# Stellar CLI 25.2.0+ is required to build wasm
```

Full instructions: [docs/developers/local-setup.md](docs/developers/local-setup.md).

## Branch and commits

Branch from `main`:

```text
feat/contract-…      fix/sdk-…
docs/…               test/…
```

Use Conventional Commits with a scope of `contract`, `sdk`, `indexer`, `web`, or
`docs`:

```text
feat(contract): support plan end dates
fix(sdk): map NotDue to a readable error
docs(guides): explain allowance top-ups
```

Keep commits focused. A PR should contain one logical change; split refactors
from behavior changes.

## What to run before opening a PR

Run the checks for the area you touched. All of them run in CI anyway.

| Area | Command |
| --- | --- |
| Contract | `pnpm contract:test` |
| Contract formatting | `cargo fmt --manifest-path contracts/stanza/Cargo.toml --check` |
| SDK | `pnpm --filter @stanza/sdk test` |
| Indexer | `pnpm --filter @stanza/indexer build` |
| Web | `pnpm --filter web build` |
| Docs | `pnpm docs:build` |
| Everything | `pnpm build && pnpm test` |

## Contract rules

- The contract is **immutable once deployed**. A breaking change means a new
  contract id, a new `deployments/testnet.json` record, and a note in the PR
  explaining the migration path for existing plans.
- Every state-changing function must keep checks-effects-interactions: write
  state before calling the token contract.
- Use checked arithmetic (`checked_add`, etc.) and map overflow to
  `Error::MathOverflow`.
- Never add custody. The contract must not hold a token balance; a test asserts
  `balance(contract) == 0` after every flow.
- New behavior needs tests that assert invariants, including failure paths
  (`NotDue`, `SubNotActive`, `CycleLimitReached`, missing allowance).
- Bump the error table in `docs/contract-reference.md` if you add a variant.

## TypeScript rules

- `bigint` for every amount, everywhere. No floats, no `Number()` on token
  amounts.
- All contract calls go through `packages/sdk`. Do not hand-roll XDR in the app
  or the indexer.
- Reads must have an on-chain fallback; the indexer is a cache.
- Errors surfaced to users should be actionable ("approve more allowance",
  "retired plan"), not raw host errors.

## Docs

- Behavior changes update the matching page under `docs/` in the same PR.
- New environment variables go in `docs/developers/environment.md`, the
  `.env.example` files, and the README table.
- Keep examples runnable; prefer the committed testnet contract id.

## Review and merge

- A PR needs green CI and one maintainer approval.
- Do not merge your own PR.
- Reviewers may ask for tests or docs before merging; that is normal.
- Squash-merge is the default; the PR title becomes the commit subject, so keep
  it Conventional.

## Security

Never open a public issue for a vulnerability. Follow
[SECURITY.md](SECURITY.md) and report privately.
