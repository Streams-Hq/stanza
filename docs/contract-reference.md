# Contract reference

The `stanza-subscriptions` contract has one responsibility: publish billing
plans and let anyone settle a due cycle by pulling a capped SEP-41 allowance.
It is written with `soroban-sdk` 29 for target `wasm32v1-none` and is **immutable
once deployed**.

- Source: [`contracts/stanza/src/lib.rs`](https://github.com/Streams-Hq/stanza/blob/main/contracts/stanza/src/lib.rs)
- Live testnet contract: `CDGIYCP56ZAC5ZVTJVHJQ5H7OLZSCDU3DFA77VWXT74N47MW6ZBV4FDP`

## Storage

| Key | Storage class | Meaning |
| --- | --- | --- |
| `NextPlanId`, `NextSubId` | instance | Monotonic id counters |
| `Plan(u64)` | persistent | One `Plan` per id |
| `Sub(u64)` | persistent | One `Subscription` per id |
| `MerchantPlans(Address)` | persistent | Plan ids created by a merchant |
| `SubscriberSubs(Address)` | persistent | Subscription ids owned by a subscriber |
| `PlanSubs(u64)` | persistent | Subscription ids billed by a plan |

Persistent entries are extended on every read and write with a 30-day threshold
and a 120-day extension, so an actively billed subscription is never archived
mid-cycle.

## Errors

All state-changing functions return `Result<T, Error>`. Codes are stable ABI.

| Code | Variant | Raised when |
| --- | --- | --- |
| 1 | `PlanNotFound` | No plan under that id |
| 2 | `SubNotFound` | No subscription under that id |
| 3 | `InvalidAmount` | `amount <= 0` at plan creation |
| 4 | `InvalidPeriod` | `period == 0` at plan creation |
| 5 | `PlanInactive` | Plan is retired |
| 6 | `SubNotActive` | Operation needs `Active`/`Paused` and the state differs |
| 7 | `NotDue` | `now < next_charge_at` |
| 8 | `CycleLimitReached` | `max_cycles` already reached |
| 9 | `MathOverflow` | Checked arithmetic overflowed |
| 10 | `NotSubscriber` | Reserved |

## Events

Every state change emits exactly one event. The first topic is the event name;
the second is the affected id. The body is a typed struct.

| Topic | Body | Emitted by |
| --- | --- | --- |
| `plan_new` | `PlanCreated { plan_id, merchant, token, amount, period, trial_period, max_cycles }` | `create_plan` |
| `sub_new` | `Subscribed { sub_id, plan_id, subscriber, next_charge_at }` | `subscribe` |
| `charged` | `Charged { sub_id, plan_id, subscriber, merchant, amount, cycles_charged, next_charge_at, total_paid }` | `charge` |
| `paused` / `resumed` / `canceled` | `SubscriptionStatusChanged { sub_id, plan_id, subscriber, status, next_charge_at }` | `pause` / `resume` / `cancel` |
| `plan_act` | `PlanStatusChanged { plan_id, merchant, active }` | `set_plan_active` |

## Functions

### `create_plan`

```rust
create_plan(
    merchant: Address,
    token: Address,
    amount: i128,
    period: u64,
    trial_period: u64,
    max_cycles: u32,
) -> Result<u64, Error>
```

- **Auth:** `merchant.require_auth()`.
- **Validates:** `amount > 0` (else `InvalidAmount`), `period > 0` (else `InvalidPeriod`).
- **Effect:** assigns the next plan id, stores the plan with `active = true`,
  indexes it under the merchant. No tokens move.
- **Emits:** `plan_new`.
- **Notes:** `max_cycles = 0` means uncapped.

### `set_plan_active`

```rust
set_plan_active(plan_id: u64, active: bool) -> Result<(), Error>
```

- **Auth:** the plan's merchant.
- **Effect:** retirement is reversible; it stops new subscriptions and new
  charges but never edits existing subscriptions or moves funds.
- **Emits:** `plan_act`.

### `subscribe`

```rust
subscribe(subscriber: Address, plan_id: u64) -> Result<u64, Error>
```

- **Auth:** `subscriber.require_auth()`.
- **Validates:** plan exists and is active (else `PlanInactive`).
- **Effect:** assigns the next subscription id, stores it with
  `next_charge_at = now + trial_period` and `status = Active`, and indexes it by
  subscriber and by plan.
- **Emits:** `sub_new`.
- **Notes:** this does not check the allowance. The first `charge` fails at the
  token contract if the subscriber never approved the Stanza contract. The app
  always runs `approve` first.

### `charge`

```rust
charge(sub_id: u64) -> Result<(), Error>
```

- **Auth:** none — permissionless.
- **Validates:** subscription is `Active`, plan is active, cap not reached, and
  `now >= next_charge_at`.
- **Effect:** state is written before the token call (checks-effects-interactions):
  `cycles_charged += 1`, `total_paid += amount`, `next_charge_at += period`, and
  `status = Completed` when the cap is reached. Then exactly one
  `transfer_from(contract, subscriber, merchant, amount)` is executed.
- **Emits:** `charged`.
- **Failure:** if the allowance is missing or too small, the token contract
  rejects the transfer and the whole charge reverts.

### `pause` / `resume` / `cancel`

```rust
pause(sub_id: u64)  -> Result<(), Error>   // Active → Paused
resume(sub_id: u64) -> Result<(), Error>   // Paused → Active
cancel(sub_id: u64) -> Result<(), Error>   // Active|Paused → Canceled (terminal)
```

- **Auth:** the subscription's subscriber.
- **Effect:** `resume` sets `next_charge_at = now + plan.period`, so paused time
  is never billed. `cancel` is permanent and moves no funds.
- **Emits:** `paused`, `resumed`, `canceled`.

### Reads

| Function | Returns |
| --- | --- |
| `get_plan(plan_id) -> Plan` | Full plan record |
| `get_subscription(sub_id) -> Subscription` | Full subscription record |
| `is_due(sub_id) -> bool` | Whether a charge would succeed now |
| `cycles_due(sub_id) -> u32` | Billable cycles including backlog, capped by `max_cycles` |
| `plan_count() -> u64` | Number of plans |
| `subscription_count() -> u64` | Number of subscriptions |
| `plans_of(merchant) -> Vec<u64>` | Plan ids by merchant |
| `subs_of(subscriber) -> Vec<u64>` | Subscription ids by subscriber |
| `subs_of_plan(plan_id) -> Vec<u64>` | Subscription ids by plan |

Reads require no authorization and no funded account.

## Calling it with the Stellar CLI

```bash
CONTRACT=CDGIYCP56ZAC5ZVTJVHJQ5H7OLZSCDU3DFA77VWXT74N47MW6ZBV4FDP
XLM=CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC

stellar contract invoke --id $CONTRACT --source alice --network testnet -- create_plan \
  --merchant "$(stellar keys address alice)" \
  --token $XLM \
  --amount 10000000 \
  --period 2592000 \
  --trial_period 0 \
  --max_cycles 12

stellar contract invoke --id $XLM --source bob --network testnet -- approve \
  --from "$(stellar keys address bob)" \
  --spender $CONTRACT \
  --amount 30000000 \
  --expiration_ledger 5600000

stellar contract invoke --id $CONTRACT --source bob --network testnet -- subscribe \
  --subscriber "$(stellar keys address bob)" --plan_id 0

stellar contract invoke --id $CONTRACT --source alice --network testnet -- charge --sub_id 0

stellar contract invoke --id $CONTRACT --network testnet -- get_subscription --sub_id 0
```

## Invariants

The unit tests in [`src/test.rs`](https://github.com/Streams-Hq/stanza/blob/main/contracts/stanza/src/test.rs)
assert the invariants listed in [How billing works](protocol.md#invariants).
The most important one for custody: **the contract's token balance is always
zero**, because it never receives funds.
