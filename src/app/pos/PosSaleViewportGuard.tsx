"use client";

import { useEffect } from "react";

const CSS_VARIABLE = "--pos-sale-visible-height";
const WORKSPACE_VARIABLE = "--pos-sale-workspace-height";
const ROOT_VARIABLE = "--pos-sale-root-height";
const MIN_PANEL_HEIGHT = 320;
const MIN_WORKSPACE_HEIGHT = 420;
const BOTTOM_GAP = 64;

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
    let currentRoot: HTMLElement | null = null;
    let currentWorkspace: HTMLElement | null = null;
    let currentPanel: HTMLElement | null = null;

    const sync = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const root = document.querySelector<HTMLElement>('[data-pos-register-view="checkout"][data-pos-authenticated="true"]');
        const workspace = root?.querySelector<HTMLElement>(".pos-workspace") ?? null;
        const panel = root?.querySelector<HTMLElement>(".pos-cart-panel") ?? null;

        if (currentRoot && currentRoot !== root) currentRoot.style.removeProperty(ROOT_VARIABLE);
        if (currentWorkspace && currentWorkspace !== workspace) currentWorkspace.style.removeProperty(WORKSPACE_VARIABLE);
        if (currentPanel && currentPanel !== panel) currentPanel.style.removeProperty(CSS_VARIABLE);
        currentRoot = root;
        currentWorkspace = workspace;
        currentPanel = panel;
        if (!root || !workspace || !panel) return;

        if (root.dataset.posSquareFlowMode !== "sale") {
          root.style.removeProperty(ROOT_VARIABLE);
          workspace.style.removeProperty(WORKSPACE_VARIABLE);
          panel.style.removeProperty(CSS_VARIABLE);
          return;
        }

        const bottom = viewportBottom() - BOTTOM_GAP;
        const visibleHeight = Math.max(MIN_WORKSPACE_HEIGHT, Math.floor(viewportBottom()));
        const workspaceTop = workspace.getBoundingClientRect().top;
        const panelTop = panel.getBoundingClientRect().top;
        const workspaceAvailable = Math.max(MIN_WORKSPACE_HEIGHT, Math.floor(bottom - workspaceTop));
        const panelAvailable = Math.max(MIN_PANEL_HEIGHT, Math.floor(bottom - panelTop));

        root.style.setProperty(ROOT_VARIABLE, `${visibleHeight}px`);
        workspace.style.setProperty(WORKSPACE_VARIABLE, `${workspaceAvailable}px`);
        panel.style.setProperty(CSS_VARIABLE, `${panelAvailable}px`);
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
      currentRoot?.style.removeProperty(ROOT_VARIABLE);
      currentWorkspace?.style.removeProperty(WORKSPACE_VARIABLE);
      currentPanel?.style.removeProperty(CSS_VARIABLE);
    };
  }, []);

  return null;
}
