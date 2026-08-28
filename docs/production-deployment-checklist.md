# Poke Restock Radar Production Deployment Checklist

This checklist is for the standalone `poke-restock-radar` app only.

Do not deploy this app into the Harbor Command Vercel project. Do not point it at the Harbor Command database. Do not copy Harbor Command auth secrets, routes, cron jobs, tables, environment variables, or deployment settings.

## Required Separation

- Vercel project name: `poke-restock-radar`
- Neon production database name: `poke_restock_radar_prod`
- App folder: `C:\Users\arive\OneDrive\Documents\New project\poke-restock-radar`
- Production app URL: the Vercel production URL or your private custom domain for this app
- Production cron routes: storefront reservation expiration, release sync, inventory market sync, and rewards audit

## 1. Prepare Local Secrets

Generate new app secrets:

```bash
npm run secrets:generate
```

Generate browser push keys:

```bash
npm run vapid:generate -- --subject=mailto:you@example.com
```

Use the generated values only for Poke Restock Radar.

## 2. Create Neon Database

1. In the same Neon account, create or select the Neon project dedicated to this app.
2. Create a separate production database named `poke_restock_radar_prod`.
3. Copy the pooled connection string for app runtime as `DATABASE_URL`.
4. Copy the direct/unpooled connection string as `DATABASE_URL_UNPOOLED` or `POSTGRES_BACKUP_URL` for Prisma migrations and backups.
5. Confirm the database name in both URLs is `poke_restock_radar_prod`.

Use an unpooled URL for `pg_dump`, `pg_restore`, and migration maintenance. Pooled URLs are for serverless app runtime.

## 3. Create Vercel Project

1. Create a new Vercel project named `poke-restock-radar`.
2. Set the project root to this standalone folder.
3. Confirm the linked project is not the Harbor Command project.
4. Confirm Settings -> Git shows `HarborCommand/poke-restock-radar` without `Project Link not found`.
5. Use the build command:

```bash
npm run vercel-build
```

6. Keep the included `vercel.json`; it registers only preserved internal cron routes.
7. If GitHub pushes do not create deployments, follow [Vercel Git Reconnect Runbook](vercel-git-reconnect-runbook.md).

## 4. Set Vercel Env Vars

Required:

- `DATABASE_URL`
- `DATABASE_URL_UNPOOLED`
- `APP_URL`
- `AUTH_SECRET`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD_HASH`
- `ADMIN_INVITE_SECRET`
- `MONITOR_JOB_SECRET`
- `CRON_SECRET`
- `MONITOR_REQUEST_DELAY_MS`

Browser push:

- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`

Optional alerts:

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM_NUMBER`

Set `CRON_SECRET` equal to `MONITOR_JOB_SECRET`.

## 5. Database Migration And Seed

Production must use Postgres. Local SQLite is development-only.

For an existing Production database, use the reviewed migration deploy path:

```bash
npm run db:migrate:prod
npm run db:seed:prod
```

Production scripts run `npm run prisma:postgres` first. That generates `.prisma-postgres/schema.prisma` from the local SQLite development schema and switches only the datasource provider to Postgres for Vercel/Neon use.

Do not run `npm run db:push:prod` against an existing database. A brand-new persistent Postgres environment requires the separately reviewed process in [Prisma Postgres Migration Baseline Repair](prisma-migration-baseline-repair.md) until an active initial migration is approved.

Keep production seed data limited to the private admin account and any intentional starter records.

## 6. Backup And Restore

App-level JSON backup:

```bash
npm run backup:json
npm run restore:json -- backups/poke-restock-radar-example.json --yes
```

Neon/Postgres logical backup:

```bash
npm run backup:postgres
npm run restore:postgres -- backups/poke-restock-radar-example.dump --yes
```

The Postgres scripts require local `pg_dump` and `pg_restore`. Use `DATABASE_URL_UNPOOLED` or `POSTGRES_BACKUP_URL`, not a pooled Neon URL.

## 7. Cron And Health Checks

The cron route runs due product checks:

Confirm `/api/radar/monitor/cron` returns 404. The retired restock monitor must not be scheduled or manually callable.

Health endpoint:

```bash
curl "$APP_URL/api/health"
```

Admin Health in the app should show database connectivity, preserved cron secret readiness, push configuration, and optional email/SMS provider status.

## 8. Final Launch Checks

- `git remote -v` points to the Poke Restock Radar repository.
- Vercel project is named `poke-restock-radar`.
- Vercel Settings -> Git is connected to `HarborCommand/poke-restock-radar` and has no `Project Link not found` warning.
- Neon database URL contains `poke_restock_radar_prod`.
- `CRON_SECRET` and `MONITOR_JOB_SECRET` match.
- Browser push keys are unique to this app.
- Twilio and SMTP credentials are unique or intentionally scoped to this app.
- `/api/health` returns OK or WARN, not ERROR.
- `npm run health:prod` passes after production deploy and reports the current commit.
- Admin can sign in.
- No Restock Radar monitor controls or monitor logs are created by ordinary admin use.
- Go / Buy Now opens the official retailer page only.
