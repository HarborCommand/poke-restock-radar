"use client";

import Image from "next/image";
import { type CSSProperties, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Gift, Sparkles, X } from "lucide-react";
import { REWARD_TIERS } from "@/lib/reward-tiers";

type RewardsLevelUpProps = {
  currentTierIndex: number;
  highestAcknowledgedTier: number;
  points: number;
  pointsToNext: number;
  progressPercent: number;
};

const focusableSelector = 'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
const confettiColors = ["gold", "green", "blue", "purple", "cream"] as const;
const confettiShapes = ["rectangle", "diamond", "sparkle"] as const;
const subscribeToDocument = () => () => undefined;
const getClientPortalTarget = (): HTMLElement | null => document.body;
const getServerPortalTarget = (): HTMLElement | null => null;
const confettiPieces = Array.from({ length: 36 }, (_, index) => ({
  color: confettiColors[index % confettiColors.length],
  shape: confettiShapes[index % confettiShapes.length],
  style: {
    "--gdg-confetti-left": `${(index * 37 + 7) % 100}%`,
    "--gdg-confetti-size": `${5 + (index % 4) * 2}px`,
    "--gdg-confetti-delay": `${(index % 8) * 0.1}s`,
    "--gdg-confetti-duration": `${3.55 + (index % 5) * 0.15}s`,
    "--gdg-confetti-drift": `${((index * 29) % 81) - 40}px`,
    "--gdg-confetti-spin": `${360 + (index % 6) * 90}deg`
  } as CSSProperties
}));

export function RewardsLevelUp({
  currentTierIndex,
  highestAcknowledgedTier,
  points,
  pointsToNext,
  progressPercent
}: RewardsLevelUpProps) {
  const shouldCelebrate = currentTierIndex > highestAcknowledgedTier && currentTierIndex > 0;
  const [open, setOpen] = useState(shouldCelebrate);
  const portalTarget = useSyncExternalStore(subscribeToDocument, getClientPortalTarget, getServerPortalTarget);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const savingRef = useRef(false);
  const tier = REWARD_TIERS[currentTierIndex] ?? REWARD_TIERS[0];
  const nextTier = REWARD_TIERS[currentTierIndex + 1] ?? null;

  const acknowledge = useCallback(async (viewRewards = false) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/account/rewards/tier-acknowledgment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tier: currentTierIndex })
      });
      if (!response.ok) throw new Error("acknowledgment_failed");
      setOpen(false);
      if (viewRewards) requestAnimationFrame(() => document.getElementById("rewards-tier-journey")?.scrollIntoView({ behavior: "smooth" }));
    } catch {
      setError("We couldn't save this celebration yet. Please try again.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [currentTierIndex]);

  useEffect(() => {
    if (!open || !portalTarget) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const first = dialog?.querySelector<HTMLElement>(focusableSelector);
    first?.focus();
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const bodyStyle = document.body.style;
    const rootStyle = document.documentElement.style;
    const previousBodyStyles = {
      overflow: bodyStyle.overflow,
      paddingRight: bodyStyle.paddingRight,
      position: bodyStyle.position,
      top: bodyStyle.top,
      left: bodyStyle.left,
      right: bodyStyle.right,
      width: bodyStyle.width
    };
    const previousOverscrollBehavior = rootStyle.overscrollBehavior;
    const scrollbarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    const bodyPaddingRight = Number.parseFloat(window.getComputedStyle(document.body).paddingRight) || 0;
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.left = `-${scrollX}px`;
    document.body.style.right = "0";
    document.body.style.width = "100%";
    if (scrollbarWidth) document.body.style.paddingRight = `${bodyPaddingRight + scrollbarWidth}px`;
    document.documentElement.style.overscrollBehavior = "none";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void acknowledge();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
      if (!focusable.length) return;
      const firstItem = focusable[0];
      const lastItem = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      Object.assign(document.body.style, previousBodyStyles);
      document.documentElement.style.overscrollBehavior = previousOverscrollBehavior;
      window.scrollTo(scrollX, scrollY);
      returnFocusRef.current?.focus();
    };
  }, [acknowledge, open, portalTarget]);

  if (!open || !portalTarget) return null;

  return createPortal(
    <div className="gdg-level-up-backdrop" role="presentation">
      <div className="gdg-level-up-confetti" aria-hidden="true">
        {confettiPieces.map((piece, index) => (
          <i
            key={index}
            className={`gdg-level-up-confetti-piece ${piece.color} ${piece.shape}`}
            style={piece.style}
          />
        ))}
      </div>
      <div
        ref={dialogRef}
        className="gdg-level-up-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gdg-level-up-title"
        aria-describedby="gdg-level-up-copy"
      >
        <button className="gdg-level-up-close" type="button" onClick={() => void acknowledge()} disabled={saving} aria-label="Close level-up celebration">
          <X size={20} aria-hidden="true" />
        </button>
        <p className="gdg-level-up-kicker"><Sparkles size={16} aria-hidden="true" /> New tier unlocked</p>
        <h2 id="gdg-level-up-title">Level Up!</h2>
        <p className="gdg-level-up-now">You are now</p>
        <strong className="gdg-level-up-tier">{tier.name}</strong>
        <div className="gdg-level-up-badge-wrap">
          <span aria-hidden="true" />
          <Image src={tier.asset} alt={`${tier.name} tier badge`} width={300} height={300} priority />
        </div>
        <p id="gdg-level-up-copy" className="gdg-level-up-copy">Nice work, Collector! Your dedication is paying off. New rewards are unlocked—keep the momentum going.</p>
        <div className="gdg-level-up-stats">
          <div><span>Your points</span><strong>{points.toLocaleString()}</strong><small>points</small></div>
          <div><span>Next milestone</span><strong>{nextTier?.name ?? "Top tier"}</strong><small>{nextTier ? `${pointsToNext.toLocaleString()} points to go` : "Legendary status"}</small></div>
          <div><span>Progress to next level</span><strong>{Math.round(progressPercent)}%</strong><div className="gdg-level-up-progress" aria-hidden="true"><i style={{ width: `${progressPercent}%` }} /></div></div>
        </div>
        {error ? <p className="gdg-level-up-error" role="alert">{error}</p> : null}
        <button className="gdg-level-up-primary" type="button" onClick={() => void acknowledge()} disabled={saving}>
          <Sparkles size={17} aria-hidden="true" /> {saving ? "Saving…" : "Awesome!"}
        </button>
        <button className="gdg-level-up-secondary" type="button" onClick={() => void acknowledge(true)} disabled={saving}>
          <Gift size={17} aria-hidden="true" /> View rewards
        </button>
        <p className="gdg-level-up-lock">Redemptions remain unavailable during the celebration.</p>
        <span className="sr-only" aria-live="assertive">Level up! You are now {tier.name}.</span>
      </div>
    </div>,
    portalTarget
  );
}
