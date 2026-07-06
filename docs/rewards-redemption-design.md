# Rewards Redemption Design

Status: design only. Do not implement checkout discounts or enable redemption until the owner approves the formula and Phase 1 rewards ledger behavior is stable.

## Business Target

- 500 points = $5 off.
- Redeem in 500-point increments.
- Recommended minimum eligible product subtotal: $40 or $50.
- Points apply only to eligible product subtotal.
- Points cannot pay shipping or tax.
- Points have no cash value.
- Points cannot apply to past orders.
- Refunded orders must reverse earned points and restore or reconcile redeemed points safely.

## Non-Goals

- No checkout total changes in this phase.
- No Stripe Checkout price changes in this phase.
- No production reward balance mutation.
- No redemption UI enablement.

## Checkout Architecture

Redemption should use a reservation flow before creating a Stripe Checkout Session.

Proposed flow:

1. Customer signs in.
2. Cart is server-priced.
3. Customer selects a redemption amount in 500-point increments.
4. Server validates available points and eligible product subtotal.
5. Server creates a redemption reservation ledger entry.
6. Server creates Stripe Checkout Session with a server-calculated discount.
7. Checkout session metadata includes the redemption reservation id.
8. Webhook finalizes or releases the reservation.

The browser must never be trusted for:

- Available points.
- Eligible subtotal.
- Discount value.
- Shipping or tax exclusion.
- Customer identity.

## Recommended Formula

Eligible product subtotal:

```txt
sum eligible line item subtotals before shipping and tax
```

Maximum redemption:

```txt
floor(eligibleProductSubtotalCents / 500) * 500 points
```

Dollar conversion:

```txt
500 points = 500 cents discount
```

Minimum order:

- Recommend `$50` eligible product subtotal for launch.
- `$40` is acceptable if owner wants a lower threshold.

Redemption should not reduce order product subtotal below zero and should never affect shipping or tax charges.

## Ledger Entries

Add explicit redemption ledger states in a future migration.

Suggested fields:

- `redemptionReservationId`
- `checkoutSessionId`
- `expiresAt`
- `status`
  - `reserved`
  - `redeemed`
  - `released`
  - `refunded`
- `pointsRedeemed`
- `discountCents`
- `idempotencyKey`

Reservation entry:

- Negative pending-style entry.
- Reduces usable available points immediately.
- Does not become final until payment succeeds.

Finalized redemption:

- Marks reservation as redeemed after paid webhook.
- Associates redemption with order id.
- Keeps idempotency by checkout session id.

Released redemption:

- Used when checkout expires, fails, or is canceled before payment.
- Restores reserved points once.

## Stripe Checkout Integration

Use server-side Stripe Checkout Session creation.

Options to evaluate:

- Add a negative line item only if Stripe supports the intended tax/shipping behavior safely.
- Prefer Stripe discounts/coupons only if they can be created or referenced without exposing customer-controlled amounts.
- Keep final order snapshots explicit: original eligible subtotal, reward discount, shipping, tax, and final charged amount.

Any Stripe implementation must keep:

- Server-authoritative cart totals.
- Idempotent checkout session creation.
- Metadata for redemption reservation id.
- Webhook verification unchanged.

## Webhook Behavior

On `checkout.session.completed`:

- Verify payment status is paid.
- Load order and reservation by trusted metadata/session id.
- Confirm reservation belongs to the signed-in customer account tied to the order.
- Mark redemption as redeemed once.
- Leave earned rewards pending according to Phase 1 rules.

On duplicate webhook:

- No duplicate redemption finalization.
- No duplicate earned rewards.
- No duplicate balance movement.

On `checkout.session.expired` or unpaid cancel:

- Release reservation once.
- Restore available points once.

## Refund Behavior

Full refund:

- Reverse earned points.
- Restore redeemed points only if business policy says the customer should regain points after refund.
- If points were restored, create a ledger entry explaining the restoration.

Partial refund:

- Recalculate eligible retained subtotal.
- Prorate earned point reversal.
- Decide whether redeemed points are restored proportionally, preserved, or reconciled against the retained purchase.
- Record every movement in ledger entries.

Policy decision needed before implementation:

- Should redeemed points be restored on customer-initiated returns, merchant cancellations, or both?

## Customer UI

Cart:

- Show available points.
- Show "Redemption coming soon" until enabled.
- When enabled, show apply/remove controls.
- Disable redemption when customer is not signed in.
- Disable redemption when available points are below 500.
- Disable redemption when eligible subtotal is below threshold.
- Show clear message that points do not cover shipping or tax.

Account rewards:

- Show available, pending, and lifetime points.
- Explain 500 points = $5 off only after redemption is enabled.
- Show redemption history after launch.

## Test Plan

Add tests for:

- Apply points with sufficient balance.
- Cannot apply points below 500.
- Cannot apply points below minimum eligible subtotal.
- Points do not reduce shipping or tax.
- Remove points releases reservation.
- Expired checkout releases reservation once.
- Successful payment finalizes reservation once.
- Duplicate webhook is idempotent.
- Refund behavior matches final owner policy.
- Browser-supplied discounts are ignored.
- Guest checkout cannot redeem points.
- Customer cannot redeem another customer's points.

## Required Schema Changes

Likely future migration:

- Redemption reservation metadata on reward ledger or a dedicated reservation table.
- Checkout session linkage.
- Expiration timestamp.
- Redemption status.
- Idempotency key indexes.

All changes should be additive and nullable/default-safe.

## Implementation Phases

1. Add schema and internal helpers behind disabled redemption flag.
2. Add server-only redemption reservation and release tests.
3. Add cart UI in disabled/read-only state.
4. Add Preview/Staging Stripe test-mode QA.
5. Enable only after owner approves the policy and refund behavior.

