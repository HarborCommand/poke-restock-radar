"use client";

import { useLayoutEffect } from "react";

const CSS_VARIABLE = "--pos-visible-height";
const LOCK_ATTRIBUTE = "data-pos-viewport-locked";
const CHECKOUT_SELECTOR = '[data-pos-register-view="checkout"][data-pos-authenticated="true"]';
const ALLOWED_SCROLL_SELECTOR = [
  ".pos-result-grid",
  ".pos-cart-lines:not(.is-empty)",
  ".pos-customer-results",
  '[data-pos-square-flow-mode="payment"] .pos-cart-panel',
  '[data-pos-square-flow-mode="customer"] .pos-cart-panel'
].join(",");

function visibleHeight() {
  const viewportHeight = window.visualViewport?.height;
  const height = Number.isFinite(viewportHeight) && Number(viewportHeight) > 0 ? Number(viewportHeight) : window.innerHeight;
  return Math.max(320, Math.round(height));
}

function checkoutIsActive() {
  return Boolean(document.querySelector<HTMLElement>(CHECKOUT_SELECTOR));
}

function eventTargetElement(target: EventTarget | null) {
  if (target instanceof Element) return target;
  if (target instanceof Node) return target.parentElement;
  return null;
}

function closestAllowedScroller(target: EventTarget | null) {
  return eventTargetElement(target)?.closest<HTMLElement>(ALLOWED_SCROLL_SELECTOR) ?? null;
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
    let lastTouchY: number | null = null;

    const sync = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        document.documentElement.style.setProperty(CSS_VARIABLE, `${visibleHeight()}px`);
        setViewportLock(checkoutIsActive());
      });
    };

    const rememberTouch = (event: TouchEvent) => {
      lastTouchY = event.touches[0]?.clientY ?? null;
    };

    const lockBodyTouch = (event: TouchEvent) => {
      if (!checkoutIsActive()) return;
      const touch = event.touches[0];
      if (!touch) return;

      const scroller = closestAllowedScroller(event.target);
      if (!scroller) {
        event.preventDefault();
        lastTouchY = touch.clientY;
        return;
      }

      const maxScrollTop = scroller.scrollHeight - scroller.clientHeight;
      if (maxScrollTop <= 1) {
        event.preventDefault();
        lastTouchY = touch.clientY;
        return;
      }

      const previousTouchY = lastTouchY ?? touch.clientY;
      const deltaY = touch.clientY - previousTouchY;
      lastTouchY = touch.clientY;

      const pullingPastTop = scroller.scrollTop <= 0 && deltaY > 0;
      const pushingPastBottom = scroller.scrollTop >= maxScrollTop - 1 && deltaY < 0;
      if (pullingPastTop || pushingPastBottom) event.preventDefault();
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
    document.addEventListener("touchstart", rememberTouch, { passive: true });
    document.addEventListener("touchmove", lockBodyTouch, { passive: false });

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", sync);
      window.removeEventListener("orientationchange", sync);
      window.visualViewport?.removeEventListener("resize", sync);
      window.visualViewport?.removeEventListener("scroll", sync);
      window.removeEventListener("scroll", sync);
      document.removeEventListener("touchstart", rememberTouch);
      document.removeEventListener("touchmove", lockBodyTouch);
      document.documentElement.style.removeProperty(CSS_VARIABLE);
      setViewportLock(false);
    };
  }, []);

  return null;
}
