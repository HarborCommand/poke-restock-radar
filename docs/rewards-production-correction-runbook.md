# Rewards production correction runbook

This is a planning artifact. It does not authorize or perform a production balance change.

## Accidental linked-sale award

The known accidental award must remain intact until the owner explicitly approves a correction. A correction must:

1. Identify the original ledger entry through an admin-only internal lookup without copying its internal key into tickets, comments, or customer-visible output.
2. Verify the customer, source purchase, points, current balance, and whether any later reversal already exists.
3. Run the read-only reward balance audit before changing anything.
4. Create a new negative adjustment/reversal ledger entry that references the original entry.
5. Use a unique correction idempotency key and a private reason/note.
6. Update the balance in the same transaction; never edit or delete the original ledger row.
7. Run reconciliation again and retain both audit events.

Under current lifetime semantics, the planned correction for the known 55-point incident would reduce available points by 55 while leaving lifetime earned unchanged. The correction must reference the original immutable entry and must be re-evaluated against the live balance immediately before execution. This runbook does not authorize that execution.

No correction should run from a browser console, ad hoc SQL, `db push`, migration, or direct balance edit.
