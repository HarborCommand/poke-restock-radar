# Sales tax foundation

This implementation provides technical calculation, persistence, receipt, refund-allocation, and reporting controls. It is not legal or tax advice. The business owner remains responsible for nexus, registration, filing frequency, product taxability, exemption evidence, destination rules, marketplace-facilitator treatment, and rate-source approval.

## Safe rollout

All five primary runtime flags default to `false`:

- `ONLINE_STRIPE_TAX_ENABLED`
- `POS_STRIPE_TAX_ENABLED`
- `MANUAL_TAX_FALLBACK_ENABLED`
- `TAX_EXEMPT_SALES_ENABLED`
- `TAX_REPORTING_ENABLED`

`POS_SALES_TAX_ENABLED` remains a compatibility alias only when `POS_STRIPE_TAX_ENABLED` is absent. The saved POS profile has a separate owner-approval toggle. Both the runtime flag and saved approval must be enabled before POS Stripe Tax is available. `MANUAL_TAX_FALLBACK_ENABLED` remains disabled and has no application configuration surface in the normal workflow. Historical records remain nullable; the UI reports unknown historical tax as **Not recorded** and never changes it to zero.

## Owner approval checklist

1. Open Stripe Dashboard in test mode.
2. Enable Stripe Tax.
3. Configure the business/head-office address.
4. Confirm or add the Florida tax registration.
5. Confirm the default product tax code and any allowed product overrides.
6. Confirm the shipping tax code.
7. Create or confirm the signed webhook endpoint.
8. Add the test credentials to Vercel Preview.
9. Run the required online and POS Stripe Tax certification cases in an isolated Preview.
10. Enable Production flags only after explicit owner approval. Production flags remain false in this change.

## Calculation and audit behavior

- Stripe Tax is the tax authority for new online and POS transactions. GameDayGrabs supplies authoritative merchandise, discounts, shipping price, tax codes, and verified store or delivery locations; Stripe determines merchandise and shipping tax.
- Stripe Checkout uses provider-returned `amount_subtotal`, `amount_discount`, `amount_shipping`, `amount_tax`, and `amount_total` as the authoritative paid snapshot after signed-webhook retrieval.
- POS uses Stripe Tax Calculation, Transaction, and Reversal references. Browser-provided rates, tax amounts, locations, provider references, and totals are never accepted.
- Refund tax is derived cumulatively from the immutable original total/tax snapshot and cannot exceed the original collected tax. Every adjustment has an idempotency key and immutable audit record.
- Revenue, profit, and rewards exclude collected sales tax. Existing reward redemption behavior is unchanged.
- Tax reports are read-only, admin-authenticated, user-scoped, bounded, no-store responses and contain no customer PII.

## POS consistency and recovery

The cashier quote is a signed preview tied to the authenticated owner, items, prices, quantities, discounts, fulfillment, location, exemption state, saved settings, and runtime mode. Finalization locks and reloads inventory and configuration in a bounded Serializable transaction, rejects a stale quote, and requests a fresh Stripe Tax calculation only after the authoritative state is known. That provider call is inside the lock window because the resulting calculation must match the inventory mutation that commits.

The internal sale, inventory decrement, merchandise-only rewards, and a `pending` tax-transaction snapshot commit atomically. Stripe Tax transaction recording then runs outside the inventory transaction with a stable owner/sale idempotency key. The API does not return success until the provider transaction matches the committed merchandise, shipping, tax, total, and line references and the saved rows are marked `recorded`.

If recording fails, the committed rows are marked `failed` (or `mismatch`) and the cashier receives a safe error. Retrying the same sale key reloads the existing sale and retries the same idempotent provider transaction; it does not decrement inventory or award rewards again. Refunds remain blocked until the original provider transaction is recorded. Reversals use the original transaction and line references, run behind the existing refund lock, use a stable reversal idempotency key, and preserve the original transaction. Reconciliation reports any pending, failed, mismatched, duplicate, or missing provider state; it never repairs or re-rates history automatically.

## Known limitations

- This foundation does not file or remit tax, create registrations, decide nexus, or certify exemptions.
- Real Stripe test-mode credentials are not currently available in the local/Preview configuration, so provider-contract tests are complete but end-to-end Stripe certification is still blocking live enablement.
- No tax flag may be enabled until the owner-approved registrations, product/shipping tax codes, store location, Local Pickup treatment, receipts, refunds, and reporting have been certified against Stripe test mode.
- Older orders and POS sales may not have a reliable tax snapshot and are intentionally shown as **Not recorded**.

## Rollback and recovery

Keep all five primary runtime flags disabled during rollout. If the application release must be rolled back, redeploy the previous build and leave the additive columns and `TaxAdjustment` table in place; the prior build does not read them. Prefer a forward fix over a down migration. Dropping the new structures is safe only before any tax-enabled write has occurred, after a verified backup, and through a separately reviewed maintenance migration. Never restore or infer historical tax values during rollback.
