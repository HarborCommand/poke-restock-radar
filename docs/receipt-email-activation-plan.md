# Receipt email activation plan

This PR prepares customer receipt email delivery but does not activate Production sending.

## Current behavior

- With `STOREFRONT_RECEIPT_EMAILS_ENABLED=false`, paid storefront orders keep the existing legacy order-confirmation email through the established `PaymentEvent` idempotency path.
- With `STOREFRONT_RECEIPT_EMAILS_ENABLED=true`, the same single `PaymentEvent` email uses the combined order-confirmation/receipt presentation. It does not create a second automatic receipt email.
- POS initial receipt emails and manual receipt resends use `ReceiptEmailDelivery`.
- `ReceiptEmailDelivery` rows are claimed before provider contact. A same-key concurrent resend can observe `PENDING`, `SENT`, or `FAILED`, but only the winning claim contacts the provider.
- If a provider accepts an email but final delivery status cannot be saved, the response stays `PENDING` with `RECEIPT_EMAIL_STATUS_UNAVAILABLE`; the same idempotency key must not resend.
- Receipt email delivery failures are isolated from completed online checkout and POS sale workflows.
- POS and storefront manual receipt email controls remain unavailable when the relevant receipt email feature flag or email provider is not configured.

## Staged activation

1. Confirm the email provider is configured with owner-approved sender/reply-to values.
2. Enable receipt email flags in a disposable Preview first.
3. Complete fake POS and storefront email QA with no Production orders or real customer sends.
4. Review delivery records for masked recipients, provider message IDs, sanitized failure fields, and stable idempotency keys.
5. After owner approval, enable Production flags during a monitored release window.
6. Monitor provider delivery status, application logs, rate-limit events, and support inbox replies.

## Rollback

- Disable `POS_RECEIPT_EMAILS_ENABLED` to hide POS email receipt controls.
- Disable `STOREFRONT_RECEIPT_EMAILS_ENABLED` to block manual storefront receipt resends and return paid storefront orders to the legacy confirmation template.
- Storefront paid order emails remain on the established `PaymentEvent` path and continue to be idempotent in both flag states.

## Manual recovery

- Do not retry an uncertain delivery with the same idempotency key. `PENDING` plus `RECEIPT_EMAIL_STATUS_UNAVAILABLE` means the provider may already have accepted the email.
- If the owner deliberately wants another send after reviewing the provider/admin evidence, use the normal manual resend control, which generates a new idempotency key.
