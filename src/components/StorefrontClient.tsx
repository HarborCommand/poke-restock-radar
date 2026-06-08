"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  BadgeCheck,
  Check,
  ChevronRight,
  ExternalLink,
  Heart,
  Mail,
  Menu,
  Minus,
  Package,
  Plus,
  Search,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Trash2,
  Truck,
  X
} from "lucide-react";
import { GAMEDAYGRABS_SPORTS_CARDS_URL } from "@/lib/storefront-routing";
import type { PublicStoreProductDTO, StorefrontSettingsDTO } from "@/types/radar";

type CartItem = { id: string; quantity: number };

const cartKey = "poke-radar-cart";
const storefrontLogoPath = "/brand/gamedaygrabs-logo-horizontal.png";
const preferredCategories = [
  "Pokemon Sealed",
  "Booster Bundles",
  "Elite Trainer Boxes",
  "Premium Collections",
  "Sleeved Boosters",
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

function availabilityFromParam(value: string | null | undefined) {
  return value === "all" || value === "sold-out" || value === "in-stock" ? value : "in-stock";
}

function categoryHref(category: string) {
  return `/shop?category=${categoryToSlug(category)}`;
}

function money(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "TBD";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function cleanPublicProductDescription(product: PublicStoreProductDTO) {
  const fallback = "Available from GameDayGrabs LLC. This sealed product is listed with clear photos, current availability, and secure request-invoice checkout.";
  const description = product.description?.trim();
  if (!description) return fallback;
  if (/reviewed for clear images|customer-facing pricing|invoice checkout confirmation/i.test(description)) {
    return fallback;
  }
  return description;
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

function categoryMatches(product: PublicStoreProductDTO, category: string) {
  const haystack = `${product.category} ${product.title} ${product.tags.join(" ")}`.toLowerCase();
  const normalized = category.toLowerCase();
  if (normalized === "pokemon sealed") return /pokemon|sealed|booster|trainer|collection|tin|blister/.test(haystack);
  if (normalized === "elite trainer boxes") return /elite trainer|etb/.test(haystack);
  if (normalized === "sports cards") return /sports|bowman|topps|panini|basketball|football|baseball/.test(haystack);
  if (normalized === "graded cards") return /graded|psa|bgs|cgc/.test(haystack);
  return haystack.includes(normalized.replace(/s$/, ""));
}

function categoryPreviewCards(products: PublicStoreProductDTO[], categories: string[]) {
  const usedImages = new Set<string>();
  return categories.slice(0, 6).map((category) => {
    const imageUrl =
      products.find((product) => {
        if (!product.imageUrl || !categoryMatches(product, category) || usedImages.has(product.imageUrl)) return false;
        usedImages.add(product.imageUrl);
        return true;
      })?.imageUrl ?? null;
    return { category, imageUrl };
  });
}

function ProductImage({
  product,
  size = "card"
}: {
  product: Pick<PublicStoreProductDTO, "title" | "imageUrl">;
  size?: "card" | "hero" | "thumb" | "detail";
}) {
  return (
    <div className={`gdg-product-image gdg-product-image-${size}`}>
      {product.imageUrl ? <Image src={product.imageUrl} alt={product.title} width={720} height={540} unoptimized /> : <Package size={size === "thumb" ? 18 : 30} />}
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
    { href: "/shop", label: "Shop", external: false },
    { href: "/shop?category=pokemon", label: "Pokemon", external: false },
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
        <p>Pokemon and sports card products for collectors, players, and families.</p>
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
        <Link href="/shop">Shop</Link>
        <Link href="/shop?category=pokemon">Pokemon</Link>
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
  return (
    <article className="gdg-product-card">
      <Link href={`/shop/product/${product.slug}`} className="gdg-product-media">
        <ProductImage product={product} />
      </Link>
      <div className="gdg-product-body">
        <span className="gdg-product-category">{product.category}</span>
        <h3>
          <Link href={`/shop/product/${product.slug}`}>{product.title}</Link>
        </h3>
        <strong>{money(product.price)}</strong>
      </div>
      <footer>
        <span className={product.availableQuantity > 0 ? "gdg-stock in" : "gdg-stock out"}>{product.availableQuantity > 0 ? "In Stock" : "Sold Out"}</span>
        <div className="gdg-card-actions">
          <Link href={`/shop/product/${product.slug}`} className="gdg-secondary-button">
            View Product
          </Link>
          <button
            type="button"
            className="gdg-primary-button compact"
            disabled={product.availableQuantity <= 0}
            onClick={() => {
              addToCart(product);
              onAdded?.(product);
            }}
          >
            {actionLabel}
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
    const fromProducts = Array.from(new Set(products.map((product) => product.category).filter(Boolean)));
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
          product.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery));
        const matchesCategory = category === "all" || categoryMatches(product, category) || product.category === category;
        const matchesAvailability = availability === "all" || (availability === "in-stock" ? product.availableQuantity > 0 : product.availableQuantity <= 0);
        return matchesQuery && matchesCategory && matchesAvailability;
      })
      .sort((left, right) => {
        if (sort === "price-low") return left.price - right.price;
        if (sort === "price-high") return right.price - left.price;
        if (sort === "stock") return right.availableQuantity - left.availableQuantity;
        return 0;
      });
  }, [availability, category, products, query, sort]);

  const newArrivals = products.slice(0, 4);
  const heroProduct = products.find((product) => product.imageUrl) ?? products[0];
  const categoryCards = useMemo(() => categoryPreviewCards(products, homeCategories), [products]);

  function onAdded(product: PublicStoreProductDTO) {
    setNotice(`${product.title} added. ${settings.checkoutConfigured ? "Open cart to checkout." : "Open cart to request an invoice."}`);
  }

  const isSportsCardsCategory = mode === "shop" && category === "Sports Cards" && sportsCards.external;

  return (
    <>
      {mode === "home" ? (
        <>
          <section className="gdg-hero">
            <div className="gdg-hero-copy">
              <p className="gdg-overline">Pokemon & Sports Cards</p>
              <h1>Collect. Play. Invest.</h1>
              <p>Premium Pokemon and sports card products for collectors, players, and fans.</p>
              <div className="gdg-hero-actions">
                <Link href="/shop" className="gdg-primary-button">
                  Shop Now
                </Link>
                <Link href="/shop?sort=newest" className="gdg-secondary-button">
                  New Arrivals
                </Link>
              </div>
            </div>
            <div className="gdg-hero-stage" aria-label="Featured collectible products">
              {heroProduct ? (
                <ProductImage product={heroProduct} size="hero" />
              ) : (
                <div className="gdg-hero-placeholder">
                  <span>GameDayGrabs</span>
                  <strong>Premium Card Shop</strong>
                  <small>Published products will appear here.</small>
                </div>
              )}
              {products[1] ? (
                <div className="gdg-floating-card">
                  <ProductImage product={products[1]} size="thumb" />
                  <span>{products[1].category}</span>
                  <b>{money(products[1].price)}</b>
                </div>
              ) : null}
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
              {categoryCards.map(({ category: entry, imageUrl }) => (
                <Link href={categoryHref(entry)} key={entry} className="gdg-category-card">
                  <span className="gdg-category-image">
                    {imageUrl ? <Image src={imageUrl} alt="" width={260} height={200} unoptimized /> : <Package size={26} />}
                  </span>
                  <b>{entry}</b>
                </Link>
              ))}
            </div>
          </section>

          <section className="gdg-section">
            <div className="gdg-section-header">
              <div>
                <h2>New Arrivals</h2>
                <p>Recently published products from available inventory.</p>
              </div>
              <Link href="/shop?sort=newest">View All New Arrivals</Link>
            </div>
            <div className="gdg-arrivals-row">
              {newArrivals.length ? (
                newArrivals.map((product) => <ProductCard key={product.id} product={product} settings={settings} onAdded={onAdded} />)
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
                    {entry === "all" ? "All Products" : entry}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Availability
              <select value={availability} onChange={(event) => setAvailability(event.currentTarget.value)}>
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
  const actionLabel = checkoutModeLabel(settings);
  const publicDescription = cleanPublicProductDescription(product);

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
          <span>{product.category}</span>
        </nav>
        <div className="gdg-detail-grid">
          <aside className={`gdg-gallery ${images.length > 1 ? "has-thumbs" : "single-image"}`}>
            <div className="gdg-gallery-main">
              {selectedImage ? (
                <Image src={selectedImage} alt={product.title} width={900} height={900} unoptimized />
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
            <span className="gdg-product-category">{product.category}</span>
            <h1>{product.title}</h1>
            <div className="gdg-detail-price">
              <strong>{money(product.price)}</strong>
              {product.compareAtPrice ? <s>{money(product.compareAtPrice)}</s> : null}
              <span className={product.availableQuantity > 0 ? "gdg-stock in" : "gdg-stock out"}>{product.availableQuantity > 0 ? "In Stock" : "Sold Out"}</span>
            </div>
            <p>{publicDescription}</p>
            <small>Stock visible now: {product.availableQuantity} item{product.availableQuantity === 1 ? "" : "s"}.</small>
            <div className="gdg-quantity-control">
              <span>Quantity</span>
              <button type="button" onClick={() => setQuantity((current) => Math.max(1, current - 1))}>
                <Minus size={15} />
              </button>
              <b>{quantity}</b>
              <button type="button" onClick={() => setQuantity((current) => Math.min(product.maxQuantityPerOrder, product.availableQuantity, current + 1))}>
                <Plus size={15} />
              </button>
            </div>
            <button className="gdg-primary-button wide" type="button" disabled={product.availableQuantity <= 0} onClick={() => addProductToCart(false)}>
              {actionLabel}
            </button>
            <button className="gdg-secondary-button wide" type="button" disabled={product.availableQuantity <= 0} onClick={() => addProductToCart(true)}>
              {settings.checkoutConfigured ? "Buy Now" : "Request Invoice Now"}
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
          <h2>Product Details</h2>
          <p>{publicDescription}</p>
          <ul>
            <li>Category: {product.category}.</li>
            <li>Available quantity shown on this page is updated from published inventory.</li>
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
            <li>Public listings never include internal purchase notes or private inventory details.</li>
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

  async function checkout() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(settings.checkoutConfigured ? "/api/storefront/checkout" : "/api/storefront/invoice-request", {
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
        const contactEmail = settings.contactEmail || "gamedaygrabs@outlook.com";
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
          <p className="gdg-overline">Cart</p>
          <h1>{settings.checkoutConfigured ? "Secure checkout" : "Request an invoice"}</h1>
          <p>{settings.checkoutConfigured ? "Review your items before Stripe Checkout." : "Checkout is in invoice mode. Submit your cart and GameDayGrabs will confirm payment details."}</p>
        </div>
        <Link href="/shop" className="gdg-secondary-button">
          Continue Shopping
        </Link>
      </div>
      {message ? <p className={message.includes("sent") ? "gdg-toast" : "gdg-error"}>{message}</p> : null}
      {products.length ? (
        <div className="gdg-cart-grid">
          <div className="gdg-cart-lines">
            {products.map((product) => (
              <article className="gdg-cart-line" key={product.id}>
                <ProductImage product={product} size="thumb" />
                <div>
                  <h2>{product.title}</h2>
                  <small>{product.category}</small>
                  <div className="gdg-quantity-control compact">
                    <button type="button" onClick={() => updateQuantity(product.id, product.requestedQuantity - 1)}>
                      <Minus size={14} />
                    </button>
                    <b>{product.requestedQuantity}</b>
                    <button type="button" onClick={() => updateQuantity(product.id, product.requestedQuantity + 1)}>
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
                <strong>{money(product.price * product.requestedQuantity)}</strong>
                <button className="gdg-icon-button" type="button" onClick={() => removeItem(product.id)} aria-label={`Remove ${product.title}`}>
                  <Trash2 size={16} />
                </button>
              </article>
            ))}
          </div>
          <aside className="gdg-cart-summary">
            <h2>Order Summary</h2>
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
              Calculated after confirmation
            </span>
            <strong>{money(subtotal + shipping)}</strong>
            <label>
              Name
              <input value={customerName} onChange={(event) => setCustomerName(event.currentTarget.value)} placeholder="Your name" />
            </label>
            <label>
              Email
              <input value={customerEmail} onChange={(event) => setCustomerEmail(event.currentTarget.value)} placeholder="you@example.com" type="email" />
            </label>
            <label>
              Phone <span>optional</span>
              <input value={customerPhone} onChange={(event) => setCustomerPhone(event.currentTarget.value)} placeholder="Optional phone number" type="tel" />
            </label>
            <label>
              Notes <span>optional</span>
              <textarea value={customerNotes} onChange={(event) => setCustomerNotes(event.currentTarget.value)} placeholder="Questions, pickup request, or products you are looking for." rows={4} />
            </label>
            <button className="gdg-primary-button wide" type="button" disabled={busy || !customerEmail.trim() || !customerName.trim()} onClick={checkout}>
              {busy ? "Working..." : settings.checkoutConfigured ? "Checkout" : "Request Invoice"}
            </button>
            <small>{settings.checkoutConfigured ? "Stripe handles payment securely." : "No card is charged. Inventory is confirmed before invoice payment."}</small>
          </aside>
        </div>
      ) : (
        <div className="gdg-empty">
          <ShoppingCart size={30} />
          <h2>Your cart is empty</h2>
          <p>Add a product to start a checkout or invoice request.</p>
          <Link href="/shop" className="gdg-primary-button">
            Back to Shop
          </Link>
        </div>
      )}
    </section>
  );
}

export function CheckoutSuccessClient() {
  useEffect(() => {
    writeCart([]);
  }, []);

  return (
    <section className="gdg-result-card">
      <span>
        <Check size={22} />
      </span>
      <h1>Payment received</h1>
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
