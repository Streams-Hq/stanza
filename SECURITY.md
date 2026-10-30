# Security Policy

## Audit status

Stanza is **unaudited testnet software**. The contract, SDK, indexer, and web app
have been reviewed by their authors and covered by unit tests, but never by an
external security firm. Do not use Stanza to bill real subscribers or to move
funds of significant value.

## What the contract can and cannot do

The design deliberately removes custody:

- The contract **never holds a token balance**. There is no deposit, no escrow,
  no withdrawal queue. A test asserts `token.balance(contract) == 0` after every
  flow.
- It can only move a subscriber's tokens through a SEP-41 `transfer_from` where
  the contract is the spender, the amount is the plan price, and the recipient is
  the plan merchant.
- It has **no admin, no owner, no upgrade path, and no pause switch**.
- It cannot charge before `next_charge_at`, above `plan.amount`, past
  `plan.max_cycles`, or on a retired plan.
- Every subscription is controlled by its subscriber: `pause`, `resume`, and
  `cancel` require the subscriber's signature.
- Charging is permissionless by design; it is not an escalation of privilege,
  because the price and recipient are fixed by the plan.

## Scope

In scope for this repository:

- `contracts/stanza` — plan/subscription storage, charge accounting, allowance
  interaction, events, TTL handling
- `packages/sdk` — transaction construction, XDR encoding, parsers, billing math
- `indexer` — event decoding, SQLite persistence, REST API
- `apps/web` — wallet integration, transaction submission, UI state

Out of scope:

- The Stellar network, Soroban host, or `@stellar/stellar-sdk` — report upstream
  to the Stellar Development Foundation
- Freighter or any other wallet
- Attacks that require a compromised subscriber or merchant key
- A malicious RPC endpoint that lies about contract state (verify with a second
  RPC or the CLI if this matters to you)
- A malicious token contract; Stanza accepts any SEP-41 token, and the token's
  own behavior is out of scope

## Reporting a vulnerability

Do not open a public issue.

- **Preferred:** GitHub Security Advisories —
  https://github.com/Streams-Hq/stanza/security/advisories/new
- **Or** contact the maintainers through the repository's listed maintainer
  account.

Please include:

- A description of the issue and its impact
- Affected file(s) or contract function and a minimal reproduction
- Whether it has been disclosed elsewhere

## What to expect

- Acknowledgement within 72 hours
- An assessment and remediation plan within 7 days
- Credit in the fix's release notes unless you prefer to stay anonymous

## Known properties that are not vulnerabilities

- **No allowance check at `subscribe`.** The first `charge` fails at the token
  contract if the allowance is missing. This is intentional: it keeps `subscribe`
  independent of token-specific allowance semantics. The app always runs
  `approve` first.
- **The indexer is a cache.** A stale record is possible; every app read has a
  direct RPC fallback and actions always go to the contract.
- **Permissionless charging.** A third party can settle a due cycle. They cannot
  change the amount, recipient, or timing.
- **Immutable plans.** Merchants cannot edit price or period; they retire and
  republish. Subscribers keep the terms they signed up for.
- **Unbounded id index vectors.** `plans_of`, `subs_of`, and `subs_of_plan`
  return growing vectors. This is a scalability limit, not a fund-safety issue,
  and is tracked as an issue.
- **Contract immutability.** There is no upgrade path, so a bug requires a new
  deployment and a migration. This is a trade-off, not a hidden capability.
