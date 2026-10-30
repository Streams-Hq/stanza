# For subscribers

This guide is for the person paying. You need a Stellar account and
[Freighter](https://www.freighter.app) on **testnet**.

## What you are agreeing to

When you subscribe, you approve a **SEP-41 allowance**: a maximum amount the
Stanza contract may pull, for a limited time. Each charge takes exactly one
cycle's price. Your money stays in your wallet until that moment, and you can
pause, cancel, or revoke at any time.

## Subscribe

1. Connect Freighter and open a plan (from **Explore** or a link a merchant sent
   you).
2. Review the price, cycle length, trial, and cycle cap.
3. Click **Approve & subscribe**. Freighter asks you to sign **two**
   transactions:
   - `approve` — grants the contract an allowance of three cycles.
   - `subscribe` — records your schedule on-chain.
4. You land on your subscription page with the first charge scheduled.

A trial delays the first charge by exactly the trial length.

## Manage your subscription

On your subscription page you can:

- **See what is due.** The progress bar and countdown use the same integer math
  as the contract.
- **Pause.** No charge is possible while paused. **Resume** restarts the cycle a
  full period from now, so paused time is never billed.
- **Cancel.** Permanent and immediate. There is nothing to refund — the contract
  never held your money.
- **Top up the allowance.** Approve three more cycles when the allowance runs
  low. If the allowance is exhausted, the merchant's charge fails until you do.

You can also revoke the allowance directly in Freighter, without touching the
subscription. The contract will simply be unable to charge.

## Verify independently

- Every settlement emits a `charged` event with the amount, cycle number, and
  next due timestamp.
- The subscription page links each charge to
  [Stellar.Expert](https://stellar.expert/explorer/testnet).
- Your allowance is a token-level fact: inspect it on the token contract itself
  with `stellar contract invoke --id <token> -- allowance --from <you> --spender <stanza>`.

## Troubleshooting

- **"Charge failed" from the merchant.** Your allowance is exhausted, expired,
  or revoked. Approve more cycles.
- **The plan is retired.** No new charges can happen. You can cancel to keep your
  history clean.
- **Countdown shows "due now" but nothing happened.** Charging is permissionless
  but not automatic; ask the merchant to charge, or use the charge button on
  your subscription page. Anyone can settle it.
- **Nothing appears in "My subscriptions".** The app reads your ids directly
  from the contract. Confirm Freighter is on testnet and the same account is
  selected.
