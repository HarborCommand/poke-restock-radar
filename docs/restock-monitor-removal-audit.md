# Restock Monitor Removal Audit

## Decision

The automated Restock Radar / product tracker subsystem is retired. The five-minute Vercel schedule and all exposed monitor/discovery execution routes are removed. Historical tables and records are retained.

## Scheduled execution impact

Removed cron:

- `/api/radar/monitor/cron` — `*/5 * * * *`

Maximum scheduled executions eliminated:

- 288 per day
- 8,640 per 30-day month
- 8,928 per 31-day month

Remaining preserved crons:

- `/api/radar/storefront/reservations/expire` — `*/5 * * * *`
- `/api/radar/releases/sync/cron` — `0 10 * * *`
- `/api/radar/inventory/market-sync/cron` — `0 11 * * *`
- `/api/radar/rewards/audit/cron` — `30 11 * * *`

## Removed entry points

- Vercel cron entry for `/api/radar/monitor/cron`
- `/api/radar/monitor/cron`
- `/api/radar/monitor/run`
- `/api/radar/check-stock`
- `/api/radar/product-discovery/best-buy`
- `/api/radar/product-discovery/target`
- `/api/radar/product-discovery/sources`
- `/api/radar/product-discovery/candidates/[candidateId]/enrich`
- `/api/radar/product-discovery/candidates/[candidateId]/identifiers`
- `/api/radar/product-discovery/candidates/[candidateId]/review`
- `/api/radar/products/[productId]/check`
- `/api/radar/products/[productId]/checked`
- `/api/radar/products/[productId]/monitor`
- local `npm run monitor` script
- private-app retailer tracker controls inside Alerts
- invite/access form controls for legacy `canRunChecks`

Deleted route files return 404 through normal Next.js routing and perform zero database queries, retailer requests, alert creation, or notification sends.

## Preserved systems

- `/api/radar/storefront/reservations/expire`
- storefront cart reservation expiration
- checkout
- Stripe checkout/webhooks
- order processing
- product catalog
- product inventory
- POS
- Quick Stock
- admin authentication
- customer accounts
- rewards earning
- rewards auditor
- product feed
- Google Merchant readiness work
- release synchronization
- inventory market/comps synchronization
- product search
- public GameDayGrabs storefront
- private Poke Restock Radar admin host

## Dormant historical data retained

The following Prisma models/fields remain for historical retention and optional future cleanup:

- `Product`
- `Retailer`
- `Alert`
- `MonitorLog`
- `RestockHistory`
- `ProductDiscoverySource`
- `ProductDiscoveryCandidate`
- notification delivery records tied to historical alerts
- product monitor/status fields such as `monitorEnabled`, `liveStockStatus`, `lastCheckedAt`, and alert eligibility fields

No migration drops, truncates, or rewrites these records.

## Shared dependencies retained

- product parser and identity helpers
- retailer template helpers
- historical monitor service module exports
- dashboard DTO fields that still model retained historical data
- shared notification infrastructure used outside automatic restock execution

These remain safe because no scheduled path, exposed route, package script, or visible navigation invokes restock monitoring or automatic Target/Best Buy discovery.

## Alert-scope decision

The general Alerts navigation remains available because alert history, system notices, release alerts, inventory/order/storefront notices, browser-push routing, email/SMS settings, and notification delivery diagnostics are not exclusively part of the retired retailer restock monitor. The rendered Alerts workspace no longer exposes monitor-run, retailer-discovery, check-stock, watchlist, simulated live-drop controls, or retailer tracker alert links. Historical tracker records remain retained in the database for non-destructive audit history, but retired retailer-monitor rows are filtered out of the active general Alerts history UI.

## Obsolete Vercel variables eligible for later cleanup

Delete these from branch/Production environments only after owner account recovery and after confirming no old deployment depends on them:

- `PRODUCT_MONITOR_CRON_ENABLED`
- `TARGET_MONITOR_CRON_ENABLED`
- `TARGET_MONITOR_BATCH_SIZE`
- `TARGET_MONITOR_CADENCE_MINUTES`
- `MONITOR_REQUEST_DELAY_MS`
- `TARGET_DISCOVERY_AUTO_ENABLED`
- `TARGET_DISCOVERY_AUTO_APPROVAL_ENABLED`
- `TARGET_DISCOVERY_RETAIL_ONLY_ENABLED`
- `TARGET_DISCOVERY_CADENCE_MINUTES`
- `TARGET_DISCOVERY_AUTO_SOURCE_LIMIT`
- `TARGET_DISCOVERY_AUTO_APPROVE_LIMIT`
- `BESTBUY_DISCOVERY_ENABLED`
- `BESTBUY_DISCOVERY_AUTO_APPROVAL_ENABLED`
- `BESTBUY_DISCOVERY_CADENCE_MINUTES`
- `BESTBUY_DISCOVERY_AUTO_SOURCE_LIMIT`
- `BESTBUY_DISCOVERY_AUTO_APPROVE_LIMIT`
- `BESTBUY_DISCOVERY_RUN_LIMIT`
- `BESTBUY_API_KEY`

Keep `MONITOR_JOB_SECRET` and `CRON_SECRET` for the preserved signed cron jobs unless those routes are later given a renamed secret.
