"use client";

import { useEffect } from "react";

const CSS_VARIABLE = "--pos-sale-visible-height";
const MIN_PANEL_HEIGHT = 320;
const BOTTOM_GAP = 14;

function viewportBottom() {
  const viewport = window.visualViewport;
  if (viewport && Number.isFinite(viewport.height) && viewport.height > 0) {
    return viewport.offsetTop + viewport.height;
  }
  return window.innerHeight;
}

export function PosSaleViewportGuard() {
  useEffect(() => {
    let frame = 0;
    let currentPanel: HTMLElement | null = null;

    const sync = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const root = document.querySelector<HTMLElement>('[data-pos-authenticated="true"]');
        const panel = root?.querySelector<HTMLElement>(".pos-cart-panel") ?? null;

        if (currentPanel && currentPanel !== panel) currentPanel.style.removeProperty(CSS_VARIABLE);
        currentPanel = panel;
        if (!root || !panel) return;

        if (root.dataset.posSquareFlowMode !== "sale") {
          panel.style.removeProperty(CSS_VARIABLE);
          return;
        }

        const top = panel.getBoundingClientRect().top;
        const available = Math.max(MIN_PANEL_HEIGHT, Math.floor(viewportBottom() - top - BOTTOM_GAP));
        panel.style.setProperty(CSS_VARIABLE, `${available}px`);
      });
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "data-pos-authenticated", "data-pos-square-flow-mode"]
    });

    window.addEventListener("resize", sync, { passive: true });
    window.addEventListener("orientationchange", sync, { passive: true });
    window.visualViewport?.addEventListener("resize", sync, { passive: true });
    window.visualViewport?.addEventListener("scroll", sync, { passive: true });

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", sync);
      window.removeEventListener("orientationchange", sync);
      window.visualViewport?.removeEventListener("resize", sync);
      window.visualViewport?.removeEventListener("scroll", sync);
      currentPanel?.style.removeProperty(CSS_VARIABLE);
    };
  }, []);

  return null;
}
