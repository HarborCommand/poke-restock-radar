"use client";

import { Boxes, ChevronDown, ReceiptText, Search, ShoppingCart, UserRound, Users } from "lucide-react";
import { useMemo, useState } from "react";
import styles from "../pos/PosRegisterShell.module.css";

type View = "checkout" | "products" | "customers" | "sales";

const sampleProducts = [
  { id: "1", title: "Pokémon Mega Evolution Booster Bundle", category: "Booster Bundles", price: 28.99, store: 4, warehouse: 7, sku: "ME-BB-001" },
  { id: "2", title: "Pokémon Elite Trainer Box", category: "ETBs", price: 54.99, store: 2, warehouse: 5, sku: "ETB-004" },
  { id: "3", title: "Topps Chrome Value Box", category: "Sports Cards", price: 39.99, store: 3, warehouse: 2, sku: "TC-VB-021" },
  { id: "4", title: "Card Sleeves 100 Pack", category: "Supplies", price: 7.99, store: 8, warehouse: 20, sku: "SLV-100" },
  { id: "5", title: "Pokémon Collection Box", category: "Collection Boxes", price: 34.99, store: 1, warehouse: 4, sku: "COL-010" },
  { id: "6", title: "Perfect Order Booster Bundle", category: "Booster Bundles", price: 24.99, store: 2, warehouse: 6, sku: "PO-BB-002" }
];

const sampleCustomers = [
  { id: "1", name: "Chris M.", email: "c***@example.com", points: 420, purchases: 12, spent: 612.45 },
  { id: "2", name: "Alex R.", email: "a***@example.com", points: 185, purchases: 5, spent: 227.91 },
  { id: "3", name: "Jordan P.", email: "j***@example.com", points: 90, purchases: 3, spent: 118.32 }
];

const sampleSales = [
  { id: "POS-A12F91", when: "2 min ago", items: 2, total: 42.38, payment: "Square" },
  { id: "POS-F8C221", when: "18 min ago", items: 1, total: 58.29, payment: "Cash" },
  { id: "POS-3B992C", when: "Today · 7:42 PM", items: 3, total: 91.14, payment: "Square" }
];

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

export default function PosReviewPage() {
  const [view, setView] = useState<View>("checkout");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<Array<{ id: string; title: string; price: number; qty: number }>>([
    { id: "6", title: "Perfect Order Booster Bundle", price: 24.99, qty: 1 }
  ]);
  const [customer, setCustomer] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? sampleProducts.filter((p) => `${p.title} ${p.category} ${p.sku}`.toLowerCase().includes(q)) : sampleProducts;
  }, [search]);

  const subtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const tax = Math.round(subtotal * 0.06 * 100) / 100;
  const total = subtotal + tax;

  function addToCart(product: (typeof sampleProducts)[number]) {
    setCart((current) => {
      const existing = current.find((item) => item.id === product.id);
      if (existing) return current.map((item) => item.id === product.id ? { ...item, qty: item.qty + 1 } : item);
      return [...current, { id: product.id, title: product.title, price: product.price, qty: 1 }];
    });
    setView("checkout");
  }

  return (
    <div className={styles.shell} data-pos-register-view={view}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.brandMark}>G</span>
          <div><strong>GameDayGrabs</strong><small>Point of Sale · Review</small></div>
        </div>
        <nav className={styles.tabs} aria-label="Register sections">
          {[
            ["checkout", "Checkout", ShoppingCart],
            ["products", "Products", Boxes],
            ["customers", "Customers", Users],
            ["sales", "Sales", ReceiptText]
          ].map(([id, label, Icon]) => {
            const ActiveIcon = Icon as typeof ShoppingCart;
            const active = view === id;
            return <button key={String(id)} type="button" className={active ? styles.activeTab : ""} onClick={() => setView(id as View)}><ActiveIcon size={18}/><span>{String(label)}</span></button>;
          })}
        </nav>
        <div className={styles.account}>
          <button type="button" className={styles.accountButton}>
            <span className={styles.userAvatar}>A</span>
            <span className={styles.userCopy}><strong>Adrian</strong><small>Admin</small></span>
            <ChevronDown size={15}/>
          </button>
        </div>
      </header>

      {view === "checkout" ? (
        <main className={styles.reviewCheckout}>
          <section className={styles.reviewProductsPane}>
            <div className={styles.reviewPaneHeader}>
              <div><span className={styles.eyebrow}>Checkout</span><h1>New sale</h1></div>
              <label className={styles.searchField}><Search size={18}/><input value={search} onChange={(e) => setSearch(e.currentTarget.value)} placeholder="Search or scan product" /></label>
            </div>
            <div className={styles.categoryBar}>
              <button type="button" className={styles.categoryActive}>All</button><button type="button">Pokémon</button><button type="button">Sports</button><button type="button">Supplies</button>
            </div>
            <div className={styles.productGrid}>
              {filtered.map((product) => (
                <article className={styles.productCard} key={product.id} onClick={() => addToCart(product)}>
                  <div className={styles.productImage}><Boxes size={28}/></div>
                  <div className={styles.productCopy}><strong>{product.title}</strong><small>{product.category}</small></div>
                  <div className={styles.productPriceRow}><b>{money(product.price)}</b><span>{product.store} in store</span></div>
                </article>
              ))}
            </div>
          </section>
          <aside className={styles.reviewCartPane}>
            <div className={styles.reviewCartHeader}><div><span className={styles.eyebrow}>Current sale</span><h2>{cart.length ? `${cart.reduce((s, i) => s + i.qty, 0)} item${cart.reduce((s, i) => s + i.qty, 0) === 1 ? "" : "s"}` : "Empty cart"}</h2></div><button type="button" onClick={() => setCart([])}>Clear</button></div>
            <button className={styles.reviewCustomerButton} type="button" onClick={() => setView("customers")}><UserRound size={18}/><span>{customer || "Add customer"}</span></button>
            <div className={styles.reviewCartLines}>
              {cart.map((item) => <div className={styles.reviewCartLine} key={item.id}><div><strong>{item.title}</strong><small>{item.qty} × {money(item.price)}</small></div><b>{money(item.qty * item.price)}</b></div>)}
            </div>
            <div className={styles.reviewTotals}><div><span>Subtotal</span><b>{money(subtotal)}</b></div><div><span>Sales tax</span><b>{money(tax)}</b></div><div className={styles.reviewGrandTotal}><span>Total</span><strong>{money(total)}</strong></div></div>
            <button className={styles.reviewChargeButton} type="button">Charge {money(total)}</button>
            <small className={styles.reviewSafeNote}>Visual review only · payments disabled</small>
          </aside>
        </main>
      ) : null}

      {view === "products" ? (
        <section className={styles.view}>
          <div className={styles.viewHeader}><div><span className={styles.eyebrow}>Catalog</span><h1>Products</h1><p>Fast inventory view for the register.</p></div><div className={styles.summaryPills}><span><b>20</b> store units</span><span><b>44</b> warehouse</span></div></div>
          <div className={styles.toolbarSingle}><label className={styles.searchField}><Search size={18}/><input placeholder="Search products, UPC or SKU" /></label></div>
          <div className={styles.productGrid}>{sampleProducts.map((p) => <article className={styles.productCard} key={p.id}><div className={styles.productImage}><Boxes size={28}/></div><div className={styles.productCopy}><strong>{p.title}</strong><small>{p.category} · {p.sku}</small></div><div className={styles.productPriceRow}><b>{money(p.price)}</b><span>{p.store} store · {p.warehouse} warehouse</span></div><button className={styles.rowAction} type="button" onClick={() => addToCart(p)}><ShoppingCart size={16}/>Sell</button></article>)}</div>
        </section>
      ) : null}

      {view === "customers" ? (
        <section className={styles.view}>
          <div className={styles.viewHeader}><div><span className={styles.eyebrow}>Customer directory</span><h1>Customers</h1><p>Search rewards and purchase history.</p></div></div>
          <div className={styles.toolbarSingle}><label className={styles.searchField}><Search size={18}/><input placeholder="Search name, email or phone" /></label></div>
          <div className={styles.customerList}>{sampleCustomers.map((c) => <article className={styles.customerRow} key={c.id}><span className={styles.avatar}><UserRound size={20}/></span><div className={styles.customerIdentity}><strong>{c.name}</strong><small>{c.email}</small></div><div className={styles.customerMetric}><small>Rewards</small><strong>{c.points} pts</strong></div><div className={styles.customerMetric}><small>Purchases</small><strong>{c.purchases} · {money(c.spent)}</strong></div><button className={styles.rowAction} type="button" onClick={() => { setCustomer(c.name); setView("checkout"); }}><ShoppingCart size={16}/>Checkout</button></article>)}</div>
        </section>
      ) : null}

      {view === "sales" ? (
        <section className={styles.view}>
          <div className={styles.viewHeader}><div><span className={styles.eyebrow}>Register history</span><h1>Sales</h1><p>Recent in-store transactions.</p></div></div>
          <div className={styles.saleList}>{sampleSales.map((sale) => <article className={styles.saleRow} key={sale.id}><span className={styles.saleIcon}><ReceiptText size={20}/></span><div className={styles.saleIdentity}><strong>{sale.id}</strong><small>{sale.when}</small></div><div className={styles.customerMetric}><small>Items</small><strong>{sale.items}</strong></div><div className={styles.customerMetric}><small>Payment</small><strong>{sale.payment}</strong></div><div className={styles.saleAmount}><small>Total</small><strong>{money(sale.total)}</strong></div></article>)}</div>
        </section>
      ) : null}
    </div>
  );
}
