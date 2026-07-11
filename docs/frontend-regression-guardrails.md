# Frontend regression guardrails

- Customer and ledger search waits 300 ms after typing and aborts stale requests before updating state.
- Customers & Rewards tabs expose tab, tabpanel, selection, focus, Home/End, and arrow-key behavior.
- `RadarApp.tsx` and `globals.css` have intentionally generous size ceilings. Crossing a ceiling requires splitting shared modules rather than raising it casually.
- The default test command continues to include route auth, customer isolation, reward idempotency, checkout, feed/schema, mobile structure, and modal/workspace regression tests.
- The focused guardrail suite is available through `npm run test:guardrails`.
