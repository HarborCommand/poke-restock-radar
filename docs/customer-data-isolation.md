# Customer data isolation

Customer identity is derived from the signed, server-verified customer session. Browser-supplied account IDs, email addresses, names, phone numbers, order owners, and reward owners are never ownership proof.

## Route matrix

| Route or API | Authentication | Identity source | Ownership filter | Cache policy | Response model |
|---|---|---|---|---|---|
| `/account` | Optional; private data requires a verified session | Signed customer session | `listCustomerAccountOrders(account)` | Dynamic, private/no-store, noindex | Account dashboard DTOs |
| `/account/orders` | Optional; history requires a verified session | Signed customer session | Online and POS scopes below | Dynamic, private/no-store, noindex | `CustomerAccountOrderHistoryItem` |
| `/account/orders/[orderNumber]` | Optional; detail requires a verified session | Signed customer session | Online order or POS sale key inside the authenticated account scope | Dynamic, private/no-store, noindex | `CustomerAccountOrderDetail` |
| `/account/rewards` | Optional; rewards require a verified session | Signed customer session | `RewardLedgerEntry.customerAccountId = account.id` | Dynamic, private/no-store, noindex | Bounded customer reward activity DTO |
| `/account/addresses` | Optional; addresses require a verified session | Signed customer session | Address records are loaded from the session account | Dynamic, private/no-store, noindex | Allowlisted saved-address fields |
| `/account/security` | Optional; sessions require a verified session | Signed customer session | `CustomerSession.customerAccountId = account.id` | Dynamic, private/no-store, noindex | Masked device/session DTO |
| `/account/login`, `/account/forgot-password`, `/account/reset-password` | Public authentication entry points | Submitted credential or one-time token | Generic responses; no account data returned before proof | Dynamic, private/no-store, noindex | Authentication status DTOs |
| `GET /api/account/session` | Optional | Signed customer session | Current session only | Private/no-store | Minimal account/session DTO |
| `POST /api/account/session/refresh` | Required for success | Signed customer session | Current session only | Private/no-store | Minimal timeout/session DTO |
| `POST /api/account/addresses` | Required | Signed customer session | Every write includes `customerAccountId = account.id` | Private/no-store | Status only |
| `POST /api/account/security/sessions` | Required | Signed customer session | Every lookup/write includes `customerAccountId = account.id` | Private/no-store | Status/count only |
| `POST /api/account/logout` | Optional | Signed customer session | Current token hash only | Private/no-store | Safe redirect |
| `POST /api/account/login` | Public | Email/password proof | Exact normalized account lookup, generic failures | Private/no-store | Authentication status only |
| `POST /api/account/register` | Public | New verified identity flow | Exact normalized email | Private/no-store | Generic registration status |
| `POST /api/account/forgot-password` | Public | Submitted email | Enumeration-resistant generic response | Private/no-store | Generic status only |
| `POST /api/account/reset-password` | Public | Single-use reset token | Token-bound account only | Private/no-store | Generic status only |
| `POST /api/account/magic-link/request` | Public | Submitted email | Enumeration-resistant generic response | Private/no-store | Generic status only |
| `GET /api/account/magic-link/verify` | Public callback | Single-use magic-link token | Token-bound account only | Private/no-store | Safe redirect and rotated session |
| `/order-status` and `POST /api/storefront/order-status` | Public two-factor lookup | Order number plus checkout email | Both values must match | Dynamic page; API private/no-store | Narrow public order-status DTO |

There are no customer-facing receipt download, account export, profile mutation, or rewards export endpoints. Receipt presentation is part of the ownership-scoped purchase detail DTO. Public checkout routes do not consume the customer account session and do not grant account-history ownership.

## Ownership rules

- Online orders explicitly linked to the authenticated account are visible.
- A legacy online order may be discovered by the authenticated account's verified normalized email only while the order and its customer record remain unlinked.
- An order linked to another account never falls back to email ownership.
- POS/local sales are visible only when `InventorySale.customerAccountId` exactly equals the authenticated account ID.
- POS/local lookups accept a receipt reference or sale ID only inside that account scope.
- Names, phones, matching sale emails, reward entries, and browser-supplied references do not establish POS ownership.
- Unlinked, test, smoke, and website-mirrored inventory sales are excluded.
- Unauthorized and nonexistent purchase references return the same safe not-found state.

## Customer-safe data

Purchase DTOs expose product title/image, quantity, customer price, safe totals/status, safe payment category, shipping tracking, receipt reference, and net customer-visible rewards.

They do not expose cost basis, profit, ROI, stock lots, private payment references, admin/link notes, ownership-review evidence, raw reward reasons, ledger metadata, internal customer IDs, auth/session records, or raw Prisma records. Database reads use explicit selects for customer account, POS sale, and online order fields.

Reward activity is ordered newest-first and clamped to 1-50 entries. It maps internal sources to `online`, `pos`, `adjustment`, or `other`; raw reasons, notes, idempotency keys, reversal IDs, metadata, and admin actors are not selected.

## Caching and delivery

- Account pages are dynamic, call `noStore()`, and receive `Cache-Control: private, no-store`, `Pragma: no-cache`, and `X-Robots-Tag: noindex, nofollow`.
- Account APIs and public order-status lookup responses use private/no-store JSON responses.
- The service worker never caches `/account` pages, account subpaths, App Router/RSC payloads, API requests, or any response marked `private` or `no-store`.
- No account data is included in public metadata, product feeds, schemas, or service-worker caches.

## Mutation rules

- Customer mutations require same-origin evidence.
- Address payloads use strict allowlisted schemas, bounded fields, and session-scoped IDs; unknown ownership, admin, verification, and reward fields are rejected.
- Session-management payloads reject client-supplied customer ownership fields and scope every operation to the authenticated account.
- Logout, password reset, and magic-link verification preserve session rotation, revocation, and one-time token behavior.
