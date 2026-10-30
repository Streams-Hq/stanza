# Indexer API

The indexer follows the Stanza contract's events over Soroban RPC, persists a
read model in SQLite, and serves a read-only REST API on port `3001`.

Base URL: `NEXT_PUBLIC_INDEXER_URL` (local: `http://localhost:3001`).

The indexer is a cache. Every app action is submitted to the contract, and every
state read has a direct Soroban RPC fallback. Treat this API as an acceleration
layer and an event archive, never as the source of truth.

## `GET /health`

```json
{
  "status": "ok",
  "service": "stanza-indexer",
  "lastLedger": 5458669,
  "timestamp": "2026-10-29T23:40:00.000Z"
}
```

## `GET /api/stats`

```json
{
  "plans": 1,
  "subscriptions": 1,
  "activeSubscriptions": 1,
  "merchants": 1,
  "volume": "10000000"
}
```

`volume` is the sum of `total_paid` across subscriptions, in base units, as a
decimal string.

## Plans

### `GET /api/plans?limit=50&offset=0`

```json
{ "plans": [ /* PlanRecord[] */ ], "limit": 50, "offset": 0 }
```

### `GET /api/plans/{id}`

```json
{
  "plan": {
    "id": 0,
    "merchant": "GANMJ…",
    "token": "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    "amount": "10000000",
    "period": 2592000,
    "trial_period": 0,
    "max_cycles": 12,
    "active": 1,
    "created_at": 1793317005,
    "updated_at": 1793317005
  }
}
```

Errors: `400` invalid id, `404` unknown plan.

### `GET /api/plans/merchant/{address}`

```json
{ "plans": [ /* PlanRecord[] */ ] }
```

### `GET /api/plans/{id}/subscriptions`

```json
{ "subscriptions": [ /* SubscriptionRecord[] */ ] }
```

## Subscriptions

### `GET /api/subscriptions?limit=50&offset=0&status=active`

`status` is optional: `active`, `paused`, `canceled`, `completed`.

```json
{ "subscriptions": [ /* SubscriptionRecord[] */ ], "limit": 50, "offset": 0 }
```

### `GET /api/subscriptions/{id}`

```json
{
  "subscription": {
    "id": 0,
    "plan_id": 0,
    "subscriber": "GBQDD…",
    "started_at": 1793317005,
    "next_charge_at": 1795909005,
    "cycles_charged": 1,
    "total_paid": "10000000",
    "status": "active",
    "created_at": 1793317005,
    "updated_at": 1793317005
  }
}
```

### `GET /api/subscriptions/subscriber/{address}`

```json
{ "subscriptions": [ /* SubscriptionRecord[] */ ] }
```

### `GET /api/subscriptions/due?limit=50`

The keeper queue: active subscriptions on active plans whose `next_charge_at`
has passed and whose cycle cap is not reached.

```json
{
  "dueAt": 1796000000,
  "subscriptions": [ /* SubscriptionRecord[] */ ]
}
```

### `GET /api/subscriptions/{id}/charges`

```json
{
  "charges": [
    {
      "id": 1,
      "sub_id": 0,
      "plan_id": 0,
      "amount": "10000000",
      "cycles_charged": 1,
      "ledger": 5458701,
      "ledger_closed_at": "2026-10-29T23:37:12Z",
      "tx_hash": "…"
    }
  ]
}
```

## Events

### `GET /api/events/{subId}`

Raw event archive for one subscription, oldest first.

```json
{
  "events": [
    {
      "id": 1,
      "sub_id": 0,
      "event_type": "charged",
      "ledger": 5458701,
      "ledger_closed_at": "2026-10-29T23:37:12Z",
      "data": "{ \"sub_id\": 0, \"amount\": \"10000000\" }",
      "tx_hash": "…"
    }
  ]
}
```

`event_type` is one of `subscribed`, `charged`, `paused`, `resumed`, `canceled`.

## Amounts

`amount`, `total_paid`, and `volume` are `i128` values serialized as decimal
strings so JavaScript never loses precision. Parse them with `BigInt(...)`.

## Running it

```bash
pnpm --filter @stanza/indexer dev                     # tsx watch, :3001
pnpm --filter @stanza/indexer build && node indexer/dist/server.js
```

Required env: `STANZA_CONTRACT_ID`, `SOROBAN_RPC_URL`. See
[Environment variables](environment.md).
