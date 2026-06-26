import type { GrabbyVariant } from "@/lib/grabby-copy";
import { GRABBY_ALT_TEXT } from "@/lib/grabby-copy";

type GrabbyMascotProps = {
  variant?: GrabbyVariant;
  size?: "small" | "medium" | "large";
  decorative?: boolean;
  className?: string;
};

export function GrabbyMascot({
  variant = "welcome",
  size = "medium",
  decorative = false,
  className = ""
}: GrabbyMascotProps) {
  const accessibilityProps = decorative
    ? { "aria-hidden": true as const }
    : { role: "img" as const, "aria-label": GRABBY_ALT_TEXT };

  return (
    <span
      className={`grabby-mascot ${size} ${variant} ${className}`.trim()}
      {...accessibilityProps}
    >
      <span className="grabby-mascot-aura" />
      <span className="grabby-mascot-character">
        <span className="grabby-cap">
          <span className="grabby-cap-crown">G</span>
          <span className="grabby-cap-brim" />
        </span>
        <span className="grabby-hair left" />
        <span className="grabby-hair right" />
        <span className="grabby-face">
          <span className="grabby-eye left" />
          <span className="grabby-eye right" />
          <span className="grabby-nose" />
          <span className="grabby-smile" />
        </span>
        <span className="grabby-body">
          <span className="grabby-hoodie-mark">G</span>
          <span className="grabby-zip" />
          <span className="grabby-arm left" />
          <span className="grabby-arm right" />
        </span>
        <span className="grabby-prop" />
      </span>
      <span className="grabby-star one" />
      <span className="grabby-star two" />
    </span>
  );
}
