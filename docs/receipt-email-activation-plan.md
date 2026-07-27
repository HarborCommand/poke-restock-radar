# Receipt email activation plan

This PR prepares customer receipt email delivery but does not activate Production sending.

## Current behavior

- Paid storefront orders send exactly one automatic order-confirmation/receipt email through the existing `PaymentEvent` idempotency path.
- POS initial receipt emails and manual receipt resends use `ReceiptEmailDelivery`.
- Receipt email delivery failures are isolated from completed online checkout and POS sale workflows.
- POS receipt email controls remain unavailable when the receipt email feature flag or email provider is not configured.

## Staged activation

1. Confirm the email provider is configured with owner-approved sender/reply-to values.
2. Enable receipt email flags in a disposable Preview first.
3. Complete fake POS and storefront email QA with no Production orders or real customer sends.
4. Review delivery records for masked recipients, provider message IDs, sanitized failure fields, and stable idempotency keys.
5. After owner approval, enable Production flags during a monitored release window.
6. Monitor provider delivery status, application logs, rate-limit events, and support inbox replies.

## Rollback

- Disable `POS_RECEIPT_EMAILS_ENABLED` to hide POS email receipt controls.
- Disable `STOREFRONT_RECEIPT_EMAILS_ENABLED` to block manual storefront receipt resends.
- Existing storefront paid order confirmations remain on the established `PaymentEvent` path and continue to be idempotent.
