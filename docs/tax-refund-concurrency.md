# Tax refund and concurrency guarantees

This document describes the accounting and transaction rules enforced by the online and POS refund paths. It is an engineering control description, not tax or filing advice.

## Immutable source snapshots

- The original stored subtotal, total, tax, jurisdiction, and tax status are immutable accounting inputs after payment or POS finalization.
- Refund allocation uses the original transaction total and tax snapshot. Current Tax Settings and browser-supplied tax fields are never used.
- Historical `not_recorded` tax remains unknown through refund processing. An authoritative stored zero remains zero.
- Refunds create separate immutable `TaxAdjustment` rows. Cumulative refunded tax is bounded by the original collected tax, and net tax cannot become negative.
- Merchandise, tax, shipping, rewards, revenue, and profit remain separate. Reward earning and reversal use merchandise amounts excluding tax.

## Idempotency and ownership

- Online admin request, provider, payment-event, and tax-adjustment keys are scoped to the authoritative order plus the client request key.
- POS duplicate detection is restricted to the locked sale rows owned by the authenticated workspace.
- Provider refund webhooks deduplicate on the Stripe refund identifier and stored order relationship.
- Order, sale, and customer identifiers are reloaded and ownership-scoped on the server. Browser refund totals and tax fields are not accepted.

## PostgreSQL transaction sequencing

Online and POS mutations run in bounded Serializable transactions. The relevant order or POS sale rows are locked with `FOR UPDATE` before the refundable balance is recalculated. Only recognized Prisma/SQLSTATE serialization conflicts are retried, for at most eight attempts.

The online admin flow calls Stripe after acquiring the order lock. This deliberately prevents two requests from authorizing refunds against the same remaining balance. The lock is bounded by a 20-second transaction timeout, and every retry uses the same order-scoped Stripe idempotency key. A provider error aborts the database transaction, so order, tax, inventory, and reward state cannot partially commit. Stripe test-mode end-to-end validation remains required before live collection can be approved.

Provider refund webhooks do not make a Stripe network call. They lock the order, apply the provider refund once, allocate tax from the immutable snapshot, create one adjustment, and reverse merchandise rewards in the same transaction. A refund arriving before payment finalization fails safely and can be retried after the payment snapshot commits.

POS inventory-return lots, sale refund state, tax adjustments, and reward reversals commit together. Derived inventory totals are recalculated after commit and again on an idempotent retry if an earlier recalculation was interrupted.

## Webhook claims and recovery

Stripe signatures are verified before event claims. A unique `PaymentEvent` claim allows one active business invocation. Successful processing marks the claim complete; an ordinary failure releases it for retry. A claim left in `processing` by process termination may be reclaimed after five minutes, preventing both overlapping work and permanent event loss.

Payment-completion retries also rerun idempotent reward, confirmation-email, and customer-total side effects for an already-paid order. Refund and reward paths reload current state inside their transactions, so a refund racing those side effects cannot award or reverse points twice.

## Operational constraints

- Production tax flags remain disabled until the separate go-live checklist is approved.
- Logs and API responses use request IDs and redacted error envelopes. Refund routes are private and `no-store`.
- Success audit logging occurs only after the financial operation commits. A logging failure cannot repeat the provider or ledger effect because the retry encounters the committed idempotency record.
- The dedicated real-PostgreSQL suite covers duplicate payment and refund events, partial and full refunds, POS races, reward reversal, payment/cancellation races, and actual Serializable retry behavior.
