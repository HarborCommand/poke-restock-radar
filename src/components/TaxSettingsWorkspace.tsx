"use client";

import { useEffect, useId, useMemo, useState } from "react";

type TaxSettings = {
  environment: string;
  collectionDisabled: boolean;
  online: {
    configurationEnabled: boolean;
    enabled: boolean;
    stripeCheckoutEnabled: boolean;
    stripeMode: "test" | "live" | "missing" | "unknown" | "mixed";
    automaticTaxReady: boolean;
    defaultProductTaxCode: string;
    checkoutAddressRequirement: string;
    localPickupStatus: string;
    localPickupTreatment: "pending_review" | "taxable_at_store_location" | "provider_authoritative";
    warnings: string[];
  };
  pos: {
    storeCountry: string;
    storeState: string;
    storeCounty: string;
    stateRateBasisPoints: number;
    countyRateBasisPoints: number;
    combinedRateBasisPoints: number;
    effectiveDate: string;
    sourceNote: string;
    profileEnabled: boolean;
    runtimeEnabled: boolean;
    active: boolean;
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
  product: { defaultTaxCategory: "general_tangible_goods"; defaultStripeTaxCode: "txcd_99999999" };
  readiness: {
    registrationConfirmed: boolean;
    stripeConfigured: boolean;
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
  defaultStripeTaxCode: "txcd_99999999";
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
  onChange
}: {
  checked: boolean;
  label: string;
  detail?: string;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="tax-check-row">
      <input id={id} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>
        <label htmlFor={id}><strong>{label}</strong></label>
        {detail ? <small>{detail}</small> : null}
      </span>
    </div>
  );
}

export function TaxSettingsWorkspace() {
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
        if (!response.ok) throw new Error(payload.error || "Tax settings are unavailable.");
        return payload as TaxSettings;
      })
      .then((payload) => {
        if (!active) return;
        const next = formFromSettings(payload);
        setSettings(payload);
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
  }, []);

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
        throw new Error(detail || payload.error || "Tax settings could not be saved.");
      }
      const nextSettings = payload as TaxSettings;
      const nextForm = formFromSettings(nextSettings);
      setSettings(nextSettings);
      setInitial(nextForm);
      setForm(nextForm);
      setMessage("Tax settings saved and an audit event was recorded.");
      setState("ready");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Tax settings could not be saved.");
      setState("ready");
    }
  }

  if (state === "loading") return <main className="tax-workspace tax-workspace-state">Loading tax settings…</main>;
  if (!settings || !form) return <main className="tax-workspace tax-workspace-state"><a href="/admin">Back to admin</a><p>{message}</p></main>;

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
    <main className="tax-workspace">
      <header className="tax-workspace-header">
        <div>
          <a href="/admin" className="tax-back-link">← Admin</a>
          <p className="tax-eyebrow">Commerce controls</p>
          <h1>Tax Settings</h1>
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
          <div className="tax-section-heading"><div><p>Online Tax</p><h2>Stripe automatic tax</h2></div><Status active={settings.online.automaticTaxReady}>{settings.online.automaticTaxReady ? "Ready" : "Not ready"}</Status></div>
          <div className="tax-summary-grid">
            <div><span>Collection gate</span><strong>{settings.online.enabled ? "Enabled" : "Disabled"}</strong></div>
            <div><span>Stripe mode</span><strong>{settings.online.stripeMode}</strong></div>
            <div><span>Checkout readiness</span><strong>{settings.online.stripeCheckoutEnabled ? "Configured" : "Disabled"}</strong></div>
            <div><span>Default product code</span><strong>{settings.online.defaultProductTaxCode}</strong></div>
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
          <div className="tax-section-heading"><div><p>POS Tax Profile</p><h2>Store jurisdiction and rate</h2></div><Status active={settings.pos.runtimeEnabled && form.posTaxEnabled}>{settings.pos.runtimeEnabled && form.posTaxEnabled ? "Active" : "Inactive"}</Status></div>
          <p className="tax-section-copy">The server calculates tax from this saved snapshot. Cashiers cannot enter or override a tax amount.</p>
          <div className="tax-form-grid">
            <label>Country<input value={form.storeCountry} maxLength={2} onChange={(event) => update("storeCountry", event.target.value.toUpperCase())} required /></label>
            <label>State<input value={form.storeState} maxLength={2} onChange={(event) => update("storeState", event.target.value.toUpperCase())} required /></label>
            <label>County<input value={form.storeCounty} onChange={(event) => update("storeCounty", event.target.value)} required /></label>
            <label>State rate (%)<input type="number" min="0" max="20" step="0.01" value={form.stateRateBasisPoints / 100} onChange={(event) => update("stateRateBasisPoints", Math.round(Number(event.target.value) * 100))} required /></label>
            <label>County surtax (%)<input type="number" min="0" max="20" step="0.01" value={form.countyRateBasisPoints / 100} onChange={(event) => update("countyRateBasisPoints", Math.round(Number(event.target.value) * 100))} required /></label>
            <label>Combined rate<input value={`${(combined / 100).toFixed(2)}%`} readOnly aria-readonly="true" /></label>
            <label>Effective date<input type="date" value={form.effectiveDate} onChange={(event) => update("effectiveDate", event.target.value)} required /></label>
            <label className="tax-span-2">Source / reference note<textarea value={form.sourceNote} onChange={(event) => update("sourceNote", event.target.value)} maxLength={500} required /></label>
          </div>
          <CheckField checked={form.posTaxEnabled} label="Enable the saved POS tax profile" detail={settings.pos.runtimeEnabled ? "The Preview runtime gate is on." : "The runtime gate is off, so saving this alone cannot collect tax."} onChange={(value) => update("posTaxEnabled", value)} />
          <p className="tax-timestamp">Last updated: {settings.pos.lastUpdated ? new Date(settings.pos.lastUpdated).toLocaleString() : "Never saved"}{settings.pos.lastUpdatedByAdmin ? " by an authenticated admin" : ""}</p>
        </section>

        <section className="tax-section">
          <div className="tax-section-heading"><div><p>Tax Exemption</p><h2>Controlled exception workflow</h2></div><Status active={settings.exemption.runtimeEnabled && form.taxExemptSalesEnabled}>{settings.exemption.runtimeEnabled && form.taxExemptSalesEnabled ? "Available" : "Unavailable"}</Status></div>
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
          <div className="tax-section-heading"><div><p>Reporting</p><h2>Filing-support exports</h2></div><Status active={settings.reporting.enabled}>{settings.reporting.enabled ? "Available" : "Disabled"}</Status></div>
          <label className="tax-select-field">Default reporting period<select value={form.defaultReportingPeriod} onChange={(event) => update("defaultReportingPeriod", event.target.value as FormState["defaultReportingPeriod"])}><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annual">Annual</option></select></label>
          <CheckField checked={form.taxReportingProfileEnabled} label="Mark the reporting profile as configured" detail={settings.reporting.enabled ? "The independent reporting runtime gate is enabled." : "Configuration intent only. Export remains unavailable while the runtime gate is off."} onChange={(value) => update("taxReportingProfileEnabled", value)} />
          <p className="tax-section-copy">{settings.reporting.disclaimer}</p>
          {settings.reporting.exportAvailable ? <a href="/admin/tax-reports" className="tax-inline-action">Open Sales Tax Reports</a> : <span className="tax-muted">Reporting is unavailable while the feature is disabled.</span>}
        </section>

        <section className="tax-section">
          <div className="tax-section-heading"><div><p>Go-Live Readiness</p><h2>Owner verification checklist</h2></div><span className="tax-progress">{readinessFields.filter(([key]) => Boolean(form[key])).length} / {readinessFields.length}</span></div>
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
    </main>
  );
}
