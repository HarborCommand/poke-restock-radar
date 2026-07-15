# Sales tax reporting definitions

The Sales Tax Reports workspace is an accounting-support tool, not a filed tax return. It reads finalized transaction and refund snapshots and never recalculates historical tax from current Tax Settings, customer addresses, product prices, or live Stripe data.

## Period and scope

- Business timezone: `America/New_York`.
- The selected start and end dates are inclusive local calendar dates. The server queries from local midnight on the start date through, but not including, local midnight after the end date.
- A report is limited to 366 inclusive calendar days, 5,000 canonical transactions, 10,000 persisted source rows, and 10,000 tax adjustments.
- Online rows include paid, partially refunded, and refunded non-test orders. Unpaid, canceled-without-payment, test, and smoke orders are excluded.
- POS rows include finalized `platform=pos` sale snapshots. Canceled POS records are excluded. Multiple POS line snapshots with the same sale reference are combined into one canonical transaction.
- If an online order number and POS sale reference match exactly after normalization, the online transaction is retained and the mirrored POS transaction is excluded from totals. The reconciliation output records the exclusion.

## Metrics

- **Gross merchandise sales excluding tax**: persisted merchandise subtotal before discounts. Tax and shipping are excluded.
- **Discounts**: persisted merchandise discounts.
- **Net merchandise sales**: gross merchandise sales minus discounts.
- **Taxable sales**: persisted taxable subtotal after eligible discounts. It does not include tax or shipping.
- **Exempt sales**: net merchandise sales for transactions whose persisted snapshot is explicitly exempt.
- **Non-taxable sales**: the non-taxable portion of known, non-exempt snapshots. Historical unknown-tax transactions are excluded.
- **Shipping charged**: persisted online shipping charge. POS shipping is zero because the POS channel is in-store.
- **Florida state tax collected**: persisted state component for Florida transactions.
- **County surtax collected**: persisted county component for Florida transactions.
- **Total tax collected**: persisted authoritative total tax. When an online provider snapshot does not contain state/county components, the total remains authoritative and is shown separately as unallocated tax.
- **Tax refunded**: cumulative persisted refunded-tax snapshot, bounded in summary totals by original collected tax. Any persisted over-refund is surfaced as a reconciliation finding.
- **Net tax collected**: total tax collected minus bounded refunded tax, never below zero.
- **Active transaction count**: included canonical transactions that are not fully refunded. Partially refunded transactions remain active and also appear in the refunded count.
- **Refunded transaction count**: transactions with persisted refunded tax or a partially/full-refunded tax status.
- **Exempt transaction count**: transactions with an explicit persisted exemption.
- **Not-recorded transaction count**: historical transactions whose tax is unknown. These are excluded from tax totals and never treated as authoritative zero tax.

## Reconciliation

Reconciliation is deterministic and read-only. It can flag missing or unknown tax snapshots, total mismatches, state/county component mismatches, tax refunds above original tax, refund-adjustment mismatches, duplicate provider references, duplicate provider tax-calculation references, invalid tax statuses, missing jurisdictions, inconsistent POS line snapshots, and mirrored cross-channel transactions. It does not repair, backfill, or mutate source data.

Only safe transaction references, dates, channels, amounts, statuses, jurisdictions, and warning categories are returned. Customer identity, contact details, addresses, payment identifiers, provider tokens, database identifiers, exemption evidence, internal notes, and free text are excluded.

## CSV safety

The CSV uses UTF-8, RFC-compatible quoting, invariant decimal currency, separate jurisdiction fields, the selected period, generation timestamp, business timezone, and the accounting-support disclaimer. Cells that could be interpreted as spreadsheet formulas are neutralized, including leading `=`, `+`, `-`, `@`, tabs, carriage returns, line feeds, or leading control/space characters before a formula marker.

> Accounting support report. Confirm filing treatment with your tax professional or Florida Department of Revenue account.
