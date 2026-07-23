# Poke Restock Radar

Private web app for tracking Pokemon TCG online restocks, local store patterns, releases, alerts, and manual card investment data.

This build intentionally does not automate carts, checkout, captcha, queues, account actions, proxy rotation, or private retailer access. Product actions open trusted retailer source URLs for manual checkout only.

## Standalone App Boundary

`poke-restock-radar` is a separate standalone project. It has its own `package.json`, Next.js routes, Prisma database schema, environment variables, authentication shell, UI, and deployment path.

It is not connected to Harbor Command and does not import or reuse Harbor Command auth, database tables, routes, styles, workspace logic, or tenant model.

## Local Setup

```bash
npm install
cp .env.example .env
npm run dev -- -p 3020
```

Default local-only seed login:

- Email: `admin@poke.local`
- Password: `radar-admin`

Set `AUTH_SECRET`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD_HASH` before any shared or deployed use.

## Phase 1 Scope

- Private login shell
- Dashboard
- Product watchlist
- Manual product status updates
- Alerts table
- Trusted-source Go / Buy Now actions
- Store tracker
- Manual sighting logs
- Release calendar
- Card investment tracker with manual data entry

## Phase 1.5 Polish

- Manual checkout safety language in the login screen, admin settings, and footer
- Edit and delete controls for products, stores, sightings, releases, and cards
- Confirmation dialogs before destructive deletes and demo resets
- Admin-only demo reset
- Admin-only JSON export/import backup
- Empty states, stronger validation, loading states, and API error toasts

## Retired Restock Monitor

The automated Restock Radar / product tracker subsystem has been retired. The Vercel schedule no longer calls `/api/radar/monitor/cron`, manual monitor/discovery endpoints are removed, and the private app no longer exposes retailer tracker navigation or monitor controls. General alert history and notification access remain available for release, inventory, order, storefront, system, and other non-restock alerts.

Dormant historical monitor, alert, and discovery tables remain in the database for non-destructive retention. Do not drop those tables without a separate migration and owner approval.

Preserved systems:

- storefront cart reservation expiration
- checkout, Stripe checkout/webhooks, and order processing
- product catalog, product inventory, POS, and Quick Stock
- release synchronization
- inventory market/comps synchronization
- rewards auditing
- product feed, sitemap, and public GameDayGrabs storefront
- private Poke Restock Radar admin host

## Email And SMS Alerts

SMTP email alerts are sent only when these env vars are set:

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`

Twilio SMS alerts are sent only when these env vars are set:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM_NUMBER`

Each user can configure in-app, email, SMS, quiet hours, and minimum priority from the app settings panel.

## Phase 3 Card Investment Engine

Phase 3 ranks Pokemon cards by manual raw-to-grade opportunity. It supports comp records for raw, PSA 9, PSA 10, BGS 9.5, BGS 10, and BGS Black Label sales, then recalculates market averages, estimated profits, max raw buy price, Buy / Watch / Avoid rating, and the weekly Top 10 Raw-to-Grade Watchlist.

Admin workflow for manual eBay sold comps:

1. Open the Cards tab.
2. Use Add Sold Comp.
3. Enter card name, set, card number, grade type, sale price, sale date, eBay sold listing URL, and condition notes.
4. Mark low pop, new release, strong character demand, or low-numbered / serialized only when you have a reason.
5. Save the comp. The card record, averages, profit estimates, and Top 10 score update automatically.

Use Investment Settings to adjust grading cost, eBay selling fee, shipping cost, and the minimum profit target. These settings are applied to existing cards when saved.

The poster/export view is printable HTML from the Top 10 panel. Use Print Poster to print or save as PDF from the browser print dialog.

### eBay Last-3 Comp Workflow

The app supports two comp modes:

- `API mode`: when eBay API credentials are configured, Refresh eBay Comps uses eBay completed/sold sales APIs to look up the last 3 matching sales per grade.
- `Manual comp mode`: when credentials are missing, the app clearly says Manual comp mode and you enter verified sold listing data yourself.

The app stores sale title, sale price, sale date, source URL, grade type, and match score. Averages and profit estimates use the last 3 sales per grade. If fewer than 3 raw, PSA 9, or PSA 10 comps exist, the UI shows low confidence. The app never invents sold prices, sold dates, or comp freshness.

Optional eBay API env vars:

- `EBAY_CLIENT_ID`
- `EBAY_CLIENT_SECRET`
- `EBAY_ENVIRONMENT` (`production` or `sandbox`)
- `EBAY_MARKETPLACE_ID` (`EBAY_US` by default)

Do not aggressively scrape eBay or pricing sites. Use API mode when configured, or assisted manual entry from completed/sold listing URLs.

## Phase 4 Release And Product Priority Logic

Phase 4 links products and cards to releases/sets so the dashboard can answer what to chase today and why. Products can be linked to a release, set name, product type, sealed resale notes, scarcity notes, and a manual Buy / Watch / Skip override.

The product priority engine calculates a 0-100 score from:

- Retail price: lower entry products score better.
- Public stock/restock status: in stock, add-to-cart, and preorder-live products score higher.
- Set demand and sealed product priority from the release calendar.
- Chase card strength from release notes and strong card demand flags.
- Number of profitable PSA 9 cards in the linked set.
- Best PSA 10 upside in the linked set.
- Sealed resale notes and scarcity notes.
- Manual Buy / Watch / Skip override.

The dashboard's Today's Chase List ranks products by this score and shows reason text such as: "High priority because Summer 2026 Sample Expansion has 2 profitable PSA 9 targets and product is in stock." Release countdown cards show preorder/release timing, product counts, profitable PSA 9 counts, and PSA 10 upside.

Alert rules added in this phase:

- Release date within 7 days.
- Preorder date is today or tomorrow.
- High-priority product is in stock, preorder live, or add-to-cart available.

### Release Calendar Auto-Sync

The Releases page is now a source-aware **Release Radar**. The built-in sync uses a source registry, source-specific parsers, duplicate merging, confidence labels, and per-source health logs. It checks the public Pokemon TCG API set list, official Pokemon expansion/news pages, Pokemon Center pages when exact dates are visible, a default ICv2 2026 Pokemon TCG product calendar as a secondary review-only source, and configured RSS/JSON product-drop feeds. Vercel Cron calls `/api/radar/releases/sync/cron` daily, protected by the shared `MONITOR_JOB_SECRET` / `CRON_SECRET` bearer setup used by preserved internal jobs.

Optional release-sync env vars:

- `POKEMON_TCG_API_KEY` - optional API key for higher Pokemon TCG API limits.
- `POKEMON_RELEASE_SOURCE_URLS` - comma-separated direct source pages to check, such as official Pokemon News articles, Pokemon Center product pages, or extra ICv2 calendar pages.
- `POKEMON_RELEASE_FEED_URLS` - comma-separated public RSS or JSON feeds for product-drop/news sources beyond core set releases.

Admin can also click **Sync Public Sources** on the Releases page. Auto-sync adds missing releases, updates known auto-synced release dates/links/images, records per-source sync logs, creates alerts for new/date-changed releases and failed/blocked sources, and sends secondary-only, conflicting, low-confidence, or date-missing entries to the review queue. Dates are not fabricated: unknown dates are shown as `TBD` until a source confirms them. Sources are marked `active`, `needs_review`, `blocked`, or `failed`; a run is not shown as clean if official sources fail or are blocked.

## Phase 5 Store Prediction And Field Mode

Phase 5 turns store sightings into a visit-history based prediction engine. Store sightings now include a result type:
`stock_seen`, `empty_shelf`, `vendor_spotted`, `bought_product`, or `no_visit`.

The prediction score uses:

- Store confidence score entered by Admin.
- Whether today is a configured restock day.
- Confirmed restock history from `stock_seen` and `bought_product` logs.
- Days since the last confirmed restock.
- Average interval between confirmed restock days.
- Most common restock weekdays and time windows.
- Overdue score based on days since last confirmed restock divided by average interval.
- Recent field signals, including empty shelf and vendor spotted logs.

Field Mode is a mobile-first tab for store hunting. It ranks saved stores by likely-today signal, confidence, and overdue score, then shows the likely window, products to look for, and quick buttons for Seen Stock, Empty Shelf, Vendor Spotted, Bought Product, No Visit, and Add Note. Logs are manual visit records only.

## Phase 6 PWA And Browser Push

Phase 6 makes the private radar installable on mobile with `public/manifest.webmanifest`, PNG app icons, an offline fallback page, and a service worker. The service worker caches the app shell, handles push events, and routes notification clicks back into the right app tab:

- Store prediction alerts open Field Mode.
- Release alerts open Release Calendar.
- Card opportunity alerts open Card Tracker.

Browser push requires HTTPS in deployment, except localhost during development. Generate VAPID keys with:

```bash
npx web-push generate-vapid-keys
```

Then set:

- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`

Each user can enable or disable browser push from Notification Settings. The Test Browser Push button sends through Web Push when VAPID and a subscription exist; otherwise it creates an in-app fallback and asks the browser to show a local test notification when permission is granted.

Browser push is alerts-only. It does not automate carts, checkout, payment, queues, captchas, accounts, or retailer limits. Go / Buy Now still opens trusted retailer source pages for manual checkout only.

## Phase 7 Production Deployment

Phase 7 adds Vercel deployment readiness:

- `vercel.json` no longer registers `/api/radar/monitor/cron`.
- The preserved cron jobs are storefront reservation expiration, release synchronization, inventory market synchronization, and rewards auditing.
- Preserved cron calls are protected by `MONITOR_JOB_SECRET`, with bearer-token compatibility for Vercel's `CRON_SECRET`.
- `/api/health` reports app, database, cron, alert, push, email, and SMS readiness without exposing secret values.
- Admin users see App Health inside the dashboard. Missing production env vars show an admin warning instead of crashing the public UI.

Vercel Cron notes:

- Vercel invokes cron jobs only on production deployments.
- Vercel sends cron requests as HTTP GET requests to the configured path.
- Vercel Cron schedules use UTC.
- Vercel can send `Authorization: Bearer $CRON_SECRET`. Set `CRON_SECRET` equal to `MONITOR_JOB_SECRET`.
- The only remaining 5-minute schedule is storefront reservation expiration.

### Required Production Env Vars

Core production env vars:

- `DATABASE_URL`
- `APP_URL`
- `AUTH_SECRET`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD_HASH`
- `ADMIN_INVITE_SECRET`
- `MONITOR_JOB_SECRET`
- `CRON_SECRET`

Browser push env vars:

- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`

Optional provider env vars:

- SMTP: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
- Twilio: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`
- eBay API comp refresh: `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `EBAY_ENVIRONMENT`, `EBAY_MARKETPLACE_ID`
- Store discovery: `GOOGLE_PLACES_API_KEY`

### Database Setup

Use managed Postgres for production. Do not deploy a `file:` SQLite database on Vercel; Vercel's filesystem is not durable for app data. The local SQLite setup is for development only, and the Admin Health panel will flag SQLite/file URLs as dev-only in production.

Production Prisma workflow:

```bash
npm run db:migrate:prod
npm run db:seed:prod
```

The tracked development schema is SQLite for local use. Production scripts run `npm run prisma:postgres`, which generates a temporary Postgres Prisma schema in `.prisma-postgres/schema.prisma`. The original Postgres cutover used `npm run db:push:prod`, but that command must not be run against an existing Production database. The current tracked migration history also lacks the original schema-creation migration, so a new persistent environment requires the reviewed baseline process in [Prisma Postgres Migration Baseline Repair](docs/prisma-migration-baseline-repair.md). Keep seed data limited to the first private admin account and trusted demo records.

### Deploy Steps

1. Create the Vercel project from the standalone `poke-restock-radar` folder.
2. Add all required env vars in Vercel Project Settings.
3. Use managed Postgres for `DATABASE_URL`.
4. Generate VAPID keys with `npx web-push generate-vapid-keys`.
5. Set `CRON_SECRET` and `MONITOR_JOB_SECRET` to the same random value.
6. Deploy production.
7. Run the reviewed migration deploy and intentional seed procedure against Production. Do not use `db:push:prod` on an existing database.
8. Sign in with the first admin login.
9. Open Admin Health and confirm database, cron secret, push, email, and SMS readiness.

First admin login is controlled by:

- `ADMIN_EMAIL`
- `ADMIN_PASSWORD_HASH`

Use `ADMIN_PASSWORD` only for local development. Shared or production deployments should use a bcrypt `ADMIN_PASSWORD_HASH`.

### Production Auth Checks

Auth uses a signed, http-only session cookie. In production the cookie is secure and uses the `__Host-poke_radar_session` name so it stays host-only and path-scoped to `/`.

Run the production auth smoke test after every auth/env change:

```bash
npm run auth:smoke
```

The smoke test verifies invalid login rejection, admin login, session persistence, dashboard access, logout, logged-out session state, and a mobile/PWA-style login user agent. It reads `AUTH_SMOKE_URL`, `AUTH_SMOKE_EMAIL`, and `AUTH_SMOKE_PASSWORD`, or the local `POKE_RESTOCK_RADAR_PRODUCTION_URL`, `POKE_RESTOCK_RADAR_ADMIN_EMAIL`, and `POKE_RESTOCK_RADAR_ADMIN_PASSWORD` values if present.

Password recovery:

- Admins can change the login email and password from `Settings -> Admin Account Settings` or the Admin drawer. Email changes update the `User` row in the database and refresh the session. Password changes require the current password, save only a bcrypt hash, invalidate existing sessions, and force a fresh login.
- `Forgot Password` creates a 30-minute secure reset token and emails a reset link when SMTP is configured.
- Resetting a password increments the user session version so older session cookies stop working.

Emergency admin reset:

```bash
npm run admin:reset
```

The reset command prompts for the admin login email and a new password, hashes the password locally with bcrypt, and updates or creates the Admin user in the configured database. It does not print or store the plain-text password. For production recovery, run it with `DATABASE_URL` pointed at the standalone `poke_restock_radar_prod` database only; do not reuse Harbor Command database URLs or environment variables.

Health endpoint:

```bash
curl "$APP_URL/api/health"
```

The endpoint returns `200` for OK/WARN and `503` for ERROR. Missing optional providers produce warnings; database failure or missing core env vars produce an error status.

## Phase 8 Real Data Setup

Phase 8 adds retailer templates, a 4-step product add wizard, bulk CSV/JSON import, a first setup checklist, and data quality warnings.

Retailer templates included:

- Pokemon Center
- Target
- Walmart
- Best Buy
- GameStop
- Amazon

Each historical retailer template stores the expected public URL pattern, common public stock words, safe public selectors/cues, useful identifier fields, default alert priority, and notes. The automated public-page monitor is retired; templates remain dormant historical configuration.

### Product Wizard

The product wizard steps are:

1. Retailer
2. Official product URL
3. Product details
4. Historical monitor and alert settings

Retailer URL validation is enforced when products are created or edited. Examples:

- Pokemon Center: `https://www.pokemoncenter.com/product/999-00001/pokemon-tcg-example-elite-trainer-box`
- Target: `https://www.target.com/p/pokemon-trading-card-game-example-booster-bundle/-/A-99900002`
- Walmart: `https://www.walmart.com/ip/Pokemon-TCG-Example-Collection-Box/99900003`
- GameStop: `https://www.gamestop.com/toys-games/trading-cards/products/pokemon-trading-card-game-example/999005`

Use exact product pages, not search or category links. The add wizard requires retailer, product URL, and product name, with expected title keywords, UPC, SKU, DPCI, TCIN/ASIN/item ID, retailer product ID, and product image URL available as matching fields. `Go / Buy Now` opens only a verified exact product URL, and checkout stays manual on the retailer site.

### Product Link Verification

Admin products include `Verify Exact Product`. The check safely fetches the public URL, follows normal redirects, and records final URL, public product title text, product image metadata, visible price cue, stock cue, identifier matches, and mismatch warnings. It answers: "Is this exact UPC/SKU/DPCI/TCIN/item-ID product available to buy right now?"

- `Verified Exact Product`
- `Search/Category Link`
- `Possible Mismatch`
- `Needs UPC/SKU`
- `Ready for Alert`

The verifier compares the final URL shape, expected title keywords, UPC, SKU, DPCI, Target TCIN, Walmart item ID, Best Buy SKU, GameStop SKU/product ID, Pokemon Center SKU/product ID, or Amazon ASIN. Search/category links are marked `Search/Category Link` with the warning `Search link only — replace with exact product URL.` A product cannot send high-priority Buy alerts or enable `Go / Buy Now` until it is a verified exact product. A possible mismatch warning means the saved link may redirect to an unrelated product or no longer prove the identifiers; in that case the verifier does not overwrite the product image. It never adds to cart, checks out, logs in, bypasses queues, or bypasses bot protection.

Target-specific setup:

- Prefer exact `target.com/p/.../-/A-TCIN` product pages over `/s` search pages.
- Store DPCI when available.
- Store TCIN in `retailerProductId` or SKU when available.
- Use the product page link, not the search results page.

### Bulk Product Import

CSV headers:

```csv
retailer,name,url,imageUrl,expectedTitleKeywords,setName,productType,sku,upc,dpci,retailerProductId,retailPrice,stockStatus,priority,rating,monitorEnabled,checkFrequencyMinutes,requiredWords,ignoreWords,releaseSetName,notes
Target,Pokemon TCG Booster Bundle,https://www.target.com/p/pokemon-trading-card-game-example-booster-bundle/-/A-99900002,https://example.com/exact-product-image.jpg,"Mega Evolution,Booster Bundle",Mega Evolution-Chaos Rising,Booster Bundle,TARGET-123,0820650990002,087-12-1234,99900002,26.99,UNAVAILABLE,HIGH,WATCH,true,60,"Pokemon,Booster","sponsored,marketplace",Mega Evolution-Chaos Rising,Manual checkout only
```

JSON format:

```json
[
  {
    "retailer": "Target",
    "name": "Pokemon TCG Booster Bundle",
    "url": "https://www.target.com/p/pokemon-trading-card-game-example-booster-bundle/-/A-99900002",
    "imageUrl": "https://example.com/exact-product-image.jpg",
    "expectedTitleKeywords": "Mega Evolution,Booster Bundle",
    "setName": "Mega Evolution-Chaos Rising",
    "productType": "Booster Bundle",
    "upc": "0820650990002",
    "dpci": "087-12-1234",
    "retailerProductId": "99900002",
    "retailPrice": 26.99,
    "stockStatus": "UNAVAILABLE",
    "priority": "HIGH",
    "rating": "WATCH",
    "monitorEnabled": true,
    "checkFrequencyMinutes": 60,
    "requiredWords": "Pokemon,Booster",
    "ignoreWords": "sponsored,marketplace",
    "releaseSetName": "Mega Evolution-Chaos Rising"
  }
]
```

### Bulk Store Import

CSV headers:

```csv
retailer,storeName,address,city,state,zip,latitude,longitude,phone,notes
Target,Target Midtown Miami,3401 N Miami Ave,Miami,FL,33127,25.8072,-80.1937,+13055551212,Manual visit log only
Walmart,Walmart Doral,8651 NW 13th Ter,Doral,FL,33126,25.7855,-80.337,+13055551213,Check card aisle and front collectibles shelf
```

JSON uses the same field names in an array or `{ "stores": [...] }`. Optional operational fields such as `zone`, `typicalRestockDays`, `typicalRestockTimeWindow`, `vendorNotes`, `confidenceScore`, and `place_id` are accepted. If restock days/window are missing, the import marks them `Unknown` so they can be tuned after visits.

### Store Discovery

The Stores tab includes a Store Coverage panel and a Find Nearby Stores flow. Enter a ZIP/city or use browser location, choose a 5, 10, 25, or 50 mile radius, select Target/Walmart/GameStop/Best Buy, then review candidate stores before adding them. Saved store dropdowns are searchable and sort favorites first, then closest stores when browser location is saved.

Store discovery uses safe public/manual sources only:

- Manual store entry
- CSV/JSON import
- Public Google Maps details pasted into notes
- Optional Google Places API when `GOOGLE_PLACES_API_KEY` is configured

When Google Places is configured, the server uses Google's Geocoding API and Places Nearby Search/Place Details endpoints to collect public name, address, latitude/longitude, phone when available, and `place_id`. Secrets are never exposed to the browser. If the key is missing, the UI stays in manual mode and shows "Add store manually or import CSV." Duplicate prevention checks retailer + address, Google `place_id` preserved in notes/vendor notes, and normalized store name + city. Google Places limits nearby radius to 50,000 meters, so a 50 mile search is best-effort and wider coverage should use import/manual entry.

### Zone And Field Mode Setup

Each user can set a default zone from Miami, Fort Lauderdale, Orlando, Tampa, Jacksonville, or Custom. Admin defaults to Miami. Users can also save browser location from the dashboard, Field Mode, or the Admin panel. When location is saved, dashboard store lists and Field Mode rank favorite stores first, then closest stores by miles. Without browser location, the app falls back to the selected zone. The `Hide non-zone stores` toggle keeps the list to the selected zone unless a store is favorited. Stores without latitude/longitude show a warning that address/coordinates are needed before distance sorting.

The Admin demo reset now seeds Miami and Fort Lauderdale examples instead of Orlando stores.

### Dashboard And Store UI

The dashboard is organized around the first question: what should I chase right now? The first viewport shows quick actions, location status, high-priority online drops, stores to check today, biggest card opportunities, and latest alerts. Production health, notifications, user management, backups, setup checklists, owner QA, and other admin-heavy cards live behind the `Admin` button so daily use does not require scrolling through setup data.

Store predictions use compact expandable rows with store name, city, confidence, next likely window, retailer, distance or zone, and a favorite toggle. Field Mode keeps product targets at the top and uses large one-tap buttons for I'm Here, Found Product, Seen Stock, Empty Shelf, Vendor Spotted, Bought Product, No Visit, and Add Note. Miami seed stores include Target Hialeah, Target Dadeland, Target Midtown Miami, Walmart Hialeah Gardens, Walmart Doral, Best Buy Dadeland, and GameStop Westland Mall Hialeah.

### Bulk Release Import

CSV headers:

```csv
setName,productType,officialReleaseDate,preorderDate,productTypes,pokemonCenterExclusiveVersion,chaseCards,demandRating,estimatedDemand,priority,sealedProductPriority,productLinks,notes
Mega Evolution-Chaos Rising,Build & Battle Box,2026-05-22,2026-05-08,"Build & Battle Box, Booster Bundle, ETB",true,Verify final chase card list,HIGH,HIGH,HIGH,HIGH,https://www.pokemon.com/uk/pokemon-news/get-a-pokemon-tcg-mega-evolution-chaos-rising-build-battle-box-early,Verify dates by region
```

JSON uses the same field names in an array or `{ "releases": [...] }`.

Real release seed examples currently include public Pokemon.com examples for `Mega Evolution-Chaos Rising` and `Mega Evolution-Ascended Heroes`. Treat them as starter calendar examples and verify region/product timing before using them for buying decisions.

### Data Quality Warnings

The dashboard flags:

- Missing product URL
- Missing SKU/UPC/DPCI/retailer product ID
- Possible product URL mismatch
- Missing release/set link
- No alert channel enabled
- Monitored product not checked in 24 hours

## Phase 9 Standalone Deployment Operations

Phase 9 adds standalone repository and production operations tooling for this app only.

Operational commands:

```bash
npm run prisma:postgres
npm run secrets:generate
npm run vapid:generate -- --subject=mailto:you@example.com
npm run backup:json
npm run restore:json -- backups/poke-restock-radar-example.json --yes
npm run backup:postgres
npm run restore:postgres -- backups/poke-restock-radar-example.dump --yes
```

The JSON backup/restore uses the app's Prisma service. The Postgres backup/restore uses `pg_dump` and `pg_restore` against `POSTGRES_BACKUP_URL`, `DATABASE_URL_UNPOOLED`, or another unpooled Postgres URL.

Deployment separation:

- Vercel project must be `poke-restock-radar`.
- Neon production database must be `poke_restock_radar_prod`.
- Do not deploy into the Harbor Command Vercel project.
- Do not use the Harbor Command database.
- Do not reuse Harbor Command env vars, auth, routes, tables, cron jobs, or deployment settings.

Use [docs/production-deployment-checklist.md](docs/production-deployment-checklist.md) for the full Vercel + Neon deployment checklist.

## Phase 13 Weekly Comp Workflow

Use the Card Investment Tracker as a weekly assisted workflow. Enter comps manually from public sold listings or trusted pricing references; do not aggressively scrape eBay or any pricing site.

Recommended weekly flow:

1. Add fresh raw comps, then PSA 9, PSA 10, BGS 9.5, BGS 10, and BGS Black Label comps with the quick grade buttons.
2. Set source quality for each comp: `eBay sold`, `PriceCharting`, `TCGPlayer`, or `manual estimate`.
3. Add condition notes when a raw listing has whitening, centering issues, dents, print lines, or unusually clean photos.
4. Review the card confidence score. It increases with more comps, fresher comps, higher-quality sources, and a realistic spread between raw and graded values.
5. Click `Generate Weekly Report Now` to archive a report with Top 10 raw-to-grade, safest PSA 9 flips, highest PSA 10 upside, Beckett candidates, and avoid/overpriced cards.
6. Use `Print Report` on the generated poster for a mobile/printable snapshot.

The app creates an in-app alert when a new comp makes a card PSA 9 profitable against the current grading, shipping, selling-fee, and minimum-profit settings.

## eBay API Setup

Card Opportunities can run in either manual comp mode or live eBay last-3-completed-sales mode. The app never exposes secret values in the UI; Admin only sees configured/missing status and masked identifiers.

Add these variables to the separate `poke-restock-radar` Vercel project:

```bash
vercel env add EBAY_CLIENT_ID production
vercel env add EBAY_CLIENT_SECRET production
vercel env add EBAY_ENVIRONMENT production
vercel env add EBAY_MARKETPLACE_ID production
```

Recommended values:

- `EBAY_ENVIRONMENT=production` for live use, or `sandbox` for eBay sandbox testing.
- `EBAY_MARKETPLACE_ID=EBAY_US` for United States sold comps.

After setting the variables, redeploy the app and open `Cards -> eBay API Status`. Click `Test eBay Connection`; a successful test only confirms OAuth/API access, not that every card search is trustworthy.

Comp QA workflow:

1. For each card, set include/exclude words and keep `Require exact set name` plus `Require card number` enabled unless there is a real reason not to.
2. Click `Refresh eBay Comps` on a card, or `Refresh All Cards` as Admin.
3. The app only imports completed/sold results from eBay Marketplace Insights.
4. It rejects lots, proxies, digital/code listings, jumbo/oversized cards, non-English listings unless allowed, wrong set names, wrong card numbers, wrong grades, and weak title matches.
5. Review the exact three accepted sold comps per grade. Use `Reject this comp` to remove a bad match from averages, or `Accept this comp` to restore it.

If eBay credentials are not configured, the app clearly shows `Manual comp mode` and no API pricing is invented.

## Phase 14 Friend Access

Access is invite-only. There is no public signup route. Admins create single-use friend invite links from `User Management`; invite links expire after 7 days and the friend creates their own password from the invite screen.

Friend permissions are enforced server-side:

- `canAddSightings`: add and edit store sightings
- `canAddComps`: add manual card comps
- `canRunChecks`: legacy permission retained for historical records; monitor/check routes are retired
- `canReceivePushAlerts`: create browser push subscriptions

Audit logs are stored for invite creation/acceptance/revocation, login attempts, sightings, card comps, historical monitor checks, and access changes. Admins can disable a friend account without deleting historical sightings or comps.

## Phase 15 Daily Workflow

The dashboard includes `Today's Plan` for the morning flow:

- Storefront and inventory items needing operational attention
- Local stores to check today
- Latest alerts
- Newest releases
- Best card opportunities

Use Inventory and Orders for the daily operating workflow, and `I Bought This` where legacy product records still support manual purchase logging. The retired restock-monitor route no longer exposes product check actions. The inventory log stores product/card purchased, cost, quantity, source, purchase date, and the expected resale or grading plan.

Saved filter presets are personal notes for recurring product/store/card views. `Generate Recap` archives a daily recap with product checks, store visits, purchases, and alerts created that day.

## Phase 16 Alert Intelligence

Alerts now carry a 0-100 score, dedupe key, cooldown window, and `Why did I get this alert?` explanation. Duplicate/cooldown suppression creates read-only suppressed history rows so Admin can see what was filtered out.

Noise controls live in notification settings:

- Alert digest mode keeps non-high alerts in-app and suppresses external channels.
- Urgent-only mode suppresses anything below `HIGH`.
- High-priority override can bypass quiet hours for urgent alerts.
- Watch-only retailer/product filters restrict alerts to terms you care about.
- Per-user cooldown minutes suppress repeated product alerts.

Use `npm run alert:smoke` with production credentials to verify login, in-app alert creation, route test alerts, and the alerts endpoint.

Admin notification diagnostics include a `Notification Delivery Log` under Notification Settings. It records recent alert-created, push/email/SMS sent, skipped, failed, cooldown, quiet-hours, digest, watch-filter, and provider-missing outcomes without exposing provider secrets. Use it after Live Drop tests to confirm whether an alert was created, attempted, delivered, or intentionally skipped.

## Phase 17 Owner Guide

Daily owner workflow:

1. Sign in with the private Admin account.
2. Review `Today's Plan` for online products, local stores, newest releases, latest alerts, and card opportunities.
3. Use `Go / Buy Now` only to open the trusted retailer source page and complete checkout manually.
4. Use `Field Mode` while store hunting, then log `Seen Stock`, `Empty Shelf`, `Vendor Spotted`, `Bought Product`, or notes.
5. Enter card comps manually, then generate the weekly investment report when the comp set looks current.
6. Check `App Health` and the `System Status Checklist` after deploys, cron changes, or notification changes.
7. Export a JSON backup before any destructive data reset or restore.

Friend invite flow:

1. Admin opens `User Management`.
2. Create an invite for the friend's email and choose permissions.
3. Share the single-use invite link.
4. Friend opens the link, confirms the invited email, and creates a password.
5. Admin can revoke unused invites or disable friend access later.

Production QA commands:

```bash
npm run build
npm run check
npm run lint
npm test
npm audit --omit=dev
npm run auth:smoke
npm run alert:smoke
npm run smoke:prod
```

`npm run smoke:prod` checks the production shell, mobile/PWA shell, `/api/health`, login/logout/session persistence, main authenticated API routes, admin route protection, cron protection, PWA manifest, service worker push handlers, backup export shape, a non-destructive restore dry run, invite create/revoke, and in-app notification routing.

## Known Limitations

- eBay sold comps require eBay developer credentials for live last-3-completed-sales refreshes; without credentials the app stays in manual comp mode. The app does not aggressively scrape eBay or other pricing sites.
- The automated retailer monitor is retired. Checkout automation remains absent; no app path adds to cart, bypasses queues, or purchases from retailer sites.
- Browser push requires a supported browser, permission approval, a saved subscription, and valid VAPID environment variables.
- Email and SMS alerts are inactive until SMTP and Twilio environment variables are configured.
- JSON restore is destructive by design. Production smoke validates backup shape only and does not import data.
- Store predictions are based on logged sightings and visits, so confidence is low until enough local history exists.
- The app is standalone and not connected to Harbor Command; it must stay on its own Vercel project and Neon database.

## Phase 18 Owner Launch And Alert Calibration

The launch dashboard is meant for the first real week of use. Admins should use `Owner Launch Checklist` to confirm:

- Real products are loaded.
- Local store routes are ready for Field Mode.
- Release and card context exists for priority scoring.
- Preserved Vercel cron jobs have run recently.
- Browser push is enabled on the phone.
- SMTP or Twilio is configured if you want a backup channel.
- Friend access has been tested.
- Daily recaps, inventory logging, and backup routines are part of the launch rhythm.

Use the owner launch checklist every morning during launch. Historical alert calibration records remain visible for audit context, but the automated restock monitor no longer creates new calibration items.

Weekly owner rhythm:

```bash
npm run backup:json
npm run backup:postgres
npm run smoke:prod
```

Keep the first week conservative: confirm operational workflows manually and only turn on optional SMS/email after owner approval.

## Inventory Tracker And Market Recommendation

Use the `Inventory` tab to track what you actually bought: sealed packs, sleeved boosters, ETBs, booster bundles, booster boxes, collection boxes, single cards, graded cards, and raw cards.

Each inventory item stores the product/card name, category, set, quantity, purchase price, total cost, purchase date, source/store, retailer, exact product URL, UPC/SKU/DPCI/ASIN when available, image, receipt image, receipt number, order number, transaction ID, payment method, condition, sealed/opened/graded/raw status, sell targets, listing status, sold price, notes, market estimate, profit, ROI, and recommendation.

Market Recommendation behavior:

- `SELL NOW`: market profit and ROI clear the target.
- `LIST HIGH`: profit clears the target but margin is less urgent.
- `GRADE FIRST`: linked card data shows raw-to-grade upside.
- `HOLD`: market is not strong enough yet, or market data is missing.
- `RIP / OPEN`: sealed packs or bundles are materially underwater.
- `AVOID BUYING MORE`: current comps show weak resale economics.

Market data is conservative. The `Market` tab uses TCGCSV as the primary automatic provider and caches Pokemon products/prices server-side before matching inventory. TCGCSV values are labeled as `TCGCSV Market Estimate` or `TCGplayer-derived market estimate`; they are not sold comps. If no cached provider match or price exists, the app shows `Market not collected yet` instead of inventing values. Manual comps remain an admin fallback only and are hidden from the main Market workflow.

Inventory market provider env vars:

- `TCGCSV_ENABLED=true`
- `TCGCSV_BASE_URL=https://tcgcsv.com/tcgplayer`
- `TCGCSV_SYNC_FREQUENCY=daily`
- `PRICECHARTING_API_TOKEN`
- `TCGPLAYER_PUBLIC_KEY`
- `TCGPLAYER_PRIVATE_KEY`
- `TCGPLAYER_ACCESS_TOKEN`
- `EBAY_CLIENT_ID`
- `EBAY_CLIENT_SECRET`
- `EBAY_ENVIRONMENT`
- `EBAY_MARKETPLACE_ID`

Market auto-sync:

- `Sync TCGCSV Now` pulls Pokemon groups, products, and prices into the local database.
- `Refresh Market for Item` matches one inventory item against cached TCGCSV data.
- `Refresh All Missing` processes inventory with no market estimate first.
- `Refresh All Inventory` reruns cached TCGCSV matching across inventory.
- Vercel Cron calls `/api/radar/inventory/market-sync/cron` daily, syncs TCGCSV when enabled, then refreshes stale/missing inventory estimates.
- Provider keys and sync requests stay server-side; Admin only sees configured/missing status and aggregate cache counts.

Market sync:

- Scanned or manually entered UPC/SKU/DPCI/ASIN values are matched against watched products.
- When a watched product matches, inventory pulls the verified product image, retailer, set, exact product URL, UPC/SKU/DPCI, and Amazon ASIN when applicable.
- Cost basis uses remaining stock lots first, then falls back to average cost if older data has no lots.
- Market value prefers the cached TCGCSV market price, then mid price, then low price. The app applies configured fee and shipping assumptions before calculating profit/loss and ROI.

Image behavior:

- Paste a verified product image URL or upload your own item photo.
- Inventory thumbnails stay inside fixed image frames.
- If no image exists, the row falls back to a clean retailer/category mark.

Import/export:

- `Inventory -> Catalog CSV` exports the current product catalog.
- `Inventory -> Lots CSV` exports purchase lots and remaining quantity.
- `Inventory -> Sales CSV` exports recorded sales and realized profit/loss.
- `Inventory -> P/L CSV` exports profit/loss summary, market value, fees, shipping, ROI, confidence, and refresh timestamps.
- `Inventory Import And Manual Comps` accepts CSV or JSON.
- JSON backup/restore includes inventory items, stock lots, sales, inventory market comps, and barcode scan history.

Barcode / UPC scanning:

- Use `Scan UPC / Barcode` from Inventory quick actions or inside Add Purchase.
- Camera access starts only after tapping `Start Camera` inside the scanner modal; no image or video is saved.
- The camera scanner uses `@zxing/browser` by default for UPC-A, UPC-E, EAN-13, EAN-8, and CODE-128 decoding.
- Manual UPC entry and `Lookup UPC` work on desktop and as a fallback when camera scanning is unavailable.
- You can also upload a barcode image for local decoding; the app stores only the decoded UPC.
- UPC lookup checks existing inventory first, watched products second, a configured UPC provider third, the public UPCItemDB trial API fourth, and an optional configured product search provider last.
- If the UPC already exists in inventory, the app opens Add Stock for that catalog item instead of creating a duplicate.
- Successful UPC lookup fills empty add-product fields only: UPC, title, brand, category, description, image URL, MSRP, model/SKU, manufacturer, retailer, and product URL when the provider returns them.
- Optional external lookup env vars: `UPC_LOOKUP_API_URL` with `{upc}` and `{apiKey}` placeholder support, and `UPC_LOOKUP_API_KEY` for bearer or `x-api-key` auth when your chosen public lookup provider requires it.
- Broad Pokemon UPC coverage uses the configurable product-search fallback after UPC-only providers miss. Built-in providers are `serpapi` and `custom`.
- SerpApi setup: set `PRODUCT_SEARCH_PROVIDER=serpapi`, `PRODUCT_SEARCH_API_URL=https://serpapi.com/search.json`, and `PRODUCT_SEARCH_API_KEY=<your server-side key>`. The app calls Google Shopping with the exact UPC query and normalizes retailer candidates from Target, Walmart, GameStop, Best Buy, Pokemon Center, Amazon, TCGplayer, and other product pages.
- Custom setup: set `PRODUCT_SEARCH_PROVIDER=custom`, `PRODUCT_SEARCH_API_URL` to your JSON product search endpoint, and `PRODUCT_SEARCH_API_KEY` if required. The URL can use `{upc}`, `{query}`, `{apiKey}`, or `{api_key}` placeholders; otherwise the server adds `q=<upc>`.
- Product search returns a confidence score. High confidence is auto-filled as `Found from Target` / `Found from product search`; medium or low confidence is shown as `Possible match - review before saving.`
- Newer Pokemon UPCs can be missing from UPC-only providers. If `PRODUCT_SEARCH_PROVIDER`, `PRODUCT_SEARCH_API_URL`, or `PRODUCT_SEARCH_API_KEY` are not configured, the app shows: `Search fallback is not configured. Set PRODUCT_SEARCH_PROVIDER, PRODUCT_SEARCH_API_URL, and PRODUCT_SEARCH_API_KEY so UPC provider misses can fall through to product search.`
- Failed UPC lookups expose safe Admin diagnostics with attempted sources, provider status codes, missing-env reasons, and whether search fallback is configured. The diagnostics never expose API keys.

## Inventory Spending And Sales Tracker

The Inventory tab is also the business tracker for spend, sales, and profit/loss.

Top cards:

- `Total Spent`: all purchase cost, including tax/shipping entered on purchases.
- `Current Inventory Value`: current market estimate multiplied by quantity still owned.
- `Total Sales`: gross sales recorded from inventory rows.
- `Net Profit / Loss`: net sale proceeds plus current inventory value minus total spend.

Use `Add Purchase` as a four-step flow:

1. What did you buy?
2. What did it cost?
3. Add proof/image.
4. Plan.

Advanced identifiers, exact product URLs, UPC/SKU/DPCI/ASIN, manual market estimate, and notes are hidden under `Advanced details`.

Receipt and order tracking:

- Step 3 accepts an item image, receipt image, receipt number, order number, transaction ID, and optional payment method.
- Purchase lots keep receipt/order proof independently, so restocks bought on different dates keep their own cost basis and proof.
- Inventory filters include missing receipt, missing market data, profitable, losing money, and scanned UPC items.

Use `Record Sale` on an inventory row for partial or full sales. The app calculates gross sale, net sale, cost basis, profit/loss, and ROI from quantity sold, sold price, fees, shipping, and original average cost.

Use the `Spending` view for purchases by date and the `Sales` view for sales by date and profit by platform. CSV exports are available from each view.

## Public Storefront And Stripe Checkout

The private Poke Radar app remains the back-office. Public customers only see listings that are explicitly published to `/shop`.

Public routes:

- `/shop`: public storefront grid for active published inventory.
- `/shop/product/[slug]`: customer-facing product detail page.
- `/cart`: local browser cart with stock checks before checkout.
- `/checkout/success` and `/checkout/cancel`: Stripe return pages.

Publishing inventory:

- Open Inventory, choose an item, then use `Listing`.
- Set `Publish to public store`, public title, public description, public price, quantity available, category, tags, image, and `Active` status.
- Draft, hidden, unpublished, missing-price, and unavailable listings do not appear publicly.
- Public shop data never includes cost basis, supplier/source, stock lots, receipts, admin notes, restock scanner data, UPC scan history, or profit calculations.

Stripe setup:

- `STRIPE_SECRET_KEY`: server-side Stripe key used to create Checkout Sessions.
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`: reserved for future embedded Stripe UI; Stripe-hosted Checkout does not expose the secret key.
- `STRIPE_WEBHOOK_SECRET`: required for signed webhook verification.
- `STORE_BASE_URL`: production storefront base URL, for example `https://poke-restock-radar.vercel.app`.

Checkout behavior:

- The cart validates product status, quantity, max quantity per order, and public price before creating checkout.
- Checkout creates a pending order and 15-minute stock reservations before redirecting to Stripe.
- Inventory is not deducted from the success redirect page.
- The Stripe webhook is the source of truth: after `checkout.session.completed`, the app marks the order paid, completes reservations, creates inventory sale records, reduces stock lots, and calculates order cost/profit.
- Failed or expired payment releases reservations.
- `/api/storefront/webhook/stripe` rejects invalid or missing Stripe signatures.

Order admin:

- Use the `Orders` tab to view order status, payment status, fulfillment status, items, totals, cost basis, estimated Stripe fees, shipping cost, net profit, ROI, notes, and tracking.
- Admin can mark orders packing/shipped, add tracking, add actual shipping cost, cancel/refund manually as needed, and print a packing slip.
- Phase 1 shipping supports flat-rate shipping and local pickup settings. `SHIPPO_API_KEY` is documented as a future placeholder only.

## Later Phases

The database schema already includes restock history, card comp sales, investment settings, release links, priority score records, and notification settings so later features can be added without reshaping the app.
