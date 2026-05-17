import Link from "next/link";
import { Radar } from "lucide-react";

export default function NotFound() {
  return (
    <main className="route-state-page">
      <section className="route-state-card">
        <div className="avatar">
          <Radar size={18} />
        </div>
        <p className="eyeline">Private radar</p>
        <h1>Page not found</h1>
        <p>This route is not available in Poke Restock Radar.</p>
        <Link className="primary-action" href="/">
          Back to dashboard
        </Link>
      </section>
    </main>
  );
}
