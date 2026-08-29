"use client";

import { useLayoutEffect } from "react";

const CSS_VARIABLE = "--pos-visible-height";
const LOCK_ATTRIBUTE = "data-pos-viewport-locked";
const CHECKOUT_SELECTOR = '[data-pos-register-view="checkout"][data-pos-authenticated="true"]';

function visibleHeight() {
  const viewportHeight = window.visualViewport?.height;
  const height = Number.isFinite(viewportHeight) && Number(viewportHeight) > 0 ? Number(viewportHeight) : window.innerHeight;
  return Math.max(320, Math.round(height));
}

function checkoutIsActive() {
  return Boolean(document.querySelector<HTMLElement>(CHECKOUT_SELECTOR));
}

function setViewportLock(locked: boolean) {
  const root = document.documentElement;
  const { body } = document;

  if (locked) {
    root.setAttribute(LOCK_ATTRIBUTE, "true");
    body.setAttribute(LOCK_ATTRIBUTE, "true");
    if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0);
    return;
  }

  root.removeAttribute(LOCK_ATTRIBUTE);
  body.removeAttribute(LOCK_ATTRIBUTE);
}

export function PosVisibleViewport() {
  useLayoutEffect(() => {
    let frame = 0;

    const sync = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        document.documentElement.style.setProperty(CSS_VARIABLE, `${visibleHeight()}px`);
        setViewportLock(checkoutIsActive());
      });
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "data-pos-authenticated", "data-pos-register-view"]
    });

    window.addEventListener("resize", sync, { passive: true });
    window.addEventListener("orientationchange", sync, { passive: true });
    window.visualViewport?.addEventListener("resize", sync, { passive: true });
    window.visualViewport?.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("scroll", sync, { passive: true });

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", sync);
      window.removeEventListener("orientationchange", sync);
      window.visualViewport?.removeEventListener("resize", sync);
      window.visualViewport?.removeEventListener("scroll", sync);
      window.removeEventListener("scroll", sync);
      document.documentElement.style.removeProperty(CSS_VARIABLE);
      setViewportLock(false);
    };
  }, []);

  return null;
}
