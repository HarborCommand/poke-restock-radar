"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Poke Restock Radar app error", error);
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
          The app kept checkout automation disabled and stopped this screen from rendering. Try again, then check System
          Status if the issue repeats.
        </p>
        <button className="primary-action" type="button" onClick={reset}>
          <RefreshCw size={16} />
          Retry
        </button>
      </section>
    </main>
  );
}
