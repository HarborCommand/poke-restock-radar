"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  Check,
  ChevronRight,
  Heart,
  Menu,
  Minus,
  Package,
  Plus,
  Search,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Star,
  Trash2,
  Truck,
  User,
  X
} from "lucide-react";
import type { PublicStoreProductDTO, StorefrontSettingsDTO } from "@/types/radar";

type CartItem = { id: string; quantity: number };

const cartKey = "poke-radar-cart";
const preferredCategories = [
  "Pokemon Sealed",
  "Booster Bundles",
  "Elite Trainer Boxes",
  "Premium Collections",
  "Sports Cards",
  "Graded Cards"
];

function money(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "TBD";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function displayStoreName(settings: StorefrontSettingsDTO) {
  return settings.storeName && !/poke radar/i.test(settings.storeName) ? settings.storeName : "GameDayGrabs LLC";
}

function checkoutModeLabel(settings: StorefrontSettingsDTO) {
  return settings.checkoutConfigured ? "Add to Cart" : "Request Invoice";
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

function categoryImage(products: PublicStoreProductDTO[], category: string) {
  return products.find((product) => categoryMatches(product, category) && product.imageUrl)?.imageUrl ?? products.find((product) => product.imageUrl)?.imageUrl ?? null;
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

export function StorefrontHeader({ settings }: { settings: StorefrontSettingsDTO }) {
  const [count, setCount] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const storeName = displayStoreName(settings);

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
    { href: "/shop#shop", label: "Shop" },
    { href: "/shop#pokemon", label: "Pokemon" },
    { href: "/shop#sports-cards", label: "Sports Cards" },
    { href: "/shop#new-arrivals", label: "New Arrivals" },
    { href: "/shop#about", label: "About" },
    { href: "/shop#policies", label: "Policies" },
    { href: "/shop#contact", label: "Contact" }
  ];

  return (
    <header className="gdg-header">
      <Link href="/shop" className="gdg-brand" aria-label={`${storeName} home`}>
        <span className="gdg-brand-text">GameDayGrabs<small>LLC</small></span>
      </Link>
      <nav className={`gdg-nav ${menuOpen ? "open" : ""}`} aria-label="Public shop navigation">
        {nav.map((item) => (
          <Link key={item.href} href={item.href} onClick={() => setMenuOpen(false)}>
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="gdg-header-actions">
        <a className="gdg-icon-link" href="/shop#shop" aria-label="Search products">
          <Search size={18} />
        </a>
        <Link className="gdg-icon-link optional" href="/" aria-label="Account">
          <User size={18} />
        </Link>
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

export function ProductGrid({ products, settings }: { products: PublicStoreProductDTO[]; settings: StorefrontSettingsDTO }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [availability, setAvailability] = useState("in-stock");
  const [sort, setSort] = useState("newest");
  const [notice, setNotice] = useState("");

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

  const newArrivals = products.slice(0, 6);
  const heroProduct = products.find((product) => product.imageUrl) ?? products[0];

  function onAdded(product: PublicStoreProductDTO) {
    setNotice(`${product.title} added. ${settings.checkoutConfigured ? "Open cart to checkout." : "Open cart to request an invoice."}`);
  }

  return (
    <>
      <section className="gdg-hero">
        <div className="gdg-hero-copy">
          <p className="gdg-overline">Pokemon & Sports Cards</p>
          <h1>Collect. Play. Invest.</h1>
          <p>Premium Pokemon and sports card products for collectors, players, and fans.</p>
          <div className="gdg-hero-actions">
            <a href="#shop" className="gdg-primary-button">
              Shop Now
            </a>
            <a href="#new-arrivals" className="gdg-secondary-button">
              New Arrivals
            </a>
          </div>
        </div>
        <div className="gdg-hero-stage" aria-label="Featured collectible products">
          {heroProduct ? <ProductImage product={heroProduct} size="hero" /> : <div className="gdg-hero-placeholder">GameDayGrabs</div>}
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
          { icon: <Truck size={19} />, title: "Fast Shipping", text: "Secure & tracked delivery" },
          { icon: <Star size={19} />, title: "Great Prices", text: "Competitive & fair pricing" },
          { icon: <ShieldCheck size={19} />, title: "Collector Trusted", text: "Reliable for collectors" }
        ].map((item) => (
          <div key={item.title}>
            <span>{item.icon}</span>
            <strong>{item.title}</strong>
            <small>{item.text}</small>
          </div>
        ))}
      </section>

      {notice ? (
        <p className="gdg-toast">
          <Check size={16} /> {notice}
        </p>
      ) : null}

      <section className="gdg-section" id="pokemon">
        <div className="gdg-section-header">
          <div>
            <h2>Shop By Category</h2>
            <p>Choose the sealed products and cards you collect most.</p>
          </div>
          <a href="#shop">View all</a>
        </div>
        <div className="gdg-category-grid">
          {preferredCategories.map((entry) => {
            const imageUrl = categoryImage(products, entry);
            return (
              <button
                type="button"
                key={entry}
                className="gdg-category-card"
                onClick={() => {
                  setCategory(entry);
                  document.getElementById("shop")?.scrollIntoView({ behavior: "smooth" });
                }}
              >
                <span className="gdg-category-image">
                  {imageUrl ? <Image src={imageUrl} alt="" width={260} height={200} unoptimized /> : <Package size={26} />}
                </span>
                <b>{entry}</b>
              </button>
            );
          })}
        </div>
      </section>

      <section className="gdg-section" id="new-arrivals">
        <div className="gdg-section-header">
          <div>
            <h2>New Arrivals</h2>
            <p>Recently published products from available inventory.</p>
          </div>
          <a href="#shop">View all</a>
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
              <h2>All Products</h2>
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
            {visibleProducts.length ? (
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

      <section className="gdg-section gdg-values" id="about">
        <div className="gdg-section-header">
          <div>
            <h2>Why Collectors Choose GameDayGrabs</h2>
            <p>We are more than a store. We are part of the collecting community.</p>
          </div>
        </div>
        <div className="gdg-value-grid">
          {[
            { icon: <User size={18} />, title: "Family Owned", text: "Passionate about cards and our community." },
            { icon: <BadgeCheck size={18} />, title: "Carefully Curated", text: "We only offer products we would collect ourselves." },
            { icon: <ShieldCheck size={18} />, title: "Safe & Secure", text: "Your information and orders are protected." },
            { icon: <Star size={18} />, title: "Top Rated Service", text: "Customer satisfaction is our priority." }
          ].map((item) => (
            <article key={item.title}>
              <span>{item.icon}</span>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="gdg-contact-strip" id="contact">
        <div>
          <h2>Join the GameDayGrabs Community</h2>
          <p>Get updates on new products, restocks, and collector offers.</p>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setNotice("Thanks. Newsletter capture will be connected from store settings.");
          }}
        >
          <input type="email" placeholder="Enter your email" aria-label="Email address" />
          <button type="submit">Subscribe</button>
        </form>
      </section>

      <section className="gdg-policies" id="policies">
        <article>
          <h3>Shipping</h3>
          <p>{settings.shippingPolicyText || "Orders ship securely with tracking. Availability is confirmed before payment or invoice fulfillment."}</p>
        </article>
        <article>
          <h3>Returns</h3>
          <p>{settings.returnPolicyText || "Sealed collectible products are reviewed case by case. Contact GameDayGrabs before returning any item."}</p>
        </article>
      </section>
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
          <Link href="/shop#shop">Shop</Link>
          <ChevronRight size={13} />
          <span>{product.category}</span>
        </nav>
        <div className="gdg-detail-grid">
          <aside className="gdg-gallery">
            <div className="gdg-gallery-main">
              {selectedImage ? <Image src={selectedImage} alt={product.title} width={820} height={680} unoptimized /> : <Package size={42} />}
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
            <p>{product.description || "Collector-grade product from GameDayGrabs public inventory."}</p>
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
        <h2>Product Description</h2>
        <p>{product.description || "This public listing is available from GameDayGrabs inventory. Availability is subject to change until checkout or invoice confirmation."}</p>
        <ul>
          <li>Ships with care from GameDayGrabs LLC.</li>
          <li>Public storefront price is shown; private cost data is never displayed.</li>
          <li>{settings.checkoutConfigured ? "Secure Stripe Checkout is available." : "Request invoice mode is active until checkout is configured."}</li>
        </ul>
      </section>
      {relatedProducts.length ? (
        <section className="gdg-section">
          <div className="gdg-section-header">
            <div>
              <h2>Related Products</h2>
              <p>More published products from GameDayGrabs.</p>
            </div>
            <Link href="/shop#shop">View all</Link>
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
        body: JSON.stringify({ items, fulfillmentMethod: "shipping", customerName, customerEmail })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Request could not start.");
      if (settings.checkoutConfigured) {
        if (!payload.checkoutUrl) throw new Error("Checkout could not start.");
        window.location.href = payload.checkoutUrl;
      } else {
        setMessage(`Invoice request ${payload.order?.orderNumber || ""} was sent. GameDayGrabs will follow up to confirm availability and payment.`);
        setItems([]);
        setProducts([]);
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
        <Link href="/" className="gdg-secondary-button">
          Private Radar
        </Link>
      </div>
    </section>
  );
}
