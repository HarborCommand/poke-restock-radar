"use client";

import { PackageSearch, Search, ShoppingCart } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import styles from "./PosRegisterShell.module.css";

export type PosRegisterProduct = {
  id: string;
  title: string;
  itemName: string;
  category: string;
  setName: string | null;
  imageUrl: string | null;
  upc: string | null;
  sku: string | null;
  price: number | null;
  onHandQuantity: number;
  inStoreQuantity: number;
  warehouseQuantity: number;
  posReady: boolean;
};

type ProductsResponse = {
  products?: PosRegisterProduct[];
  summary?: {
    productCount: number;
    inStoreUnits: number;
    warehouseUnits: number;
    readyToSellCount: number;
  };
  error?: string;
};

function money(value: number | null) {
  if (value === null) return "Price needed";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function categoryLabel(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function PosProductsView({ onCheckout }: { onCheckout: (product: PosRegisterProduct) => void }) {
  const [products, setProducts] = useState<PosRegisterProduct[]>([]);
  const [summary, setSummary] = useState<ProductsResponse["summary"]>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("ALL");

  useEffect(() => {
    let active = true;
    setLoading(true);
    void fetch("/api/radar/pos/products", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json()) as ProductsResponse;
        if (!response.ok) throw new Error(data.error || "Could not load products.");
        if (!active) return;
        setProducts(Array.isArray(data.products) ? data.products : []);
        setSummary(data.summary ?? null);
        setError(null);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : "Could not load products.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const categories = useMemo(
    () => Array.from(new Set(products.map((product) => product.category).filter(Boolean))).sort(),
    [products]
  );

  const visibleProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return products
      .filter((product) => category === "ALL" || product.category === category)
      .filter((product) => {
        if (!query) return true;
        return [product.title, product.itemName, product.category, product.setName, product.upc, product.sku]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(query));
      })
      .sort((left, right) => Number(right.posReady) - Number(left.posReady) || left.title.localeCompare(right.title));
  }, [category, products, search]);

  return (
    <section className={styles.view} aria-label="POS products">
      <div className={styles.viewHeader}>
        <div>
          <span className={styles.eyebrow}>Catalog</span>
          <h1>Products</h1>
          <p>Fast stock lookup for the register. Warehouse inventory stays visible without becoming sellable at checkout.</p>
        </div>
        {summary ? (
          <div className={styles.summaryPills} aria-label="Product summary">
            <span><b>{summary.readyToSellCount}</b> ready</span>
            <span><b>{summary.inStoreUnits}</b> in store</span>
            <span><b>{summary.warehouseUnits}</b> warehouse</span>
          </div>
        ) : null}
      </div>

      <div className={styles.toolbar}>
        <label className={styles.searchField}>
          <Search size={18} aria-hidden="true" />
          <input
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            placeholder="Search product, UPC or SKU"
            aria-label="Search POS products"
          />
        </label>
        <div className={styles.categoryTabs} aria-label="Product categories">
          <button type="button" className={category === "ALL" ? styles.activePill : ""} onClick={() => setCategory("ALL")}>All</button>
          {categories.map((value) => (
            <button
              type="button"
              key={value}
              className={category === value ? styles.activePill : ""}
              onClick={() => setCategory(value)}
            >
              {categoryLabel(value)}
            </button>
          ))}
        </div>
      </div>

      {error ? <div className={styles.errorCard} role="alert">{error}</div> : null}
      {loading ? <div className={styles.loadingCard}>Loading products…</div> : null}

      {!loading && !error ? (
        visibleProducts.length ? (
          <div className={styles.productGrid}>
            {visibleProducts.map((product) => (
              <article className={styles.productCard} key={product.id}>
                <div className={styles.productImage}>
                  {product.imageUrl ? <img src={product.imageUrl} alt="" /> : <PackageSearch size={24} aria-hidden="true" />}
                </div>
                <div className={styles.productCopy}>
                  <strong>{product.title}</strong>
                  <small>{product.setName || categoryLabel(product.category)}</small>
                  <div className={styles.stockLine}>
                    <span className={product.inStoreQuantity > 0 ? styles.stockReady : styles.stockMuted}>Store {product.inStoreQuantity}</span>
                    <span>Warehouse {product.warehouseQuantity}</span>
                  </div>
                </div>
                <div className={styles.productAction}>
                  <b>{money(product.price)}</b>
                  <button type="button" disabled={!product.posReady} onClick={() => onCheckout(product)}>
                    <ShoppingCart size={16} aria-hidden="true" />
                    {product.posReady ? "Sell" : product.inStoreQuantity <= 0 ? "Warehouse" : "Setup needed"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className={styles.emptyCard}>
            <PackageSearch size={28} aria-hidden="true" />
            <strong>No matching products</strong>
            <span>Try another search or category.</span>
          </div>
        )
      ) : null}
    </section>
  );
}
