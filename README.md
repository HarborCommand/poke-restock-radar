# Poke Restock Radar

Private web app for tracking Pokemon TCG online restocks, local store patterns, releases, alerts, and manual card investment data.

This build intentionally does not automate carts, checkout, captcha, queues, account actions, proxy rotation, or private retailer access. Product actions open the official retailer URL for manual checkout only.

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
- Official-page Go / Buy Now actions
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

## Phase 2 Monitoring

Phase 2 adds safe public-page product monitoring. Checks are sequential and rate-limited, store monitor logs, create restock history on detected changes, and can trigger in-app, SMTP email, or Twilio SMS alerts.

The monitor only fetches public product pages. It does not perform cart, payment, account, queue, captcha, purchase-limit, or retailer-private actions.

Run due checks locally:

```bash
npm run monitor
```

Run checks from the app:

- Admin product action: `Run Check Now`
- Admin products action: `Run Due Checks`
- Admin products action: `Run All Checks`

Cron/serverless monitor endpoint:

```bash
curl -X POST "$APP_URL/api/radar/monitor/cron" \
  -H "Content-Type: application/json" \
  -H "x-monitor-secret: $MONITOR_JOB_SECRET" \
  -d '{"mode":"due"}'
```

Use `{"mode":"all"}` only for deliberate admin-triggered sweeps.

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

Monitor tuning:

- `MONITOR_JOB_SECRET` protects the cron endpoint.
- `MONITOR_REQUEST_DELAY_MS` controls delay between product checks. The app enforces a minimum delay of 500 ms.
- Retailer templates include public status words for in stock, sold out, preorder, unavailable, blocked pages, captcha/robot pages, price changes, and page changes.
- Product-level `Required words` make the monitor prove it is looking at the right product before trusting a positive signal.
- Product-level `Ignore words` suppress ambiguous matches such as sponsored results, marketplace modules, unrelated sets, or page furniture.
- Low-confidence high-priority changes are held as pending and must appear in two matching checks before an alert is sent.
- Blocked, captcha, robot, and rate-limit pages are logged as blocked monitor results and never send restock alerts.
- Use `Pause Monitor` for noisy products, `Resume Monitor` after tuning, `Force Alert` only for an intentional manual admin notification, and `Mark False Positive` to improve accuracy stats.

Each user can configure in-app, email, SMS, quiet hours, and minimum priority from the app settings panel.

### Tuning Retailer Detection

Start with exact product URLs whenever possible. Search pages work for setup, but exact product pages give cleaner detected words, prices, and final URLs. After a noisy check, open the monitor result details and review HTTP status, final URL, response time, confidence, reason, and detected words.

Recommended tuning loop:

1. Add a product with a retailer template and run `Run Check Now`.
2. If the result is blocked or captcha, wait and let the normal cron cadence retry. Do not bypass it.
3. If the monitor matches the wrong product, add required words from the actual product title.
4. If the monitor matches unrelated page text, add those words to ignore words.
5. Mark confirmed bad alerts as false positives so the admin accuracy stats stay honest.

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

eBay integration is manual/assisted for now. Do not use aggressive scraping; enter sold comps from public eBay sold results or another source you can verify.

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

- Product restock alerts open Products.
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

Browser push is alerts-only. It does not automate carts, checkout, payment, queues, captchas, accounts, or retailer limits. Go / Buy Now still opens official retailer pages for manual checkout only.

## Phase 7 Production Deployment

Phase 7 adds Vercel deployment readiness:

- `vercel.json` registers `/api/radar/monitor/cron` on a `*/5 * * * *` UTC schedule.
- `/api/radar/monitor/cron` supports Vercel's GET cron invocation and the existing POST/manual test flow.
- Cron calls are protected by `MONITOR_JOB_SECRET`, with bearer-token compatibility for Vercel's `CRON_SECRET`.
- `/api/health` reports app, database, cron, alert, push, email, and SMS readiness without exposing secret values.
- Admin users see App Health inside the dashboard. Missing production env vars show an admin warning instead of crashing the public UI.

Vercel Cron notes:

- Vercel invokes cron jobs only on production deployments.
- Vercel sends cron requests as HTTP GET requests to the configured path.
- Vercel Cron schedules use UTC.
- Vercel can send `Authorization: Bearer $CRON_SECRET`. Set `CRON_SECRET` equal to `MONITOR_JOB_SECRET`.
- The included 5-minute schedule requires a plan that supports sub-daily cron intervals. Hobby projects must change the schedule to a daily expression or use another cron provider.

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
- `MONITOR_REQUEST_DELAY_MS`

Browser push env vars:

- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`

Optional provider env vars:

- SMTP: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
- Twilio: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`

### Database Setup

Use managed Postgres for production. Do not deploy a `file:` SQLite database on Vercel; Vercel's filesystem is not durable for app data. The local SQLite setup is for development only, and the Admin Health panel will flag SQLite/file URLs as dev-only in production.

Production Prisma workflow:

```bash
npm run db:push:prod
npm run db:migrate:prod
npm run db:seed:prod
```

The tracked development schema is SQLite for local use. Production scripts run `npm run prisma:postgres`, which generates a temporary Postgres Prisma schema in `.prisma-postgres/schema.prisma` before generating the Prisma client or pushing the database schema. For the first production cutover, `npm run db:push:prod` is the expected setup path; create and review formal Prisma migrations before relying on `db:migrate:prod` for later production changes. Keep seed data limited to the first private admin account and trusted demo records.

### Deploy Steps

1. Create the Vercel project from the standalone `poke-restock-radar` folder.
2. Add all required env vars in Vercel Project Settings.
3. Use managed Postgres for `DATABASE_URL`.
4. Generate VAPID keys with `npx web-push generate-vapid-keys`.
5. Set `CRON_SECRET` and `MONITOR_JOB_SECRET` to the same random value.
6. Deploy production.
7. Run `npm run db:push:prod` and `npm run db:seed:prod` against production.
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

- Admins can reset their own password from the Admin Health panel after signing in.
- `Forgot Password` creates a 30-minute secure reset token and emails a reset link when SMTP is configured.
- Resetting a password increments the user session version so older session cookies stop working.

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

Each template stores the expected public URL pattern, common public stock words, safe public selectors/cues, useful identifier fields, default alert priority, and monitor notes. Templates are guidance for public-page monitoring only; they do not bypass queues, captchas, accounts, purchase limits, or checkout.

### Product Wizard

The product wizard steps are:

1. Retailer
2. Official product URL
3. Product details
4. Monitor and alert settings

Retailer URL validation is enforced when products are created or edited. Examples:

- Pokemon Center: `https://www.pokemoncenter.com/category/trading-card-game`
- Target: `https://www.target.com/s?searchTerm=pokemon+tcg+booster+bundle`
- Walmart: `https://www.walmart.com/search?q=pokemon%20tcg`
- GameStop: `https://www.gamestop.com/toys-games/trading-cards`

Use exact product pages when available. Search/category URLs are acceptable for setup notes but less precise for monitor checks.

### Bulk Product Import

CSV headers:

```csv
retailer,name,url,setName,productType,sku,upc,dpci,retailPrice,stockStatus,priority,rating,monitorEnabled,checkFrequencyMinutes,requiredWords,ignoreWords,releaseSetName,notes
Target,Pokemon TCG Booster Bundle,https://www.target.com/s?searchTerm=pokemon+tcg+booster+bundle,Mega Evolution-Chaos Rising,Booster Bundle,TARGET-123,,087-12-1234,26.99,UNAVAILABLE,HIGH,WATCH,true,60,"Pokemon,Booster","sponsored,marketplace",Mega Evolution-Chaos Rising,Manual checkout only
```

JSON format:

```json
[
  {
    "retailer": "Target",
    "name": "Pokemon TCG Booster Bundle",
    "url": "https://www.target.com/s?searchTerm=pokemon+tcg+booster+bundle",
    "setName": "Mega Evolution-Chaos Rising",
    "productType": "Booster Bundle",
    "dpci": "087-12-1234",
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
retailer,storeName,address,city,state,typicalRestockDays,typicalRestockTimeWindow,vendorNotes,confidenceScore,notes
Target,Target Northside,100 Market Plaza,Orlando,FL,"Tuesday,Friday",8:00 AM - 11:00 AM,Card aisle after front lanes,70,Manual visit log only
```

JSON uses the same field names in an array or `{ "stores": [...] }`.

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
- Missing SKU/UPC/DPCI
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

## Phase 14 Friend Access

Access is invite-only. There is no public signup route. Admins create single-use friend invite links from `User Management`; invite links expire after 7 days and the friend creates their own password from the invite screen.

Friend permissions are enforced server-side:

- `canAddSightings`: add and edit store sightings
- `canAddComps`: add manual card comps
- `canRunChecks`: run manual product checks or due monitor batches
- `canReceivePushAlerts`: create browser push subscriptions

Audit logs are stored for invite creation/acceptance/revocation, login attempts, sightings, card comps, monitor checks, and access changes. Admins can disable a friend account without deleting historical sightings or comps.

## Phase 15 Daily Workflow

The dashboard includes `Today's Plan` for the morning flow:

- Top online products to monitor
- Local stores to check today
- Latest alerts
- Newest releases
- Best card opportunities

Use `Mark Checked Today` on a product after a manual review, and `I Bought This` to log a purchase into inventory. The inventory log stores product/card purchased, cost, quantity, source, purchase date, and the expected resale or grading plan.

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

## Later Phases

The database schema already includes restock history, card comp sales, investment settings, release links, priority score records, and notification settings so later features can be added without reshaping the app.
