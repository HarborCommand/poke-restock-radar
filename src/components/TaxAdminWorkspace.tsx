"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Circle, FileCheck2, Gauge, Settings2 } from "lucide-react";
import { TaxReportsWorkspace } from "@/components/TaxReportsWorkspace";
import { TaxSettingsWorkspace, type TaxSettings } from "@/components/TaxSettingsWorkspace";
import { StripeTaxReadinessWorkspace } from "@/components/StripeTaxReadinessWorkspace";

type TaxSection = "overview" | "stripe-readiness" | "settings" | "reports" | "readiness";

const sections: Array<{ id: TaxSection; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "stripe-readiness", label: "Stripe Readiness" },
  { id: "settings", label: "Settings" },
  { id: "reports", label: "Reports" },
  { id: "readiness", label: "Go-Live Readiness" }
];

function normalizeSection(value: string | null): TaxSection {
  return sections.some((section) => section.id === value) ? value as TaxSection : "overview";
}

function RuntimeStatus({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <article className={enabled ? "tax-admin-runtime enabled" : "tax-admin-runtime disabled"}>
      <span>{label}</span>
      <strong>{enabled ? "Enabled" : "Disabled"}</strong>
    </article>
  );
}

function ReadinessItem({ label, complete, detail }: { label: string; complete: boolean; detail?: string }) {
  return (
    <li className={complete ? "complete" : "pending"}>
      <span aria-hidden="true">{complete ? <Check size={16} /> : <Circle size={16} />}</span>
      <div><strong>{label}</strong>{detail ? <small>{detail}</small> : null}</div>
    </li>
  );
}

export function TaxAdminWorkspace() {
  const [section, setSection] = useState<TaxSection>(() => {
    if (typeof window === "undefined") return "overview";
    return normalizeSection(new URLSearchParams(window.location.search).get("section"));
  });
  const [settings, setSettings] = useState<TaxSettings | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    setState("loading");
    setError("");
    try {
      const response = await fetch("/api/radar/tax-settings", {
        cache: "no-store",
        credentials: "same-origin",
        signal
      });
      const payload = await response.json() as TaxSettings & { error?: string; requestId?: string };
      if (!response.ok) {
        const requestId = payload.requestId || response.headers.get("X-Request-Id");
        throw new Error(`${payload.error || "Tax administration is unavailable."}${requestId ? ` Reference: ${requestId}.` : ""}`);
      }
      setSettings(payload);
      setState("ready");
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      setError(loadError instanceof Error ? loadError.message : "Tax administration is unavailable.");
      setState("error");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [load]);

  useEffect(() => {
    const syncFromHistory = () => setSection(normalizeSection(new URLSearchParams(window.location.search).get("section")));
    window.addEventListener("popstate", syncFromHistory);
    return () => window.removeEventListener("popstate", syncFromHistory);
  }, []);

  function selectSection(next: TaxSection) {
    setSection(next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", "tax");
    url.searchParams.set("section", next);
    window.history.pushState(null, "", `${url.pathname}?${url.searchParams.toString()}${url.hash}`);
  }

  const allRuntimeDisabled = Boolean(settings &&
    !settings.online.enabled &&
    !settings.pos.runtimeEnabled &&
    !settings.exemption.runtimeEnabled &&
    !settings.reporting.enabled);

  const readiness = useMemo(() => settings ? [
    { label: "Florida registration active in Stripe", complete: settings.readiness.providerRegistrationStatus === "active", detail: `Provider status: ${settings.readiness.providerRegistrationStatus}.` },
    { label: "Legal store address confirmed", complete: settings.readiness.storeAddressConfirmed },
    { label: "County confirmed", complete: settings.readiness.countyConfirmed },
    { label: "Stripe product and shipping tax codes configured", complete: Boolean(settings.product.defaultStripeTaxCode && settings.product.shippingStripeTaxCode) },
    { label: "Filing frequency confirmed", complete: false, detail: `${settings.reporting.defaultPeriod} is selected, but accountant confirmation is not recorded.` },
    { label: "Accountant reviewed", complete: false, detail: "Accountant approval is not stored in the application." },
    { label: "Stripe test credentials available", complete: settings.online.stripeMode === "test", detail: `Current detected mode: ${settings.online.stripeMode}.` },
    { label: "Same-county test passed", complete: false, detail: "The existing online Preview check does not record county-specific evidence separately." },
    { label: "Different-county test passed", complete: false, detail: "The existing online Preview check does not record county-specific evidence separately." },
    { label: "Local Pickup test passed", complete: settings.readiness.previewPickupPassed },
    { label: "Webhook test passed", complete: false, detail: "Signed webhook evidence is not recorded separately." },
    { label: "Full refund test passed", complete: false, detail: settings.readiness.refundVerified ? "Combined refund verification exists; full-refund evidence is not separate." : "Not recorded." },
    { label: "Partial refund test passed", complete: false, detail: settings.readiness.refundVerified ? "Combined refund verification exists; partial-refund evidence is not separate." : "Not recorded." },
    { label: "Owner approval", complete: settings.readiness.ownerApproved, detail: settings.readiness.ownerApprovedAt ? `Recorded ${new Date(settings.readiness.ownerApprovedAt).toLocaleString()}.` : "Not recorded." }
  ] : [], [settings]);

  const readinessCount = readiness.filter((item) => item.complete).length;

  return (
    <section className="tax-admin-workspace" aria-labelledby="tax-admin-title">
      <header className="tax-admin-hero">
        <div>
          <p className="tax-admin-eyebrow">Private commerce administration</p>
          <h2 id="tax-admin-title">Tax</h2>
          <p>Configure the installed tax foundation, review launch readiness, and access filing-support reports without exposing these controls to the storefront.</p>
        </div>
        <span className={allRuntimeDisabled ? "tax-admin-collection-state disabled" : "tax-admin-collection-state enabled"}>
          {allRuntimeDisabled ? "Collection disabled" : "Review active gates"}
        </span>
      </header>

      <nav className="tax-admin-tabs" aria-label="Tax administration sections" role="tablist">
        {sections.map((item) => (
          <button
            aria-controls="tax-admin-panel"
            aria-selected={section === item.id}
            className={section === item.id ? "active" : ""}
            id={`tax-admin-tab-${item.id}`}
            key={item.id}
            onClick={() => selectSection(item.id)}
            role="tab"
            type="button"
          >
            {item.label}
          </button>
        ))}
      </nav>

      {allRuntimeDisabled ? (
        <div className="tax-admin-disabled-banner" role="status">
          <AlertTriangle size={20} aria-hidden="true" />
          <div>
            <strong>Tax collection is currently disabled</strong>
            <span>The tax foundation is installed, but online tax, POS tax, exemptions, and reporting are not active in Production.</span>
          </div>
        </div>
      ) : null}

      {settings ? (
        <section className="tax-admin-runtime-grid" aria-label="Tax runtime status">
          <RuntimeStatus label="Online Stripe Tax" enabled={settings.online.enabled} />
          <RuntimeStatus label="POS Sales Tax" enabled={settings.pos.runtimeEnabled} />
          <RuntimeStatus label="Tax Exempt Sales" enabled={settings.exemption.runtimeEnabled} />
          <RuntimeStatus label="Tax Reporting" enabled={settings.reporting.enabled} />
        </section>
      ) : null}

      {state === "loading" ? <div className="tax-admin-state" role="status">Loading private tax configuration…</div> : null}
      {state === "error" ? <div className="tax-admin-state error" role="alert"><strong>Tax administration could not be loaded.</strong><span>{error}</span><button type="button" onClick={() => void load()}>Try again</button></div> : null}

      <div
        aria-labelledby={`tax-admin-tab-${section}`}
        className="tax-admin-panel"
        id="tax-admin-panel"
        role="tabpanel"
      >
      {state === "ready" && settings && section === "overview" ? (
        <div className="tax-admin-overview">
          <section className="tax-admin-card tax-admin-current-status">
            <div className="tax-admin-card-heading"><Gauge size={20} /><div><p>Current status</p><h3>Deployed foundation, live collection blocked</h3></div></div>
            <div className="tax-admin-status-group">
              <h4>Code readiness</h4>
              <ul>
                <ReadinessItem label="Code foundation deployed" complete />
                <ReadinessItem label="Tax Settings deployed" complete />
                <ReadinessItem label="POS tax flow deployed" complete />
                <ReadinessItem label="Online Checkout tax flow deployed" complete />
                <ReadinessItem label="Tax reporting code deployed" complete />
                <ReadinessItem label="Refund and concurrency hardening deployed" complete />
                <ReadinessItem label="Tax security review deployed" complete />
              </ul>
            </div>
            <div className="tax-admin-status-group">
              <h4>Live state</h4>
              <ul>
                <ReadinessItem label="No online tax collection" complete={!settings.online.enabled} />
                <ReadinessItem label="No POS tax collection" complete={!settings.pos.runtimeEnabled} />
                <ReadinessItem label="No tax exemption processing" complete={!settings.exemption.runtimeEnabled} />
                <ReadinessItem label="No active tax reporting" complete={!settings.reporting.enabled} />
                <ReadinessItem label="No official filing activity" complete={!settings.reporting.enabled} />
                <ReadinessItem label="No filed-return claim" complete />
              </ul>
            </div>
          </section>

          <section className="tax-admin-card">
            <div className="tax-admin-card-heading"><Settings2 size={20} /><div><p>Configuration summary</p><h3>Saved policy and provider readiness</h3></div></div>
            <dl className="tax-admin-summary">
              <div><dt>Store state</dt><dd>{settings.pos.storeState || "Not set"}</dd></div>
              <div><dt>Store county</dt><dd>{settings.pos.storeCounty || "Not confirmed"}</dd></div>
              <div><dt>Tax provider</dt><dd>Stripe Tax</dd></div>
              <div><dt>Product tax code</dt><dd>{settings.readiness.defaultCodeConfirmed ? "Confirmed" : "Needs confirmation"}</dd></div>
              <div><dt>Stripe Tax readiness</dt><dd>{settings.online.automaticTaxReady ? "Provider configured" : "Not ready"}</dd></div>
              <div><dt>Florida registration</dt><dd>{settings.readiness.providerRegistrationStatus}</dd></div>
              <div><dt>Local Pickup</dt><dd>{settings.online.localPickupStatus}</dd></div>
              <div><dt>Filing frequency</dt><dd>{settings.reporting.defaultPeriod}; confirmation pending</dd></div>
              <div><dt>Shipping treatment</dt><dd>GameDayGrabs prices; Stripe taxes</dd></div>
            </dl>
          </section>

          <section className="tax-admin-card tax-admin-readiness-preview">
            <div className="tax-admin-card-heading"><FileCheck2 size={20} /><div><p>Go-live checklist</p><h3>{readinessCount} of {readiness.length} checks complete</h3></div></div>
            <ul>{readiness.slice(0, 6).map((item) => <ReadinessItem key={item.label} {...item} />)}</ul>
            <button className="tax-admin-secondary-action" type="button" onClick={() => selectSection("readiness")}>Review all readiness checks</button>
          </section>
        </div>
      ) : null}

      {state === "ready" && settings && section === "settings" ? <TaxSettingsWorkspace embedded onSettingsChange={setSettings} /> : null}

      {state === "ready" && settings && section === "stripe-readiness" ? <StripeTaxReadinessWorkspace /> : null}

      {state === "ready" && settings && section === "reports" ? (
        settings.reporting.enabled ? <TaxReportsWorkspace embedded /> : (
          <section className="tax-admin-card tax-admin-reports-disabled" aria-labelledby="tax-admin-reports-disabled-title">
            <FileCheck2 size={24} aria-hidden="true" />
            <p className="tax-admin-eyebrow">Read-only filing support</p>
            <h3 id="tax-admin-reports-disabled-title">Tax Reports are visible but disabled</h3>
            <p>The reporting runtime gate is off. No transaction data was requested, loaded, or exported.</p>
            <ul>
              <ReadinessItem label="Reporting profile configured" complete={settings.reporting.configurationEnabled} />
              <ReadinessItem label="Preview report reconciled" complete={settings.readiness.reportReconciled} />
              <ReadinessItem label="Production reporting runtime enabled" complete={settings.reporting.enabled} />
            </ul>
            <button className="tax-admin-secondary-action" type="button" onClick={() => selectSection("settings")}>Review Tax Settings</button>
          </section>
        )
      ) : null}

      {state === "ready" && settings && section === "readiness" ? (
        <section className="tax-admin-card tax-admin-readiness-full">
          <div className="tax-admin-card-heading"><FileCheck2 size={20} /><div><p>Go-live readiness</p><h3>{readinessCount} of {readiness.length} checks complete</h3></div></div>
          <p className="tax-admin-card-copy">Pending items keep live collection blocked. Sensitive registration numbers and provider credentials are never displayed here.</p>
          <ul>{readiness.map((item) => <ReadinessItem key={item.label} {...item} />)}</ul>
          <button className="tax-admin-secondary-action" type="button" onClick={() => selectSection("settings")}>Update saved readiness settings</button>
        </section>
      ) : null}
      </div>
    </section>
  );
}
