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
      grossSale: true,
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
      items: []
    };

    current.itemCount += row.quantitySold;
    current.lineCount += 1;
    current.subtotalCents += row.subtotalCents ?? Math.round(row.grossSale * 100);
    current.taxCents += row.taxCents ?? 0;
    current.totalCents += row.totalCents ?? Math.round(row.grossSale * 100);
    current.refundedAmount += row.refundedAmount ?? 0;
    current.refundStatus = row.refundStatus || current.refundStatus;
    const itemTitle = row.inventoryItem.publicTitle || row.inventoryItem.itemName;
    if (!current.items.includes(itemTitle)) current.items.push(itemTitle);
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
