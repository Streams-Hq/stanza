# How billing works

This page describes the state machine, the arithmetic, and the invariants of the
Stanza contract. The Rust source is the authoritative specification:
[`contracts/stanza/src/lib.rs`](https://github.com/Streams-Hq/stanza/blob/main/contracts/stanza/src/lib.rs).

## The plan object

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | `u64` | Plan identifier, assigned from 0 |
| `merchant` | `Address` | Receives every charge; may retire the plan |
| `token` | `Address` | SEP-41 token contract (a SAC or any Soroban token) |
| `amount` | `i128` | Price per cycle, in the token's base unit |
| `period` | `u64` | Cycle length in seconds |
| `trial_period` | `u64` | Seconds billed at zero cost before the first charge |
| `max_cycles` | `u32` | Cap on paid cycles; `0` means no cap |
| `active` | `bool` | Retired plans cannot be subscribed to or charged |

Plan parameters are immutable. To change a price you retire the plan and publish
a new one; existing subscriptions keep their original terms.

## The subscription object

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | `u64` | Subscription identifier, assigned from 0 |
| `plan_id` | `u64` | The plan being billed |
| `subscriber` | `Address` | Owns the allowance; may pause, resume, cancel |
| `started_at` | `u64` | Ledger timestamp at `subscribe` |
| `next_charge_at` | `u64` | Timestamp of the next billable cycle |
| `cycles_charged` | `u32` | Cycles successfully pulled |
| `total_paid` | `i128` | Sum of amounts pulled |
| `status` | `SubStatus` | `Active`, `Paused`, `Canceled`, `Completed` |

## Status machine

```
                    subscribe
                        │
                        ▼
                 ┌─────────────┐   pause    ┌────────────┐
                 │   ACTIVE    │ ─────────▶ │   PAUSED   │
                 └─────────────┘ ◀───────── └────────────┘
                   │    │    │     resume
        charge     │    │    │  cancel
        (cycle)    │    │    └──────────────▶ CANCELED (terminal)
                   │    │
                   │    └───────────────────▶ COMPLETED (cap reached)
                   └── next_charge_at += period
```

- **Active** — billable whenever `now >= next_charge_at` and the plan is active.
- **Paused** — never billable. `resume` restarts the cycle one full `period`
  from now, so paused time is never billed.
- **Canceled** — terminal. The subscriber can cancel from `active` or `paused`.
  There is nothing to refund because the contract holds nothing.
- **Completed** — terminal, reached automatically when the cycle cap is hit.

## The charge rule

For a subscription `s` on plan `p` at ledger timestamp `t`:

```
billable = s.status == Active
        && p.active
        && (p.max_cycles == 0 || s.cycles_charged < p.max_cycles)
        && t >= s.next_charge_at

on charge:
    transfer_from(contract → subscriber, p.merchant, p.amount)   // exactly once
    s.cycles_charged += 1
    s.total_paid     += p.amount
    s.next_charge_at += p.period
    if p.max_cycles != 0 && s.cycles_charged == p.max_cycles:
        s.status = Completed
```

`charge` is permissionless. A merchant, the subscriber, an automated keeper, or
an unrelated third party can all settle a due cycle; the outcome is identical
because the price, the recipient, and the schedule are fixed by the plan.

### Backlog

If nobody charges for three cycles, `cycles_due` reports the backlog (bounded by
`max_cycles`) and each `charge` call settles one cycle. `next_charge_at` advances
by exactly one `period` per call, so a keeper can drain a backlog without ever
skipping or double-charging a cycle.

## Worked example

Plan: **1 XLM per 30 days**, no trial, cap of 12 cycles. Subscriber approves
3 cycles of allowance (3 XLM).

| Step | Time | Result |
| --- | --- | --- |
| `subscribe` | `t0` | `next_charge_at = t0`, status `Active` |
| `charge` | `t0 + 10 min` | 1 XLM pulled; `next_charge_at = t0 + 30d` |
| `charge` | `t0 + 30d + 1s` | 1 XLM pulled; `next_charge_at = t0 + 60d` |
| — | `t0 + 45d` | subscriber `pause`; no charge is possible |
| `resume` | `t0 + 60d` | `next_charge_at = t0 + 90d` (paused time not billed) |
| `charge` | `t0 + 90d` | 1 XLM pulled; allowance now exhausted |
| `charge` | `t0 + 120d` | token contract rejects the pull: no allowance |
| — | — | subscriber approves more, or cancels |

If the subscriber cancels at `t0 + 45d` after two charges, they have paid 2 XLM
and nothing else. No refund is needed, because no funds were ever held.

## Invariants

These are what the unit tests assert:

1. The contract's token balance is **zero** before, during, and after any test.
2. `charge` moves exactly `plan.amount`, never more, even with a backlog.
3. `next_charge_at` advances by exactly `plan.period` per successful charge.
4. A charge is impossible before `next_charge_at`, on a retired plan, on a
   non-active subscription, or after the cycle cap.
5. `total_paid == cycles_charged * plan.amount` for every subscription.
6. `cycles_charged <= plan.max_cycles` whenever `max_cycles != 0`.
7. A canceled subscription can never be charged again.
8. Paused time is not billed: `resume` moves `next_charge_at` a full period
   forward.

## Trust and failure modes

| Risk | Mitigation |
| --- | --- |
| Merchant charges more than the price | Price and recipient are plan fields; the contract pulls exactly `amount` once per cycle |
| Merchant charges early | `now >= next_charge_at` is enforced by the contract clock |
| Merchant drains the wallet | The allowance is amount-capped and ledger-capped by the subscriber, and revocable at any time |
| Contract is compromised | It cannot move funds outside `transfer_from(contract → subscriber, merchant, amount)`; it holds no balance and has no admin |
| Subscription state expires | Persistent entries are extended on every read/write with a 30-day threshold and 120-day extension |
| Indexer lies | Every state read is a Soroban simulation; the indexer only supplies cached event history |

## Errors

| Code | Variant | Meaning |
| --- | --- | --- |
| 1 | `PlanNotFound` | No plan under that id |
| 2 | `SubNotFound` | No subscription under that id |
| 3 | `InvalidAmount` | Price per cycle was `<= 0` |
| 4 | `InvalidPeriod` | Cycle length was `0` |
| 5 | `PlanInactive` | Plan is retired |
| 6 | `SubNotActive` | Wrong state for this operation |
| 7 | `NotDue` | The next cycle has not started |
| 8 | `CycleLimitReached` | Plan cap already reached |
| 9 | `MathOverflow` | Checked arithmetic overflowed |
| 10 | `NotSubscriber` | Reserved for explicit caller checks |

Codes are stable and part of the ABI; the TypeScript SDK maps them to messages.
