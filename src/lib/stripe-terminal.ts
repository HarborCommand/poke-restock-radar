import Stripe from "stripe";
import { createHash } from "node:crypto";
import { createPosSale, getTrustedPosSaleQuote, posSaleReferenceFromIdempotencyKey } from "@/lib/radar-service";
import type { PosSaleReceiptDTO, SessionUser } from "@/types/radar";

export const STRIPE_TERMINAL_TEST_MODE_FLAG = "STRIPE_TERMINAL_TEST_MODE_ENABLED";

type PosTerminalCartInput = {
  idempotencyKey: string;
  items: Array<{ inventoryItemId: string; quantity: number }>;
};

function envValue(name: string) {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : null;
}

function stripeKeyMode(value: string | null, keyType: "sk" | "pk") {
  if (!value) return "missing";
  if (value.startsWith(`${keyType}_test_`)) return "test";
  if (value.startsWith(`${keyType}_live_`)) return "live";
  return "unknown";
}

export function stripeTerminalTestModeConfig(env: Record<string, string | undefined> = process.env) {
  const enabled = env[STRIPE_TERMINAL_TEST_MODE_FLAG]?.trim() === "true";
  const secretKey = env.STRIPE_SECRET_KEY?.trim() || null;
  const secretKeyMode = stripeKeyMode(secretKey, "sk");
  return {
    enabled,
    secretKeyConfigured: Boolean(secretKey),
    secretKeyMode,
    ready: enabled && secretKeyMode === "test"
  };
}

function stripeTerminalClient() {
  const config = stripeTerminalTestModeConfig();
  const key = envValue("STRIPE_SECRET_KEY");
  if (!config.enabled) throw new Error("Stripe Terminal test mode is disabled.");
  if (!key || config.secretKeyMode !== "test") {
    throw new Error("Stripe Terminal test mode requires a Stripe test secret key.");
  }
  return new Stripe(key);
}

function moneyToCents(value: number) {
  return Math.round(value * 100);
}

function terminalMetadataHash(input: Record<string, string>) {
  return createHash("sha256").update(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join("|")).digest("hex");
}

function terminalPaymentMetadata(input: {
  currentUser: SessionUser;
  idempotencyKey: string;
  saleReference: string;
  cartFingerprint: string;
  subtotal: number;
  tax: number;
  total: number;
  itemCount: number;
}) {
  const base = {
    integration: "pos_stripe_terminal_test_mode",
    posMode: "test",
    posUserId: input.currentUser.id,
    posSaleReference: input.saleReference,
    posIdempotencyKey: input.idempotencyKey,
    posCartFingerprint: input.cartFingerprint,
    posSubtotal: input.subtotal.toFixed(2),
    posTax: input.tax.toFixed(2),
    posTotal: input.total.toFixed(2),
    posItemCount: String(input.itemCount)
  };
  return {
    ...base,
    posMetadataHash: terminalMetadataHash(base)
  };
}

function verifyTerminalPaymentIntent(input: {
  intent: Stripe.PaymentIntent;
  currentUser: SessionUser;
  idempotencyKey: string;
  saleReference: string;
  cartFingerprint: string;
  total: number;
}) {
  if (input.intent.livemode) throw new Error("Live Stripe Terminal payments are not enabled.");
  if (input.intent.currency !== "usd") throw new Error("Stripe Terminal payment currency mismatch.");
  if (input.intent.amount !== moneyToCents(input.total)) throw new Error("Stripe Terminal payment amount mismatch.");
  if (!input.intent.payment_method_types.includes("card_present")) {
    throw new Error("Stripe Terminal payment must use a card-present PaymentIntent.");
  }
  const metadata = input.intent.metadata ?? {};
  if (metadata.integration !== "pos_stripe_terminal_test_mode" || metadata.posMode !== "test") {
    throw new Error("Stripe Terminal payment was not created by the POS test-mode flow.");
  }
  if (metadata.posUserId !== input.currentUser.id) throw new Error("Stripe Terminal payment user mismatch.");
  if (metadata.posSaleReference !== input.saleReference) throw new Error("Stripe Terminal sale reference mismatch.");
  if (metadata.posIdempotencyKey !== input.idempotencyKey) throw new Error("Stripe Terminal idempotency key mismatch.");
  if (metadata.posCartFingerprint !== input.cartFingerprint) throw new Error("Stripe Terminal cart mismatch.");
}

export async function createTerminalConnectionToken() {
  const stripe = stripeTerminalClient();
  const token = await stripe.terminal.connectionTokens.create();
  if (!token.secret) throw new Error("Stripe Terminal did not return a connection token.");
  return { secret: token.secret };
}

export async function createTerminalPosPaymentIntent(currentUser: SessionUser, input: PosTerminalCartInput) {
  const stripe = stripeTerminalClient();
  const quote = await getTrustedPosSaleQuote(currentUser, input);
  const amount = moneyToCents(quote.total);
  if (amount <= 0) throw new Error("Card reader total must be greater than $0.00.");

  const paymentIntent = await stripe.paymentIntents.create(
    {
      amount,
      currency: "usd",
      payment_method_types: ["card_present"],
      capture_method: "manual",
      description: `POS sale ${quote.saleReference}`,
      metadata: terminalPaymentMetadata({
        currentUser,
        idempotencyKey: input.idempotencyKey,
        saleReference: quote.saleReference,
        cartFingerprint: quote.cartFingerprint,
        subtotal: quote.subtotal,
        tax: quote.tax,
        total: quote.total,
        itemCount: quote.itemCount
      })
    },
    {
      idempotencyKey: `pos-terminal:${currentUser.id}:${quote.saleReference}:${quote.cartFingerprint}:${amount}`
    }
  );
  if (paymentIntent.livemode) throw new Error("Live Stripe Terminal payments are not enabled.");
  if (!paymentIntent.client_secret) throw new Error("Stripe Terminal did not return a client secret.");

  return {
    paymentIntentId: paymentIntent.id,
    clientSecret: paymentIntent.client_secret,
    saleReference: quote.saleReference,
    subtotal: quote.subtotal,
    tax: quote.tax,
    total: quote.total,
    itemCount: quote.itemCount
  };
}

export async function completeTerminalPosSale(currentUser: SessionUser, input: PosTerminalCartInput & { paymentIntentId: string }): Promise<PosSaleReceiptDTO> {
  const stripe = stripeTerminalClient();
  const quote = await getTrustedPosSaleQuote(currentUser, input);
  const expectedSaleReference = posSaleReferenceFromIdempotencyKey(currentUser.id, input.idempotencyKey);
  if (quote.saleReference !== expectedSaleReference) throw new Error("Stripe Terminal sale reference mismatch.");

  const intent = await stripe.paymentIntents.retrieve(input.paymentIntentId);
  verifyTerminalPaymentIntent({
    intent,
    currentUser,
    idempotencyKey: input.idempotencyKey,
    saleReference: quote.saleReference,
    cartFingerprint: quote.cartFingerprint,
    total: quote.total
  });

  if (intent.status !== "requires_capture" && intent.status !== "succeeded") {
    throw new Error(`Stripe Terminal payment is ${intent.status.replaceAll("_", " ")}. Retry or cancel the card reader payment.`);
  }

  let capturedForSale = intent.status === "succeeded";
  if (intent.status === "requires_capture") {
    const captured = await stripe.paymentIntents.capture(intent.id, {}, {
      idempotencyKey: `pos-terminal-capture:${intent.id}:${quote.saleReference}`
    });
    if (captured.livemode) throw new Error("Live Stripe Terminal payments are not enabled.");
    if (captured.status !== "succeeded") {
      throw new Error(`Stripe Terminal capture is ${captured.status.replaceAll("_", " ")}.`);
    }
    capturedForSale = true;
  }

  try {
    return await createPosSale(currentUser, {
      idempotencyKey: input.idempotencyKey,
      items: quote.items,
      paymentMethod: "card_terminal",
      paymentReference: intent.id,
      stripePaymentIntentId: intent.id
    });
  } catch (error) {
    if (capturedForSale) {
      await stripe.refunds.create(
        {
          payment_intent: intent.id,
          metadata: {
            integration: "pos_stripe_terminal_test_mode",
            posSaleReference: quote.saleReference,
            reason: "pos_sale_completion_failed"
          }
        },
        { idempotencyKey: `pos-terminal-refund-failed-sale:${intent.id}:${quote.saleReference}` }
      ).catch(() => undefined);
    }
    throw error;
  }
}

export async function cancelTerminalPosPaymentIntent(currentUser: SessionUser, input: { paymentIntentId: string }) {
  const stripe = stripeTerminalClient();
  const intent = await stripe.paymentIntents.retrieve(input.paymentIntentId);
  if (intent.livemode) throw new Error("Live Stripe Terminal payments are not enabled.");
  if (intent.metadata?.integration !== "pos_stripe_terminal_test_mode" || intent.metadata?.posUserId !== currentUser.id) {
    throw new Error("Stripe Terminal payment was not created by this POS session.");
  }

  if (["canceled", "succeeded"].includes(intent.status)) {
    return { paymentIntentId: intent.id, status: intent.status };
  }
  if (!["requires_payment_method", "requires_confirmation", "requires_action", "requires_capture", "processing"].includes(intent.status)) {
    return { paymentIntentId: intent.id, status: intent.status };
  }

  const canceled = await stripe.paymentIntents.cancel(intent.id);
  return { paymentIntentId: canceled.id, status: canceled.status };
}
