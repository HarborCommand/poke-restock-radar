"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
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

export function RewardsLevelUp({
  currentTierIndex,
  highestAcknowledgedTier,
  points,
  pointsToNext,
  progressPercent
}: RewardsLevelUpProps) {
  const shouldCelebrate = currentTierIndex > highestAcknowledgedTier && currentTierIndex > 0;
  const [open, setOpen] = useState(shouldCelebrate);
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
    if (!open) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const first = dialog?.querySelector<HTMLElement>(focusableSelector);
    first?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

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
      document.body.style.overflow = previousOverflow;
      returnFocusRef.current?.focus();
    };
  }, [acknowledge, open]);

  if (!open) return null;

  return (
    <div className="gdg-level-up-backdrop" role="presentation">
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
        <div className="gdg-level-up-confetti" aria-hidden="true">
          {Array.from({ length: 12 }, (_, index) => <i key={index} />)}
        </div>
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
    </div>
  );
}
