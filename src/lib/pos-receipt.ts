function legacyPosReceiptMoneyFromNote(notes: string | null | undefined, label: "tax") {
  const match = notes?.match(new RegExp(`POS ${label}: \\$(\\d+(?:\\.\\d{1,2})?)\\.`));
  return match ? Math.round(Number(match[1]) * 100) / 100 : null;
}

export function legacyPosReceiptTax(input: {
  notes: string | null | undefined;
  taxStatus: string | null | undefined;
}) {
  if (input.taxStatus === "not_recorded") return null;
  return legacyPosReceiptMoneyFromNote(input.notes, "tax");
}
