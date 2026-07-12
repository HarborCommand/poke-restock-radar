# Observability and Error Handling

This document is the production-safe inventory for operational diagnostics. Structured events are metadata-only. Business records remain in Postgres and Vercel function logs are not a source of truth.

## Event Matrix

| Surface | Event type | Severity | Correlation ID | Redaction policy | User-facing behavior |
| --- | --- | --- | --- | --- | --- |
| `/api/health` | health warning or failure | warning/error | request header and response header | public projection contains categories and counts only | `200` for OK/WARN; `503` for fatal checks |
| Admin health/diagnostics | bounded health, audit categories, recent event categories | info/error | request and response header | admin-only, private/no-store; no raw logs, metadata, PII, or stacks | safe diagnostics or generic failure |
| API routes | validation, authorization, dependency, conflict, internal error | warning/error | API-wide proxy plus route context | no request/response body; sensitive strings and keys recursively redacted | stable code, safe message, request ID, accurate status |
| Admin authentication | success, invalid credential, origin rejection, rate limit, configuration failure | info/warning/error | request and response header | account reference is HMAC-derived; no email, password, cookie, or token | enumeration-resistant response preserved |
| Customer authentication | audit categories, rate limit, replay/expiry, session revocation | info/warning | API request ID where routed; safe audit action | hashed limiter keys and safe action categories; tokens never logged | enumeration-resistant response preserved |
| Authorization | role rejection and same-origin rejection | warning | request and response header | route template, method category, role category only | existing `401`/`403` behavior preserved |
| Client error intake | route error, unhandled error, rejection | warning | client or server-safe request ID | strict allowlist, 8 KiB limit, URL query removal, recursive token/PII redaction | `202`, or safe `400`/`403`/`413`/`429` |
| Prisma/database | connectivity, known conflict, serialization conflict | error/warning | active request context | error category and redacted server-only stack; no query, params, or URL | safe `409`, `500`, or `503` |
| Reward transaction | commit, serialization retry, terminal conflict, duplicate audit result | info/warning | async request context | retry count and category only; no ledger metadata or idempotency key | existing financial result preserved |
| Reward adjustment/backfill | audit success/failure and safe route failure | info/warning/error | explicit route context | safe entity reference and point delta category; no notes or customer ID | actionable business rejection or generic failure |
| Refund/cancellation | audit success, retry, duplicate, safe route failure | info/warning/error | explicit route context | safe order/sale reference only; no payment reference or private note | existing workflow and status preserved |
| Customer linking | search/apply failure and committed audit action | info/warning/error | explicit route context | customer reference is HMAC-derived; no contact data or ownership note | existing match/mismatch behavior preserved |
| Inventory/price/image mutations | committed audit action and audit failure | info/error | API request context when available | safe entity reference; summaries stay in admin audit storage, not structured logs | existing response behavior preserved |
| Stripe checkout/webhooks | provider category, duplicate/event status, safe failure | info/warning/error | API request ID or generated job ID | no signature, Checkout payload, customer details, or card data | provider-safe status; retries remain idempotent |
| Cron/monitor jobs | run status, dependency category, duration | info/warning/error | incoming safe ID or generated job ID | no bearer secret or fetched payload | job status remains bounded and safe |
| Email delivery | provider status and safe notification category | info/warning/error | active request/job context | no recipient, message body, tokenized link, or provider key | generic delivery result |
| Upload/import/export | validation/rejection, result count, duration | info/warning/error | API request ID | no file contents, receipt data, signed URL, or imported row body | validation result or generic failure |
| Deployment/build | environment label and short commit | info | request ID where applicable | short SHA and environment label only | visible in health diagnostics |

## Correlation IDs

- `x-request-id` accepts only 8-64 ASCII letters, digits, dots, underscores, and hyphens.
- Invalid or absent values are replaced with a cryptographically random UUID.
- The API proxy forwards the normalized value to route handlers and adds it to responses.
- Financial helpers inherit the request ID through `AsyncLocalStorage`; IDs never encode customer, order, sale, or token data.

## Redaction

Structured logging recursively redacts mixed-case sensitive keys, nested objects, arrays, error objects, headers, contact data, URLs with query strings, credentials, database URLs, payment references, internal notes, and idempotency keys. Values are bounded by depth, item count, field count, and string length. Logging failures are swallowed and cannot roll back or duplicate a business transaction.

## Health Classification

- Fatal: database unavailable, required production/Vercel configuration missing, auth runtime unavailable, or no admin account.
- Warning: optional provider is partially configured, configured admin email does not match, monitor reports a failure, or a feature-flag dependency is inconsistent.
- Optional: disabled email/SMS/search/storage/shipping providers are healthy when no partial configuration exists.
- Public health returns only status, timestamp, database state, warning count/categories, and short build commit.
- Detailed health and diagnostics require admin authentication and use private/no-store responses.

## Failure Testing

Failure-mode QA must use mocks or isolated Preview configuration. Never intentionally break Production configuration. Temporary Preview variables and fixtures must be restored or removed, and health must return to OK before merge.
