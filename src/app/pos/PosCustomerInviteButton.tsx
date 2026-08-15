"use client";

import { UserPlus, X } from "lucide-react";
import { createPortal } from "react-dom";
import { type FormEvent, useEffect, useRef, useState } from "react";
import styles from "./PosCustomerInviteButton.module.css";

function currentPosCustomerEmail() {
  const selectors = [
    ".pos-cart-panel input[type='email']",
    ".pos-page input[type='email']"
  ];

  for (const selector of selectors) {
    const input = document.querySelector<HTMLInputElement>(selector);
    const value = input?.value.trim();
    if (value) return value;
  }

  return "";
}

export function PosCustomerInviteButton() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;

    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, submitting]);

  const openDialog = () => {
    setEmail(currentPosCustomerEmail());
    setError("");
    setSuccess("");
    setOpen(true);
  };

  const closeDialog = () => {
    if (!submitting) setOpen(false);
  };

  const sendInvite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || submitting) return;

    setSubmitting(true);
    setError("");
    setSuccess("");

    try {
      const response = await fetch("/api/account/magic-link/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail })
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        throw new Error(
          payload?.error ||
            (response.status === 429
              ? "Too many account emails were requested. Try again shortly."
              : "Could not send the account email.")
        );
      }

      setEmail(normalizedEmail);
      setSuccess("Account link sent. They can finish on their phone.");
    } catch (inviteError) {
      setError(inviteError instanceof Error ? inviteError.message : "Could not send the account email.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        className={`${styles.trigger} pos-customer-invite-button`}
        type="button"
        aria-label="Create or open customer account"
        title="Customer account"
        onClick={openDialog}
      >
        <UserPlus size={18} aria-hidden="true" />
        <span>Customer</span>
      </button>

      {open &&
        createPortal(
          <div
            className={styles.backdrop}
            onMouseDown={(event) => {
              if (event.currentTarget === event.target) closeDialog();
            }}
          >
            <section
              className={styles.dialog}
              role="dialog"
              aria-modal="true"
              aria-labelledby="pos-customer-account-title"
            >
              <div className={styles.header}>
                <div>
                  <p className={styles.eyebrow}>Quick customer setup</p>
                  <h2 id="pos-customer-account-title">Customer account</h2>
                </div>
                <button
                  className={styles.closeButton}
                  type="button"
                  aria-label="Close customer account dialog"
                  onClick={closeDialog}
                  disabled={submitting}
                >
                  <X size={19} aria-hidden="true" />
                </button>
              </div>

              <p className={styles.copy}>
                Enter the customer&apos;s email. We&apos;ll send a secure link to create or open their GameDayGrabs account.
              </p>

              <form className={styles.form} onSubmit={sendInvite}>
                <label className={styles.label} htmlFor="pos-customer-account-email">
                  Email
                </label>
                <input
                  ref={inputRef}
                  id="pos-customer-account-email"
                  className={styles.input}
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="customer@email.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={submitting}
                  required
                />

                {error && (
                  <p className={styles.error} role="alert">
                    {error}
                  </p>
                )}
                {success && (
                  <p className={styles.success} role="status">
                    {success}
                  </p>
                )}

                <button className={styles.submitButton} type="submit" disabled={submitting || !email.trim()}>
                  {submitting ? "Sending…" : success ? "Send again" : "Send account link"}
                </button>
              </form>

              <p className={styles.privacy}>This does not subscribe the customer to marketing emails.</p>
            </section>
          </div>,
          document.body
        )}
    </>
  );
}
