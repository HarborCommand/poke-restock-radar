# POS Rewards Design

Status: design only. Manual POS sales should not earn rewards until customer identity, claim, and fraud controls are implemented and reviewed.

## Current Limitation

Manual POS sales are recorded as inventory sale records and do not currently capture a verified customer account identity. Because of that, POS sales are excluded from Phase 1 rewards.

That exclusion should remain until POS can identify a customer safely.

## Goals

Future POS rewards should:

- Let an admin optionally associate a POS sale with a verified customer.
- Award points only once.
- Use server-calculated POS sale totals.
- Avoid customer identity guesswork.
- Support a receipt-based claim workflow.
- Keep POS rewards separate from Stripe Terminal work until both are reviewed.

## Non-Goals

- No current POS behavior changes.
- No production sales mutation.
- No automatic points for anonymous POS sales.
- No points from unverified email text alone.
- No redemption at POS in this phase.

## Recommended Approach

### 1. Optional Customer Email Capture

Add an optional field in POS:

```txt
Customer email for rewards
```

Suggested helper text:

> Want rewards? Add the customer's email. Points require a verified customer account before they are awarded.

The server should store a normalized email snapshot for the sale, but this alone must not award points.

### 2. Verified Account Matching

Reward eligibility should require one of:

- Customer is already signed in or verified in a future POS customer lookup flow.
- Admin selects an existing verified customer account.
- Customer later claims the sale through a verified email/account flow.

Email-only matching should be treated as a claim candidate, not final proof.

### 3. Receipt Claim Reference

For eligible claim candidates, POS receipt can show:

```txt
Rewards claim reference: POS-...
```

Claim reference requirements:

- Random or non-enumerable token.
- Stored hashed if exposed to customers.
- Expires after a configurable window.
- Can be used only once.
- Links to one POS sale.

### 4. Admin Attach POS Sale To Customer

Future admin workflow:

1. Open POS sale detail.
2. Search verified customer account.
3. Attach sale to customer.
4. Server validates sale is not already rewarded or claimed.
5. Server creates reward ledger entry.
6. Server records admin actor and reason.

This must be ledger-backed and idempotent.

## Fraud And Abuse Controls

Rules:

- No points without verified email or customer account.
- No duplicate claim for the same POS sale.
- Points are based on server-calculated POS sale totals.
- Refunds/voids must reverse POS-earned points.
- Admin attach flow requires reason and audit trail.
- Customer claim flow should rate-limit claim attempts.
- Claim reference must not reveal private sale details before verification.

Server validation:

- Sale exists.
- Sale is finalized and not voided/refunded.
- Sale has not already produced a reward ledger entry.
- Customer account is verified.
- Eligible subtotal is positive.
- Idempotency key is unique.

## Data Model Needs

Potential additive fields or tables:

- `InventorySale.customerEmail`
- `InventorySale.customerAccountId`
- `InventorySale.rewardClaimReferenceHash`
- `InventorySale.rewardClaimExpiresAt`
- `InventorySale.rewardClaimedAt`
- `InventorySale.rewardLedgerEntryId`

Alternative dedicated table:

```txt
PosRewardClaim
```

Fields:

- id
- saleId
- customerAccountId
- claimReferenceHash
- status
- expiresAt
- claimedAt
- createdByAdminUserId
- idempotencyKey

All migrations should be additive and nullable/default-safe.

## Customer UX

POS screen:

- Optional customer email field.
- Clear "rewards require verified account" helper.
- No reward points promised until verified.

Receipt:

- If a claim reference exists, show how to claim.
- If no email/account was provided, omit rewards claim language.

Customer account:

- Show POS rewards only after claim or admin attach is complete.
- Include POS receipt reference in activity if safe.

## Admin UX

Inventory sale detail:

- Show reward status:
  - Not eligible
  - Claim pending
  - Rewarded
  - Reversed
- Allow admin attach only with verified customer and reason.
- Show audit trail.

## Tests Needed

Add tests for:

- POS sale without customer identity does not earn points.
- Email-only POS sale creates claim candidate only, not points.
- Verified customer attach awards points once.
- Duplicate attach does not duplicate ledger or balance.
- Claim reference cannot be reused.
- Invalid/expired claim reference fails safely.
- Refunded/voided POS sale cannot earn points.
- POS reward reversal handles refund/void.
- Browser-provided POS totals are ignored.
- Customer cannot claim another customer's sale.
- Admin notes and private sale data do not leak publicly.

## Implementation Prerequisites

- Phase 1 rewards ledger merged.
- Owner approves POS customer identity policy.
- Manual POS sale detail workflow is stable.
- Claim reference policy reviewed.
- Refund/void behavior for POS sales is defined.

