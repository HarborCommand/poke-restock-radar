"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldAlert } from "lucide-react";

type Switchboard = {
  generatedAt: string; status: "blocked" | "ready_flags_off" | "live";
  flags: { online: boolean; pos: boolean; reporting: boolean; exemption: boolean; manualFallback: boolean; conflict: boolean };
  stripe: { mode: string; registrationStatus: string; webhookConfigured: boolean };
  locations: { verifiedPos: boolean; verifiedPickup: boolean };
  codes: { product: boolean; shipping: boolean };
  certification: { complete: boolean; passed: number; required: number; buildCommit: string };
  reconciliation: { clean: boolean; criticalErrorCount: number };
  approvals: { ownerApproved: boolean; ownerApprovedAt: string | null; accountantReviewed: boolean; accountantReviewedAt: string | null; accountantReviewNote: string };
  blockers: Array<{ code: string; label: string; critical: true }>;
  build: { commit: string; deployId: string | null };
  health: { status: string; checkedAt: string; databaseOk: boolean };
  launchInstructions: string[]; rollbackInstructions: string[];
};

function State({ ready, children }: { ready: boolean; children: React.ReactNode }) {
  return <span className={`stripe-readiness-status ${ready ? "ready" : "blocked"}`}>{ready ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}{children}</span>;
}

export function TaxGoLiveSwitchboard() {
  const [data, setData] = useState<Switchboard | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "saving" | "error">("loading");
  const [message, setMessage] = useState("");
  const [ownerApproved, setOwnerApproved] = useState(false);
  const [accountantReviewed, setAccountantReviewed] = useState(false);
  const [note, setNote] = useState("");

  async function load(signal?: AbortSignal) {
    setState("loading"); setMessage("");
    try {
      const response = await fetch("/api/radar/tax-go-live", { credentials: "same-origin", cache: "no-store", signal });
      const payload = await response.json() as Switchboard & { error?: string; requestId?: string };
      if (!response.ok) throw new Error(`${payload.error || "Go-live preflight is unavailable."}${payload.requestId ? ` Reference: ${payload.requestId}.` : ""}`);
      setData(payload); setOwnerApproved(payload.approvals.ownerApproved); setAccountantReviewed(payload.approvals.accountantReviewed); setNote(payload.approvals.accountantReviewNote); setState("ready");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setState("error"); setMessage(error instanceof Error ? error.message : "Go-live preflight is unavailable.");
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, []);

  async function saveApprovals(event: React.FormEvent) {
    event.preventDefault(); setState("saving"); setMessage("");
    try {
      const response = await fetch("/api/radar/tax-go-live", { method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ownerApproved, accountantReviewed, accountantReviewNote: note }) });
      const payload = await response.json() as Switchboard & { error?: string; requestId?: string };
      if (!response.ok) throw new Error(`${payload.error || "Approvals could not be saved."}${payload.requestId ? ` Reference: ${payload.requestId}.` : ""}`);
      setData(payload); setState("ready"); setMessage("Approvals saved. Runtime flags were not changed.");
    } catch (error) { setState("ready"); setMessage(error instanceof Error ? error.message : "Approvals could not be saved."); }
  }

  if (!data && state === "loading") return <div className="tax-admin-state" role="status">Running safe, read-only tax preflight…</div>;
  if (!data) return <div className="tax-admin-state error" role="alert">{message}<button type="button" onClick={() => void load()}>Try again</button></div>;

  const checks = [
    ["Live Stripe mode", data.stripe.mode === "live", data.stripe.mode],
    ["Florida registration", data.stripe.registrationStatus === "active", data.stripe.registrationStatus],
    ["POS location", data.locations.verifiedPos, data.locations.verifiedPos ? "verified" : "missing"],
    ["Local Pickup location", data.locations.verifiedPickup, data.locations.verifiedPickup ? "verified" : "missing"],
    ["Product and shipping tax codes", data.codes.product && data.codes.shipping, data.codes.product && data.codes.shipping ? "ready" : "incomplete"],
    ["Signed webhook", data.stripe.webhookConfigured, data.stripe.webhookConfigured ? "configured" : "missing"],
    ["Stripe test certification", data.certification.complete, `${data.certification.passed}/${data.certification.required}`],
    ["Reconciliation", data.reconciliation.clean, data.reconciliation.clean ? "clean" : `${data.reconciliation.criticalErrorCount} critical`],
    ["Owner approval", data.approvals.ownerApproved, data.approvals.ownerApprovedAt ? new Date(data.approvals.ownerApprovedAt).toLocaleString() : "missing"],
    ["Accountant review", data.approvals.accountantReviewed, data.approvals.accountantReviewedAt ? new Date(data.approvals.accountantReviewedAt).toLocaleString() : "missing"]
  ] as const;

  return <section className="tax-go-live-switchboard" aria-labelledby="tax-go-live-title">
    <header className="stripe-readiness-hero"><div><p className="tax-admin-eyebrow">Controlled launch</p><h3 id="tax-go-live-title">Go-Live Switchboard</h3><p>Verify live readiness and prepare owner instructions. This panel cannot change Vercel environment variables or enable collection.</p></div><button className="tax-admin-secondary-action" type="button" onClick={() => void load()} disabled={state === "loading"}><RefreshCw size={16} />Run preflight</button></header>
    <div className="tax-admin-runtime-grid"><article className="tax-admin-runtime"><span>Online gate</span><strong>{data.flags.online ? "Enabled" : "Disabled"}</strong></article><article className="tax-admin-runtime"><span>POS gate</span><strong>{data.flags.pos ? "Enabled" : "Disabled"}</strong></article><article className="tax-admin-runtime"><span>Reporting gate</span><strong>{data.flags.reporting ? "Enabled" : "Disabled"}</strong></article><article className="tax-admin-runtime"><span>Exemption gate</span><strong>{data.flags.exemption ? "Enabled" : "Disabled"}</strong></article></div>
    <div className={`tax-go-live-verdict ${data.status}`}><ShieldAlert size={22} /><div><strong>{data.status === "blocked" ? "Preflight blocked" : data.status === "ready_flags_off" ? "Ready for controlled flag enablement" : "Live gates detected"}</strong><span>{data.blockers.length ? `${data.blockers.length} blocker${data.blockers.length === 1 ? "" : "s"} must be resolved.` : "All required preflight checks passed."}</span></div></div>
    <div className="tax-go-live-grid"><section className="tax-admin-card"><h4>Preflight checks</h4><ul className="tax-go-live-checks">{checks.map(([label, ready, detail]) => <li key={label}><State ready={ready}>{label}</State><small>{detail}</small></li>)}</ul></section><section className="tax-admin-card"><h4>Build and health</h4><dl className="tax-admin-summary"><div><dt>Build commit</dt><dd>{data.build.commit}</dd></div><div><dt>Last health check</dt><dd>{new Date(data.health.checkedAt).toLocaleString()}</dd></div><div><dt>Health</dt><dd>{data.health.status}</dd></div><div><dt>Database</dt><dd>{data.health.databaseOk ? "Healthy" : "Unavailable"}</dd></div></dl></section></div>
    {data.blockers.length ? <section className="tax-admin-card"><h4>Unresolved blockers</h4><ul className="tax-warning-list">{data.blockers.map((blocker) => <li key={blocker.code}>{blocker.label}</li>)}</ul></section> : null}
    <form className="tax-admin-card tax-go-live-approvals" onSubmit={saveApprovals}><h4>Recorded approvals</h4><label><input type="checkbox" checked={ownerApproved} onChange={(event) => setOwnerApproved(event.target.checked)} /> Owner readiness approval</label><label><input type="checkbox" checked={accountantReviewed} onChange={(event) => setAccountantReviewed(event.target.checked)} /> Accountant review confirmed</label><label>Accountant review note<textarea value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} required={accountantReviewed} /></label><button className="tax-admin-primary-action" type="submit" disabled={state === "saving"}>{state === "saving" ? "Saving…" : "Save approvals only"}</button><small>Saving approvals records an audit event. It does not enable tax, change Stripe, or modify Vercel.</small></form>
    <div className="tax-go-live-grid"><section className="tax-admin-card"><h4>Owner / Codex launch instructions</h4><ol>{data.launchInstructions.map((item) => <li key={item}>{item}</li>)}</ol></section><section className="tax-admin-card"><h4>Emergency kill switch</h4><ol>{data.rollbackInstructions.map((item) => <li key={item}>{item}</li>)}</ol></section></div>
    {message ? <p className="stripe-readiness-message" role="status">{message}</p> : null}
  </section>;
}
