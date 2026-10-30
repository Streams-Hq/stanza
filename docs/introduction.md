# Introduction

## The problem

Recurring billing is the one payment pattern Stellar does not have a native
primitive for. Merchants either:

1. **Ask subscribers to send manually every month.** Churn is high, and every
   cycle needs a human on both sides.
2. **Use a custodial processor.** The subscriber signs away a card or an API key
   and trusts an intermediary with the mandate, the schedule, and the money.
3. **Prepay a balance.** The subscriber hands over funds up front, and the
   merchant draws it down. That is a loan to the merchant, not a subscription.

Streaming protocols solve a neighbouring problem — a deposit that unlocks
linearly — but not this one. A stream locks the whole amount up front and pays
out continuously. Subscriptions are the opposite shape: a small, discrete,
repeating pull, revocable at any moment, with the money staying with the
subscriber between charges.

## What Stanza does

A merchant publishes a **plan**: token, price per cycle, cycle length, optional
trial, and an optional cap on the number of paid cycles. A subscriber grants the
contract a **SEP-41 allowance** for a few cycles and calls `subscribe`. The
contract stores the schedule.

From then on the rule is one sentence:

> **After each cycle is due, anyone may pull exactly one cycle's price from the
> subscriber to the merchant, and never more.**

The subscriber's funds sit in their own wallet until the instant of a charge.
Cancelling is unilateral and immediate, and a plan can never exceed its cap or
charge early, because both checks are in the contract.

## Why this is Stellar-native

Every functional piece is a Stellar primitive, not a wrapper around an external
service:

- **SEP-41 allowances.** `approve` creates the spending mandate, and
  `transfer_from` executes it. The mandate is bounded by amount and by ledger,
  is visible on-chain, and can be revoked by the subscriber at any time.
- **Stellar Asset Contract.** XLM and any Stellar-issued asset can be billed
  through the same code path, because the contract talks to the token through
  the SEP-41 interface. No bespoke token adapter, no bridge.
- **Ledger timestamp.** The cycle clock is `env.ledger().timestamp()`, not a
  server cron. Two different keepers computing "is this due?" get the same
  answer from the same ledger.
- **Soroban persistent storage + TTL.** Plans and subscriptions are contract
  storage entries whose rent is pre-paid well past their billing horizon, so a
  live subscription cannot silently fall out of state.
- **Contract events.** `plan_new`, `sub_new`, `charged`, `paused`, `resumed`,
  `canceled`, and `plan_act` are emitted by the contract. The indexer and any
  third party rebuild the same history from the same events.
- **Soroban RPC + Freighter.** Reads are simulations; writes are prepared
  transactions signed in the wallet. No backend holds a key.
- **Stellar fees.** A charge costs one network fee, a fraction of a cent. That
  is what makes per-cycle on-chain settlement economic at all.

## How a billing cycle works

1. **Publish.** `create_plan(merchant, token, amount, period, trial_period, max_cycles)`
   requires the merchant's signature and stores the plan. Nothing is escrowed.
2. **Authorise.** The subscriber signs a SEP-41 `approve` naming the Stanza
   contract as spender, for N cycles, with an expiry ledger.
3. **Subscribe.** `subscribe(subscriber, plan_id)` requires the subscriber's
   signature and records `next_charge_at = now + trial_period`.
4. **Charge.** Once the timestamp reaches `next_charge_at`, `charge(sub_id)` may
   be called by anyone. It pulls `amount` once, advances `next_charge_at` by
   `period`, and marks the subscription `completed` if the plan's cap is reached.
5. **Control.** The subscriber can `pause`, `resume`, `cancel`, and can revoke or
   top up the allowance in their wallet at any time. The merchant can retire a
   plan, which stops future charges without touching existing balances.

## What is in this repository

This is a single, self-contained monorepo. The contract is **not** in a separate
repository.

- **`contracts/stanza`** — the Soroban contract in Rust, with 15 unit tests that
  exercise the full lifecycle on a real SAC token.
- **`packages/sdk`** — the typed TypeScript client: transaction builders,
  XDR encoding, plan/subscription parsers, allowance helpers, event decoding,
  and the billing math mirrored exactly from Rust.
- **`indexer`** — a service that follows contract events over Soroban RPC,
  persists a read model in SQLite, and exposes a REST API including a keeper
  queue of everything due now.
- **`apps/web`** — the Next.js app: merchant plans, plan discovery,
  subscribe-with-allowance, subscriber controls, and a permissionless charge
  button.

!!! note "The chain is authoritative"
    The indexer is a cache. Every page falls back to direct Soroban RPC
    simulations when the indexer is unavailable, and every action is submitted
    to the contract, not to the API.
