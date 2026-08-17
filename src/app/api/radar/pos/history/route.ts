import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { privateOk } from "@/lib/http";
import { normalizePosPaymentMethod, posPaymentMethodLabel } from "@/lib/pos";
import { hasPosRole, resolvePosStoreUser } from "@/lib/pos-authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function maskEmail(value: string | null | undefined) {
  const email = value?.trim();
  if (!email || !email.includes("@")) return null;
  const [local, domain] = email.split("@");
  return `${local.slice(0, Math.min(2, local.length))}${local.length > 2 ? "***" : "*"}@${domain}`;
}

function maskPhone(value: string | null | undefined) {
  const digits = value?.replace(/\D/g, "") ?? "";
  return digits.length >= 4 ? `***-***-${digits.slice(-4)}` : null;
}

export async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;
  if (!hasPosRole(user)) {
    return NextResponse.json({ error: "POS access required" }, { status: 403 });
  }

  const storeUser = await resolvePosStoreUser(user);
  const rows = await prisma.inventorySale.findMany({
    where: {
      userId: storeUser.id,
      platform: "pos",
      saleReference: { not: null }
    },
    select: {
      saleReference: true,
      quantitySold: true,
      soldPricePerItem: true,
      grossSale: true,
      originalUnitPrice: true,
      adjustedUnitPrice: true,
      discountAmount: true,
      subtotalCents: true,
      taxCents: true,
      totalCents: true,
      paymentMethod: true,
      customerEmail: true,
      customerPhone: true,
      soldAt: true,
      refundedAmount: true,
      refundStatus: true,
      customerAccount: { select: { displayName: true } },
      inventoryItem: { select: { itemName: true, publicTitle: true } }
    },
    orderBy: [{ soldAt: "desc" }, { createdAt: "desc" }],
    take: 600
  });

  type SaleLine = {
    title: string;
    quantity: number;
    unitPrice: number;
    originalUnitPrice: number | null;
    discountAmount: number;
    subtotal: number;
    tax: number;
    total: number;
    refundedAmount: number;
  };

  type SaleSummary = {
    saleReference: string;
    completedAt: string;
    itemCount: number;
    lineCount: number;
    subtotalCents: number;
    taxCents: number;
    totalCents: number;
    paymentMethod: string;
    paymentMethodLabel: string;
    customerName: string | null;
    customerEmail: string | null;
    customerPhone: string | null;
    refundedAmount: number;
    refundStatus: string | null;
    items: string[];
    lines: SaleLine[];
  };

  const grouped = new Map<string, SaleSummary>();
  for (const row of rows) {
    const saleReference = row.saleReference?.trim();
    if (!saleReference) continue;
    const paymentMethod = normalizePosPaymentMethod(row.paymentMethod) ?? "other";
    const current = grouped.get(saleReference) ?? {
      saleReference,
      completedAt: row.soldAt.toISOString(),
      itemCount: 0,
      lineCount: 0,
      subtotalCents: 0,
      taxCents: 0,
      totalCents: 0,
      paymentMethod,
      paymentMethodLabel: posPaymentMethodLabel(paymentMethod),
      customerName: row.customerAccount?.displayName?.trim() || null,
      customerEmail: maskEmail(row.customerEmail),
      customerPhone: maskPhone(row.customerPhone),
      refundedAmount: 0,
      refundStatus: null,
      items: [],
      lines: []
    };

    const lineSubtotalCents = row.subtotalCents ?? Math.round(row.grossSale * 100);
    const lineTaxCents = row.taxCents ?? 0;
    const lineTotalCents = row.totalCents ?? Math.round(row.grossSale * 100);
    const itemTitle = row.inventoryItem.publicTitle || row.inventoryItem.itemName;
    const unitPrice = row.adjustedUnitPrice ?? row.soldPricePerItem;

    current.itemCount += row.quantitySold;
    current.lineCount += 1;
    current.subtotalCents += lineSubtotalCents;
    current.taxCents += lineTaxCents;
    current.totalCents += lineTotalCents;
    current.refundedAmount += row.refundedAmount ?? 0;
    current.refundStatus = row.refundStatus || current.refundStatus;
    if (!current.items.includes(itemTitle)) current.items.push(itemTitle);
    current.lines.push({
      title: itemTitle,
      quantity: row.quantitySold,
      unitPrice: Number(unitPrice.toFixed(2)),
      originalUnitPrice: row.originalUnitPrice === null ? null : Number(row.originalUnitPrice.toFixed(2)),
      discountAmount: Number((row.discountAmount ?? 0).toFixed(2)),
      subtotal: Number((lineSubtotalCents / 100).toFixed(2)),
      tax: Number((lineTaxCents / 100).toFixed(2)),
      total: Number((lineTotalCents / 100).toFixed(2)),
      refundedAmount: Number((row.refundedAmount ?? 0).toFixed(2))
    });
    if (row.soldAt.toISOString() > current.completedAt) current.completedAt = row.soldAt.toISOString();
    grouped.set(saleReference, current);
  }

  const sales = [...grouped.values()]
    .sort((left, right) => right.completedAt.localeCompare(left.completedAt))
    .slice(0, 100)
    .map((sale) => ({
      ...sale,
      subtotal: sale.subtotalCents / 100,
      tax: sale.taxCents / 100,
      total: sale.totalCents / 100,
      refundedAmount: Number(sale.refundedAmount.toFixed(2))
    }));

  return privateOk({ sales });
}
