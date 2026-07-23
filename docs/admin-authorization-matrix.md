# Admin authorization matrix

This matrix covers every state-changing route under `/api/radar` (86 route modules at this revision), plus admin credential mutations. Authentication is resolved from signed server cookies. Browser payloads never establish role, ownership, prices, totals, reward points, eligibility, or target identity.

All cookie-authenticated `/api/radar` `POST`, `PUT`, `PATCH`, and `DELETE` requests pass through `src/proxy.ts`, which rejects missing or invalid browser origin evidence. High-risk financial, credential, inventory, customer, and order routes also call `authorizeAdminMutation` inside the route after authentication. The only proxy exceptions are the separately signed job routes listed below.

| Route group | Methods | Mutation | Server access guard | Same-origin / caller proof | Audit | Idempotency / duplicate safety |
| --- | --- | --- | --- | --- | --- | --- |
| `/api/auth/admin/account` | PATCH | Admin identity | Authenticated Admin | Route guard | Credential audit | Session version rotation |
| `/api/auth/admin/password` | POST | Admin credential | Authenticated Admin | Route guard | Credential audit | Current password + session rotation |
| `/api/radar/admin/reset` | POST | Destructive demo reset | Admin | Proxy + route guard | Reset audit | Explicit UI confirmation |
| `/api/radar/alerts` | PATCH, DELETE | Read/archive alert state | Admin | Proxy | Action-specific | Target IDs reloaded |
| `/api/radar/area-preferences` | PATCH, POST | Current-user area/store preferences | Authenticated user | Proxy | User-scoped | Current session user only |
| `/api/radar/backup` | POST | Operational backup import | Admin | Proxy + route guard | Import audit | Explicit confirmation; 5 MB and row limits |
| `/api/radar/cards` and `/api/radar/cards/[cardId]` | POST, PATCH, DELETE | Card create/update/delete | Admin | Proxy | Action-specific | Strict allowlisted schemas |
| `/api/radar/cards/[cardId]/refresh-comps`, `/api/radar/cards/comps`, `/api/radar/cards/comps/[compId]/review` | POST | Comp refresh/create/review | Named permission or Admin | Proxy | Action-specific | Server target lookup |
| `/api/radar/cards/refresh-comps`, `/api/radar/cards/reports` | POST | Bulk comp refresh/report | Admin | Proxy | Action-specific | Bounded server work |
| `/api/radar/customers/[customerAccountId]` | PATCH | Customer profile | Admin | Proxy + route guard | Profile audit | Strict DTO fields |
| `/api/radar/customers/[customerAccountId]/attach-order` | POST | Link purchase / reward preview or apply | Admin | Proxy + route guard | Link/reward audit | Transaction + stable reward keys |
| `/api/radar/daily-recaps` | POST | Generate recap | Authenticated user | Proxy | User-scoped | Current session user only |
| `/api/radar/ebay/test` | POST | Provider test | Admin | Proxy | Diagnostic only | No secret response |
| `/api/radar/filter-presets` and `/api/radar/filter-presets/[presetId]` | POST, DELETE | Saved filters | Authenticated user | Proxy | User-scoped | Owner-scoped target |
| `/api/radar/investment-settings` | PATCH | Valuation settings | Admin | Proxy | Settings update | Validated numeric ranges |
| `/api/radar/inventory` and `/api/radar/inventory/[itemId]` | POST, PATCH, DELETE | Inventory create/update/delete | Admin | Proxy + route guard | Inventory audit | Strict fields; server target lookup |
| `/api/radar/inventory/[itemId]/sales` and `/api/radar/inventory/[itemId]/sales/[saleId]` | POST, PATCH | Sale create/update | Admin | Proxy + route guard | Sale audit | Server totals; stable sale identity |
| `/api/radar/inventory/[itemId]/stock-lots/[lotId]` | PATCH, DELETE | Lot adjustment/delete | Admin | Proxy + route guard | Stock audit | Server item/lot ownership check |
| `/api/radar/inventory/[itemId]/store-listing`, `/api/radar/inventory/store-listing/bulk` | PATCH, POST | Listing update/publish | Admin | Proxy + route guard | Listing audit | Allowlisted fields; bounded IDs |
| `/api/radar/inventory/[itemId]/images`, `/api/radar/inventory/[itemId]/images/[imageId]` | POST, PATCH, DELETE | Attach/update/remove product image | Admin | Proxy | Image audit | Item/image relationship reloaded |
| `/api/radar/inventory/images/upload` | POST | Blob image upload | Admin | Proxy | Storage result | JPG/PNG/WebP; 10 MB; server-owned path |
| `/api/radar/inventory/images/resolve-url` | POST | Resolve image URL | Admin | Proxy | Diagnostic | Validated public image URL |
| `/api/radar/inventory/comps`, `/api/radar/inventory/comps/import`, `/api/radar/inventory/**/refresh-comps` | POST | Market comp create/import/refresh | Admin | Proxy + route guard where financial | Comp audit | Bounded rows; server item lookup |
| `/api/radar/inventory/import` | POST | Inventory import | Admin | Proxy + route guard | Import summary | Validated bounded rows |
| `/api/radar/inventory/tcgcsv/sync`, `/api/radar/inventory/tcgcsv/matches/[itemId]` | POST, PATCH | Catalog sync/match | Admin | Proxy + route guard | Sync summary | Server item/provider IDs |
| `/api/radar/inventory/upc/lookup` | POST | UPC lookup bookkeeping | Authenticated user | Proxy | Scan audit | Bounded UPC/provider request |
| `/api/radar/invites` and `/api/radar/invites/[inviteId]` | POST, DELETE | Invite/revoke user | Admin | Proxy + route guard | Invite audit | Hashed token; target reloaded |
| `/api/radar/notifications` | PATCH | Current-user notification settings | Authenticated user | Proxy | User-scoped | Current session user only |
| `/api/radar/notifications/test`, `/api/radar/notifications/test-all`, `/api/radar/push/test` | POST | Notification diagnostics | Route policy / Admin for bulk | Proxy | Delivery log | No secret response |
| `/api/radar/push/subscription` | POST, DELETE | Browser subscription | Authenticated user | Proxy | User-scoped | Current session user only |
| `/api/radar/pos/customer-match` | POST | Customer discovery only | Admin | Proxy | No link/reward mutation | Masked DTO; strict bounded input |
| `/api/radar/pos/sales` | POST | POS sale | Admin | Proxy + route guard | Sale/reward audit | Server totals + idempotency key |
| `/api/radar/pos/sales/[saleReference]/refund` | POST | POS refund | Admin | Proxy + route guard | Refund/reward audit | Stable refund idempotency key |
| `/api/radar/products` and `/api/radar/products/[productId]` | POST, PATCH, DELETE | Product create/update/delete | Admin | Proxy | Action-specific | Strict fields; server target lookup |
| `/api/radar/products/[productId]/{archive,verify}` | POST | Product lifecycle | Admin | Proxy | Action-specific | Server target lookup |
| `/api/radar/products/[productId]/bought` | POST | Purchase/inventory creation | Admin | Proxy + route guard | Inventory audit | Server price/target handling |
| `/api/radar/products/import`, `/api/radar/products/seed-*` | POST | Product bulk import/seed | Admin | Proxy | Import summary | Validated source data |
| `/api/radar/releases` and `/api/radar/releases/[releaseId]` | POST, PATCH, DELETE | Release create/update/delete | Admin | Proxy | Action-specific | Strict fields; server target lookup |
| `/api/radar/releases/import`, `/api/radar/releases/sync` | POST | Release import/sync | Admin | Proxy | Sync summary | Trusted source parsers |
| `/api/radar/rewards/adjustments` | POST | Add/deduct points | Admin + feature flag | Proxy + route guard | Ledger audit | Stable idempotency key; server points |
| `/api/radar/shipping-profiles` and `/api/radar/shipping-profiles/[profileId]` | POST, PATCH | Shipping profile create/update | Admin | Proxy | Shipping audit | Strict numeric ranges; no provider secrets |
| `/api/radar/sightings` and `/api/radar/sightings/[sightingId]` | POST, PATCH, DELETE | Store sighting create/update/delete | `canAddSightings` or Admin | Proxy | User/action scoped | Server target lookup |
| `/api/radar/storefront/orders/[orderId]` | PATCH | Fulfillment update | Admin | Proxy + route guard | Order audit | Strict status fields |
| `/api/radar/storefront/orders/[orderId]/cancel-refund` | POST | Cancel/refund | Admin | Proxy + route guard | Refund/order/reward audit | Stable idempotency key; server amount |
| `/api/radar/storefront/settings` | PATCH | Storefront settings | Admin | Proxy + route guard | Settings audit | Strict allowlist; no secrets returned |
| `/api/radar/stores` and `/api/radar/stores/[storeId]` | POST, PATCH, DELETE | Store create/update/delete | Admin | Proxy | Action-specific | Strict fields; server target lookup |
| `/api/radar/stores/discovery` | POST | Read external store discovery | Authenticated user | Proxy | Diagnostic | Bounded retailer/location input |
| `/api/radar/stores/discovery/add`, `/api/radar/stores/import` | POST | Store add/import | Admin | Proxy | Import audit | Bounded strict candidates |
| `/api/radar/users/[userId]` | PATCH | User access/disable | Admin | Proxy + route guard | Access audit | Server target; last-admin protection |

## Explicit non-browser exceptions

| Route | Methods | Caller proof | Failure behavior |
| --- | --- | --- | --- |
| `/api/radar/storefront/reservations/expire` | GET, POST | `MONITOR_JOB_SECRET` or `CRON_SECRET` bearer/header | Missing, empty, or invalid secret returns 401 |
| `/api/radar/inventory/market-sync/cron` | GET | `MONITOR_JOB_SECRET` or `CRON_SECRET` bearer/header | Missing, empty, or invalid secret returns 401 |
| `/api/radar/releases/sync/cron` | GET | `MONITOR_JOB_SECRET` or `CRON_SECRET` bearer/header | Missing, empty, or invalid secret returns 401 |
| `/api/storefront/stripe/webhook`, `/api/storefront/webhook/stripe` | POST | Stripe signature verified against webhook secret | Missing or invalid signature fails before mutation |

These routes never fall back to cookie admin authorization and never treat a missing `Origin` as authorization.

## GET/read invariants

- Dashboard, inventory, customer/reward, settings, release, report, and admin-summary GET paths are read-only.
- `listDashboard` uses reads and in-memory defaults/derived scores only. It does not create tables, initialize settings, backfill inventory, refresh alerts, or persist priority scores.
- One-time authentication callbacks may consume their own token as part of the authentication protocol; signed cron GETs are the documented server-job exception.
- Maintenance/backfill behavior must use an explicit protected mutation or a committed migration, never a page-load GET.

## Response and data invariants

- Public and customer routes do not reuse raw admin Prisma records.
- Customer search and POS matching return masked DTOs and never establish ownership by name or phone.
- Backup export omits users, password hashes, invite/reset tokens, push credentials, notification contacts, and audit metadata. Import preserves authentication/security records.
- Blob deletion is attempted only for an uploaded image whose HTTPS Vercel Blob path is owned by the current admin namespace; removing a product reference does not authorize arbitrary URL deletion.
- Product discovery test URLs must use HTTPS on the exact retailer host or a true subdomain.
- Redemption remains disabled independently of these authorization controls.
