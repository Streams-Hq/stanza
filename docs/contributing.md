# Contributing

Thanks for your interest. Stanza takes part in the Stellar Drips Wave program,
and the issue backlog is labelled so new contributors can find work at a
comfortable level.

The full guide lives in the repository:

**→ [CONTRIBUTING.md](https://github.com/stanza-labs/stanza/blob/main/CONTRIBUTING.md)**

## The short version

1. **Claim an issue first.** Comment on it to avoid duplicate work.
2. **Branch from `main`:** `feat/…`, `fix/…`, `docs/…`, `test/…`.
3. **Commit in Conventional Commits** — `type(scope): description`, with scope
   `contract`, `sdk`, `indexer`, `web`, or `docs`.
4. **Run the checks for what you touched.**
   - contract: `pnpm contract:test` and `cargo fmt --manifest-path contracts/stanza/Cargo.toml --check`
   - SDK: `pnpm --filter @stanza/sdk test`
   - app/indexer: `pnpm build`
   - docs: `pnpm docs:build`
5. **Open a PR.** Green CI and one maintainer review are required; do not merge
   your own.

## Good entry points

Issues labelled `good first issue` and `Stellar Wave` are scoped for new
contributors. The `complexity: low / mid / high` labels indicate roughly how
much work each one is.

## House rules

- Node 20+, pnpm 10, Rust stable, Stellar CLI 25.2.0+.
- **Never use floating point for token amounts.** `bigint` in TypeScript,
  `i128` in Rust.
- All contract calls go through `packages/sdk`; do not hand-roll XDR in the app.
- Contract changes need tests that assert invariants, not only the happy path.
- Behavior changes update the matching page under `docs/` in the same PR.
- The contract is immutable once deployed. A breaking change needs a new
  deployment id, a `deployments/` record, and a migration note in the PR.

## Security

Do not open a public issue for a security problem. Follow the
[security policy](https://github.com/stanza-labs/stanza/blob/main/SECURITY.md)
and report privately.
