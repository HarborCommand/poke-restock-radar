export function stableReceiptEmailIdempotencyKey(prefix: string, randomId: string) {
  const cleanPrefix = prefix.trim().replace(/[^a-zA-Z0-9:_-]/g, "-").slice(0, 80);
  const cleanRandomId = randomId.trim().replace(/[^a-zA-Z0-9:_-]/g, "-").slice(0, 80);
  return `${cleanPrefix || "receipt-email"}:${cleanRandomId || "manual"}`;
}

export function newReceiptEmailIdempotencyKey(prefix: string, cryptoSource: Pick<Crypto, "randomUUID"> | null | undefined = globalThis.crypto) {
  const randomId = cryptoSource?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return stableReceiptEmailIdempotencyKey(prefix, randomId);
}
