# SDK reference

`@stanza/sdk` is the typed TypeScript client for the Stanza contract. It builds
and simulates transactions, encodes arguments to XDR, parses plans and
subscriptions, reads allowances, decodes events, and mirrors the contract's
billing math with `bigint` only.

```bash
pnpm --filter @stanza/sdk build
```

## Setup

```ts
import { StanzaClient } from '@stanza/sdk';

const client = new StanzaClient({
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
  contractId: process.env.NEXT_PUBLIC_STANZA_CONTRACT_ID!,
});
```

## Reads

All reads are simulations against a dummy source account — no wallet, no funded
account.

| Method | Returns |
| --- | --- |
| `getPlan(planId: bigint)` | `Plan` |
| `getSubscription(subId: bigint)` | `Subscription` |
| `planCount()` / `subscriptionCount()` | `bigint` |
| `plansOf(merchant)` / `subsOf(subscriber)` / `subsOfPlan(planId)` | `bigint[]` |
| `isDue(subId)` | `boolean` |
| `cyclesDue(subId)` | `number` |
| `allowance(token, owner, spender)` | `bigint` |
| `getEvents(startLedger, limit?)` | decoded `DecodedContractEvent[]` |

```ts
const plan = await client.getPlan(0n);
const due = await client.cyclesDue(0n);
const approved = await client.allowance(plan.token, subscriber, contractId);
```

Unknown ids fail with a `StanzaError` carrying the contract error code:

```ts
import { CONTRACT_ERRORS, StanzaError } from '@stanza/sdk';

try {
  await client.getPlan(99n);
} catch (err) {
  if (err instanceof StanzaError && err.code === 1) {
    console.log(CONTRACT_ERRORS[1]); // "Plan not found"
  }
}
```

## Writes

Each write returns an **unsigned, prepared** `Transaction` for the wallet to
sign. Nothing is signed or submitted by the SDK.

```ts
// 1. Publish a plan (merchant signs)
const planTx = await client.createPlanTx({
  merchant: address,
  token: XLM_SAC,
  amount: 10_000_000n,     // 1 XLM per cycle
  period: 2_592_000n,      // 30 days
  trialPeriod: 604_800n,   // optional, 7-day trial
  maxCycles: 12,           // optional, 0 = uncapped
});

// 2. Grant the allowance (subscriber signs)
const approveTx = await client.approveAllowanceTx({
  token: XLM_SAC,
  owner: subscriber,
  spender: contractId,
  amount: 30_000_000n,               // 3 cycles
  expirationLedger: latestLedger + 17_280 * 30,
});

// 3. Enrol (subscriber signs)
const subTx = await client.subscribeTx({ subscriber, planId: 0n });

// 4. Settle a due cycle (anyone signs, including a keeper)
const chargeTx = await client.chargeTx({ subscriptionId: 0n }, keeperAddress);

// 5. Subscriber controls
await client.pauseTx({ subscriptionId: 0n, subscriber });
await client.resumeTx({ subscriptionId: 0n, subscriber });
await client.cancelTx({ subscriptionId: 0n, subscriber });

// 6. Merchant controls
await client.setPlanActiveTx({ planId: 0n, merchant, active: false });
```

`chargeTx` takes a `source` argument because charging is permissionless: the
transaction fee payer does not have to be the subscriber or the merchant.

## Billing math

These mirror [`src/lib.rs`](https://github.com/Streams-Hq/stanza/blob/main/contracts/stanza/src/lib.rs)
exactly, so a UI countdown never disagrees with `charge`.

```ts
import { billingProgress, cyclesDue, isDue } from '@stanza/sdk';

cyclesDue(plan, sub, now);       // includes backlog, respects the cycle cap
isDue(plan, sub, now);           // boolean
billingProgress(plan, sub, now); // { dueCycles, cycleProgress, secondsUntilNext, cyclesRemaining }
```

Formatting helpers:

```ts
formatUnits(12_345_678n, 7);   // "1.2345678"
parseUnits('1.2345678', 7);    // 12345678n
formatPeriod(2_592_000n);      // "30 days"
formatCountdown(90_061);       // "1d 1h 1m"
committedValue(plan);          // plan.amount * plan.maxCycles, or null
```

## Events

`getEvents` returns decoded events for this contract:

```ts
const events = await client.getEvents(startLedger);
for (const event of events) {
  if (event.kind === 'charged') {
    console.log(event.data.subId, event.data.amount, event.data.nextChargeAt);
  }
}
```

Lower-level decoding is available for custom indexers:

```ts
import { parseStanzaEvent, EVENT_TOPIC_TO_KIND } from '@stanza/sdk';

// topics/value are already scValToNative-decoded
const event = parseStanzaEvent('charged', nativeValue);
```

Event kinds: `plan_created`, `subscribed`, `charged`, `subscription_updated`,
`plan_status_changed`.

## Types

```ts
interface Plan {
  id: bigint;
  merchant: string;
  token: string;
  amount: bigint;
  period: bigint;
  trialPeriod: bigint;
  maxCycles: number;
  active: boolean;
}

type SubStatus = 'active' | 'paused' | 'canceled' | 'completed';

interface Subscription {
  id: bigint;
  planId: bigint;
  subscriber: string;
  startedAt: bigint;
  nextChargeAt: bigint;
  cyclesCharged: number;
  totalPaid: bigint;
  status: SubStatus;
}
```

Also exported: `ClientConfig`, `CreatePlanParams`, `SubscribeParams`,
`ApproveAllowanceParams`, all event payload interfaces, `StanzaEvent`,
`STANZA`-level formatters, and the `xdr` helpers `addressToScVal`, `u64ToScVal`,
`u32ToScVal`, `i128ToScVal`, `boolToScVal`, `parsePlanScVal`,
`parseSubscriptionScVal`.

## Precision

Amounts are `i128` base units on-chain and `bigint` in TypeScript. There is no
floating point anywhere in the SDK. Use `parseUnits` / `formatUnits` at the UI
boundary and keep `bigint` everywhere else.
