"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    const requestId = crypto.randomUUID();
    const safeMessage = error.message
      .replace(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi, "[REDACTED_EMAIL]")
      .replace(/bearer\s+[^\s]+/gi, "Bearer [REDACTED]")
      .replace(/https?:\/\/[^\s?#]+(?:\?[^\s#]*)?(?:#[^\s]*)?/gi, (value) => {
        try {
          const url = new URL(value);
          return `${url.origin}${url.pathname}`;
        } catch {
          return "[REDACTED_URL]";
        }
      })
      .slice(0, 500);
    void fetch("/api/client-errors", {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": requestId },
      body: JSON.stringify({
        event: "route_error",
        message: safeMessage || error.name,
        component: "app-error-boundary",
        url: `${window.location.origin}${window.location.pathname}`,
        requestId
      })
    }).catch(() => undefined);
  }, [error]);

  return (
    <main className="route-state-page">
      <section className="route-state-card" role="alert">
        <div className="avatar">
          <AlertTriangle size={18} />
        </div>
        <p className="eyeline">System guard</p>
        <h1>Something went wrong</h1>
        <p>
          The storefront could not finish loading. Try again, then contact support or check System Status if the issue
          repeats.
        </p>
        <button className="primary-action" type="button" onClick={reset}>
          <RefreshCw size={16} />
          Retry
        </button>
      </section>
    </main>
  );
}
