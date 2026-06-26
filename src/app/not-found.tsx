import Link from "next/link";
import { GrabbyCard } from "@/components/brand/GrabbyCard";

export default function NotFound() {
  return (
    <main className="route-state-page">
      <section className="route-state-card route-state-card-grabby">
        <GrabbyCard variant="error" ctaHref="/shop" ctaLabel="Keep shopping" />
        <Link className="primary-action secondary" href="/">
          Back to home
        </Link>
      </section>
    </main>
  );
}
