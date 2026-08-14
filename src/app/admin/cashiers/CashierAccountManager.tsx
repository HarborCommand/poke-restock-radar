"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import styles from "./cashiers.module.css";

type Cashier = {
  id: string;
  email: string;
  name: string;
  disabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

type CashierListResponse = { cashiers: Cashier[] };
type CashierCreateResponse = { cashier?: Cashier; error?: string };

export function CashierAccountManager() {
  const [cashiers, setCashiers] = useState<Cashier[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function loadCashiers() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/admin/cashiers", { credentials: "same-origin" });
      const data = (await response.json()) as CashierListResponse & { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not load cashier accounts.");
      setCashiers(data.cashiers || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load cashier accounts.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadCashiers();
  }, []);

  async function createCashier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const form = event.currentTarget;
    const formData = new FormData(form);
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/auth/admin/cashiers", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.get("name"),
          email: formData.get("email"),
          password: formData.get("password")
        })
      });
      const data = (await response.json()) as CashierCreateResponse;
      if (!response.ok || !data.cashier) throw new Error(data.error || "Could not create cashier account.");

      form.reset();
      setSuccess(`${data.cashier.name} can now sign in at /pos.`);
      setCashiers((current) => [data.cashier!, ...current]);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create cashier account.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>GameDayGrabs Admin</span>
            <h1>Cashier Accounts</h1>
            <p>Create POS-only logins for the store iPad. Cashiers do not get the Admin workspace.</p>
          </div>
          <Link className={styles.backButton} href="/admin?tab=pos">Back to Admin</Link>
        </header>

        <section className={styles.card}>
          <div className={styles.cardHeading}>
            <div>
              <h2>Create cashier</h2>
              <p>Use a dedicated store email and a password you can change later if needed.</p>
            </div>
          </div>

          <form className={styles.form} onSubmit={createCashier}>
            <label>
              <span>Name</span>
              <input name="name" minLength={2} maxLength={80} placeholder="Store Cashier" required />
            </label>
            <label>
              <span>Email</span>
              <input name="email" type="email" autoComplete="username" placeholder="cashier@gamedaygrabs.com" required />
            </label>
            <label>
              <span>Password</span>
              <input name="password" type="password" minLength={12} maxLength={200} autoComplete="new-password" placeholder="12+ characters" required />
            </label>
            <button type="submit" disabled={saving}>{saving ? "Creating…" : "Create Cashier Account"}</button>
          </form>

          {error ? <div className={styles.error}>{error}</div> : null}
          {success ? <div className={styles.success}>{success}</div> : null}
        </section>

        <section className={styles.card}>
          <div className={styles.cardHeading}>
            <div>
              <h2>Cashier logins</h2>
              <p>These accounts are intended only for in-store sales on the POS.</p>
            </div>
            <button className={styles.refreshButton} type="button" onClick={() => void loadCashiers()} disabled={loading}>Refresh</button>
          </div>

          {loading ? (
            <div className={styles.empty}>Loading cashier accounts…</div>
          ) : cashiers.length ? (
            <div className={styles.list}>
              {cashiers.map((cashier) => (
                <article className={styles.row} key={cashier.id}>
                  <div>
                    <strong>{cashier.name}</strong>
                    <span>{cashier.email}</span>
                  </div>
                  <div className={styles.meta}>
                    <span className={cashier.disabled ? styles.disabled : styles.active}>{cashier.disabled ? "Disabled" : "POS Only"}</span>
                    <small>{cashier.lastLoginAt ? `Last login ${new Date(cashier.lastLoginAt).toLocaleString()}` : "Has not signed in yet"}</small>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className={styles.empty}>No cashier accounts yet.</div>
          )}
        </section>
      </div>
    </main>
  );
}
