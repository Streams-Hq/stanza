# For merchants

This guide is for the person getting paid. You need a Stellar account and
[Freighter](https://www.freighter.app) on **testnet**.

## Before you start

- Install Freighter and switch it to **Testnet**.
- Fund the account from [Friendbot](https://laboratory.stellar.org/#account-creator?network=testnet).
- Nothing else. Stanza has no signup, no API key, and no protocol fee.

## Publish a plan

1. Open the app and click **Connect wallet**.
2. Go to **New plan**.
3. Choose the asset: **XLM (SAC)** or a custom SEP-41 token contract.
4. Enter the **price per cycle** — this is what a subscriber is charged each
   cycle, not a deposit.
5. Pick a **cycle length**: 7, 30, 90 days, or a year.
6. Optionally add a **trial** (7, 14, or 30 days) and a **cycle cap**
   (open-ended, 12, or 24).
7. Click **Publish plan** and sign in Freighter.

The plan is now a storage entry in the contract. You can share
`/plans/{id}` with subscribers. Plan parameters are immutable; to change a price,
retire the plan and publish a new one.

## Get paid

There is no cron job in Stanza. Once `next_charge_at` passes, the cycle is
chargeable by **anyone** — you, the subscriber, or an automated keeper.

- Open your plan page. Every subscriber row shows whether a cycle is due.
- Click **Charge** to settle one cycle. The contract pulls exactly one cycle's
  price from the subscriber's approved allowance into your wallet.
- If a subscriber has a backlog, the button shows how many cycles are due;
  each click settles one.
- A charge fails if the subscriber's allowance is exhausted or revoked. The
  subscriber can top it up from their subscription page.

Because charging is permissionless, you can also run a keeper loop against the
indexer's `GET /api/subscriptions/due` endpoint. See the
[Indexer API](../developers/api.md).

## Retire a plan

Open the plan page and click **Retire this plan**. New subscriptions are
rejected and existing subscriptions stop being billable. Retiring is reversible
and never moves funds. Subscribers see the plan as `Retired`.

## What it costs

- One network fee per transaction (publish, retire, charge) — a fraction of a
  cent on testnet.
- No protocol fee, no listing fee, no withdrawal fee.

## Tips

- **Price per cycle is exact.** If you want 5 XLM per 30 days, that is the number
  the contract pulls every 30 days — not an annual price divided by 12.
- **Use a trial to reduce friction.** The first charge is delayed by exactly the
  trial length, and paused time is never billed.
- **A cycle cap is a promise.** With `max_cycles = 12`, subscribers know the
  contract cannot bill them more than 12 times.
- **Keep the merchant key safe.** The contract has no admin and no recovery
  path; only the merchant address can retire a plan.
