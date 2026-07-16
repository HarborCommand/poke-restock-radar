"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, RefreshCw, ShieldCheck, XCircle } from "lucide-react";

type State = "ready" | "warning" | "blocked" | "unknown";

type Readiness = {
  environment: string;
  connection: {
    apiMode: "test" | "live" | "missing";
    secretKeyConfigured: boolean;
    publishableKeyConfigured: boolean;
    webhookConfigured: boolean;
    webhookSignatureReady: boolean;
    providerReachable: boolean | null;
    lastSafeConnectivityCheck: string | null;
    requestId: string | null;
  };
  registration: { status: "active" | "pending" | "missing" | "unknown"; effectiveDate: string | null; warning: string | null };
  product: {
    defaultProductTaxCode: string;
    shippingTaxCode: string;
    defaultCodeReady: boolean;
    shippingCodeReady: boolean;
    fallbackProductCount: number;
    overrideProductCount: number;
  };
  online: {
    automaticTaxConfigured: boolean;
    runtimeEnabled: boolean;
    checkoutLocationCollectionReady: boolean;
    shippingTaxReady: boolean;
    localPickupLocationReady: boolean;
    signedWebhookReady: boolean;
    testCheckoutStatus: "passed" | "not_run" | "blocked";
  };
  pos: {
    runtimeEnabled: boolean;
    calculationsApiReady: boolean;
    transactionsApiReady: boolean;
    storePickupLocationReady: boolean;
    deliveryAddressPathReady: boolean;
    offStripePaymentRecordingReady: boolean;
    reversalRefundPathReady: boolean;
  };
  blockers: string[];
};

function statusFor(value: boolean | null): State {
  return value === true ? "ready" : value === false ? "blocked" : "unknown";
}

function Status({ state, children }: { state: State; children: React.ReactNode }) {
  const Icon = state === "ready" ? CheckCircle2 : state === "blocked" ? XCircle : state === "warning" ? AlertTriangle : CircleDashed;
  return <span className={`stripe-readiness-status ${state}`}><Icon size={15} aria-hidden="true" />{children}<span className="sr-only">. Status: {state}</span></span>;
}

function CheckRow({ label, value, detail }: { label: string; value: boolean | null; detail?: string }) {
  return <li><div><strong>{label}</strong>{detail ? <small>{detail}</small> : null}</div><Status state={statusFor(value)}>{value === true ? "Ready" : value === false ? "Blocked" : "Not checked"}</Status></li>;
}

function safeDate(value: string | null) {
  if (!value) return "Not checked";
  return new Date(value).toLocaleString();
}

export function StripeTaxReadinessWorkspace() {
  const [data, setData] = useState<Readiness | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error" | "checking">("loading");
  const [message, setMessage] = useState("");

  const load = useCallback(async (method: "GET" | "POST" = "GET", signal?: AbortSignal) => {
    setState(method === "POST" ? "checking" : "loading");
    setMessage("");
    try {
      const response = await fetch("/api/radar/tax-readiness", {
        method,
        cache: "no-store",
        credentials: "same-origin",
        headers: method === "POST" ? { "Content-Type": "application/json" } : undefined,
        body: method === "POST" ? "{}" : undefined,
        signal
      });
      const payload = await response.json() as Readiness & { error?: string; requestId?: string };
      if (!response.ok) throw new Error(`${payload.error || "Stripe Tax readiness is unavailable."}${payload.requestId ? ` Reference: ${payload.requestId}.` : ""}`);
      setData(payload);
      setState("ready");
      if (method === "POST") setMessage(payload.connection.providerReachable ? "Safe Stripe test completed." : "Stripe could not be reached. No settings or transactions were changed.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setState("error");
      setMessage(error instanceof Error ? error.message : "Stripe Tax readiness is unavailable.");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load("GET", controller.signal), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [load]);

  if (!data && state === "loading") return <div className="tax-admin-state" role="status">Loading Stripe readiness…</div>;
  if (!data) return <div className="tax-admin-state error" role="alert">{message}<button type="button" onClick={() => void load()}>Try again</button></div>;

  return (
    <section className="stripe-readiness-workspace" aria-labelledby="stripe-readiness-title">
      <header className="stripe-readiness-hero">
        <div><p className="tax-admin-eyebrow">Provider readiness</p><h3 id="stripe-readiness-title">Stripe Tax Readiness</h3><p>Verify configuration and launch blockers without exposing credentials or using manual tax rates.</p></div>
        <Status state={data.blockers.length ? "warning" : "ready"}>{data.blockers.length ? `${data.blockers.length} blockers` : "Ready for review"}</Status>
      </header>

      <div className="stripe-readiness-grid">
        <article>
          <div className="stripe-readiness-heading"><ShieldCheck size={20} /><div><p>Stripe Connection</p><h4>Safe configuration status</h4></div></div>
          <dl>
            <div><dt>API mode</dt><dd><Status state={data.connection.apiMode === "test" ? "ready" : data.connection.apiMode === "live" ? "warning" : "blocked"}>{data.connection.apiMode}</Status></dd></div>
            <div><dt>Secret key</dt><dd>{data.connection.secretKeyConfigured ? "Configured" : "Missing"}</dd></div>
            <div><dt>Publishable key</dt><dd>{data.connection.publishableKeyConfigured ? "Configured" : "Missing"}</dd></div>
            <div><dt>Webhook</dt><dd>{data.connection.webhookConfigured ? "Configured" : "Missing"}</dd></div>
            <div><dt>Signature verification</dt><dd>{data.connection.webhookSignatureReady ? "Ready" : "Blocked"}</dd></div>
            <div><dt>Provider API</dt><dd>{data.connection.providerReachable === null ? "Not checked" : data.connection.providerReachable ? "Reachable" : "Unavailable"}</dd></div>
            <div><dt>Last safe check</dt><dd>{safeDate(data.connection.lastSafeConnectivityCheck)}</dd></div>
            {data.connection.requestId ? <div><dt>Safe request reference</dt><dd>{data.connection.requestId}</dd></div> : null}
          </dl>
          <button className="tax-admin-secondary-action" disabled={state === "checking" || !data.connection.secretKeyConfigured} onClick={() => void load("POST")} type="button"><RefreshCw size={16} aria-hidden="true" />{state === "checking" ? "Checking…" : "Run safe connectivity check"}</button>
          {message ? <p className="stripe-readiness-message" role="status">{message}</p> : null}
        </article>

        <article>
          <div className="stripe-readiness-heading"><div><p>Tax Registrations</p><h4>Florida collection authority</h4></div></div>
          <dl>
            <div><dt>Status</dt><dd><Status state={data.registration.status === "active" ? "ready" : data.registration.status === "pending" ? "warning" : data.registration.status === "missing" ? "blocked" : "unknown"}>{data.registration.status}</Status></dd></div>
            <div><dt>Effective date</dt><dd>{data.registration.effectiveDate || "Not available"}</dd></div>
          </dl>
          {data.registration.warning ? <p className="stripe-readiness-warning"><AlertTriangle size={17} aria-hidden="true" />{data.registration.warning}</p> : null}
          <small>Registration identifiers are intentionally never displayed.</small>
        </article>

        <article>
          <div className="stripe-readiness-heading"><div><p>Product Configuration</p><h4>Tax codes</h4></div></div>
          <dl>
            <div><dt>Default product code</dt><dd>{data.product.defaultProductTaxCode || "Missing"}</dd></div>
            <div><dt>Shipping code</dt><dd>{data.product.shippingTaxCode || "Missing"}</dd></div>
            <div><dt>Products using fallback</dt><dd>{data.product.fallbackProductCount}</dd></div>
            <div><dt>Explicit product overrides</dt><dd>{data.product.overrideProductCount}</dd></div>
          </dl>
          {!data.product.defaultCodeReady || !data.product.shippingCodeReady ? <p className="stripe-readiness-warning"><AlertTriangle size={17} aria-hidden="true" />A valid Stripe product and shipping tax code are required.</p> : null}
        </article>

        <article>
          <div className="stripe-readiness-heading"><div><p>Online Readiness</p><h4>Checkout and webhook</h4></div></div>
          <ul>
            <CheckRow label="Automatic tax configured" value={data.online.automaticTaxConfigured} />
            <CheckRow label="Checkout location collection" value={data.online.checkoutLocationCollectionReady} />
            <CheckRow label="Shipping tax" value={data.online.shippingTaxReady} />
            <CheckRow label="Local Pickup location" value={data.online.localPickupLocationReady} />
            <CheckRow label="Signed webhook" value={data.online.signedWebhookReady} />
            <CheckRow label="Test checkout" value={data.online.testCheckoutStatus === "passed" ? true : false} detail={data.online.testCheckoutStatus.replaceAll("_", " ")} />
          </ul>
        </article>

        <article>
          <div className="stripe-readiness-heading"><div><p>POS Readiness</p><h4>Calculation through reversal</h4></div></div>
          <ul>
            <CheckRow label="Calculations API" value={data.pos.calculationsApiReady} />
            <CheckRow label="Transactions API" value={data.pos.transactionsApiReady} />
            <CheckRow label="Store and pickup location" value={data.pos.storePickupLocationReady} />
            <CheckRow label="Delivery address path" value={data.pos.deliveryAddressPathReady} />
            <CheckRow label="Cash and Zelle recording" value={data.pos.offStripePaymentRecordingReady} />
            <CheckRow label="Refund and reversal path" value={data.pos.reversalRefundPathReady} />
          </ul>
        </article>

        <article className="stripe-readiness-blockers">
          <div className="stripe-readiness-heading"><AlertTriangle size={20} /><div><p>Live Blockers</p><h4>Resolve before enabling collection</h4></div></div>
          {data.blockers.length ? <ul>{data.blockers.map((blocker) => <li key={blocker}><XCircle size={16} aria-hidden="true" /><span>{blocker}</span></li>)}</ul> : <p>No blockers detected. Owner review is still required before changing any runtime gate.</p>}
        </article>
      </div>
    </section>
  );
}
