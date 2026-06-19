# Rule: Money & payments

Topic detail for CLAUDE.md §6. Billing is **stubbed** during the pilot, but these
rules are locked from day one because they are expensive to change later.
**This file wins over a prompt.**

## Data shape (locked now, even before billing is live)
- **All money = integer minor units (piastres) + an explicit `currency` field.
  Never floats.** (The same integer discipline is why `progress_entries` stores
  `weight_grams`, not kilograms as a float.)
- The `transactions` table is **generic and append-only** from the start:
  `type` (`subscription_charge | client_payment | coach_payout | refund`),
  `payer_id`, `payee_id`, `amount_minor`, `platform_fee_minor`, `currency`,
  `provider`, `provider_ref`, `status`. Only `subscription_charge` is used in V1.
- **Financial rows are never hard-deleted.**

## Architecture (locked now)
- All payment logic goes through a single **`PaymentProvider` adapter interface**.
  Business logic never calls Paymob directly.
- Seat count and "active" status are **server-side truth**, mutated only after
  webhook confirmation. Never trust client-sent billing state.

## Webhooks (when billing goes live — Phase 6)
- **Verify HMAC signature first**, enforce a timestamp tolerance (replay
  protection), and dedupe via an idempotency key (provider txn id, `UNIQUE`)
  **before** any state change.
- Add the webhook signature + idempotency test job to CI at that point (§11).

## Considering payments "throughout"
Even while billing is off, design new tables payment-aware: don't block a future
link from a `client`/subscription to a `transactions` row, and keep amounts/units
out of any float column anywhere.
