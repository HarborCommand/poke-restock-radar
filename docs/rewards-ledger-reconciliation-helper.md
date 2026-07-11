# Rewards Ledger Reconciliation Helper Design

Status: implemented as a bounded read-only helper in `src/lib/reward-reconciliation.ts` and exposed through the admin-only GET route `/api/radar/rewards/reconciliation`. No automatic repair path exists.

## Goal

Add a read-only internal helper that lets admins or developers compare `RewardBalance` totals with the sum of `RewardLedgerEntry` rows for one customer account.

The helper must never repair balances, rewrite ledger entries, or expose customer private data in public surfaces.

## Proposed Helper

```ts
calculateRewardBalanceAudit(customerAccountId: string): Promise<RewardBalanceAudit>
```

The helper should:

- Require a server-trusted customer account id.
- Read `RewardBalance` and related `RewardLedgerEntry` rows.
- Return an admin/internal-safe summary.
- Avoid returning customer email, name, address, payment data, or raw private notes.
- Perform no writes.

## Expected Totals

Pending points:

- Sum positive earn entries with `status = "pending"`.
- Treat legacy positive entries with null status as available, not pending.
- Subtract reversal entries that explicitly reverse pending points if Phase 1 metadata supports that split.

Available points:

- Sum positive earn entries with `status = "available"`.
- Treat legacy positive earn entries with null status as available.
- Subtract reversal entries that reverse available points.

Lifetime earned points:

- Sum historical positive earn points that were created for eligible paid orders.
- Do not reduce lifetime earned for refunds unless the product decision changes.
- Report reversed points separately so lifetime semantics stay clear.

Reversed and canceled entries:

- Negative `reverse` entries should contribute to reversal totals.
- `status = "canceled"` entries should not contribute to available or pending totals.
- Reversal entries should be grouped by `reversalOfEntryId` where present.

## Suggested Result Shape

```ts
type RewardBalanceAudit = {
  accountRef: string;
  isComplete: boolean;
  stored: {
    availablePoints: number;
    pendingPoints: number;
    lifetimeEarnedPoints: number;
  };
  expected: {
    availablePoints: number;
    pendingPoints: number;
    lifetimeEarnedPoints: number;
  };
  deltas: {
    availablePoints: number;
    pendingPoints: number;
    lifetimeEarnedPoints: number;
  };
  ledgerCounts: {
    total: number;
    scanned: number;
    pending: number;
    available: number;
    reversed: number;
    canceled: number;
    legacyNullStatus: number;
  };
  warnings: string[];
  isBalanced: boolean;
};
```

## Admin Use

The GET route requires an authenticated admin session and returns a private, no-store response. It accepts one server-validated customer account identifier, returns only the masked account reference and aggregate values, and has no write method.

The helper reads at most 1,000 ledger rows. If the account exceeds that bound, `isComplete` is false, `entry_limit_reached` is included in warnings, and `isBalanced` is always false. This prevents a partial sample from being mistaken for a complete reconciliation. A future paginated implementation may replace this conservative bound.

## CLI Use

An optional CLI can be added later for local/staging checks:

```powershell
npm run rewards:audit -- --customer-account-id <id>
```

CLI output should:

- Mask customer identity.
- Print only ids, counts, totals, deltas, and warning codes.
- Never print secrets, database URLs, Stripe keys, addresses, or private notes.
- Default to read-only behavior.

## Test Plan

Add tests for:

- Matching `RewardBalance` totals return `isBalanced: true`.
- Pending mismatch is detected.
- Available mismatch is detected.
- Lifetime mismatch is detected.
- Legacy null-status positive entries count as available.
- Reversed entries reduce the correct expected balance.
- Canceled pending entries do not count as pending or available.
- The helper performs no writes.
- The admin route rejects unauthenticated and non-admin callers.
- A truncated audit cannot report `isBalanced: true`.
- The helper does not expose customer email, addresses, payment data, or private notes.

## Implementation Preconditions

- Phase 1 pending rewards ledger schema is merged.
- Reward status semantics remain: reversals do not reduce lifetime earned points.
- Any production runbook explicitly says the helper is read-only.
- Any future repair remains a separate owner-approved operation that appends ledger history rather than rewriting it.

