# Rewards financial integrity

This document describes the current earning and reversal boundaries. Rewards redemption remains disabled.

## Flow matrix

| Flow | Trigger | Eligible subtotal source | Transaction boundary | Idempotency scope | Balance effect | Ledger effect |
|---|---|---|---|---|---|---|
| Online earn | Fresh paid Stripe order | Persisted order item line totals, with persisted subtotal fallback | Serializable retry wrapper | One earn per order | Pending and lifetime increase | Pending earn |
| Pending release | Shipped, picked up, fulfilled, or configured delay | Existing pending earn | Serializable retry wrapper | Conditional pending-status claim | Pending decreases; available increases | Earn moves to available |
| POS earn | Completed POS sale | Server-calculated adjusted POS line subtotal | POS sale serializable transaction | One earn per sale reference | Available and lifetime increase | Available POS earn |
| Admin legacy backfill | Confirmed admin attach/apply action | Persisted order items or persisted sale totals | Serializable retry wrapper | One backfill per purchase/customer policy | Available and lifetime increase | Available backfill earn |
| Apply Rewards Now | Confirmed admin review | Same persisted backfill calculation | Same attach/backfill transaction | Same backfill key as the purchase | Available and lifetime increase once | Available backfill earn once |
| Admin add | Admin adjustment with required reason | Server-validated integer points | Serializable retry wrapper | Customer, action, and request key | Available and lifetime increase | Positive adjustment |
| Admin deduct | Admin adjustment with required reason | Server-validated integer points | Serializable retry wrapper with conditional balance claim | Customer, action, and request key | Available decreases, never below zero | Negative adjustment |
| Full refund/cancel | Persisted refunded/canceled order | Original eligible subtotal and persisted refund state | Serializable retry wrapper | One reversal per event key | Pending first, then available; never below zero | Immutable reversal referencing earn |
| Partial refund | Persisted cumulative refund | Integer-cent proration against original eligible product subtotal | Serializable retry wrapper | One reversal per refund event | Pending first, then available; bounded by earn and balance | Immutable partial reversal referencing earn |
| POS refund | Completed POS refund transaction | Original POS earn | POS refund serializable transaction | One reversal per sale reference | Available decreases, never below zero | Immutable POS reversal referencing earn |

There is no point-expiry flow. Future redemption hooks remain disabled and do not alter checkout totals.

## Canonical calculation

- Money is converted to bounded integer cents before point calculation.
- One point is earned per complete eligible product-subtotal dollar; fractional dollars are floored.
- Shipping and tax are excluded.
- Online item line totals and POS adjusted line totals already reflect discounts.
- Zero, negative, non-finite, and unsupported values earn zero.
- The maximum eligible subtotal accepted by the calculator is $1,000,000.
- Partial refunds use cumulative integer cents and cannot reverse more than the original earn.

## Invariants

- Every mutation appends one immutable ledger entry and updates its balance in the same transaction.
- A unique idempotency key produces at most one effective ledger/balance mutation.
- Available and pending points never become negative.
- An original earn is not deleted or rewritten as a correction.
- Reversals reference the original earn where available.
- Lifetime earned is the historical sum of positive earns and positive admin adjustments. Refunds, cancellations, and deductions do not decrement lifetime earned.
- Serializable conflicts are retried only for idempotent reward operations, up to a bounded attempt count; exhaustion returns a safe conflict error.
- Online awards reload persisted order state inside the transaction so stale paid callers cannot award a refunded or canceled order.

If a refund exceeds the customer points still present after unrelated deductions, the reversal consumes only the points available in the applicable buckets and returns a partial/insufficient result for explicit reconciliation. It never creates a negative balance and never blocks the underlying payment refund transaction with an invalid points decrement.

## Privacy and reconciliation

Customer activity uses safe labels and omits internal reasons, actors, keys, ownership evidence, and reconciliation metadata. The admin reconciliation endpoint is GET-only, private/no-store, masked, bounded, and performs no correction.
