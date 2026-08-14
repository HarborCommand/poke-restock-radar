"use client";

import { useEffect, useState } from "react";

type SessionResponse = {
  user?: {
    role?: string;
  } | null;
};

export function PrivateSignOutButton({
  adminOnly = false,
  redirectTo = "/pos"
}: {
  adminOnly?: boolean;
  redirectTo?: string;
}) {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;

    void fetch("/api/auth/session", {
      credentials: "same-origin",
      cache: "no-store"
    })
      .then(async (response) => {
        const data = (await response.json()) as SessionResponse;
        if (!active) return;
        const role = String(data.user?.role || "");
        setVisible(Boolean(data.user) && (!adminOnly || role === "ADMIN"));
      })
      .catch(() => {
        if (active) setVisible(false);
      });

    return () => {
      active = false;
    };
  }, [adminOnly]);

  async function signOut() {
    if (busy) return;
    setBusy(true);
    setError(false);

    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store"
      });
      if (!response.ok) throw new Error("Sign out failed");
      window.location.assign(redirectTo);
    } catch {
      setError(true);
      setBusy(false);
    }
  }

  if (!visible) return null;

  return (
    <div
      style={{
        position: "fixed",
        right: "max(16px, env(safe-area-inset-right))",
        bottom: "max(16px, env(safe-area-inset-bottom))",
        zIndex: 5000,
        display: "flex",
        alignItems: "center",
        gap: 8
      }}
    >
      {error ? (
        <span
          role="alert"
          style={{
            borderRadius: 10,
            background: "rgba(255,255,255,.96)",
            padding: "10px 12px",
            color: "#991b1b",
            fontSize: 12,
            fontWeight: 800,
            boxShadow: "0 10px 30px rgba(15,23,42,.12)"
          }}
        >
          Could not sign out. Try again.
        </span>
      ) : null}
      <button
        type="button"
        onClick={() => void signOut()}
        disabled={busy}
        aria-label="Sign out"
        style={{
          minWidth: 108,
          minHeight: 48,
          border: "1px solid rgba(255,255,255,.18)",
          borderRadius: 12,
          background: "#0f172a",
          padding: "0 16px",
          color: "#fff",
          fontSize: 13,
          fontWeight: 900,
          boxShadow: "0 12px 32px rgba(15,23,42,.24)",
          cursor: busy ? "wait" : "pointer",
          opacity: busy ? 0.72 : 1
        }}
      >
        {busy ? "Signing Out…" : "Sign Out"}
      </button>
    </div>
  );
}
