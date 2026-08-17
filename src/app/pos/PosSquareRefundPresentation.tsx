"use client";

import { useEffect } from "react";

function replaceMatchingText(root: HTMLElement, match: (text: string) => boolean, replace: (text: string) => string) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    if (node instanceof Text) nodes.push(node);
    node = walker.nextNode();
  }

  for (const textNode of nodes) {
    const value = textNode.nodeValue || "";
    const normalized = value.trim();
    if (!normalized || !match(normalized)) continue;
    const next = replace(normalized);
    if (next !== normalized) textNode.nodeValue = value.replace(normalized, next);
  }
}

function polishSquareRefundDialog(dialog: HTMLElement) {
  const content = dialog.textContent || "";
  if (!/card\s*[·-]?\s*square|square card/i.test(content)) return;

  replaceMatchingText(
    dialog,
    (text) => text === "Payment return is separate.",
    () => "Square refund to original card."
  );

  replaceMatchingText(
    dialog,
    (text) => text.startsWith("This action records the refund in GameDayGrabs") && text.includes("It does not send money through Square"),
    () => "This sends the selected amount back to the original card through Square. GameDayGrabs updates the sale, tax, rewards, and optional inventory return only after Square confirms the refund."
  );

  replaceMatchingText(
    dialog,
    (text) => text.includes("remains refundable in the POS record."),
    (text) => text.replace("remains refundable in the POS record.", "remains refundable to the original Square card.")
  );

  replaceMatchingText(
    dialog,
    (text) => text === "Refund sale",
    () => "Refund to Square"
  );

  replaceMatchingText(
    dialog,
    (text) => text === "I confirm the customer's payment has been returned, or I am handling the payment return separately.",
    () => "I understand this refund will be sent to the original Square card through Square."
  );

  replaceMatchingText(
    dialog,
    (text) => text.startsWith("Record refund $") && !text.includes("Square"),
    (text) => `${text.replace("Record refund ", "Refund ")} to Square`
  );

  replaceMatchingText(
    dialog,
    (text) => text === "Record partial refund",
    () => "Refund partial amount to Square"
  );

  replaceMatchingText(
    dialog,
    (text) => text.startsWith("Refund recorded for the remaining "),
    (text) => `Square refund completed. ${text.replace("Refund recorded for the remaining ", "Refunded ")}`
  );

  replaceMatchingText(
    dialog,
    (text) => text.startsWith("Partial refund of ") && text.endsWith(" recorded."),
    (text) => `Square refund completed. ${text.replace(" recorded.", ".")}`
  );
}

export function PosSquareRefundPresentation() {
  useEffect(() => {
    let scheduled = false;
    const sync = () => {
      scheduled = false;
      const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-label^="Sale "]'));
      for (const dialog of dialogs) polishSquareRefundDialog(dialog);
    };
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(sync);
    };

    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
