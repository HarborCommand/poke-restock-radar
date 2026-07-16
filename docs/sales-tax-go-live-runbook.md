# Sales Tax Go-Live Runbook

Status: **Not approved for live tax collection**  
Prepared: 2026-07-15
Scope: Florida online delivery, Local Pickup, and owner-operated POS sales.  
This is an operational readiness plan, not legal, accounting, or filing advice. Do not put registration or certificate numbers in source code, tickets, logs, or pull requests.

## Unified Stripe Tax operating model (authoritative)

The current candidate architecture uses Stripe Tax for online calculation, POS calculation, tax on shipping, tax transaction recording, and tax reversals. GameDayGrabs owns prices, discounts, shipping price, inventory, customers, rewards, receipts/UI, immutable snapshots, reporting, and reconciliation. This section and [Unified Stripe Tax Operations](./unified-stripe-tax-operations.md) supersede older configured-POS-rate language retained below as historical rollout context.

The follow-up draft stack is PR #89 → #90 → #91 → #92 → #93 → #94 → #95 → #96. None of these drafts authorizes a Production deployment, live flag change, or real transaction. Merge only after review and revalidation in order.

Current runtime gates are `ONLINE_STRIPE_TAX_ENABLED`, `POS_STRIPE_TAX_ENABLED`, `TAX_EXEMPT_SALES_ENABLED`, `TAX_REPORTING_ENABLED`, and the emergency-only `MANUAL_TAX_FALLBACK_ENABLED`. All default false. The deprecated `POS_SALES_TAX_ENABLED` alias must not be used for new rollout instructions.

Before live collection, the owner/accountant must privately confirm the legal store address, Florida registration, filing frequency, accountant review, product tax code, shipping tax code, Local Pickup treatment, exemption policy, and evidence retention. Do not store official registration or certificate numbers in application notes or documentation.

## Deployed release chain

PRs #80 through #86 were reviewed, merged in order, and deployed to Production. Their runtime tax flags remain disabled. This final documentation phase changes no schema, runtime behavior, environment setting, or business data.

| Order | PR | Branch | Purpose | Schema / migration |
| --- | --- | --- | --- | --- |
| 1 | [#80](https://github.com/HarborCommand/poke-restock-radar/pull/80) | `codex/implement-sales-tax-foundation` | Canonical tax snapshots, server calculations, receipts, refunds, flags | `20260713010000_sales_tax_foundation` |
| 2 | [#81](https://github.com/HarborCommand/poke-restock-radar/pull/81) | `codex/build-tax-settings-workspace` | Owner settings and readiness checklist | `20260713023000_tax_settings_workspace` |
| 3 | [#82](https://github.com/HarborCommand/poke-restock-radar/pull/82) | `codex/polish-pos-tax-checkout-receipt` | POS quote/totals/receipt/print experience | None |
| 4 | [#83](https://github.com/HarborCommand/poke-restock-radar/pull/83) | `codex/polish-online-tax-checkout-experience` | Cart, Stripe Tax trust copy, orders, account, email | None |
| 5 | [#84](https://github.com/HarborCommand/poke-restock-radar/pull/84) | `codex/build-tax-reporting-workspace` | Read-only report, reconciliation, accountant CSV | None |
| 6 | [#85](https://github.com/HarborCommand/poke-restock-radar/pull/85) | `codex/harden-tax-refunds-concurrency` | Row locks, provider-event claims, refund races | None |
| 7 | [#86](https://github.com/HarborCommand/poke-restock-radar/pull/86) | `codex/harden-tax-security-privacy` | Authorization, no-store, redaction, tenant boundary | None |
| 8 | [#87](https://github.com/HarborCommand/poke-restock-radar/pull/87) | `codex/audit-tax-go-live-readiness` | This runbook and final audit | None |

The stacked implementation is now complete. The final code gate verified that owner `userId` predicates, strict schemas, immutable snapshots, and private/no-store headers survived the rebases. Preserve the historical merge order above when auditing or reverting the rollout.

### Current deployed state

- Production contains PRs #80 through #86. PR #87 is documentation and an automated readiness check only.
- Live tax collection is not approved. `ONLINE_STRIPE_TAX_ENABLED`, `POS_STRIPE_TAX_ENABLED`, `TAX_EXEMPT_SALES_ENABLED`, `TAX_REPORTING_ENABLED`, and `MANUAL_TAX_FALLBACK_ENABLED` must remain disabled until the unified stack is reviewed and approved.
- Customer rewards redemption remains disabled and is outside this rollout.
- Merchant Center and Stripe Terminal work in PR #22 remains parked and untouched.
- Code readiness is not business readiness: deployed safeguards do not authorize live collection.

### Remaining go-live blockers

- A valid, isolated Stripe test credential set has not been made available and verified.
- Stripe Checkout still requires end-to-end evidence for a same-county Florida delivery and a different-county Florida delivery.
- Local Pickup treatment must be approved and then verified end to end at the configured pickup location.
- Signed webhook processing must be verified against the persisted tax snapshot.
- Full and partial refunds must be completed in Stripe test mode and reconciled to the original snapshot.
- The owner must privately confirm the legal store address, Florida registration, store county and approved rate source, filing frequency, accountant review, and written exemption/evidence-retention policy.

Do not enable any tax flag until every blocker is closed and explicit owner approval is recorded privately.

### Migration order

1. Keep every tax feature flag false.
2. Back up the target database using the existing encrypted/approved process.
3. Confirm no failed Prisma migration rows and no schema drift.
4. Apply `20260713010000_sales_tax_foundation`.
5. Apply `20260713023000_tax_settings_workspace`.
6. Run Prisma migration status, schema validation, application health, and read-only smoke checks.
7. Do not backfill historical tax. Existing unknown tax must remain `not_recorded`.

For a brand-new Postgres environment, use the reviewed frozen baseline process documented in `docs/prisma-migration-baseline-repair.md`: execute the reviewed baseline, resolve its 25 absorbed migrations, then deploy the remaining migrations. Never use `prisma db push` against an existing Production database.

## Required owner and accountant inputs

No live collection decision can be approved until the owner records all of the following in the private operational system (not in Git):

- Legal business/store address and confirmation that it is the correct tax location.
- Florida sales-tax registration confirmation. Store only status/date in the readiness UI; do not paste the certificate number into code or a PR.
- Store county and the approved county discretionary surtax rate/source.
- Filing frequency assigned by Florida (for example monthly or quarterly).
- Accountant or tax professional contact and evidence of their review.
- Stripe Tax live-mode registration/readiness, including Florida registration and origin location.
- Default product tax code confirmation for the actual catalog.
- Written tax-exemption policy: accepted customers, evidence, retention, renewal, refunds, and who may approve an exemption.
- Local Pickup location and its tax treatment confirmation.
- POS rate source, effective date, and a process for rate changes.

## Pre-launch configuration

### Florida and filing

- [ ] Owner confirms Florida registration is active for the legal entity and store location.
- [ ] Accountant confirms filing frequency, first filing period, due-date calendar, and whether zero returns are required.
- [ ] Owner confirms legal/store address and county.
- [ ] Accountant validates state rate, county surtax, sourcing assumptions, shipping treatment, discounts, refunds, and Local Pickup treatment.
- [ ] Owner assigns a person responsible for filing and a backup.

### Stripe Tax live readiness

- [ ] Live Stripe account ownership and business details are verified.
- [ ] Florida tax registration is configured in Stripe Tax by an authorized owner.
- [ ] Store/origin and Local Pickup locations are correct.
- [ ] Default product tax code `txcd_99999999` is reviewed; replace it through an approved code change if it is not correct for every catalog item.
- [ ] Checkout collects the address required by Stripe Tax.
- [ ] Live webhook endpoint is configured for the required Checkout/payment events and its signing secret is stored only in Vercel.
- [ ] Live webhook signature failure produces a generic correlated error and no payload/provider details.
- [ ] Stripe Dashboard tax calculation and application snapshot agree for test-mode delivery and pickup fixtures.

### POS profile and exemption policy

- [ ] Country, state, county, state rate, county surtax, effective date, and source note are completed in Tax Settings.
- [ ] Combined rate is independently checked against the approved source.
- [ ] Cashier cannot type a rate or tax amount; server quote is displayed before sale completion.
- [ ] Exempt sales remain disabled until the written policy and private evidence workflow are approved.
- [ ] Certificate/reference and reason remain required; no certificate document is exposed through a public route.

## Preview transaction checklist

Complete only in the dedicated Preview databases and Stripe test mode. Use disposable fixtures and remove them after evidence is saved.

- [ ] Florida shipment in the store county: Stripe subtotal, shipping, state tax, county tax, and total match the persisted snapshot.
- [ ] Florida shipment to a different county: provider jurisdiction and tax are authoritative; no browser estimate appears.
- [ ] Local Pickup: configured pickup location is used and tax appears before test payment confirmation.
- [ ] POS sale: quantity and discount changes invalidate stale quotes and recalculate on the server.
- [ ] Tax-disabled and provider-unavailable states fail clearly; no zero-tax fallback is accepted.
- [ ] Tax-exempt POS fixture requires reason/reference and stores zero tax with `exempt` status.
- [ ] Receipt, print/PDF layout, order detail, account history, and email state tax separately.
- [ ] Duplicate checkout webhook has one order/inventory/reward/tax effect.
- [ ] Full refund nets original tax to zero; partial refund uses the original snapshot; repeated request has one effect.
- [ ] Online/POS/mixed report aggregates reconcile to the immutable fixtures and exported CSV contains no PII or formulas.
- [ ] Historical unknown fixture remains “Not recorded.”
- [ ] Readiness checklist records Preview online, pickup, POS, receipt, refund, and report evidence.

## Production flag plan

Current safe defaults in `.env.example` are false:

```text
ONLINE_STRIPE_TAX_ENABLED=false
POS_STRIPE_TAX_ENABLED=false
TAX_EXEMPT_SALES_ENABLED=false
TAX_REPORTING_ENABLED=false
MANUAL_TAX_FALLBACK_ENABLED=false
```

`STRIPE_CHECKOUT_ENABLED` controls Checkout availability and is separate from tax collection. Do not change an existing Checkout decision as part of the tax release unless the owner explicitly schedules it.

Only an authorized owner may execute the following after the PR chain, migrations, owner inputs, accountant review, and Preview checklist are complete:

1. Deploy the merged code with all four tax flags false and verify Production health/read-only admin access.
2. Configure approved Tax Settings while environment collection flags remain false.
3. Enable `TAX_REPORTING_ENABLED=true` first; verify an empty/read-only report does not mutate data.
4. In a scheduled window, enable **one channel at a time**:
   - Online: `ONLINE_STRIPE_TAX_ENABLED=true` only after live Stripe Tax and signed webhook readiness.
   - POS: `POS_STRIPE_TAX_ENABLED=true` only after Stripe Tax certification, verified locations, approved codes, and cashier training.
5. Leave `TAX_EXEMPT_SALES_ENABLED=false` until the exemption policy/evidence workflow is approved; enable it separately.
6. Redeploy, verify health/configuration status, inspect one owner-authorized transaction per enabled channel, reconcile its receipt/snapshot/report, and record approval privately.
7. Never enable rewards redemption as part of this procedure.

## Rollback / disable procedure

If tax is incorrect, provider readiness degrades, reconciliation fails, or ownership is uncertain:

1. Stop affected checkout/POS activity operationally.
2. Set the affected collection flag false (`ONLINE_STRIPE_TAX_ENABLED`, `POS_STRIPE_TAX_ENABLED`, or `TAX_EXEMPT_SALES_ENABLED`) and redeploy. Keep `MANUAL_TAX_FALLBACK_ENABLED=false` unless the documented emergency process is separately approved.
3. Keep `TAX_REPORTING_ENABLED` on only if read-only investigation is safe; otherwise disable it too.
4. Do not delete or rewrite orders, sales, tax snapshots, refund adjustments, provider events, or audit logs.
5. Preserve request IDs and affected references; do not copy customer addresses, provider payloads, secrets, or certificate numbers into incident channels.
6. Reconcile the incident population with Stripe, persisted snapshots, refunds, and the accountant.
7. Correct code/settings in a new reviewed Preview; repeat the checklist before re-enabling.

Disabling application tax affects **new** calculations only. Existing immutable snapshots and refund records remain authoritative.

## Post-launch monitoring

For the first day, first week, and each filing close, review:

- Health/configuration warnings and webhook signature/processing failures.
- Checkout automatic-tax errors, unsupported locations, and address failures.
- POS quote failures, stale quote prevention, and profile effective date/source.
- Missing tax snapshots, total mismatches, refund tax above original tax, duplicate provider calculation IDs, and historical unknown counts.
- Tax collected, refunded, and net tax by online/POS, state/county, delivery/pickup, and exemption status.
- Duplicate webhook/refund claims and serialization retry frequency.
- Report/CSV access logs and unexpected 401/403/origin rejections.

Escalate immediately if tax exceeds the original snapshot, tax changes without a refund record, cross-owner access is suspected, a secret/provider payload appears in a response/log, or report totals do not reconcile.

## Filing-support workflow

1. Lock the filing period dates with the accountant; the application does not file a return.
2. Export the bounded accountant CSV from the private Tax Reports workspace.
3. Save the report generation timestamp, period, application commit, filter set, and truncation status.
4. Reconcile gross merchandise sales excluding tax, taxable/exempt sales, discounts, shipping, state/county tax, refunds, and net tax to Stripe and internal settlement records.
5. Investigate every reconciliation finding without auto-correction. Historical unknown tax is disclosed, not guessed.
6. Accountant prepares/reviews the return using the official filing system and approved source records.
7. Store filing confirmation and workpapers in the approved private accounting repository, not in Git or public application storage.
8. Record filing completion, period, reviewer, and next due date without storing private certificate/account identifiers in code.

## Final approval gate

Go-live remains blocked until every owner/accountant input and Preview item above is complete, migrations are current, the admin readiness checklist is complete, Production tax flags are independently verified false before the scheduled change, and the owner records explicit approval.

Use Admin → Tax → Go-Live Switchboard as the single launch preflight. It reads the existing settings, locations, certification, reconciliation, build, health, and approval records; it cannot modify Vercel environment variables or independently enable collection.
