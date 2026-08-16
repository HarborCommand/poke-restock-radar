"use client";

import { useLayoutEffect } from "react";

const CSS_VARIABLE = "--pos-visible-height";

function visibleHeight() {
  const viewportHeight = window.visualViewport?.height;
  const height = Number.isFinite(viewportHeight) && Number(viewportHeight) > 0 ? Number(viewportHeight) : window.innerHeight;
  return Math.max(320, Math.round(height));
}

export function PosVisibleViewport() {
  useLayoutEffect(() => {
    let frame = 0;

    const sync = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        document.documentElement.style.setProperty(CSS_VARIABLE, `${visibleHeight()}px`);
      });
    };

    sync();
    window.addEventListener("resize", sync, { passive: true });
    window.addEventListener("orientationchange", sync, { passive: true });
    window.visualViewport?.addEventListener("resize", sync, { passive: true });
    window.visualViewport?.addEventListener("scroll", sync, { passive: true });

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", sync);
      window.removeEventListener("orientationchange", sync);
      window.visualViewport?.removeEventListener("resize", sync);
      window.visualViewport?.removeEventListener("scroll", sync);
      document.documentElement.style.removeProperty(CSS_VARIABLE);
    };
  }, []);

  return null;
}
