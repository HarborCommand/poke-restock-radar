# Unified Stripe Tax Operations

Status: **Draft architecture; not approved for live collection**  
Updated: 2026-07-16  
Scope: online delivery, Local Pickup, owner-operated POS, refunds, reporting, certification, emergency fallback, and rollback.

This document is an operating guide, not legal, tax, accounting, or filing advice. Never place credentials, webhook secrets, registration numbers, certificate numbers, customer addresses, or provider payloads in Git, tickets, screenshots, or pull requests.

## System responsibilities

Stripe Tax is authoritative for:

- online tax calculation;
- POS tax calculation;
- tax on shipping;
- tax transaction recording; and
- tax reversals.

GameDayGrabs is authoritative for:

- product prices and discounts;
- shipping price;
- inventory;
- customer accounts and rewards;
- receipts and user interface;
- immutable internal tax snapshots; and
- reporting and reconciliation.

The browser is never authoritative for a rate, jurisdiction, taxable subtotal, tax amount, provider reference, registration state, or live-mode status. A saved manual rate cannot activate normal collection.

## Required owner and accountant decisions

Live preflight must remain blocked until the following are privately confirmed:

- legal store address;
- active Florida registration status;
- filing frequency;
- accountant review;
- default product tax code;
- shipping tax code;
- Local Pickup location and treatment;
- written exemption policy; and
- evidence-retention location and duration.

Store only approval status, review date, and a bounded non-sensitive note in GameDayGrabs. Keep official identifiers and source documents in the approved private accounting system.

## POS cashier workflow

1. Add owner-scoped inventory and any approved discount. The cashier cannot enter a tax rate or amount.
2. Select in-person or delivery fulfillment. Delivery requires a verified destination; in-person and Local Pickup use the approved location snapshot.
3. Wait for the signed server quote. Stripe Tax calculates merchandise and shipping tax.
4. If location, registration, provider, or quote evidence is missing, stop. Never treat a provider failure as an authoritative zero.
5. Complete the sale only while the signed quote still matches price, quantity, discount, fulfillment, customer selection, exemption state, location, and tax configuration.
6. GameDayGrabs persists the Stripe calculation, location, jurisdiction, tax breakdown, cents, and line references, then records the Stripe Tax transaction exactly once.
7. Give the customer the itemized receipt. Rewards use eligible merchandise only and exclude tax.

The legacy emergency fallback is selected only by server state after an administrator records a qualifying incident. A cashier cannot request, select, edit, or extend it.

## Refund workflow

1. Verify the owner-scoped order or POS sale and obtain the existing immutable tax snapshot under the refund lock.
2. Accept merchandise amount and reason only; never accept browser tax, rate, provider reference, or customer ownership.
3. Compute cumulative refunded tax from the original snapshot. Current rates never re-rate history.
4. Issue the payment refund where applicable, then create the Stripe Tax reversal using the original transaction and line references.
5. Persist the adjustment, provider reversal state, inventory effect, rewards effect, and audit evidence exactly once.
6. Full refund must net original tax to zero. Partial refunds must remain bounded by original tax. Provider failure remains visible for reconciliation and must not be silently discarded.

Historical manual transactions keep their original state/county snapshot and provider label. Their refunds use that original snapshot; they are never rewritten as Stripe transactions.

## Reporting and reconciliation workflow

1. Use the private, no-store Tax Reports workspace with an accountant-approved business-date range.
2. Reconcile gross merchandise, discounts, shipping, taxable/exempt sales, collected tax, refunded tax, and net tax to Stripe and settlement evidence.
3. Review canonical findings: missing calculation/transaction, duplicate transaction, total mismatch, missing/orphan/excess reversal, missing location/registration, provider unavailable, legacy manual, and unknown history.
4. “Prepare repair plan” creates review guidance only. It cannot call Stripe or update accounting data. Every corrective operation requires owner approval and a separate idempotent implementation.
5. Export the bounded, formula-safe CSV only to the approved private accounting repository. The application does not file a return.
6. Preserve historical unknown tax as unknown. Never guess or backfill it.

## Stripe test certification

Run certification only with branch-scoped Stripe test credentials, a disposable Preview Postgres database, and explicit provider-write confirmation. The harness refuses live keys, Production runtime/base URLs, and Production-like database targets.

Required evidence covers 20 scenarios: same/different Florida county, out-of-state delivery, Local Pickup, shipping tax, Checkout creation, signed and duplicate webhooks, full/partial online refunds, POS in-person/delivery/cash/Zelle, transaction recording, duplicate finalize, full/partial/duplicate reversals, and provider failure.

Commands:

```text
npm run tax:certify:contracts
npm run tax:certify:stripe
npm run tax:certify:report
```

Contract mocks prove application invariants but do not certify Stripe. Live preflight requires all Stripe-test scenarios passed, unexpired, and tied to the candidate build. Save safe references and cents only, then remove disposable fixtures and credentials.

## Emergency manual fallback

Normal state: `MANUAL_TAX_FALLBACK_ENABLED=false`.

Emergency use requires all of the following:

- authenticated owner administrator;
- Stripe Tax confirmed unavailable;
- documented non-sensitive incident reason;
- explicit acknowledgment;
- activation expiry no more than 24 hours away;
- audit event; and
- `POS_STRIPE_TAX_ENABLED=false`.

Stripe and manual modes can never operate simultaneously. There is no automatic switching. Saved rates alone cannot activate collection, and expiration blocks the incident path. Display the incident banner throughout activation. After Stripe recovery, disable fallback, reconcile the complete incident window, preserve every historical snapshot, and document owner/accountant review.

## Controlled launch

1. Merge the reviewed PR stack in order and rerun validation after each rebase/merge.
2. Apply reviewed migrations with every tax runtime flag false.
3. Open Admin → Tax → Go-Live Switchboard. Run preflight and resolve every blocker.
4. Record owner readiness approval and accountant review. These records do not enable collection.
5. Verify live Stripe mode, active Florida registration, verified POS/pickup locations, product/shipping codes, signed webhook, unexpired certification, clean reconciliation, build commit, and healthy database.
6. In a scheduled window, enable one approved channel at a time using the controlled Vercel environment workflow; the application UI cannot change Vercel variables.
7. Redeploy, rerun preflight, observe one owner-authorized transaction, and reconcile snapshot, Stripe transaction, receipt, refund readiness, and report.
8. Leave exemption collection and manual fallback disabled unless their separate policies authorize them.

## Emergency kill switch and rollback

1. Stop affected online/POS activity.
2. Set `ONLINE_STRIPE_TAX_ENABLED=false` and `POS_STRIPE_TAX_ENABLED=false`, then redeploy.
3. Preserve completed tax snapshots, Stripe references, adjustments, audit logs, and request IDs. Do not delete or rewrite history.
4. New calculations must stop. Allow in-flight Checkout Sessions to expire or verify their signed webhook and stored snapshot before fulfillment; do not create a second order or tax transaction.
5. Keep read-only reports and original-snapshot refunds available when investigation safety permits.
6. Notify the owner and accountant without sharing customer data, credentials, registration numbers, or raw provider payloads.
7. Reconcile the affected period, correct the root cause in an isolated Preview, repeat certification/preflight, and obtain fresh approval before re-enabling.

Disabling tax gates changes only new calculations. It does not invalidate completed tax snapshots or prevent a correct refund/reversal from using original evidence.
