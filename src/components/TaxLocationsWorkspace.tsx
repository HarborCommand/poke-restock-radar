"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, MapPin, Plus, ShieldCheck, Trash2 } from "lucide-react";

type Location = {
  id: string; name: string; locationType: string; country: string; addressLine1: string; addressLine2: string | null;
  city: string; state: string; postalCode: string; county: string | null; active: boolean; defaultForPos: boolean;
  defaultForLocalPickup: boolean; defaultShipFrom: boolean; effectiveDate: string; verificationStatus: string;
};

const empty = {
  name: "", locationType: "primary_store", country: "US", addressLine1: "", addressLine2: "", city: "", state: "FL", postalCode: "", county: "",
  active: true, defaultForPos: false, defaultForLocalPickup: false, defaultShipFrom: false,
  effectiveDate: new Date().toISOString().slice(0, 10), verificationStatus: "unverified"
};

export function TaxLocationsWorkspace() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [form, setForm] = useState<typeof empty & { id?: string }>(empty);
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "saving" | "error">("loading");
  const [message, setMessage] = useState("");

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/radar/tax-locations", { cache: "no-store", credentials: "same-origin", signal });
      const payload = await response.json() as { locations?: Location[]; error?: string; requestId?: string };
      if (!response.ok) throw new Error(`${payload.error || "Tax locations are unavailable."}${payload.requestId ? ` Reference: ${payload.requestId}.` : ""}`);
      setLocations(payload.locations ?? []); setStatus("ready");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setStatus("error"); setMessage(error instanceof Error ? error.message : "Tax locations are unavailable.");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [load]);

  function edit(location?: Location) {
    setForm(location ? { ...location, addressLine2: location.addressLine2 ?? "", county: location.county ?? "" } : empty);
    setEditing(true); setMessage("");
  }

  async function save(event: React.FormEvent) {
    event.preventDefault(); setStatus("saving"); setMessage("");
    try {
      const response = await fetch("/api/radar/tax-locations", { method: form.id ? "PATCH" : "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const payload = await response.json() as Location & { error?: string; requestId?: string };
      if (!response.ok) throw new Error(`${payload.error || "Tax location could not be saved."}${payload.requestId ? ` Reference: ${payload.requestId}.` : ""}`);
      setEditing(false); setMessage("Location saved and audited."); await load();
    } catch (error) { setStatus("error"); setMessage(error instanceof Error ? error.message : "Tax location could not be saved."); }
  }

  async function remove(location: Location) {
    if (!window.confirm(`Delete ${location.name}? Historical transaction snapshots will be preserved.`)) return;
    setStatus("saving");
    const response = await fetch("/api/radar/tax-locations", { method: "DELETE", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: location.id, confirmDeletion: true }) });
    const payload = await response.json() as { error?: string; requestId?: string };
    if (!response.ok) { setStatus("error"); setMessage(`${payload.error || "Tax location could not be deleted."}${payload.requestId ? ` Reference: ${payload.requestId}.` : ""}`); return; }
    setMessage("Location deleted. Historical snapshots were not changed."); await load();
  }

  const set = <K extends keyof typeof empty>(key: K, value: (typeof empty)[K]) => setForm((current) => ({ ...current, [key]: value }));

  return <section className="tax-locations-workspace" aria-labelledby="tax-locations-title">
    <header className="stripe-readiness-hero"><div><p className="tax-admin-eyebrow">Private tax configuration</p><h3 id="tax-locations-title">Tax Locations</h3><p>Verified locations determine POS, Local Pickup, and ship-from addresses. Cashiers never enter tax rates.</p></div><button className="tax-admin-secondary-action" onClick={() => edit()} type="button"><Plus size={16} />Add location</button></header>
    {message ? <p className={status === "error" ? "tax-admin-state error" : "stripe-readiness-message"} role={status === "error" ? "alert" : "status"}>{message}</p> : null}
    {status === "loading" ? <div className="tax-admin-state" role="status">Loading private locations…</div> : null}
    <div className="tax-location-list">
      {locations.map((location) => <article key={location.id}>
        <div className="tax-location-icon"><MapPin size={20} /></div>
        <div><div className="tax-location-title"><h4>{location.name}</h4><span className={`stripe-readiness-status ${location.verificationStatus === "verified" ? "ready" : "warning"}`}>{location.verificationStatus === "verified" ? <CheckCircle2 size={14} /> : <ShieldCheck size={14} />}{location.verificationStatus}</span></div><p>{location.city}, {location.state} {location.postalCode} · {location.locationType.replaceAll("_", " ")}</p><div className="tax-location-tags">{location.defaultForPos ? <span>POS default</span> : null}{location.defaultForLocalPickup ? <span>Pickup default</span> : null}{location.defaultShipFrom ? <span>Ship-from default</span> : null}{!location.active ? <span>Inactive</span> : null}</div></div>
        <div className="tax-location-actions"><button type="button" onClick={() => edit(location)}>Edit</button><button aria-label={`Delete ${location.name}`} type="button" onClick={() => void remove(location)}><Trash2 size={16} /></button></div>
      </article>)}
      {status === "ready" && !locations.length ? <div className="tax-admin-state"><MapPin size={22} /><strong>No tax locations yet.</strong><span>Add a verified store location before enabling Stripe Tax.</span></div> : null}
    </div>
    {editing ? <form className="tax-location-form" onSubmit={save}>
      <div className="tax-section-heading"><div><p>Location details</p><h4>{form.id ? "Edit location" : "Add location"}</h4></div></div>
      <div className="tax-form-grid">
        <label>Name<input maxLength={80} required value={form.name} onChange={(e) => set("name", e.currentTarget.value)} /></label>
        <label>Type<select value={form.locationType} onChange={(e) => set("locationType", e.currentTarget.value)}><option value="primary_store">Primary store</option><option value="local_pickup">Local Pickup</option><option value="ship_from">Ship-from</option><option value="warehouse">Warehouse</option><option value="pos_delivery_origin">POS delivery origin</option></select></label>
        <label>Address line<input maxLength={160} required value={form.addressLine1} onChange={(e) => set("addressLine1", e.currentTarget.value)} /></label>
        <label>Unit (optional)<input maxLength={160} value={form.addressLine2} onChange={(e) => set("addressLine2", e.currentTarget.value)} /></label>
        <label>City<input maxLength={100} required value={form.city} onChange={(e) => set("city", e.currentTarget.value)} /></label>
        <label>State<input maxLength={2} required value={form.state} onChange={(e) => set("state", e.currentTarget.value.toUpperCase())} /></label>
        <label>ZIP code<input maxLength={10} required value={form.postalCode} onChange={(e) => set("postalCode", e.currentTarget.value)} /></label>
        <label>County (verified only)<input maxLength={100} value={form.county} onChange={(e) => set("county", e.currentTarget.value)} /></label>
        <label>Country<input maxLength={2} required value={form.country} onChange={(e) => set("country", e.currentTarget.value.toUpperCase())} /></label>
        <label>Effective date<input type="date" required value={form.effectiveDate} onChange={(e) => set("effectiveDate", e.currentTarget.value)} /></label>
        <label>Verification<select value={form.verificationStatus} onChange={(e) => set("verificationStatus", e.currentTarget.value)}><option value="unverified">Unverified</option><option value="verified">Verified</option><option value="failed">Failed verification</option></select></label>
      </div>
      <div className="tax-location-defaults"><label><input type="checkbox" checked={form.active} onChange={(e) => set("active", e.currentTarget.checked)} />Active</label><label><input type="checkbox" checked={form.defaultForPos} onChange={(e) => set("defaultForPos", e.currentTarget.checked)} />Default for POS</label><label><input type="checkbox" checked={form.defaultForLocalPickup} onChange={(e) => set("defaultForLocalPickup", e.currentTarget.checked)} />Default for Local Pickup</label><label><input type="checkbox" checked={form.defaultShipFrom} onChange={(e) => set("defaultShipFrom", e.currentTarget.checked)} />Default ship-from</label></div>
      <div className="tax-location-form-actions"><button className="tax-admin-secondary-action" type="button" onClick={() => setEditing(false)}>Cancel</button><button className="primary-action" disabled={status === "saving"} type="submit">{status === "saving" ? "Saving…" : "Save location"}</button></div>
    </form> : null}
  </section>;
}
