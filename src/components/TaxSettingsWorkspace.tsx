"use client";

import { useEffect, useId, useMemo, useState } from "react";

export type TaxSettings = {
  environment: string;
  collectionDisabled: boolean;
  online: {
    configurationEnabled: boolean;
    enabled: boolean;
    stripeCheckoutEnabled: boolean;
    stripeMode: "test" | "live" | "missing" | "unknown" | "mixed";
    automaticTaxReady: boolean;
    defaultProductTaxCode: string;
    shippingTaxCode: string;
    providerRegistrationStatus: "active" | "inactive" | "unknown";
    webhookReady: boolean;
    checkoutAddressRequirement: string;
    localPickupStatus: string;
    localPickupTreatment: "pending_review" | "taxable_at_store_location" | "provider_authoritative";
    warnings: string[];
  };
  pos: {
    storeCountry: string;
    storeState: string;
    storeCounty: string;
    storeAddressLine1: string;
    storeAddressLine2: string;
    storeCity: string;
    storePostalCode: string;
    stateRateBasisPoints: number;
    countyRateBasisPoints: number;
    combinedRateBasisPoints: number;
    effectiveDate: string;
    sourceNote: string;
    profileEnabled: boolean;
    runtimeEnabled: boolean;
    active: boolean;
    providerReady: boolean;
    providerRegistrationStatus: "active" | "inactive" | "unknown";
    inPersonCalculationReady: boolean;
    deliveryCalculationReady: boolean;
    transactionRecordingReady: boolean;
    reversalReady: boolean;
    shippingTaxCode: string;
    legacyFallbackConfigured: boolean;
    legacyFallbackRuntimeEnabled: boolean;
    legacyFallbackEnabled: boolean;
    lastUpdated: string | null;
    lastUpdatedByAdmin: string | null;
  };
  exemption: {
    enabled: boolean;
    runtimeEnabled: boolean;
    active: boolean;
    referenceRequired: boolean;
    reasonRequired: boolean;
    adminOnly: boolean;
    documentStorageAvailable: boolean;
  };
  reporting: {
    configurationEnabled: boolean;
    enabled: boolean;
    defaultPeriod: "monthly" | "quarterly" | "annual";
    exportAvailable: boolean;
    disclaimer: string;
  };
  product: { defaultTaxCategory: "general_tangible_goods"; defaultStripeTaxCode: string; shippingStripeTaxCode: string };
  readiness: {
    registrationConfirmed: boolean;
    stripeConfigured: boolean;
    providerRegistrationStatus: "active" | "inactive" | "unknown";
    storeAddressConfirmed: boolean;
    countyConfirmed: boolean;
    defaultCodeConfirmed: boolean;
    previewOnlinePassed: boolean;
    previewPickupPassed: boolean;
    previewPosPassed: boolean;
    receiptVerified: boolean;
    refundVerified: boolean;
    reportReconciled: boolean;
    ownerApproved: boolean;
    ownerApprovedAt: string | null;
  };
};

type FormState = {
  storeCountry: string;
  storeState: string;
  storeCounty: string;
  storeAddressLine1: string;
  storeAddressLine2: string;
  storeCity: string;
  storePostalCode: string;
  stateRateBasisPoints: number;
  countyRateBasisPoints: number;
  effectiveDate: string;
  sourceNote: string;
  onlineTaxProfileEnabled: boolean;
  posTaxEnabled: boolean;
  taxExemptSalesEnabled: boolean;
  taxReportingProfileEnabled: boolean;
  localPickupTaxTreatment: "pending_review" | "taxable_at_store_location" | "provider_authoritative";
  exemptionReferenceRequired: true;
  exemptionReasonRequired: true;
  defaultTaxCategory: "general_tangible_goods";
  defaultStripeTaxCode: string;
  shippingStripeTaxCode: string;
  legacyManualTaxFallbackEnabled: boolean;
  legacyManualTaxFallbackConfirmed?: boolean;
  defaultReportingPeriod: "monthly" | "quarterly" | "annual";
  registrationConfirmed: boolean;
  storeAddressConfirmed: boolean;
  countyConfirmed: boolean;
  defaultCodeConfirmed: boolean;
  previewOnlinePassed: boolean;
  previewPickupPassed: boolean;
  previewPosPassed: boolean;
  receiptVerified: boolean;
  refundVerified: boolean;
  reportReconciled: boolean;
  ownerApproved: boolean;
  enableTaxCollectionConfirmed?: boolean;
  enablementReason?: "owner_approved_go_live" | "approved_preview_validation" | "configuration_rehearsal";
};

function formFromSettings(settings: TaxSettings): FormState {
  return {
    storeCountry: settings.pos.storeCountry,
    storeState: settings.pos.storeState,
    storeCounty: settings.pos.storeCounty,
    storeAddressLine1: settings.pos.storeAddressLine1,
    storeAddressLine2: settings.pos.storeAddressLine2,
    storeCity: settings.pos.storeCity,
    storePostalCode: settings.pos.storePostalCode,
    stateRateBasisPoints: settings.pos.stateRateBasisPoints,
    countyRateBasisPoints: settings.pos.countyRateBasisPoints,
    effectiveDate: settings.pos.effectiveDate,
    sourceNote: settings.pos.sourceNote,
    onlineTaxProfileEnabled: settings.online.configurationEnabled,
    posTaxEnabled: settings.pos.profileEnabled,
    taxExemptSalesEnabled: settings.exemption.enabled,
    taxReportingProfileEnabled: settings.reporting.configurationEnabled,
    localPickupTaxTreatment: settings.online.localPickupTreatment,
    exemptionReferenceRequired: true,
    exemptionReasonRequired: true,
    defaultTaxCategory: settings.product.defaultTaxCategory,
    defaultStripeTaxCode: settings.product.defaultStripeTaxCode,
    shippingStripeTaxCode: settings.product.shippingStripeTaxCode,
    legacyManualTaxFallbackEnabled: settings.pos.legacyFallbackConfigured,
    defaultReportingPeriod: settings.reporting.defaultPeriod,
    registrationConfirmed: settings.readiness.registrationConfirmed,
    storeAddressConfirmed: settings.readiness.storeAddressConfirmed,
    countyConfirmed: settings.readiness.countyConfirmed,
    defaultCodeConfirmed: settings.readiness.defaultCodeConfirmed,
    previewOnlinePassed: settings.readiness.previewOnlinePassed,
    previewPickupPassed: settings.readiness.previewPickupPassed,
    previewPosPassed: settings.readiness.previewPosPassed,
    receiptVerified: settings.readiness.receiptVerified,
    refundVerified: settings.readiness.refundVerified,
    reportReconciled: settings.readiness.reportReconciled,
    ownerApproved: settings.readiness.ownerApproved
  };
}

function Status({ active, children }: { active: boolean; children: React.ReactNode }) {
  return <span className={active ? "tax-status tax-status-on" : "tax-status tax-status-off"}>{children}</span>;
}

function CheckField({
  checked,
  label,
  detail,
  disabled = false,
  onChange
}: {
  checked: boolean;
  label: string;
  detail?: string;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="tax-check-row">
      <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span>
        <label htmlFor={id}><strong>{label}</strong></label>
        {detail ? <small>{detail}</small> : null}
      </span>
    </div>
  );
}

export function TaxSettingsWorkspace({
  embedded = false,
  onSettingsChange
}: {
  embedded?: boolean;
  onSettingsChange?: (settings: TaxSettings) => void;
}) {
  const [settings, setSettings] = useState<TaxSettings | null>(null);
  const [initial, setInitial] = useState<FormState | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "saving" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/radar/tax-settings", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) {
          const requestId = payload.requestId || response.headers.get("X-Request-Id");
          throw new Error(`${payload.error || "Tax settings are unavailable."}${requestId ? ` Reference: ${requestId}.` : ""}`);
        }
        return payload as TaxSettings;
      })
      .then((payload) => {
        if (!active) return;
        const next = formFromSettings(payload);
        setSettings(payload);
        onSettingsChange?.(payload);
        setInitial(next);
        setForm(next);
        setState("ready");
      })
      .catch((error) => {
        if (!active) return;
        setMessage(error instanceof Error ? error.message : "Tax settings are unavailable.");
        setState("error");
      });
    return () => {
      active = false;
    };
  }, [onSettingsChange]);

  const dirty = useMemo(() => Boolean(form && initial && JSON.stringify(form) !== JSON.stringify(initial)), [form, initial]);
  const enabling = Boolean(form && initial && (
    (!initial.onlineTaxProfileEnabled && form.onlineTaxProfileEnabled) ||
    (!initial.posTaxEnabled && form.posTaxEnabled) ||
    (!initial.taxExemptSalesEnabled && form.taxExemptSalesEnabled) ||
    (!initial.taxReportingProfileEnabled && form.taxReportingProfileEnabled)
  ));
  const combined = (form?.stateRateBasisPoints ?? 0) + (form?.countyRateBasisPoints ?? 0);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => (current ? { ...current, [key]: value } : current));
    setMessage("");
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!form || !settings) return;
    if (enabling && !form.enableTaxCollectionConfirmed) {
      setMessage("Confirm the tax collection enablement before saving.");
      return;
    }
    if (enabling && !form.enablementReason) {
      setMessage("Select an approved enablement reason before saving.");
      return;
    }
    setState("saving");
    setMessage("");
    try {
      const response = await fetch("/api/radar/tax-settings", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      const payload = await response.json();
      if (!response.ok) {
        const detail = Array.isArray(payload.issues) ? payload.issues.map((issue: { message: string }) => issue.message).join(" ") : "";
        const requestId = payload.requestId || response.headers.get("X-Request-Id");
        throw new Error(`${detail || payload.error || "Tax settings could not be saved."}${requestId ? ` Reference: ${requestId}.` : ""}`);
      }
      const nextSettings = payload as TaxSettings;
      const nextForm = formFromSettings(nextSettings);
      setSettings(nextSettings);
      onSettingsChange?.(nextSettings);
      setInitial(nextForm);
      setForm(nextForm);
      setMessage("Tax settings saved and an audit event was recorded.");
      setState("ready");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Tax settings could not be saved.");
      setState("ready");
    }
  }

  if (state === "loading") return <section className="tax-workspace tax-workspace-state">Loading tax settings…</section>;
  if (!settings || !form) return <section className="tax-workspace tax-workspace-state">{!embedded ? <a href="/admin">Back to admin</a> : null}<p>{message}</p></section>;

  const readinessFields: Array<[keyof FormState, string, string?]> = [
    ["registrationConfirmed", "Florida registration confirmed"],
    ["storeAddressConfirmed", "Store address confirmed"],
    ["countyConfirmed", "County confirmed"],
    ["defaultCodeConfirmed", "Default product tax code confirmed"],
    ["previewOnlinePassed", "Preview online checkout passed"],
    ["previewPickupPassed", "Preview Local Pickup passed"],
    ["previewPosPassed", "Preview POS passed"],
    ["receiptVerified", "Receipt verified"],
    ["refundVerified", "Refund verified"],
    ["reportReconciled", "Report reconciled"],
    ["ownerApproved", "Owner approval recorded", settings.readiness.ownerApprovedAt ? `Recorded ${new Date(settings.readiness.ownerApprovedAt).toLocaleString()}` : undefined]
  ];

  return (
    <section className={embedded ? "tax-workspace tax-workspace-embedded" : "tax-workspace"}>
      <header className="tax-workspace-header">
        <div>
          {!embedded ? <a href="/admin" className="tax-back-link">← Admin</a> : null}
          <p className="tax-eyebrow">Commerce controls</p>
          {embedded ? <h3>Tax Settings</h3> : <h1>Tax Settings</h1>}
          <p>Configure saved tax policy and verify launch readiness. Environment gates remain separately controlled.</p>
        </div>
        <div className="tax-header-status">
          <Status active={settings.environment !== "production"}>{settings.environment}</Status>
          <Status active={settings.collectionDisabled}>{settings.collectionDisabled ? "Collection disabled" : "Collection active"}</Status>
        </div>
      </header>

      {settings.collectionDisabled ? (
        <div className="tax-deployment-notice" role="status"><strong>Code deployed, collection disabled.</strong> Saved configuration cannot override the independent server environment gates.</div>
      ) : null}

      {settings.online.stripeMode === "live" && settings.environment === "preview" ? (
        <div className="tax-critical-warning" role="alert">Live-mode Stripe credentials are present in Preview. Online Checkout must remain disabled until branch-scoped test credentials replace them.</div>
      ) : null}

      <form onSubmit={save}>
        <section className="tax-section">
          <div className="tax-section-heading"><div><p>Online Tax</p>{embedded ? <h4>Stripe automatic tax</h4> : <h2>Stripe automatic tax</h2>}</div><Status active={settings.online.automaticTaxReady}>{settings.online.automaticTaxReady ? "Ready" : "Not ready"}</Status></div>
          <div className="tax-summary-grid">
            <div><span>Collection gate</span><strong>{settings.online.enabled ? "Enabled" : "Disabled"}</strong></div>
            <div><span>Stripe mode</span><strong>{settings.online.stripeMode}</strong></div>
            <div><span>Registration</span><strong>{settings.online.providerRegistrationStatus}</strong></div>
            <div><span>Webhook</span><strong>{settings.online.webhookReady ? "Ready" : "Not ready"}</strong></div>
            <div><span>Checkout readiness</span><strong>{settings.online.stripeCheckoutEnabled ? "Configured" : "Disabled"}</strong></div>
            <div><span>Default product code</span><strong>{settings.online.defaultProductTaxCode}</strong></div>
            <div><span>Shipping tax code</span><strong>{settings.online.shippingTaxCode}</strong></div>
          </div>
          <dl className="tax-definition-list">
            <div><dt>Address requirement</dt><dd>{settings.online.checkoutAddressRequirement}</dd></div>
            <div><dt>Local Pickup</dt><dd>{settings.online.localPickupStatus}</dd></div>
          </dl>
          {settings.online.warnings.length ? <ul className="tax-warning-list">{settings.online.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
          <CheckField checked={form.onlineTaxProfileEnabled} label="Mark the online tax profile as configured" detail={settings.online.enabled ? "The independent online runtime gate is enabled." : "Configuration intent only. This cannot alter the runtime environment gate."} onChange={(value) => update("onlineTaxProfileEnabled", value)} />
          <label className="tax-select-field tax-top-field">Local Pickup tax treatment<select value={form.localPickupTaxTreatment} onChange={(event) => update("localPickupTaxTreatment", event.target.value as FormState["localPickupTaxTreatment"])}><option value="pending_review">Pending owner/accountant review</option><option value="taxable_at_store_location">Approved store-location treatment</option><option value="provider_authoritative">Provider-authoritative calculation</option></select></label>
        </section>

        <section className="tax-section">
          <div className="tax-section-heading"><div><p>POS Stripe Tax</p>{embedded ? <h4>Locations and transaction readiness</h4> : <h2>Locations and transaction readiness</h2>}</div><Status active={settings.pos.runtimeEnabled && form.posTaxEnabled}>{settings.pos.runtimeEnabled && form.posTaxEnabled ? "Active" : "Inactive"}</Status></div>
          <p className="tax-section-copy">Stripe Tax calculates every new POS sale. GameDayGrabs supplies authoritative prices, discounts, shipping, and the verified location.</p>
          <div className="tax-summary-grid">
            <div><span>Provider</span><strong>{settings.pos.providerReady ? "Ready" : "Not ready"}</strong></div>
            <div><span>Florida registration</span><strong>{settings.pos.providerRegistrationStatus}</strong></div>
            <div><span>In-person calculations</span><strong>{settings.pos.inPersonCalculationReady ? "Ready" : "Needs location"}</strong></div>
            <div><span>Delivery calculations</span><strong>{settings.pos.deliveryCalculationReady ? "Ready" : "Not ready"}</strong></div>
            <div><span>Transaction recording</span><strong>{settings.pos.transactionRecordingReady ? "Ready" : "Not ready"}</strong></div>
            <div><span>Refund reversals</span><strong>{settings.pos.reversalReady ? "Ready" : "Not ready"}</strong></div>
          </div>
          <div className="tax-form-grid">
            <label>Country<input value={form.storeCountry} maxLength={2} onChange={(event) => update("storeCountry", event.target.value.toUpperCase())} required /></label>
            <label>State<input value={form.storeState} maxLength={2} onChange={(event) => update("storeState", event.target.value.toUpperCase())} required /></label>
            <label>County<input value={form.storeCounty} onChange={(event) => update("storeCounty", event.target.value)} required /></label>
            <label>Store / pickup address<input value={form.storeAddressLine1} onChange={(event) => update("storeAddressLine1", event.target.value)} required /></label>
            <label>Unit (optional)<input value={form.storeAddressLine2} onChange={(event) => update("storeAddressLine2", event.target.value)} /></label>
            <label>City<input value={form.storeCity} onChange={(event) => update("storeCity", event.target.value)} required /></label>
            <label>ZIP code<input value={form.storePostalCode} onChange={(event) => update("storePostalCode", event.target.value)} required /></label>
            <label>Default product tax code<input value={form.defaultStripeTaxCode} onChange={(event) => update("defaultStripeTaxCode", event.target.value)} required /></label>
            <label>Shipping tax code<input value={form.shippingStripeTaxCode} onChange={(event) => update("shippingStripeTaxCode", event.target.value)} required /></label>
          </div>
          <CheckField checked={form.posTaxEnabled} label="Mark POS Stripe Tax as configured" detail={settings.pos.runtimeEnabled ? "The independent runtime gate is on." : "Configuration only. The runtime gate remains off."} onChange={(value) => update("posTaxEnabled", value)} />
          <p className="tax-section-copy"><strong>Shipping:</strong> GameDayGrabs calculates the price. Stripe decides whether and how it is taxed. Local Pickup remains $0.00 and uses the store address.</p>
          <details className="tax-legacy-fallback">
            <summary>Legacy manual tax fallback</summary>
            <p><strong>Emergency fallback only — not used for normal tax calculations.</strong> Disabled by default, unavailable to cashiers, and cannot be active with POS Stripe Tax.</p>
            <CheckField
              checked={form.legacyManualTaxFallbackEnabled}
              disabled={!settings.pos.legacyFallbackRuntimeEnabled || settings.pos.runtimeEnabled}
              label="Enable legacy emergency fallback"
              detail={settings.pos.legacyFallbackRuntimeEnabled ? "Available only while POS Stripe Tax remains disabled." : "The independent emergency runtime gate is off."}
              onChange={(value) => { update("legacyManualTaxFallbackEnabled", value); update("legacyManualTaxFallbackConfirmed", false); }}
            />
            {form.legacyManualTaxFallbackEnabled ? <CheckField checked={Boolean(form.legacyManualTaxFallbackConfirmed)} label="I explicitly confirm this emergency-only fallback" onChange={(value) => update("legacyManualTaxFallbackConfirmed", value)} /> : null}
            <fieldset disabled={!form.legacyManualTaxFallbackEnabled} className="tax-form-grid">
              <label>State rate (%)<input type="number" min="0" max="20" step="0.01" value={form.stateRateBasisPoints / 100} onChange={(event) => update("stateRateBasisPoints", Math.round(Number(event.target.value) * 100))} required /></label>
              <label>County surtax (%)<input type="number" min="0" max="20" step="0.01" value={form.countyRateBasisPoints / 100} onChange={(event) => update("countyRateBasisPoints", Math.round(Number(event.target.value) * 100))} required /></label>
              <label>Combined legacy rate<input value={`${(combined / 100).toFixed(2)}%`} readOnly /></label>
              <label>Effective date<input type="date" value={form.effectiveDate} onChange={(event) => update("effectiveDate", event.target.value)} required /></label>
              <label className="tax-span-2">Source / incident reason<textarea value={form.sourceNote} onChange={(event) => update("sourceNote", event.target.value)} maxLength={500} required /></label>
            </fieldset>
          </details>
          <p className="tax-timestamp">Last updated: {settings.pos.lastUpdated ? new Date(settings.pos.lastUpdated).toLocaleString() : "Never saved"}{settings.pos.lastUpdatedByAdmin ? " by an authenticated admin" : ""}</p>
        </section>

        <section className="tax-section">
          <div className="tax-section-heading"><div><p>Tax Exemption</p>{embedded ? <h4>Controlled exception workflow</h4> : <h2>Controlled exception workflow</h2>}</div><Status active={settings.exemption.runtimeEnabled && form.taxExemptSalesEnabled}>{settings.exemption.runtimeEnabled && form.taxExemptSalesEnabled ? "Available" : "Unavailable"}</Status></div>
          <CheckField checked={form.taxExemptSalesEnabled} label="Enable exempt-sale workflow" detail="Admin-only. Every exempt sale requires both a reason and a reference." onChange={(value) => update("taxExemptSalesEnabled", value)} />
          <div className="tax-summary-grid">
            <div><span>Certificate / reference</span><strong>Required</strong></div>
            <div><span>Reason</span><strong>Required</strong></div>
            <div><span>Authorization</span><strong>Admin only</strong></div>
            <div><span>Document storage</span><strong>{settings.exemption.documentStorageAvailable ? "Available" : "Not configured"}</strong></div>
          </div>
          <p className="tax-section-copy">Do not paste certificate numbers or documents into the source note. Document upload is unavailable until private storage is configured.</p>
        </section>

        <section className="tax-section">
          <div className="tax-section-heading"><div><p>Reporting</p>{embedded ? <h4>Filing-support exports</h4> : <h2>Filing-support exports</h2>}</div><Status active={settings.reporting.enabled}>{settings.reporting.enabled ? "Available" : "Disabled"}</Status></div>
          <label className="tax-select-field">Default reporting period<select value={form.defaultReportingPeriod} onChange={(event) => update("defaultReportingPeriod", event.target.value as FormState["defaultReportingPeriod"])}><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annual">Annual</option></select></label>
          <CheckField checked={form.taxReportingProfileEnabled} label="Mark the reporting profile as configured" detail={settings.reporting.enabled ? "The independent reporting runtime gate is enabled." : "Configuration intent only. Export remains unavailable while the runtime gate is off."} onChange={(value) => update("taxReportingProfileEnabled", value)} />
          <p className="tax-section-copy">{settings.reporting.disclaimer}</p>
          {settings.reporting.exportAvailable ? <a href="/app?tab=tax&section=reports" className="tax-inline-action">Open Sales Tax Reports</a> : <span className="tax-muted">Reporting is unavailable while the feature is disabled.</span>}
        </section>

        <section className="tax-section">
          <div className="tax-section-heading"><div><p>Go-Live Readiness</p>{embedded ? <h4>Owner verification checklist</h4> : <h2>Owner verification checklist</h2>}</div><span className="tax-progress">{readinessFields.filter(([key]) => Boolean(form[key])).length} / {readinessFields.length}</span></div>
          <div className="tax-checklist">
            <div className="tax-check-row tax-check-static"><input type="checkbox" checked={settings.readiness.stripeConfigured} readOnly /><span><strong>Stripe Tax configured</strong><small>Read-only provider readiness status</small></span></div>
            {readinessFields.map(([key, label, detail]) => <CheckField key={key} checked={Boolean(form[key])} label={label} detail={detail} onChange={(value) => update(key, value as never)} />)}
          </div>
        </section>

        {enabling ? (
          <section className="tax-enable-confirmation">
            <CheckField checked={Boolean(form.enableTaxCollectionConfirmed)} label="I confirm this saved tax collection profile is intended to be enabled" detail="This records configuration intent only. It does not bypass the independent environment gate." onChange={(value) => update("enableTaxCollectionConfirmed", value)} />
            <label className="tax-select-field">Approved reason<select value={form.enablementReason ?? ""} onChange={(event) => update("enablementReason", event.target.value as FormState["enablementReason"])} required><option value="" disabled>Select a reason</option><option value="configuration_rehearsal">Configuration rehearsal</option><option value="approved_preview_validation">Approved Preview validation</option><option value="owner_approved_go_live">Owner-approved go-live</option></select></label>
          </section>
        ) : null}

        <footer className="tax-save-bar">
          <div aria-live="polite"><strong>{dirty ? "Unsaved changes" : "All changes saved"}</strong><span>{message || "GET is read-only; Save writes changed fields and one audit event."}</span></div>
          <button type="button" disabled={!dirty || state === "saving"} onClick={() => setForm(initial)}>Discard</button>
          <button type="submit" disabled={!dirty || state === "saving"}>{state === "saving" ? "Saving…" : "Save tax settings"}</button>
        </footer>
      </form>
    </section>
  );
}
