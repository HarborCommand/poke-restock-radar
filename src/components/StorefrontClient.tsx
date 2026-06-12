"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  BadgeCheck,
  Check,
  ChevronRight,
  CreditCard,
  ExternalLink,
  Heart,
  Lock,
  Mail,
  Menu,
  MessageCircle,
  Minus,
  Package,
  Phone,
  Plus,
  Search,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Star,
  Trash2,
  Truck,
  Trophy,
  User,
  X
} from "lucide-react";
import { GAMEDAYGRABS_SPORTS_CARDS_URL } from "@/lib/storefront-routing";
import {
  storefrontImageBadges,
  storefrontMatchesAvailability,
  storefrontPrimaryActionDisabled,
  isSoldOutProduct,
  isNewArrival,
  type StorefrontAvailabilityFilter
} from "@/lib/storefront-badges";
import { displayStorefrontCategory, storefrontCategoryMatches } from "@/lib/storefront-categories";
import { cleanStorefrontDescription, cleanStorefrontTitle, storefrontSoldOutNote } from "@/lib/storefront-copy";
import { homepageArrivalSection, selectHomepageHeroProduct } from "@/lib/storefront-home";
import type { PublicStoreProductDTO, StorefrontSettingsDTO } from "@/types/radar";

type CartItem = { id: string; quantity: number };

const cartKey = "poke-radar-cart";
const storefrontLogoPath = "/brand/gamedaygrabs-logo-horizontal.png";
const preferredCategories = [
  "Pokemon Sealed",
  "Booster Bundles",
  "Booster Boxes",
  "Elite Trainer Boxes",
  "Premium Collections",
  "Sleeved Boosters",
  "Blisters",
  "Tins",
  "Collection Boxes",
  "Sports Cards",
  "Graded Cards"
];
const homeCategories = [
  "Pokemon Sealed",
  "Booster Bundles",
  "Elite Trainer Boxes",
  "Premium Collections",
  "Sports Cards",
  "Graded Cards"
];

const categorySubtitles: Record<string, string> = {
  "Pokemon Sealed": "Sealed Pokémon products",
  "Booster Bundles": "Compact pack bundles",
  "Booster Boxes": "Full display boxes",
  "Elite Trainer Boxes": "ETBs and trainer kits",
  "Premium Collections": "Collector boxes",
  "Sleeved Boosters": "Single pack products",
  "Blisters": "Blisters and checklanes",
  "Tins": "Tins and Poké Balls",
  "Collection Boxes": "Boxed collections",
  "Sports Cards": "Shop on eBay",
  "Graded Cards": "Slabs and singles"
};

function categoryToSlug(category: string) {
  return category
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function categoryFromParam(value: string | null | undefined) {
  if (!value) return "all";
  const normalized = categoryToSlug(value);
  if (normalized === "pokemon") return "Pokemon Sealed";
  const match = preferredCategories.find((entry) => categoryToSlug(entry) === normalized);
  return match ?? "all";
}

function sortFromParam(value: string | null | undefined) {
  return ["newest", "price-low", "price-high", "stock"].includes(value ?? "") ? String(value) : "newest";
}

function availabilityFromParam(value: string | null | undefined): StorefrontAvailabilityFilter {
  if (value === "all" || value === "sold-out" || value === "in-stock") {
    return value;
  }
  return "in-stock";
}

function categoryHref(category: string) {
  return `/shop?category=${categoryToSlug(category)}`;
}

function money(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "TBD";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function publicCategoryLabel(category: string) {
  return cleanStorefrontTitle(category);
}

function displayStoreName(settings: StorefrontSettingsDTO) {
  return settings.storeName && !/poke radar/i.test(settings.storeName) ? settings.storeName : "GameDayGrabs LLC";
}

function checkoutModeLabel(settings: StorefrontSettingsDTO) {
  return settings.checkoutConfigured ? "Add to Cart" : "Request Invoice";
}

function sportsCardsLink(settings: StorefrontSettingsDTO) {
  const externalUrl = settings.sportsCardsExternalUrl?.trim() || GAMEDAYGRABS_SPORTS_CARDS_URL;
  return {
    href: externalUrl || "/shop?category=sports-cards",
    external: Boolean(externalUrl)
  };
}

function readCart(): CartItem[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(cartKey) || "[]");
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => ({ id: String(item.id || ""), quantity: Number(item.quantity || 0) }))
        .filter((item) => item.id && item.quantity > 0);
    }
  } catch {
    return [];
  }
  return [];
}

function writeCart(items: CartItem[]) {
  window.localStorage.setItem(cartKey, JSON.stringify(items));
  window.dispatchEvent(new CustomEvent("poke-radar-cart", { detail: items }));
}

function addToCart(product: PublicStoreProductDTO, quantity = 1) {
  const cart = readCart();
  const existing = cart.find((item) => item.id === product.id);
  const nextQuantity = Math.min(product.maxQuantityPerOrder, product.availableQuantity, (existing?.quantity ?? 0) + quantity);
  const next = existing
    ? cart.map((item) => (item.id === product.id ? { ...item, quantity: nextQuantity } : item))
    : [...cart, { id: product.id, quantity: nextQuantity }];
  writeCart(next);
}

function categoryPreviewCards(products: PublicStoreProductDTO[], categories: string[]) {
  const usedImages = new Set<string>();
  return categories.slice(0, 6).map((category) => {
    const useProductImage = category !== "Sports Cards" && category !== "Graded Cards";
    const imageUrl = useProductImage
      ? (products.find((product) => {
          if (!product.imageUrl || usedImages.has(product.imageUrl)) return false;
          const specificCategory = displayStorefrontCategory(product);
          if (category === "Pokemon Sealed" && specificCategory !== "Pokemon Sealed") return false;
          if (category !== "Pokemon Sealed" && specificCategory !== category && !storefrontCategoryMatches(product, category)) return false;
          usedImages.add(product.imageUrl);
          return true;
        })?.imageUrl ?? null)
      : null;
    return { category, imageUrl, subtitle: categorySubtitles[category] ?? "Shop category", tone: categoryToSlug(category) };
  });
}

function CategoryVisual({ category, imageUrl }: { category: string; imageUrl: string | null }) {
  if (imageUrl) {
    return <Image src={imageUrl} alt="" width={260} height={200} unoptimized />;
  }

  if (category === "Sports Cards") {
    return (
      <span className="gdg-category-illustration gdg-category-illustration-sports" aria-hidden="true">
        <span className="gdg-ebay-mark">
          <b>e</b>
          <b>B</b>
          <b>a</b>
          <b>y</b>
        </span>
        <span className="gdg-sports-card-stack">
          <i />
          <i />
          <i />
        </span>
      </span>
    );
  }

  if (category === "Graded Cards") {
    return (
      <span className="gdg-category-illustration gdg-category-illustration-graded" aria-hidden="true">
        <span className="gdg-graded-slab">
          <small>GRADED</small>
          <b>10</b>
          <i />
        </span>
      </span>
    );
  }

  return (
    <span className={`gdg-category-illustration gdg-category-illustration-${categoryToSlug(category)}`} aria-hidden="true">
      <Package size={30} />
      <i />
      <i />
    </span>
  );
}

function ProductImage({
  product,
  size = "card",
  showBadges = false,
  newArrivalDays = 14
}: {
  product: Pick<PublicStoreProductDTO, "title" | "imageUrl" | "availableQuantity" | "status" | "publishedAt" | "createdAt">;
  size?: "card" | "hero" | "thumb" | "detail";
  showBadges?: boolean;
  newArrivalDays?: number;
}) {
  const badges = showBadges ? storefrontImageBadges(product, newArrivalDays) : [];
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const imageFailed = Boolean(product.imageUrl && failedImageUrl === product.imageUrl);

  useEffect(() => {
    if (size !== "hero" || !product.imageUrl) return;
    const image = imageRef.current;
    if (image?.complete && image.naturalWidth <= 160 && image.naturalHeight <= 160) {
      setFailedImageUrl(product.imageUrl);
    }
  }, [product.imageUrl, size]);

  return (
    <div className={`gdg-product-image gdg-product-image-${size} gdg-product-media ${size === "detail" ? "gdg-product-image-detail-media" : ""}`}>
      <div className="gdg-image-badges" aria-hidden="true">
        {badges.map((badge) => (
          <span key={badge.label} className={`gdg-product-badge gdg-product-badge-${badge.variant}`}>
            {badge.label}
          </span>
        ))}
      </div>
      {product.imageUrl && !imageFailed ? (
        <Image
          src={product.imageUrl}
          alt={product.title}
          width={720}
          height={540}
          unoptimized
          ref={imageRef}
          onLoad={(event) => {
            const image = event.currentTarget;
            if (size === "hero" && image.naturalWidth <= 160 && image.naturalHeight <= 160) {
              setFailedImageUrl(product.imageUrl ?? null);
            }
          }}
          onError={() => setFailedImageUrl(product.imageUrl ?? null)}
        />
      ) : (
        <div className="gdg-image-placeholder">
          <Package size={size === "thumb" ? 18 : 30} />
          {size !== "thumb" ? <span>Image coming soon</span> : null}
        </div>
      )}
    </div>
  );
}

export function StorefrontHeader({ settings, homeHref = "/shop" }: { settings: StorefrontSettingsDTO; homeHref?: string }) {
  const [count, setCount] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const storeName = displayStoreName(settings);
  const sportsCards = sportsCardsLink(settings);

  useEffect(() => {
    const sync = () => setCount(readCart().reduce((sum, item) => sum + item.quantity, 0));
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener("poke-radar-cart", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("poke-radar-cart", sync);
    };
  }, []);

  const nav = [
    { href: homeHref, label: "Home", external: false },
    { href: "/shop", label: "Shop", external: false },
    { href: "/shop?category=pokemon", label: "Pokémon", external: false },
    { href: sportsCards.href, label: "Sports Cards", external: sportsCards.external },
    { href: "/shop?sort=newest", label: "New Arrivals", external: false },
    { href: "/about", label: "About", external: false },
    { href: "/policies", label: "Policies", external: false },
    { href: "/contact", label: "Contact", external: false }
  ];

  return (
    <header className="gdg-header">
      <Link href={homeHref} className="gdg-brand" aria-label={`${storeName} home`}>
        <Image
          src={storefrontLogoPath}
          alt={`${storeName} home`}
          width={220}
          height={56}
          className="gdg-brand-logo"
          priority
        />
      </Link>
      <nav className={`gdg-nav ${menuOpen ? "open" : ""}`} aria-label="Public shop navigation">
        {nav.map((item) =>
          item.external ? (
            <a key={item.href} href={item.href} target="_blank" rel="noopener noreferrer" className="gdg-external-nav" onClick={() => setMenuOpen(false)}>
              {item.label}
              <ExternalLink size={12} aria-hidden="true" />
            </a>
          ) : (
            <Link key={item.href} href={item.href} onClick={() => setMenuOpen(false)}>
              {item.label}
            </Link>
          )
        )}
      </nav>
      <div className="gdg-header-actions">
        <a className="gdg-icon-link" href="/shop" aria-label="Search products">
          <Search size={18} />
        </a>
        <Link href="/cart" className="gdg-cart-link" aria-label={`Cart with ${count} items`}>
          <ShoppingBag size={18} />
          {count ? <b>{count}</b> : null}
        </Link>
        <button className="gdg-menu-button" type="button" aria-expanded={menuOpen} aria-label="Open menu" onClick={() => setMenuOpen((value) => !value)}>
          {menuOpen ? <X size={19} /> : <Menu size={19} />}
        </button>
      </div>
    </header>
  );
}

export function StorefrontFooter({ settings, homeHref = "/shop" }: { settings: StorefrontSettingsDTO; homeHref?: string }) {
  const storeName = displayStoreName(settings);
  const sportsCards = sportsCardsLink(settings);
  return (
    <footer className="gdg-footer">
      <div>
        <Link href={homeHref} className="gdg-footer-brand">
          <Image src={storefrontLogoPath} alt={`${storeName} logo`} width={180} height={44} className="gdg-footer-brand-logo" />
          <span className="sr-only">{storeName}</span>
        </Link>
        <p>Pokémon and sports card products for collectors, players, and families.</p>
        {settings.contactEmail ? (
          <a href={`mailto:${settings.contactEmail}`} className="gdg-footer-email">
            <Mail size={15} />
            {settings.contactEmail}
          </a>
        ) : (
          <span className="gdg-footer-email muted">Contact email pending setup</span>
        )}
      </div>
      <nav aria-label="Store footer navigation">
        <Link href={homeHref}>Home</Link>
        <Link href="/shop">Shop</Link>
        <Link href="/shop?category=pokemon">Pokémon</Link>
        {sportsCards.external ? (
          <a href={sportsCards.href} target="_blank" rel="noopener noreferrer" className="gdg-external-nav">
            Sports Cards
            <ExternalLink size={12} aria-hidden="true" />
          </a>
        ) : (
          <Link href={sportsCards.href}>Sports Cards</Link>
        )}
        <Link href="/shop?sort=newest">New Arrivals</Link>
        <Link href="/about">About</Link>
        <Link href="/policies">Policies</Link>
        <Link href="/contact">Contact</Link>
      </nav>
      <small>(c) {new Date().getFullYear()} GameDayGrabs LLC. Availability subject to change.</small>
    </footer>
  );
}

export function StorefrontContactForm({ settings }: { settings: StorefrontSettingsDTO }) {
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submitContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setStatus("");
    setError("");
    try {
      const formData = new FormData(form);
      const response = await fetch("/api/storefront/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: String(formData.get("name") || ""),
          email: String(formData.get("email") || ""),
          subject: String(formData.get("subject") || ""),
          message: String(formData.get("message") || "")
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Message could not be sent.");
      setStatus(payload.message || "Thanks. Your message was saved.");
      form.reset();
    } catch (contactError) {
      setError(contactError instanceof Error ? contactError.message : "Message could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="gdg-contact-form" onSubmit={submitContact}>
      <div>
        <h2>Send a message</h2>
        <p>
          {settings.contactEmail
            ? `Messages go to ${settings.contactEmail} when email is configured.`
            : "Messages are saved as storefront inquiries until a public contact email is configured."}
        </p>
      </div>
      <label>
        Name
        <input name="name" autoComplete="name" required minLength={2} maxLength={120} />
      </label>
      <label>
        Email
        <input name="email" type="email" autoComplete="email" required />
      </label>
      <label>
        Subject
        <input name="subject" required minLength={2} maxLength={160} placeholder="Inventory question" />
      </label>
      <label>
        Message
        <textarea name="message" required minLength={10} maxLength={2000} rows={6} placeholder="Tell us what you are looking for." />
      </label>
      <button className="gdg-primary-button wide" type="submit" disabled={busy}>
        {busy ? "Sending..." : "Send Message"}
      </button>
      {status ? <p className="gdg-toast inline">{status}</p> : null}
      {error ? <p className="gdg-error">{error}</p> : null}
    </form>
  );
}

function ProductCard({
  product,
  settings,
  onAdded
}: {
  product: PublicStoreProductDTO;
  settings: StorefrontSettingsDTO;
  onAdded?: (product: PublicStoreProductDTO) => void;
}) {
  const actionLabel = checkoutModeLabel(settings);
  const actionDisabled = storefrontPrimaryActionDisabled(product);
  const isSoldOut = isSoldOutProduct(product);
  const actionText = actionDisabled ? "Sold Out" : actionLabel;
  const displayCategory = publicCategoryLabel(displayStorefrontCategory(product));
  const productTitle = cleanStorefrontTitle(product.title);

  return (
    <article className="gdg-product-card">
      <Link href={`/shop/product/${product.slug}`} className="gdg-product-media">
        <ProductImage product={product} showBadges newArrivalDays={settings.newArrivalDays} />
      </Link>
      <div className="gdg-product-body">
        <span className="gdg-product-category">{displayCategory}</span>
        <h3>
          <Link href={`/shop/product/${product.slug}`}>{productTitle}</Link>
        </h3>
        <strong>{money(product.price)}</strong>
      </div>
      <footer>
        <span className={isSoldOut ? "gdg-stock out" : "gdg-stock in"}>{isSoldOut ? "Sold Out" : "In Stock"}</span>
        <div className="gdg-card-actions">
          <Link href={`/shop/product/${product.slug}`} className="gdg-secondary-button">
            View Product
          </Link>
          <button
            type="button"
            className="gdg-primary-button compact"
            disabled={actionDisabled}
            onClick={() => {
              addToCart(product);
              onAdded?.(product);
            }}
          >
            {actionText}
          </button>
        </div>
      </footer>
    </article>
  );
}

export function ProductGrid({
  products,
  settings,
  mode = "shop",
  initialCategory,
  initialSort,
  initialAvailability
}: {
  products: PublicStoreProductDTO[];
  settings: StorefrontSettingsDTO;
  mode?: "home" | "shop";
  initialCategory?: string | null;
  initialSort?: string | null;
  initialAvailability?: string | null;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(() => (mode === "shop" ? categoryFromParam(initialCategory) : "all"));
  const [availability, setAvailability] = useState(() => (mode === "shop" ? availabilityFromParam(initialAvailability) : "in-stock"));
  const [sort, setSort] = useState(() => (mode === "shop" ? sortFromParam(initialSort) : "newest"));
  const [notice, setNotice] = useState("");
  const sportsCards = sportsCardsLink(settings);

  const categories = useMemo(() => {
    const fromProducts = Array.from(new Set(products.map((product) => displayStorefrontCategory(product)).filter(Boolean)));
    return ["all", ...preferredCategories, ...fromProducts.filter((entry) => !preferredCategories.includes(entry))];
  }, [products]);

  const visibleProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return products
      .filter((product) => {
        const matchesQuery =
          !normalizedQuery ||
          product.title.toLowerCase().includes(normalizedQuery) ||
          product.category.toLowerCase().includes(normalizedQuery) ||
          displayStorefrontCategory(product).toLowerCase().includes(normalizedQuery) ||
          product.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery));
        const matchesCategory = category === "all" || storefrontCategoryMatches(product, category) || product.category === category;
        const matchesAvailability = storefrontMatchesAvailability(product, availability);
        return matchesQuery && matchesCategory && matchesAvailability;
      })
      .sort((left, right) => {
        if (sort === "price-low") return left.price - right.price;
        if (sort === "price-high") return right.price - left.price;
        if (sort === "stock") return right.availableQuantity - left.availableQuantity;
        return 0;
      });
  }, [availability, category, products, query, sort]);

  const arrivalSection = homepageArrivalSection(products, settings.newArrivalDays);
  const heroProduct = selectHomepageHeroProduct(products, settings);
  const heroCategory = heroProduct ? publicCategoryLabel(displayStorefrontCategory(heroProduct)) : null;
  const heroProductTitle = heroProduct ? cleanStorefrontTitle(heroProduct.title) : "";
  const heroProductBadges = heroProduct
    ? [
        ...(isSoldOutProduct(heroProduct) ? ["Sold Out"] : []),
        ...(isNewArrival(heroProduct, new Date(), settings.newArrivalDays) ? ["New Arrival"] : ["Latest Release"])
      ]
    : [];
  const categoryCards = useMemo(() => categoryPreviewCards(products, homeCategories), [products]);

  function onAdded(product: PublicStoreProductDTO) {
    setNotice(`${cleanStorefrontTitle(product.title)} added. ${settings.checkoutConfigured ? "Open cart to checkout." : "Open cart to request an invoice."}`);
  }

  const isSportsCardsCategory = mode === "shop" && category === "Sports Cards" && sportsCards.external;

  return (
    <>
      {mode === "home" ? (
        <>
          <section className="gdg-hero">
            <div className="gdg-hero-copy">
              <p className="gdg-overline">Pokémon & Sports Cards</p>
              <h1>Collect. Play. Invest.</h1>
              <p>Premium Pokémon and sports card products for collectors, players, and fans.</p>
              <div className="gdg-hero-actions">
                <Link href="/shop" className="gdg-primary-button">
                  Shop Now
                </Link>
                <Link href="/shop?sort=newest" className="gdg-secondary-button">
                  New Arrivals
                </Link>
              </div>
              {heroProduct ? (
                <div className="gdg-hero-feature">
                  <div className="gdg-hero-badge-row">
                    {heroProductBadges.map((badge) => (
                      <span key={badge}>{badge}</span>
                    ))}
                  </div>
                  <small>{heroCategory}</small>
                  <strong>{heroProductTitle}</strong>
                  <b>{money(heroProduct.price)}</b>
                  <Link href={`/shop/product/${heroProduct.slug}`} className="gdg-secondary-button compact">
                    View Product
                  </Link>
                </div>
              ) : null}
            </div>
            <div className="gdg-hero-stage" aria-label="Featured collectible products">
              {heroProduct ? (
                <Link href={`/shop/product/${heroProduct.slug}`} className="gdg-hero-product-link" aria-label={`View ${heroProductTitle}`}>
                  <ProductImage product={heroProduct} size="hero" showBadges newArrivalDays={settings.newArrivalDays} />
                  <span className="gdg-hero-view-cue">
                    View product
                    <ChevronRight size={13} aria-hidden="true" />
                  </span>
                </Link>
              ) : (
                <div className="gdg-hero-placeholder">
                  <span>GameDayGrabs</span>
                  <strong>Premium Card Shop</strong>
                  <small>Published products will appear here.</small>
                </div>
              )}
            </div>
          </section>

          <section className="gdg-trust-bar" aria-label="Store promises">
            {[
              { icon: <BadgeCheck size={19} />, title: "Authentic Products", text: "100% authentic guaranteed" },
              { icon: <ShieldCheck size={19} />, title: "Secure Packaging", text: "Packed carefully for transit" },
              { icon: <Truck size={19} />, title: "Fast Shipping", text: "Secure & tracked delivery" },
              { icon: <ShieldCheck size={19} />, title: "Collector Trusted", text: "Reliable for collectors" }
            ].map((item) => (
              <div key={item.title}>
                <span>{item.icon}</span>
                <strong>{item.title}</strong>
                <small>{item.text}</small>
              </div>
            ))}
          </section>
        </>
      ) : null}

      {notice ? (
        <p className="gdg-toast">
          <Check size={16} /> {notice}
        </p>
      ) : null}

      {mode === "home" ? (
        <>
          <section className="gdg-section">
            <div className="gdg-section-header">
              <div>
                <h2>Shop By Category</h2>
                <p>Choose the sealed products and cards you collect most.</p>
              </div>
              <Link href="/shop">View all</Link>
            </div>
            <div className="gdg-category-grid">
              {categoryCards.map(({ category: entry, imageUrl, subtitle, tone }) => {
                const isSports = entry === "Sports Cards";
                const link = isSports ? sportsCards : { href: categoryHref(entry), external: false };
                const card = (
                  <>
                    <span className={`gdg-category-image gdg-category-image-${tone}`}>
                      <CategoryVisual category={entry} imageUrl={imageUrl} />
                    </span>
                    <span className="gdg-category-copy">
                      <b>{publicCategoryLabel(entry)}</b>
                      <small>{subtitle}</small>
                    </span>
                    {link.external ? (
                      <span className="gdg-category-external">
                        <ExternalLink size={12} aria-hidden="true" />
                        Opens eBay
                      </span>
                    ) : null}
                  </>
                );

                return link.external ? (
                  <a key={entry} href={link.href} target="_blank" rel="noopener noreferrer" className="gdg-category-card">
                    {card}
                  </a>
                ) : (
                  <Link href={link.href} key={entry} className="gdg-category-card">
                    {card}
                  </Link>
                );
              })}
            </div>
          </section>

          <section className="gdg-section">
            <div className="gdg-section-header">
              <div>
                <h2>{arrivalSection.title}</h2>
                <p>{arrivalSection.detail}</p>
              </div>
              <Link href="/shop?sort=newest">View All New Arrivals</Link>
            </div>
            <div className="gdg-arrivals-row">
              {arrivalSection.products.length ? (
                arrivalSection.products.map((product) => <ProductCard key={product.id} product={product} settings={settings} onAdded={onAdded} />)
              ) : (
                <div className="gdg-empty compact">
                  <h3>No public listings yet</h3>
                  <p>Published inventory will appear here automatically.</p>
                </div>
              )}
            </div>
          </section>
        </>
      ) : (
        <section className="gdg-shop-area" id="shop">
          <aside className="gdg-shop-filters">
            <div>
              <h2>Shop All Products</h2>
              <p>Showing {visibleProducts.length} of {products.length} active listings.</p>
            </div>
            <label>
              Search
              <span>
                <Search size={15} />
                <input value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Product, category, tag..." />
              </span>
            </label>
            <label>
              Categories
              <select value={category} onChange={(event) => setCategory(event.currentTarget.value)}>
                {categories.map((entry) => (
                  <option key={entry} value={entry}>
                    {entry === "all" ? "All Products" : publicCategoryLabel(entry)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Availability
              <select
                value={availability}
                onChange={(event) => setAvailability(event.currentTarget.value as StorefrontAvailabilityFilter)}
              >
                <option value="in-stock">In Stock</option>
                <option value="sold-out">Sold Out</option>
                <option value="all">All</option>
              </select>
            </label>
            <button
              type="button"
              className="gdg-filter-clear"
              onClick={() => {
                setQuery("");
                setCategory("all");
                setAvailability("in-stock");
                setSort("newest");
              }}
            >
              Clear Filters
            </button>
          </aside>
          <div className="gdg-shop-list">
            <div className="gdg-shop-toolbar">
              <div>
                <p>Shop</p>
                <h2>{category === "all" ? "All Products" : category}</h2>
              </div>
              <label>
                Sort By
                <select value={sort} onChange={(event) => setSort(event.currentTarget.value)}>
                  <option value="newest">Newest</option>
                  <option value="price-low">Price: Low to High</option>
                  <option value="price-high">Price: High to Low</option>
                  <option value="stock">Most Available</option>
                </select>
              </label>
            </div>
            <div className="gdg-product-grid">
              {isSportsCardsCategory ? (
                <div className="gdg-empty gdg-ebay-empty">
                  <span className="gdg-ebay-icon">
                    <ExternalLink size={22} />
                  </span>
                  <h3>Sports card inventory is currently listed on our eBay store.</h3>
                  <p>Open GameDayGrabs sports card listings on eBay while the internal sports card catalog is being prepared.</p>
                  <a className="gdg-primary-button" href={sportsCards.href} target="_blank" rel="noopener noreferrer">
                    Open eBay Store
                    <ExternalLink size={14} aria-hidden="true" />
                  </a>
                </div>
              ) : visibleProducts.length ? (
                visibleProducts.map((product) => <ProductCard key={product.id} product={product} settings={settings} onAdded={onAdded} />)
              ) : (
                <div className="gdg-empty">
                  <h3>No matching products</h3>
                  <p>Try another category or check back for new public listings.</p>
                </div>
              )}
            </div>
          </div>
        </section>
      )}
    </>
  );
}

export function ProductDetail({
  product,
  settings,
  relatedProducts = []
}: {
  product: PublicStoreProductDTO;
  settings: StorefrontSettingsDTO;
  relatedProducts?: PublicStoreProductDTO[];
}) {
  const [quantity, setQuantity] = useState(1);
  const [notice, setNotice] = useState("");
  const images = product.images.length ? product.images : product.imageUrl ? [product.imageUrl] : [];
  const [selectedImage, setSelectedImage] = useState(images[0] ?? null);
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const isSoldOut = storefrontPrimaryActionDisabled(product);
  const actionLabel = checkoutModeLabel(settings);
  const soldOutActionLabel = isSoldOut ? "Sold Out" : actionLabel;
  const soldOutSecondaryLabel = isSoldOut ? "Sold Out" : settings.checkoutConfigured ? "Buy Now" : "Request Invoice Now";
  const publicDescription = cleanStorefrontDescription(product);
  const displayCategory = publicCategoryLabel(displayStorefrontCategory(product));
  const productTitle = cleanStorefrontTitle(product.title);
  const conditionLabel = cleanStorefrontTitle(product.condition) || "Collector-ready condition";
  const soldOutNote = storefrontSoldOutNote();

  function addProductToCart(redirect = false) {
    addToCart(product, quantity);
    setNotice(settings.checkoutConfigured ? "Added to cart." : "Added to invoice request.");
    if (redirect) window.location.href = "/cart";
  }

  return (
    <>
      <section className="gdg-detail">
        <nav className="gdg-breadcrumb" aria-label="Breadcrumb">
          <Link href="/shop">Home</Link>
          <ChevronRight size={13} />
          <Link href="/shop">Shop</Link>
          <ChevronRight size={13} />
          <span>{displayCategory}</span>
        </nav>
        <div className="gdg-detail-grid">
          <aside className={`gdg-gallery ${images.length > 1 ? "has-thumbs" : "single-image"}`}>
            <div className="gdg-gallery-main">
              <div className="gdg-image-badges gdg-image-badges-detail" aria-hidden="true">
                {storefrontImageBadges(product, settings.newArrivalDays).map((badge) => (
                  <span key={badge.label} className={`gdg-product-badge gdg-product-badge-${badge.variant}`}>
                    {badge.label}
                  </span>
                ))}
              </div>
              {selectedImage && !failedImages.includes(selectedImage) ? (
                <Image
                  src={selectedImage}
                  alt={productTitle}
                  width={900}
                  height={900}
                  unoptimized
                  onError={() => setFailedImages((current) => (current.includes(selectedImage) ? current : [...current, selectedImage]))}
                />
              ) : (
                <div className="gdg-image-placeholder">
                  <Package size={42} />
                  <span>Image coming soon</span>
                </div>
              )}
            </div>
            {images.length > 1 ? (
              <div className="gdg-gallery-thumbs">
                {images.slice(0, 5).map((image) => (
                  <button type="button" key={image} className={image === selectedImage ? "active" : ""} onClick={() => setSelectedImage(image)}>
                    <Image src={image} alt="" width={82} height={82} unoptimized />
                  </button>
                ))}
              </div>
            ) : null}
          </aside>
          <section className="gdg-detail-info">
            <span className="gdg-product-category">{displayCategory}</span>
            <h1>{productTitle}</h1>
            <div className="gdg-detail-price">
              <strong>{money(product.price)}</strong>
              {product.compareAtPrice ? <s>{money(product.compareAtPrice)}</s> : null}
              <span className={isSoldOut ? "gdg-stock out" : "gdg-stock in"}>{isSoldOut ? "Sold Out" : "In Stock"}</span>
            </div>
            <p>{publicDescription}</p>
            <small>Stock visible now: {product.availableQuantity} item{product.availableQuantity === 1 ? "" : "s"}.</small>
            {isSoldOut ? <p className="gdg-soldout-notice">{soldOutNote}</p> : null}
            <div className="gdg-quantity-control">
              <span>Quantity</span>
              <button type="button" onClick={() => setQuantity((current) => Math.max(1, current - 1))} disabled={isSoldOut}>
                <Minus size={15} />
              </button>
              <b>{quantity}</b>
              <button
                type="button"
                disabled={isSoldOut}
                onClick={() => setQuantity((current) => Math.min(product.maxQuantityPerOrder, product.availableQuantity, current + 1))}
              >
                <Plus size={15} />
              </button>
            </div>
            <button
              className="gdg-primary-button wide"
              type="button"
              disabled={isSoldOut}
              onClick={() => addProductToCart(false)}
            >
              {soldOutActionLabel}
            </button>
            <button
              className="gdg-secondary-button wide"
              type="button"
              disabled={isSoldOut}
              onClick={() => addProductToCart(true)}
            >
              {soldOutSecondaryLabel}
            </button>
            <button className="gdg-wishlist-button" type="button">
              <Heart size={15} /> Add to Wishlist
            </button>
            {notice ? (
              <p className="gdg-toast inline">
                <Check size={16} /> {notice}
              </p>
            ) : null}
            <div className="gdg-product-trust">
              {[
                ["Authentic", "100% authentic products"],
                ["Fast Shipping", "Secure & tracked"],
                ["Easy Returns", "Case-by-case support"],
                ["Secure Checkout", "Safe & protected"]
              ].map(([title, text]) => (
                <span key={title}>
                  <ShieldCheck size={15} />
                  <b>{title}</b>
                  <small>{text}</small>
                </span>
              ))}
            </div>
          </section>
        </div>
      </section>
      <section className="gdg-description-section">
        <article>
          <h2>Product Description</h2>
          <p>{publicDescription}</p>
          {isSoldOut ? <p>{soldOutNote}</p> : null}
        </article>
        <article>
          <h2>Product Details</h2>
          <ul>
            <li>Category: {displayCategory}.</li>
            <li>Condition: {conditionLabel}.</li>
            <li>Availability: {isSoldOut ? "Sold Out" : `${product.availableQuantity} available`}.</li>
            <li>{settings.checkoutConfigured ? "Secure Stripe Checkout is available." : "Request Invoice mode is active until online checkout is configured."}</li>
          </ul>
        </article>
        <article>
          <h2>Shipping & Handling</h2>
          <p>{settings.shippingPolicyText || "Products are packed with care and shipped securely with tracking when shipping is selected."}</p>
          <ul>
            <li>Default shipping estimate: {money(settings.defaultShippingPrice)}.</li>
            {settings.freeShippingThreshold ? <li>Free shipping threshold: {money(settings.freeShippingThreshold)}.</li> : null}
            <li>Availability is confirmed before invoice payment or shipment.</li>
          </ul>
        </article>
        <article>
          <h2>Condition Policy</h2>
          <p>{settings.returnPolicyText || "Sealed and collectible products are reviewed carefully before fulfillment. Returns are handled case by case, especially for sealed collectible items."}</p>
          <ul>
            <li>Listings show only customer-facing availability, condition, and checkout details.</li>
            <li>Contact GameDayGrabs before returning any collectible product.</li>
          </ul>
        </article>
      </section>
      {relatedProducts.length ? (
        <section className="gdg-section">
          <div className="gdg-section-header">
            <div>
              <h2>Related Products</h2>
              <p>More published products from GameDayGrabs.</p>
            </div>
            <Link href="/shop">View all</Link>
          </div>
          <div className="gdg-arrivals-row">
            {relatedProducts.slice(0, 4).map((entry) => (
              <ProductCard key={entry.id} product={entry} settings={settings} />
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

function cartStockState(product: PublicStoreProductDTO & { requestedQuantity: number }) {
  if (isSoldOutProduct(product) || product.availableQuantity <= 0) {
    return { label: "Sold Out", tone: "out", detail: "Remove this item to continue." };
  }
  if (product.requestedQuantity > product.availableQuantity) {
    return { label: "Stock Changed", tone: "warn", detail: `Only ${product.availableQuantity} available now.` };
  }
  if (product.availableQuantity <= 2) {
    return { label: "Low Stock", tone: "warn", detail: "Almost gone." };
  }
  if (product.availableQuantity <= 5) {
    return { label: "Limited Stock", tone: "limited", detail: "Small batch available." };
  }
  return { label: "In Stock - Ready to Ship", tone: "in", detail: "Ready for secure checkout." };
}

function cartHasBlockingStockIssue(products: Array<PublicStoreProductDTO & { requestedQuantity: number }>) {
  return products.some((product) => isSoldOutProduct(product) || product.availableQuantity <= 0 || product.requestedQuantity > product.availableQuantity);
}

export function CartClient({ settings }: { settings: StorefrontSettingsDTO }) {
  const [items, setItems] = useState<CartItem[]>(() => readCart());
  const [products, setProducts] = useState<Array<PublicStoreProductDTO & { requestedQuantity: number }>>([]);
  const [message, setMessage] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerNotes, setCustomerNotes] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!items.length) {
      return;
    }
    fetch("/api/storefront/cart", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items })
    })
      .then((response) => response.json())
      .then((payload) => {
        if (payload.error) throw new Error(payload.error);
        setProducts(payload.items);
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : "Cart could not be loaded."));
  }, [items]);

  function updateQuantity(productId: string, quantity: number) {
    const product = products.find((entry) => entry.id === productId);
    const nextQuantity = product ? Math.min(product.availableQuantity, product.maxQuantityPerOrder, Math.max(1, quantity)) : Math.max(1, quantity);
    const next = items.map((item) => (item.id === productId ? { ...item, quantity: nextQuantity } : item));
    setItems(next);
    writeCart(next);
  }

  function removeItem(productId: string) {
    const next = items.filter((item) => item.id !== productId);
    setItems(next);
    if (!next.length) setProducts([]);
    writeCart(next);
  }

  const subtotal = products.reduce((sum, product) => sum + product.price * product.requestedQuantity, 0);
  const shipping = subtotal > 0 && (settings.freeShippingThreshold === null || subtotal < settings.freeShippingThreshold) ? settings.defaultShippingPrice : 0;
  const total = subtotal + shipping;
  const contactEmail = settings.contactEmail || "gamedaygrabs@outlook.com";
  const freeShippingRemaining = settings.freeShippingThreshold !== null ? Math.max(0, settings.freeShippingThreshold - subtotal) : null;
  const freeShippingProgress =
    settings.freeShippingThreshold !== null && settings.freeShippingThreshold > 0
      ? Math.min(100, Math.max(0, (subtotal / settings.freeShippingThreshold) * 100))
      : 0;
  const hasBlockingStockIssue = cartHasBlockingStockIssue(products);
  const soldOutProducts = products.filter((product) => isSoldOutProduct(product) || product.availableQuantity <= 0);
  const overQuantityProducts = products.filter((product) => product.requestedQuantity > product.availableQuantity && product.availableQuantity > 0);
  const checkoutDisabled = busy || !customerEmail.trim() || !customerName.trim() || hasBlockingStockIssue;
  const successMessage = message.toLowerCase().includes("received");
  const cartIsLoading = items.length > 0 && !products.length && !message;

  function removeSoldOutItems() {
    const blockedIds = new Set(soldOutProducts.map((product) => product.id));
    const next = items.filter((item) => !blockedIds.has(item.id));
    setItems(next);
    writeCart(next);
  }

  function syncChangedQuantities() {
    const next = items.map((item) => {
      const product = products.find((entry) => entry.id === item.id);
      if (!product) return item;
      return { ...item, quantity: Math.min(product.availableQuantity, product.maxQuantityPerOrder, Math.max(1, item.quantity)) };
    });
    setItems(next);
    writeCart(next);
    setMessage("Quantity updated because available stock changed.");
  }

  async function checkout() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(settings.checkoutConfigured ? "/api/storefront/checkout/session" : "/api/storefront/invoice-request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items, fulfillmentMethod: "shipping", customerName, customerEmail, customerPhone, customerNotes })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Request could not start.");
      if (settings.checkoutConfigured) {
        if (!payload.checkoutUrl) throw new Error("Checkout could not start.");
        window.location.href = payload.checkoutUrl;
      } else {
        setMessage(`Thanks - we received your request and will contact you shortly at ${contactEmail}.`);
        setItems([]);
        setProducts([]);
        setCustomerNotes("");
        writeCart([]);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Request could not start.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="gdg-cart-page">
      <div className="gdg-cart-header">
        <div>
          <h1>Your Pok&eacute;mon Picks Are Almost Yours! <Sparkles size={28} aria-hidden="true" /></h1>
          <p>Review your cart and complete secure checkout.</p>
        </div>
        <Link href="/shop" className="gdg-secondary-button">
          Continue Shopping
        </Link>
      </div>
      <div className="gdg-checkout-hero">
        <div className="gdg-checkout-trust-row" aria-label="Checkout trust points">
          <article>
            <ShieldCheck size={24} />
            <div>
              <strong>Secure Checkout</strong>
              <small>Your info is protected</small>
            </div>
          </article>
          <article>
            <Truck size={24} />
            <div>
              <strong>Fast Shipping</strong>
              <small>Packed and shipped quickly</small>
            </div>
          </article>
          <article>
            <Package size={24} />
            <div>
              <strong>Carefully Packaged</strong>
              <small>Handled like a collection</small>
            </div>
          </article>
          <article>
            <BadgeCheck size={24} />
            <div>
              <strong>100% Authentic</strong>
              <small>Real products only</small>
            </div>
          </article>
        </div>
        <div className="gdg-cart-hero-visual" aria-hidden="true">
          <Sparkles size={22} />
          <ShoppingBag size={54} />
          <Star size={18} />
        </div>
      </div>
      {message ? <p className={successMessage ? "gdg-toast" : "gdg-error"}>{message}</p> : null}
      {cartIsLoading ? (
        <div className="gdg-empty gdg-cart-empty compact">
          <span>
            <ShoppingCart size={30} />
          </span>
          <h2>Loading your cart...</h2>
          <p>Checking current product availability before checkout.</p>
        </div>
      ) : products.length ? (
        <div className="gdg-cart-grid">
          <div className="gdg-cart-main">
            {hasBlockingStockIssue ? (
              <div className="gdg-cart-stock-warning">
                <div>
                  <strong>Quantity updated because available stock changed.</strong>
                  <small>Review the highlighted item before checkout.</small>
                </div>
                <div className="gdg-card-actions">
                  {overQuantityProducts.length ? (
                    <button className="gdg-secondary-button" type="button" onClick={syncChangedQuantities}>
                      Update quantities
                    </button>
                  ) : null}
                  {soldOutProducts.length ? (
                    <button className="gdg-secondary-button" type="button" onClick={removeSoldOutItems}>
                      Remove sold-out item
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
            <div className="gdg-cart-lines">
              {products.map((product) => {
                const stock = cartStockState(product);
                const title = cleanStorefrontTitle(product.title);
                const maxQuantity = Math.min(product.availableQuantity, product.maxQuantityPerOrder);
                return (
                  <article className={`gdg-cart-line ${stock.tone === "out" || stock.tone === "warn" ? "attention" : ""}`} key={product.id}>
                    <ProductImage product={product} size="thumb" />
                    <div className="gdg-cart-line-copy">
                      <h2>{title}</h2>
                      <small>{publicCategoryLabel(displayStorefrontCategory(product))}</small>
                      <span className={`gdg-cart-stock ${stock.tone}`}>
                        <Check size={13} />
                        {stock.label}
                      </span>
                      <small>{stock.detail}</small>
                      <div className="gdg-quantity-control compact" aria-label={`Quantity for ${title}`}>
                        <button type="button" disabled={product.requestedQuantity <= 1} onClick={() => updateQuantity(product.id, product.requestedQuantity - 1)} aria-label={`Decrease ${title} quantity`}>
                          <Minus size={14} />
                        </button>
                        <b>{product.requestedQuantity}</b>
                        <button type="button" disabled={product.availableQuantity <= 0 || product.requestedQuantity >= maxQuantity} onClick={() => updateQuantity(product.id, product.requestedQuantity + 1)} aria-label={`Increase ${title} quantity`}>
                          <Plus size={14} />
                        </button>
                      </div>
                    </div>
                    <div className="gdg-cart-line-price">
                      <strong>{money(product.price * product.requestedQuantity)}</strong>
                      <small>{money(product.price)} each</small>
                    </div>
                    <button className="gdg-icon-button" type="button" onClick={() => removeItem(product.id)} aria-label={`Remove ${title}`}>
                      <Trash2 size={16} />
                    </button>
                  </article>
                );
              })}
            </div>
            <div className="gdg-cart-assurance">
              <ShieldCheck size={28} />
              <p><strong>Every order is backed by our Authenticity Guarantee.</strong> 100% real Pok&eacute;mon products, packed carefully for collectors.</p>
            </div>
            <div className="gdg-cart-small-business">
              <Trophy size={28} />
              <p><strong>{`You're supporting a small business!`}</strong> Thank you for helping GameDayGrabs grow.</p>
              <Heart size={18} />
            </div>
          </div>
          <aside className="gdg-cart-summary gdg-checkout-panel">
            <div className="gdg-summary-heading">
              <Sparkles size={20} />
              <h2>Order Summary</h2>
            </div>
            <div className="gdg-summary-rows">
              <span>
                <b>Subtotal</b>
                {money(subtotal)}
              </span>
              <span>
                <b>Shipping estimate</b>
                {money(shipping)}
              </span>
              <span>
                <b>Tax</b>
                <em>Calculated after confirmation</em>
              </span>
              <strong>
                <b>Total</b>
                {money(total)}
              </strong>
            </div>
            {settings.freeShippingThreshold !== null && freeShippingRemaining !== null && subtotal > 0 ? (
              <div className="gdg-free-shipping">
                <strong>{freeShippingRemaining > 0 ? `You\u2019re only ${money(freeShippingRemaining)} away from free shipping!` : "Free shipping unlocked!"}</strong>
                <span><i style={{ width: `${freeShippingProgress}%` }} /></span>
                <small>Secure shipping with tracking.</small>
              </div>
            ) : (
              <div className="gdg-free-shipping muted">
                <strong>Orders are packed securely and shipped with tracking.</strong>
                <small>Questions? Email {contactEmail}.</small>
              </div>
            )}
            <label>
              Name
              <span className="gdg-checkout-field">
                <User size={17} />
                <input value={customerName} onChange={(event) => setCustomerName(event.currentTarget.value)} placeholder="Your name" />
              </span>
            </label>
            <label>
              Email
              <span className="gdg-checkout-field">
                <Mail size={17} />
                <input value={customerEmail} onChange={(event) => setCustomerEmail(event.currentTarget.value)} placeholder="you@example.com" type="email" />
              </span>
            </label>
            <label>
              Phone <span>optional</span>
              <span className="gdg-checkout-field">
                <Phone size={17} />
                <input value={customerPhone} onChange={(event) => setCustomerPhone(event.currentTarget.value)} placeholder="Optional phone number" type="tel" />
              </span>
            </label>
            <label>
              Notes <span>optional</span>
              <span className="gdg-checkout-field textarea">
                <MessageCircle size={17} />
                <textarea value={customerNotes} onChange={(event) => setCustomerNotes(event.currentTarget.value)} placeholder="Questions, pickup request, or anything we should know?" rows={4} />
              </span>
            </label>
            {hasBlockingStockIssue ? <p className="gdg-summary-warning">Please remove sold-out items or update changed quantities before checkout.</p> : null}
            <button className="gdg-primary-button wide gdg-checkout-button" type="button" disabled={checkoutDisabled} onClick={checkout}>
              <Lock size={17} />
              <span>
                {busy ? "Working..." : settings.checkoutConfigured ? "Proceed to Checkout" : "Request Invoice"}
                <small>{settings.checkoutConfigured ? "Secure Stripe Checkout" : "No card is charged today"}</small>
              </span>
              <ChevronRight size={18} />
            </button>
            <div className="gdg-payment-row" aria-label="Accepted payment note">
              <CreditCard size={16} />
              <small>{settings.checkoutConfigured ? "Cards accepted securely through Stripe." : `We will contact you shortly at ${contactEmail}.`}</small>
            </div>
            <div className="gdg-payment-icons" aria-hidden="true">
              <span>VISA</span>
              <span>MC</span>
              <span>AMEX</span>
              <span>DISC</span>
              <span>Pay</span>
            </div>
          </aside>
        </div>
      ) : (
        <div className="gdg-empty gdg-cart-empty">
          <span>
            <ShoppingCart size={34} />
          </span>
          <h2>Your cart is waiting for something awesome.</h2>
          <p>Browse Pok&eacute;mon sealed products, sports cards, and collectibles.</p>
          <div className="gdg-card-actions">
            <Link href="/shop?category=pokemon" className="gdg-primary-button">
              Shop Pok&eacute;mon
            </Link>
            <Link href="/shop?sort=newest" className="gdg-secondary-button">
              View New Arrivals
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}

export function CheckoutSuccessClient({ orderReference = "" }: { orderReference?: string }) {
  useEffect(() => {
    writeCart([]);
  }, []);

  return (
    <section className="gdg-result-card">
      <span>
        <Check size={22} />
      </span>
      <h1>Payment received</h1>
      {orderReference ? <p className="gdg-order-reference">Order {orderReference}</p> : null}
      <p>Your order is being confirmed by Stripe. Inventory updates after the secure webhook confirms payment.</p>
      <div className="gdg-result-actions">
        <Link href="/shop" className="gdg-primary-button">
          Back to Shop
        </Link>
        <Link href="/contact" className="gdg-secondary-button">
          Contact GameDayGrabs
        </Link>
      </div>
    </section>
  );
}
