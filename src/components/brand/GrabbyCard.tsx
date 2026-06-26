import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { GrabbyMascot } from "@/components/brand/GrabbyMascot";
import { GRABBY_NAME, GRABBY_TAGLINE, grabbyCopy, type GrabbyVariant } from "@/lib/grabby-copy";

type GrabbyCardProps = {
  variant: GrabbyVariant;
  title?: string;
  message?: string;
  ctaHref?: string;
  ctaLabel?: string;
  compact?: boolean;
  className?: string;
};

export function GrabbyCard({
  variant,
  title,
  message,
  ctaHref,
  ctaLabel,
  compact = false,
  className = ""
}: GrabbyCardProps) {
  const copy = grabbyCopy[variant];
  const resolvedCtaLabel = ctaLabel ?? copy.ctaLabel;

  return (
    <article className={`grabby-card ${variant} ${compact ? "compact" : ""} ${className}`.trim()}>
      <GrabbyMascot variant={variant} size={compact ? "small" : "medium"} />
      <div className="grabby-card-copy">
        <p className="grabby-card-kicker">{GRABBY_NAME} - {GRABBY_TAGLINE}</p>
        <h2>{title ?? copy.title}</h2>
        <p>{message ?? copy.message}</p>
        {ctaHref && resolvedCtaLabel ? (
          <Link href={ctaHref} className="grabby-card-link">
            {resolvedCtaLabel}
            <ChevronRight size={15} aria-hidden="true" />
          </Link>
        ) : null}
      </div>
    </article>
  );
}
