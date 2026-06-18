import { notFound } from "next/navigation";
import { StorefrontCollectionView } from "@/components/StorefrontServerViews";
import {
  getStorefrontCollection,
  storefrontCollectionMetadata,
  storefrontCollections
} from "@/lib/storefront-collections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function generateStaticParams() {
  return storefrontCollections.map((collection) => ({ slug: collection.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const collection = getStorefrontCollection(slug);
  if (!collection) return {};
  return storefrontCollectionMetadata(collection);
}

export default async function CollectionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!getStorefrontCollection(slug)) notFound();
  return <StorefrontCollectionView slug={slug} />;
}
