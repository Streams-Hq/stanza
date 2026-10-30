# Stanza

**Non-custodial recurring subscriptions on Stellar.**

Stanza lets a merchant publish a billing plan once, and lets a subscriber join it
with a capped [SEP-41](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0041.md)
allowance. Every cycle, anyone can settle the charge: the Soroban contract pulls
exactly one cycle's price from the subscriber's wallet into the merchant's
wallet with `transfer_from`.

The contract never holds customer funds. There is no admin key, no withdrawal
queue, and no custodian.

## Live on testnet

| | |
| --- | --- |
| Network | Stellar testnet |
| Contract | [`CDGIYCP56ZAC5ZVTJVHJQ5H7OLZSCDU3DFA77VWXT74N47MW6ZBV4FDP`](https://stellar.expert/explorer/testnet/contract/CDGIYCP56ZAC5ZVTJVHJQ5H7OLZSCDU3DFA77VWXT74N47MW6ZBV4FDP) |
| Wasm hash | `4638029cba67555f31ef4404e3c08b3fa507f987cf291308a7dfc445245ebf38` |
| Demo plan | plan `#0` — 1 XLM per 30 days, 12-cycle cap |
| Demo subscription | subscription `#0` — one cycle charged on-chain |

## Where to start

<div class="grid cards" markdown>

- **New to the idea?** Read [Introduction](introduction.md) for the problem,
  the design, and why the primitives are Stellar-specific.
- **Want the mechanics?** Read [How billing works](protocol.md) for the state
  machine, the cycle arithmetic, and the invariants the tests assert.
- **Using the app?** Jump to the guides for
  [merchants](guides/merchant.md) and [subscribers](guides/subscriber.md).
- **Building on it?** Start with [Local setup](developers/local-setup.md), then
  the [SDK reference](developers/sdk.md) and the
  [Indexer API](developers/api.md).

</div>

## At a glance

| | |
| --- | --- |
| Contract | Rust / `soroban-sdk` 29, one contract, immutable once deployed |
| Payment rail | SEP-41 `approve` + `transfer_from` (works with XLM SAC and any Stellar asset) |
| Frontend | Next.js 14 App Router, Tailwind CSS |
| SDK | [`@stanza/sdk`](developers/sdk.md) (TypeScript, bigint-only) |
| Indexer | Node.js + Express + SQLite read model |
| Wallet | [Freighter](https://www.freighter.app) |
| Audit status | **Unaudited, testnet only** — see the [security policy](https://github.com/stanza-labs/stanza/blob/main/SECURITY.md) |

!!! warning "Testnet software"
    Stanza is unaudited and runs on Stellar testnet. Do not use it to bill real
    subscribers or move funds of significant value.
