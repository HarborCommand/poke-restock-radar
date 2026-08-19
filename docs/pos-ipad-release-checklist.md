# POS iPad release checklist

Use this checklist for every change touching POS layout, POS cart rows, payment panels, checkout actions, or global app-shell sizing.

## Required iPad checks

- Test iPad portrait at 768 × 1024.
- Test iPad landscape at 1024 × 768.
- Add at least three cart items.
- Confirm only the cart item list scrolls.
- Confirm the Charge / checkout action remains visible inside the viewport.
- Confirm totals, tax status, customer controls, receipt controls, and payment controls do not push the Charge action off screen.
- Open Confirm Sale, inspect the summary, then cancel without completing a sale.
- Confirm no horizontal overflow, overlapping text, or hidden footer controls.

## Release rule

Do not release POS layout changes unless the automated iPad charge-footer regression test passes and the manual iPad smoke above is clean.
