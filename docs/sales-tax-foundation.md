# Sales tax foundation

This implementation provides technical calculation, persistence, receipt, refund-allocation, and reporting controls. It is not legal or tax advice. The business owner remains responsible for nexus, registration, filing frequency, product taxability, exemption evidence, destination rules, marketplace-facilitator treatment, and rate-source approval.

## Safe rollout

All four runtime flags default to `false`:

- `ONLINE_STRIPE_TAX_ENABLED`
- `POS_SALES_TAX_ENABLED`
- `TAX_EXEMPT_SALES_ENABLED`
- `TAX_REPORTING_ENABLED`

The saved POS profile has separate owner-approval toggles. Both the runtime flag and the saved approval must be enabled before POS tax or exemption entry is available. Historical records remain nullable; the UI reports unknown historical tax as **Not recorded** and never changes it to zero.

## Owner approval checklist

1. Confirm registrations, nexus states, filing frequencies, and effective dates with a qualified adviser.
2. Confirm the Florida store county and discretionary surtax rate from the current Florida Department of Revenue source. Save the effective date and a source/version note.
3. Review the default Stripe product tax code and every product override. Add only approved codes to `STRIPE_ALLOWED_PRODUCT_TAX_CODES`.
4. Configure Stripe Tax registrations in Stripe test mode, then validate taxable, non-taxable, discount, shipping, address, refund, and webhook cases in an isolated Preview.
5. Choose and document a local-pickup tax policy. Stripe Checkout cannot use a performance/store location, so tax-enabled local pickup intentionally fails closed until the owner approves a separate supported calculation path.
6. Reconcile Preview receipts and the tax report to Stripe and adviser expectations.
7. Enable one flag at a time only after approval. Production flags remain false in this change.

## Calculation and audit behavior

- All new calculations use integer cents and basis points. Florida POS calculations use half-up rounding at the transaction level, with state and county components reconciled exactly to the collected total.
- Stripe Checkout uses provider-returned `amount_subtotal`, `amount_discount`, `amount_shipping`, `amount_tax`, and `amount_total` as the authoritative paid snapshot after signed-webhook retrieval.
- Refund tax is derived cumulatively from the immutable original total/tax snapshot and cannot exceed the original collected tax. Every adjustment has an idempotency key and immutable audit record.
- Revenue, profit, and rewards exclude collected sales tax. Existing reward redemption behavior is unchanged.
- Tax reports are read-only, admin-authenticated, user-scoped, bounded, no-store responses and contain no customer PII.

## Known limitations

- This foundation does not file or remit tax, create registrations, decide nexus, or certify exemptions.
- POS rates are owner-managed snapshots; there is no live third-party POS tax provider in this change.
- Online local pickup is blocked while Stripe Tax is enabled until a supported owner-approved store-location policy is implemented.
- Older orders and POS sales may not have a reliable tax snapshot and are intentionally shown as **Not recorded**.
