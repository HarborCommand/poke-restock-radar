"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Check, Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import type { PublicStoreProductDTO, StorefrontSettingsDTO } from "@/types/radar";

type CartItem = { id: string; quantity: number };

const cartKey = "poke-radar-cart";

function money(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "TBD";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
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

export function StorefrontHeader({ settings }: { settings: StorefrontSettingsDTO }) {
  const [count, setCount] = useState(0);
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
  return (
    <header className="shop-header">
      <Link href="/shop" className="shop-brand">
        <span className="shop-brand-mark">PR</span>
        <span>
          <b>{settings.storeName}</b>
          <small>Pokemon inventory storefront</small>
        </span>
      </Link>
      <nav>
        <Link href="/shop">Shop</Link>
        <Link href="/cart" className="shop-cart-link">
          <ShoppingBag size={17} />
          Cart {count ? <b>{count}</b> : null}
        </Link>
      </nav>
    </header>
  );
}

export function ProductGrid({ products }: { products: PublicStoreProductDTO[] }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [notice, setNotice] = useState("");
  const categories = useMemo(() => ["all", ...Array.from(new Set(products.map((product) => product.category)))], [products]);
  const visibleProducts = products.filter((product) => {
    const matchesQuery = !query.trim() || product.title.toLowerCase().includes(query.toLowerCase()) || product.tags.some((tag) => tag.toLowerCase().includes(query.toLowerCase()));
    const matchesCategory = category === "all" || product.category === category;
    return matchesQuery && matchesCategory;
  });
  function addProduct(product: PublicStoreProductDTO) {
    const cart = readCart();
    const existing = cart.find((item) => item.id === product.id);
    const nextQuantity = Math.min(product.maxQuantityPerOrder, product.availableQuantity, (existing?.quantity ?? 0) + 1);
    const next = existing
      ? cart.map((item) => (item.id === product.id ? { ...item, quantity: nextQuantity } : item))
      : [...cart, { id: product.id, quantity: nextQuantity }];
    writeCart(next);
    setNotice(`${product.title} added to cart.`);
  }
  return (
    <>
      <section className="shop-hero">
        <div>
          <span>POKE RADAR SHOP</span>
          <h1>Available Pokemon inventory</h1>
          <p>Customer-facing listings only. Availability can change until checkout is complete.</p>
        </div>
        <Link href="/cart" className="shop-primary-link">View Cart</Link>
      </section>
      <section className="shop-filters">
        <input value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Search products..." />
        <select value={category} onChange={(event) => setCategory(event.currentTarget.value)}>
          {categories.map((entry) => (
            <option key={entry} value={entry}>
              {entry === "all" ? "All Categories" : entry}
            </option>
          ))}
        </select>
      </section>
      {notice ? <p className="shop-toast"><Check size={15} /> {notice}</p> : null}
      <section className="shop-grid">
        {visibleProducts.length ? (
          visibleProducts.map((product) => (
            <article className="shop-product-card" key={product.id}>
              <Link href={`/shop/product/${product.slug}`} className="shop-product-image">
                {product.imageUrl ? <Image src={product.imageUrl} alt={product.title} width={420} height={320} unoptimized /> : <span>No image</span>}
              </Link>
              <div>
                <span>{product.category}</span>
                <h2><Link href={`/shop/product/${product.slug}`}>{product.title}</Link></h2>
                <p>{product.description || "Pokemon product available from private inventory."}</p>
              </div>
              <footer>
                <strong>{money(product.price)}</strong>
                <small>{product.availableQuantity} available</small>
                <button type="button" disabled={product.availableQuantity <= 0} onClick={() => addProduct(product)}>
                  Add to Cart
                </button>
              </footer>
            </article>
          ))
        ) : (
          <div className="shop-empty">
            <h2>No products available</h2>
            <p>Check back soon for active listings.</p>
          </div>
        )}
      </section>
    </>
  );
}

export function ProductDetail({ product }: { product: PublicStoreProductDTO }) {
  const [quantity, setQuantity] = useState(1);
  const [notice, setNotice] = useState("");
  function addToCart() {
    const cart = readCart();
    const existing = cart.find((item) => item.id === product.id);
    const nextQuantity = Math.min(product.maxQuantityPerOrder, product.availableQuantity, quantity + (existing?.quantity ?? 0));
    const next = existing ? cart.map((item) => (item.id === product.id ? { ...item, quantity: nextQuantity } : item)) : [...cart, { id: product.id, quantity: nextQuantity }];
    writeCart(next);
    setNotice("Added to cart.");
  }
  return (
    <section className="shop-detail">
      <div className="shop-detail-image">
        {product.imageUrl ? <Image src={product.imageUrl} alt={product.title} width={700} height={520} unoptimized /> : <span>No image</span>}
      </div>
      <div className="shop-detail-info">
        <span>{product.category}</span>
        <h1>{product.title}</h1>
        <p>{product.description || "Available Pokemon inventory item."}</p>
        <div className="shop-price-row">
          <strong>{money(product.price)}</strong>
          {product.compareAtPrice ? <s>{money(product.compareAtPrice)}</s> : null}
          <small>{product.availableQuantity > 0 ? `${product.availableQuantity} available` : "Sold out"}</small>
        </div>
        <div className="shop-quantity-row">
          <button type="button" onClick={() => setQuantity((current) => Math.max(1, current - 1))}><Minus size={15} /></button>
          <b>{quantity}</b>
          <button type="button" onClick={() => setQuantity((current) => Math.min(product.maxQuantityPerOrder, product.availableQuantity, current + 1))}><Plus size={15} /></button>
        </div>
        <button className="shop-primary-button" type="button" disabled={product.availableQuantity <= 0} onClick={addToCart}>
          Add to Cart
        </button>
        {notice ? <p className="shop-toast"><Check size={15} /> {notice}</p> : null}
        <small>Availability subject to change. Checkout is completed through Stripe.</small>
      </div>
    </section>
  );
}

export function CartClient({ settings }: { settings: StorefrontSettingsDTO }) {
  const [items, setItems] = useState<CartItem[]>(() => readCart());
  const [products, setProducts] = useState<Array<PublicStoreProductDTO & { requestedQuantity: number }>>([]);
  const [message, setMessage] = useState("");
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
      const response = await fetch("/api/storefront/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items, fulfillmentMethod: "shipping" })
      });
      const payload = await response.json();
      if (!response.ok || !payload.checkoutUrl) throw new Error(payload.error || "Checkout could not start.");
      window.location.href = payload.checkoutUrl;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Checkout could not start.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="shop-cart-page">
      <div>
        <span>CART</span>
        <h1>Your cart</h1>
      </div>
      {message ? <p className="shop-error">{message}</p> : null}
      {products.length ? (
        <div className="shop-cart-grid">
          <div className="shop-cart-lines">
            {products.map((product) => (
              <article className="shop-cart-line" key={product.id}>
                <div className="shop-cart-image">
                  {product.imageUrl ? <Image src={product.imageUrl} alt={product.title} width={120} height={120} unoptimized /> : <span>No image</span>}
                </div>
                <div>
                  <h2>{product.title}</h2>
                  <small>{product.category}</small>
                  <div className="shop-quantity-row">
                    <button type="button" onClick={() => updateQuantity(product.id, product.requestedQuantity - 1)}><Minus size={14} /></button>
                    <b>{product.requestedQuantity}</b>
                    <button type="button" onClick={() => updateQuantity(product.id, product.requestedQuantity + 1)}><Plus size={14} /></button>
                  </div>
                </div>
                <strong>{money(product.price * product.requestedQuantity)}</strong>
                <button className="shop-icon-button" type="button" onClick={() => removeItem(product.id)} aria-label={`Remove ${product.title}`}>
                  <Trash2 size={16} />
                </button>
              </article>
            ))}
          </div>
          <aside className="shop-cart-summary">
            <h2>Order summary</h2>
            <span><b>Subtotal</b>{money(subtotal)}</span>
            <span><b>Shipping estimate</b>{money(shipping)}</span>
            <span><b>Tax</b>Calculated in checkout</span>
            <strong>{money(subtotal + shipping)}</strong>
            <button className="shop-primary-button" type="button" disabled={busy} onClick={checkout}>
              {busy ? "Starting checkout" : "Checkout"}
            </button>
          </aside>
        </div>
      ) : (
        <div className="shop-empty">
          <h2>Your cart is empty</h2>
          <Link href="/shop" className="shop-primary-link">Back to shop</Link>
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
    <section className="shop-result-card">
      <span>ORDER RECEIVED</span>
      <h1>Payment received</h1>
      <p>Your order is being confirmed by Stripe. Inventory updates after the secure webhook confirms payment.</p>
      <div className="shop-result-actions">
        <Link href="/shop" className="shop-primary-link">Back to Shop</Link>
        <Link href="/" className="shop-secondary-link">Private Radar</Link>
      </div>
    </section>
  );
}
