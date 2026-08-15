"use client";

import { useEffect } from "react";

export function PosCartImageFix() {
  useEffect(() => {
    let scheduled = false;

    const fixCartImages = () => {
      scheduled = false;
      document.querySelectorAll<HTMLImageElement>(".pos-cart-line .inventory-image-frame img").forEach((image) => {
        image.loading = "eager";
        image.style.display = "block";
        image.style.opacity = "1";
        image.style.visibility = "visible";
        image.style.width = "100%";
        image.style.height = "100%";
        image.style.objectFit = "contain";
      });
    };

    const scheduleFix = () => {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(fixCartImages);
    };

    scheduleFix();
    const observer = new MutationObserver(scheduleFix);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, []);

  return null;
}
