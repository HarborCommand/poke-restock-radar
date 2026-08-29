const MIN_VISIBLE_HEIGHT = 320;
const MIN_VISIBLE_WIDTH = 280;

function positiveFinite(value: number | null | undefined) {
  return Number.isFinite(value) && Number(value) > 0 ? Number(value) : null;
}

export function isPosHomeScreenMode() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;

  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  const userAgent = window.navigator.userAgent || "";
  const platform = window.navigator.platform || "";
  const appleTouchDevice =
    window.navigator.maxTouchPoints > 1 &&
    (/iPad|iPhone|iPod/.test(userAgent) || platform === "MacIntel" || /Macintosh/.test(userAgent));

  let launchedFromPosShortcut = false;
  try {
    launchedFromPosShortcut = new URL(window.location.href).searchParams.get("source") === "pos-pwa";
  } catch {
    launchedFromPosShortcut = false;
  }

  return Boolean(
    window.matchMedia?.("(display-mode: standalone)").matches ||
      navigatorWithStandalone.standalone ||
      launchedFromPosShortcut ||
      appleTouchDevice
  );
}

export function getUsableViewportHeight() {
  if (typeof window === "undefined") return MIN_VISIBLE_HEIGHT;

  const layoutHeight = positiveFinite(window.innerHeight);
  const visualHeight = positiveFinite(window.visualViewport?.height);
  const measuredHeight = visualHeight ?? layoutHeight ?? MIN_VISIBLE_HEIGHT;
  if (!isPosHomeScreenMode()) return Math.max(MIN_VISIBLE_HEIGHT, Math.round(measuredHeight));

  const availableHeights = [layoutHeight, visualHeight].filter((value): value is number => value !== null);
  const usableHeight = availableHeights.length ? Math.min(...availableHeights) : measuredHeight;
  return Math.max(MIN_VISIBLE_HEIGHT, Math.round(usableHeight));
}

export function getUsableViewportWidth() {
  if (typeof window === "undefined") return MIN_VISIBLE_WIDTH;

  const layoutWidth = positiveFinite(window.innerWidth);
  const visualWidth = positiveFinite(window.visualViewport?.width);
  const measuredWidth = visualWidth ?? layoutWidth ?? MIN_VISIBLE_WIDTH;
  if (!isPosHomeScreenMode()) return Math.max(MIN_VISIBLE_WIDTH, Math.round(measuredWidth));

  const availableWidths = [layoutWidth, visualWidth].filter((value): value is number => value !== null);
  const usableWidth = availableWidths.length ? Math.min(...availableWidths) : measuredWidth;
  return Math.max(MIN_VISIBLE_WIDTH, Math.round(usableWidth));
}
