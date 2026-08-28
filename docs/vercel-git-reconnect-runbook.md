# Vercel Git Reconnect Runbook

This runbook is for the standalone `poke-restock-radar` app only.

Do not reconnect, redeploy, or change the Harbor Command Vercel project or Harbor Command database while following these steps.

## When To Use This

Use this if Vercel shows `Project Link not found`, GitHub pushes do not create deployments, or production is serving an older commit than GitHub `main`.

## Correct Project

- Vercel project: `poke-restock-radar`
- GitHub repo: `HarborCommand/poke-restock-radar`
- Production storefront: `https://www.gamedaygrabs.com`
- Private app preview/admin URL: `https://poke-restock-radar.vercel.app`

## Reconnect Vercel To GitHub

1. Open Vercel.
2. Go to project `poke-restock-radar`.
3. Open Settings -> Git.
4. If `HarborCommand/poke-restock-radar` shows `Project Link not found`, click Reconnect.
5. GitHub opens the Vercel app installation page.
6. Configure repository access for `HarborCommand/poke-restock-radar`.
7. Save the GitHub app installation.
8. Return to Vercel Settings -> Git and confirm `Project Link not found` is gone.

Keep repository access scoped to `HarborCommand/poke-restock-radar` when possible.

## Verify A Fresh Deployment

From the local `poke-restock-radar` folder:

```bash
git status --short
git rev-parse --short=12 HEAD
curl https://www.gamedaygrabs.com/api/health
```

The health response `buildCommit` should match the current Git commit prefix.

If Vercel does not start a deployment after reconnecting Git, push an empty trigger commit:

```bash
git commit --allow-empty -m "Trigger Poke Radar production deployment"
git push origin main
```

Then confirm the production deployment is `READY` and assigned to:

- `www.gamedaygrabs.com`
- `gamedaygrabs.com`
- `poke-restock-radar.vercel.app`

## Migration Safety

Never manually add production columns/tables without either:

- running the matching Prisma migration through the normal deployment path, or
- recording the matching migration in `_prisma_migrations` after verifying the schema is already present.

If migration history gets out of sync, Vercel may retry an already-applied migration and fail before the storefront can render.

## Automated Guard

The `Production health` GitHub workflow checks:

- the storefront health endpoint responds,
- the database is online,
- production is not reporting `ERROR`,
- production `buildCommit` matches the latest `main` commit after pushes.

If that workflow fails after a push, check Vercel Settings -> Git first.

## Direct Deploy Fallback

The `Vercel production deploy fallback` GitHub workflow can deploy production without relying on the Vercel Git app hook.

It uses:

- Vercel project ID: `prj_FFVI8ET1BkrnRJQ77XkjRNIwaCsu`
- Vercel team ID: `team_lZ5uqSLWZgwBynAh48f23zJA`
- GitHub secret: `POKE_RADAR_VERCEL_TOKEN`

If the secret is missing, the workflow exits without deploying and prints a notice.

To enable the fallback:

1. Create a Vercel token with access to the `poke-restock-radar` project only if possible.
2. In GitHub repo `HarborCommand/poke-restock-radar`, open Settings -> Secrets and variables -> Actions.
3. Add repository secret `POKE_RADAR_VERCEL_TOKEN`.
4. Run the `Vercel production deploy fallback` workflow manually once.
5. Confirm `https://www.gamedaygrabs.com/api/health` reports the new commit.

Use this fallback when Vercel Settings -> Git cannot be repaired immediately.
