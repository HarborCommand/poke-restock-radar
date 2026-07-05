export type AuthenticityProofStatus = "missing" | "partial" | "complete";
export type AuthenticityReceiptStatus = "missing" | "receipt" | "invoice" | "order_history" | "other";
export type AuthenticityPhotoStatus = "missing" | "front_only" | "front_back" | "front_back_upc";

const proofStatuses = new Set<AuthenticityProofStatus>(["missing", "partial", "complete"]);
const receiptStatuses = new Set<AuthenticityReceiptStatus>(["missing", "receipt", "invoice", "order_history", "other"]);
const photoStatuses = new Set<AuthenticityPhotoStatus>(["missing", "front_only", "front_back", "front_back_upc"]);

export const authenticityProofStatusOptions: Array<{ value: AuthenticityProofStatus; label: string }> = [
  { value: "missing", label: "Missing" },
  { value: "partial", label: "Partial" },
  { value: "complete", label: "Complete" }
];

export const authenticityReceiptStatusOptions: Array<{ value: AuthenticityReceiptStatus; label: string }> = [
  { value: "missing", label: "Missing" },
  { value: "receipt", label: "Retail receipt" },
  { value: "invoice", label: "Distributor/wholesale invoice" },
  { value: "order_history", label: "Order history" },
  { value: "other", label: "Other private proof" }
];

export const authenticityPhotoStatusOptions: Array<{ value: AuthenticityPhotoStatus; label: string }> = [
  { value: "missing", label: "Missing" },
  { value: "front_only", label: "Front photo only" },
  { value: "front_back", label: "Front and back/sealed photos" },
  { value: "front_back_upc", label: "Front, back/sealed, and UPC photos" }
];

export type AuthenticityProofInput = {
  authenticityProofStatus?: string | null;
  authenticityReceiptStatus?: string | null;
  authenticityPhotoStatus?: string | null;
  authenticityUpcVerified?: boolean | null;
};

function normalizedStatus<T extends string>(value: string | null | undefined, allowed: Set<T>, fallback: T): T {
  const normalized = value?.trim().toLowerCase();
  return normalized && allowed.has(normalized as T) ? (normalized as T) : fallback;
}

export function normalizeAuthenticityProofStatus(value: string | null | undefined): AuthenticityProofStatus {
  return normalizedStatus(value, proofStatuses, "missing");
}

export function normalizeAuthenticityReceiptStatus(value: string | null | undefined): AuthenticityReceiptStatus {
  return normalizedStatus(value, receiptStatuses, "missing");
}

export function normalizeAuthenticityPhotoStatus(value: string | null | undefined): AuthenticityPhotoStatus {
  return normalizedStatus(value, photoStatuses, "missing");
}

export function isAuthenticityProofReady(product: AuthenticityProofInput) {
  return (
    normalizeAuthenticityProofStatus(product.authenticityProofStatus) === "complete" &&
    normalizeAuthenticityReceiptStatus(product.authenticityReceiptStatus) !== "missing" &&
    normalizeAuthenticityPhotoStatus(product.authenticityPhotoStatus) === "front_back_upc" &&
    product.authenticityUpcVerified === true
  );
}

export function hasPartialAuthenticityProof(product: AuthenticityProofInput) {
  return (
    normalizeAuthenticityProofStatus(product.authenticityProofStatus) !== "missing" ||
    normalizeAuthenticityReceiptStatus(product.authenticityReceiptStatus) !== "missing" ||
    normalizeAuthenticityPhotoStatus(product.authenticityPhotoStatus) !== "missing" ||
    product.authenticityUpcVerified === true
  );
}
