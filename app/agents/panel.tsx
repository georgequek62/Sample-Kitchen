"use client";

import Link from "next/link";
import { useState } from "react";

type NumericPlan = {
  ready: boolean;
  missingImports: string[];
  missingInventoryIngredients: string[];
  planningWindow: { start: string; end: string; timezone: string };
  eligibleOrders: unknown[];
  excludedOrders: unknown[];
};

type SavedRun = {
  id: string;
  model: string;
  createdAt: string;
  importVersions: unknown;
  recommendations: {
    sales: {
      summary: string;
      lateOrderExplanations: Array<{ orderId: string; reason: string; managerAction: string }>;
      productionActions: Array<{ date: string; action: string }>;
    };
    manpower: {
      summary: string;
      staffingGaps: Array<{ date: string; uncoveredHours: number; additionalPartTimeShiftsToRequest: number; requestForManagerReview: string }>;
      pendingLeaveNotes: Array<{ staffId: string; date: string; note: string }>;
    };
    purchasing: {
      summary: string;
      shortageLines: Array<{ ingredientId: string; packsToOrder: number; quantityToOrder: number; unit: string; explanation: string }>;
      supplierDraft: { to: string; subject: string; body: string };
    };
  };
  handoffTrace: Array<{ sequence: number; agent: string; responseId: string | null; receivedFrom: string[]; status: string }>;
};

const importOrder = [
  { kind: "STOCK", label: "Stock count" },
  { kind: "HR_STAFF", label: "Staff master" },
  { kind: "HR_LEAVE", label: "Leave decisions" },
  { kind: "HR_AVAILABILITY", label: "Part-time availability" },
  { kind: "CRM", label: "Weekly CRM orders" },
];

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-SG", { dateStyle: "medium", timeZone: "Asia/Singapore" }).format(new Date(`${value}T00:00:00+08:00`));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-SG", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Singapore" }).format(new Date(value));
}

export default function AgentsPanel() {
  const [token, setToken] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [plan, setPlan] = useState<NumericPlan | null>(null);
  const [run, setRun] = useState<SavedRun | null>(null);

  async function loadWorkspace(accessKey: string) {
    const headers = { Authorization: `Bearer ${accessKey}` };
    const [accessResponse, planResponse, latestResponse] = await Promise.all([
      fetch("/api/imports", { headers, cache: "no-store" }),
      fetch("/api/plan", { headers, cache: "no-store" }),
      fetch("/api/agents/latest", { headers, cache: "no-store" }),
    ]);
    const accessBody = await accessResponse.json();
    const planBody = await planResponse.json();
    const latestBody = await latestResponse.json();
    if (!accessResponse.ok) throw new Error(accessBody.error ?? "Could not verify owner access.");
    if (!planResponse.ok) throw new Error(planBody.error ?? "Could not load the numeric plan.");
    if (!latestResponse.ok) throw new Error(latestBody.error ?? "Could not load saved agent results.");
    setPlan(planBody as NumericPlan);
    setRun((latestBody.run as SavedRun | null) ?? null);
  }

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setChecking(true);
    setError("");
    try {
      await loadWorkspace(token);
      setAuthorized(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not verify owner access.");
    } finally {
      setChecking(false);
    }
  }

  async function runAgents() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/agents/run", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await response.json();
      if (body.plan) setPlan(body.plan as NumericPlan);
      if (!response.ok) {
        setError(body.error ?? "The agents could not run.");
        return;
      }
      setRun(body.run as SavedRun);
      setNotice("All three recommendations were validated and saved with the current imports.");
    } catch {
      setError("The request failed. Your numeric plan and last saved agent run are still available.");
    } finally {
      setBusy(false);
    }
  }

  async function refreshInputs() {
    setChecking(true);
    setError("");
    setNotice("");
    try {
      await loadWorkspace(token);
      setNotice("Input status refreshed from the saved database records.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not refresh input status.");
    } finally {
      setChecking(false);
    }
  }

  function signOut() {
    setAuthorized(false);
    setToken("");
    setPlan(null);
    setRun(null);
    setError("");
    setNotice("");
  }

  if (!authorized) {
    return (
      <section className="welcome-card access-card" aria-labelledby="access-title">
        <p className="eyebrow accent">Private planning action</p>
        <h2 id="access-title">Sign in with your owner import key.</h2>
        <p className="intro-copy">The key is stored in your local <code>.env.local</code> file as <code>IMPORT_ADMIN_TOKEN</code>. It stays in this browser’s memory only until you refresh or sign out.</p>
        <form className="access-form" onSubmit={signIn}>
          <label htmlFor="owner-key">Owner import key</label>
          <input id="owner-key" type="password" autoComplete="current-password" value={token} onChange={(event) => setToken(event.target.value)} required />
          <button className="primary-button" type="submit" disabled={checking}>{checking ? "Checking…" : "Continue"}</button>
        </form>
        {error && <p className="form-message error-message" role="alert">{error}</p>}
      </section>
    );
  }

  return (
    <>
      <section className="welcome-card import-intro">
        <div className="import-intro-heading">
          <div>
            <p className="eyebrow accent">Agent run console</p>
            <h2>Run the planning agents when you’re ready.</h2>
          </div>
          <button type="button" className="quiet-button" onClick={signOut}>Sign out</button>
        </div>
        <p className="intro-copy">The button sends the saved, verified plan to three OpenAI agents in sequence. They can explain and recommend, but cannot change the numeric plan, book staff, place orders or send email.</p>
        {plan && <div className="plan-readiness" role="status">
          <strong>{plan.ready ? "Planning inputs are ready" : "Planning inputs are incomplete"}</strong>
          <span>Planning week: {formatDate(plan.planningWindow.start)} – {formatDate(plan.planningWindow.end)}</span>
          {plan.missingImports.includes("CRM")
            ? <span>Order totals will appear after the weekly CRM file is imported.</span>
            : <span>{plan.eligibleOrders.length} eligible orders · {plan.excludedOrders.length} excluded for review</span>}
          {plan.missingInventoryIngredients.length > 0 && <span>Missing ingredient counts in the stock import: {plan.missingInventoryIngredients.join(", ")}</span>}
        </div>}
        {plan && !plan.ready && <div className="plan-next-steps">
          <strong>{plan.missingImports.length > 0 ? "To enable the agent run, import the missing files in this order:" : "To enable the agent run, complete the stock count:"}</strong>
          {plan.missingImports.length > 0 && <ol>{importOrder.filter((item) => plan.missingImports.includes(item.kind)).map((item) => <li key={item.kind}>{item.label}</li>)}</ol>}
          {plan.missingInventoryIngredients.length > 0 && <p>Update the stock count to include the missing ingredients listed above.</p>}
          <Link className="primary-button import-link" href="/imports">Open data imports</Link>
        </div>}
        <button className="quiet-button refresh-inputs-button" type="button" disabled={checking || busy} onClick={refreshInputs}>{checking ? "Refreshing…" : "Refresh input status"}</button>
        <button className="primary-button run-agent-button" type="button" disabled={busy || !plan?.ready} onClick={runAgents}>
          {busy ? "Running three agents…" : "Run planning agents"}
        </button>
        {plan && !plan.ready && <p className="form-message">Run planning agents becomes available after the required imports are saved.</p>}
        {error && <p className="form-message error-message" role="alert">{error} The numeric plan remains available and is still shown above.</p>}
        {notice && <p className="form-message success-message" role="status">{notice}</p>}
        {busy && <p className="form-message">This makes three sequential OpenAI API requests. Keep this page open while they finish.</p>}
      </section>

      {run && <>
        <section className="agent-run-meta" aria-label="Saved agent run details">
          <strong>Saved run</strong><span>{run.model} · {formatDateTime(run.createdAt)}</span>
        </section>
        <section className="agent-grid" aria-label="Agent recommendations">
          <article className="agent-card">
            <p className="eyebrow accent">Sales & Production</p>
            <p>{run.recommendations.sales.summary}</p>
            <h3>Late orders for review</h3>
            {run.recommendations.sales.lateOrderExplanations.length ? run.recommendations.sales.lateOrderExplanations.map((item) => <div className="agent-detail" key={item.orderId}><strong>{item.orderId}</strong><span>{item.reason}</span><span>Manager action: {item.managerAction}</span></div>) : <p className="agent-empty">No late-order exceptions in this run.</p>}
            <h3>Dated production actions</h3>
            {run.recommendations.sales.productionActions.map((item) => <div className="agent-detail" key={`${item.date}-${item.action}`}><strong>{formatDate(item.date)}</strong><span>{item.action}</span></div>)}
          </article>
          <article className="agent-card">
            <p className="eyebrow accent">Manpower</p>
            <p>{run.recommendations.manpower.summary}</p>
            <h3>Cover requests for review</h3>
            {run.recommendations.manpower.staffingGaps.length ? run.recommendations.manpower.staffingGaps.map((item) => <div className="agent-detail" key={item.date}><strong>{formatDate(item.date)} · {item.uncoveredHours} uncovered hours</strong><span>{item.additionalPartTimeShiftsToRequest} additional part-time shift(s) to request</span><span>{item.requestForManagerReview}</span></div>) : <p className="agent-empty">No uncovered hours in this run.</p>}
            <h3>Pending leave alerts</h3>
            {run.recommendations.manpower.pendingLeaveNotes.length ? run.recommendations.manpower.pendingLeaveNotes.map((item) => <div className="agent-detail" key={`${item.staffId}-${item.date}`}><strong>{item.staffId} · {formatDate(item.date)}</strong><span>{item.note}</span></div>) : <p className="agent-empty">No pending leave alerts in this run.</p>}
          </article>
          <article className="agent-card">
            <p className="eyebrow accent">Purchasing</p>
            <p>{run.recommendations.purchasing.summary}</p>
            <h3>Verified shortage lines</h3>
            {run.recommendations.purchasing.shortageLines.length ? run.recommendations.purchasing.shortageLines.map((item) => <div className="agent-detail" key={item.ingredientId}><strong>{item.ingredientId} · {item.packsToOrder} packs · {item.quantityToOrder} {item.unit}</strong><span>{item.explanation}</span></div>) : <p className="agent-empty">No whole packs to request from the saved stock count.</p>}
            <h3>Supplier draft · not sent</h3>
            <div className="supplier-draft"><strong>To: {run.recommendations.purchasing.supplierDraft.to}</strong><strong>{run.recommendations.purchasing.supplierDraft.subject}</strong><pre>{run.recommendations.purchasing.supplierDraft.body}</pre></div>
          </article>
        </section>
        <section className="handoff-card" aria-label="Agent handoff trace">
          <div><p className="eyebrow accent">Structured handoff</p><h2>What each agent received</h2></div>
          <ol>{run.handoffTrace.map((item) => <li key={item.sequence}><strong>{item.sequence}. {item.agent}</strong><span>Received from: {item.receivedFrom.join(" + ")}</span><span>Status: {item.status}</span></li>)}</ol>
        </section>
      </>}
    </>
  );
}
