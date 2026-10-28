"use client";

import Link from "next/link";
import { useState } from "react";
import type { AwaitedPlan } from "@/lib/planning/load-plan";
import { sameImportVersions } from "@/lib/planning/versions";

type Plan = AwaitedPlan;
type Import = { kind: string; sourceFilename: string; exportId: string | null; sourceSystem: string | null; exportedAt: string | null; checkedAt: string | null; importedAt: string; recordCount: number };
type Draft = { to: string; subject: string; body: string };
type Run = {
  id: string; model: string; createdAt: string; importVersions: unknown;
  recommendations: {
    sales: { summary: string; productionActions: Array<{ date: string; action: string }> };
    manpower: { summary: string };
    purchasing: { summary: string; supplierDraft: Draft };
  };
  handoffTrace: Array<{ sequence: number; agent: string; receivedFrom: string[]; status: string }>;
};

const required = [
  ["STOCK", "Stock count"], ["HR_STAFF", "Staff master"], ["HR_LEAVE", "Leave decisions"],
  ["HR_AVAILABILITY", "Part-time availability"], ["CRM", "Weekly CRM orders"],
] as const;

function day(value: string) {
  return new Intl.DateTimeFormat("en-SG", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Singapore" }).format(new Date(value + "T00:00:00+08:00"));
}
function dateTime(value: string) {
  return new Intl.DateTimeFormat("en-SG", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Singapore" }).format(new Date(value));
}
function number(value: number | null) {
  return value === null ? "—" : new Intl.NumberFormat("en-SG", { maximumFractionDigits: 2 }).format(value);
}
async function json(response: Response) {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "The saved planning workspace could not be loaded.");
  return body;
}

export default function DashboardPanel() {
  const [token, setToken] = useState("");
  const [signedIn, setSignedIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draftBusy, setDraftBusy] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [imports, setImports] = useState<Import[]>([]);
  const [importsLoaded, setImportsLoaded] = useState(false);
  const [savedRun, setSavedRun] = useState<Run | null>(null);
  const [draft, setDraft] = useState<Draft>({ to: "", subject: "", body: "" });
  const [zapierReady, setZapierReady] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [draftCreated, setDraftCreated] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load(accessKey: string) {
    const headers = { Authorization: "Bearer " + accessKey };
    const planBody = await fetch("/api/plan", { headers, cache: "no-store" }).then(json);
    const [runResult, importResult, draftResult] = await Promise.allSettled([
      fetch("/api/agents/latest", { headers, cache: "no-store" }).then(json),
      fetch("/api/imports", { headers, cache: "no-store" }).then(json),
      fetch("/api/draft", { headers, cache: "no-store" }).then(json),
    ]);
    const nextPlan = planBody as Plan;
    const latest = runResult.status === "fulfilled" ? (runResult.value.run as Run | null) ?? null : null;
    setPlan(nextPlan);
    setSavedRun(latest);
    setImports(importResult.status === "fulfilled" ? importResult.value.imports as Import[] : []);
    setImportsLoaded(importResult.status === "fulfilled");
    setZapierReady(draftResult.status === "fulfilled" && Boolean(draftResult.value.configured));
    if (runResult.status === "rejected" || importResult.status === "rejected" || draftResult.status === "rejected") {
      setNotice("The numeric plan is available. Some saved details or draft connection status could not be loaded.");
    }
    setDraft(latest && nextPlan.ready && sameImportVersions(latest.importVersions, nextPlan.sourceVersions)
      ? latest.recommendations.purchasing.supplierDraft : { to: "", subject: "", body: "" });
    setReviewed(false);
    setDraftCreated(false);
  }
  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError("");
    try { await load(token); setSignedIn(true); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Owner access could not be verified."); }
    finally { setBusy(false); }
  }
  async function refresh() {
    setBusy(true); setError(""); setNotice("");
    try { await load(token); setNotice("Refreshed from saved imports and agent results."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The dashboard could not be refreshed."); }
    finally { setBusy(false); }
  }
  function signOut() {
    setSignedIn(false); setToken(""); setPlan(null); setImports([]); setImportsLoaded(false); setSavedRun(null);
    setDraft({ to: "", subject: "", body: "" }); setError(""); setNotice("");
  }
  const run = plan?.ready && savedRun && sameImportVersions(savedRun.importVersions, plan.sourceVersions) ? savedRun : null;
  async function createDraft() {
    if (!run || !reviewed || !zapierReady || draftCreated) return;
    setDraftBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/draft", {
        method: "POST", headers: { Authorization: "Bearer " + token, "content-type": "application/json" },
        body: JSON.stringify({ runId: run.id, ...draft, reviewed: true }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "The Gmail draft could not be confirmed.");
      setDraftCreated(true);
      setNotice(body.message ?? "Gmail draft created. Check Gmail Drafts before making another one.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Check Gmail Drafts and Zapier History before retrying.");
    } finally { setDraftBusy(false); }
  }
  const roster = new Map(plan?.roster?.map((row) => [row.date, row]) ?? []);
  const products = plan?.dailyProduction[0]?.products ?? [];
  const excluded = new Map<string, string[]>();
  for (const order of plan?.excludedOrders ?? []) {
    excluded.set(order.productionDate, [...(excluded.get(order.productionDate) ?? []), order.orderId]);
  }

  return <main className="page-shell dashboard-shell">
    <header className="topbar dashboard-topbar">
      <div className="brand-mark" aria-hidden="true">K</div>
      <div><p className="eyebrow">Sample Central Kitchen</p><h1>Kitchen Planner</h1></div>
      <nav className="dashboard-nav" aria-label="Workspace pages"><Link href="/imports">Imports</Link><Link href="/agents">Planning agents</Link></nav>
    </header>

    {!signedIn ? <section className="welcome-card access-card" aria-labelledby="access-title">
      <p className="eyebrow accent">Owner workspace</p><h2 id="access-title">Open your weekly plan.</h2>
      <p className="intro-copy">Sign in with the owner import key to see the plan calculated from saved orders, staff and stock. The key stays in this browser’s memory until you refresh or sign out.</p>
      <form className="access-form" onSubmit={signIn}>
        <label htmlFor="dashboard-key">Owner import key</label>
        <input id="dashboard-key" type="password" autoComplete="current-password" value={token} onChange={(event) => setToken(event.target.value)} required />
        <button className="primary-button" type="submit" disabled={busy}>{busy ? "Opening…" : "Open dashboard"}</button>
      </form>
      {error && <p role="alert" className="form-message error-message">{error}</p>}
    </section> : <>
      <section className="dashboard-hero">
        <div><p className="eyebrow accent">Weekly operations · Singapore time</p>
          <h2>Production plan · {plan ? day(plan.planningWindow.start) + " – " + day(plan.planningWindow.end) : "next week"}</h2>
          <p>Calculated from accepted imports. Roster, late orders and supplier requests remain for manager review.</p>
        </div>
        <div className="dashboard-hero-actions"><button className="quiet-button" type="button" onClick={refresh} disabled={busy || draftBusy}>{busy ? "Refreshing…" : "Refresh plan"}</button><button className="quiet-button" type="button" onClick={signOut}>Sign out</button></div>
      </section>
      {error && <p role="alert" className="dashboard-message error-message">{error}</p>}
      {notice && <p role="status" className="dashboard-message success-message">{notice}</p>}

      <section className="dashboard-section" aria-labelledby="sources-title">
        <div className="section-heading"><div><p className="eyebrow accent">01 · Provenance</p><h2 id="sources-title">Saved source files</h2></div><Link href="/imports">Manage imports →</Link></div>
        <div className="source-grid">{required.map(([kind, label]) => {
          const source = imports.find((item) => item.kind === kind);
          return <article className="source-card" key={kind}>
            <div className="source-card-top"><strong>{label}</strong><span className={source ? "source-ready" : "source-missing"}>{source ? "Saved" : importsLoaded ? "Needed" : "Unknown"}</span></div>
            {source ? <><p>{source.sourceFilename}</p><dl>
              <div><dt>Records</dt><dd>{source.recordCount}</dd></div>
              {source.exportId && <div><dt>Export ID</dt><dd>{source.exportId}</dd></div>}
              {source.sourceSystem && <div><dt>Source</dt><dd>{source.sourceSystem}</dd></div>}
              {source.checkedAt && <div><dt>Counted</dt><dd>{dateTime(source.checkedAt)}</dd></div>}
              {source.exportedAt && <div><dt>Exported</dt><dd>{dateTime(source.exportedAt)}</dd></div>}
              <div><dt>Imported</dt><dd>{dateTime(source.importedAt)}</dd></div>
            </dl></> : <p>Import this file to complete the plan.</p>}
          </article>;
        })}</div>
      </section>

      {plan && !plan.ready && <section className="dashboard-section dashboard-empty">
        <p className="eyebrow accent">Planning inputs</p><h2>Finish importing before using this plan.</h2>
        <p>The dashboard will calculate from saved records when the required files and stock counts are present.</p>
        {plan.missingImports.length > 0 && <p>Missing files: {plan.missingImports.join(", ")}</p>}
        {plan.missingInventoryIngredients.length > 0 && <p>Missing ingredient counts: {plan.missingInventoryIngredients.join(", ")}</p>}
        <Link className="primary-button import-link" href="/imports">Open data imports</Link>
      </section>}

      {plan?.ready && <>
        <section className="metric-grid" aria-label="Weekly totals">
          <article><span>Eligible orders</span><strong>{plan.eligibleOrders.length}</strong><small>At or before cutoff</small></article>
          <article><span>Review exceptions</span><strong>{plan.excludedOrders.length}</strong><small>Outside baseline plan</small></article>
          <article><span>Sandwiches planned</span><strong>{plan.dailyProduction.reduce((sum, row) => sum + row.totalSandwiches, 0)}</strong><small>For this planning week</small></article>
          <article><span>Uncovered hours</span><strong>{number(plan.roster?.reduce((sum, row) => sum + row.uncoveredHours, 0) ?? 0)}</strong><small>Cover to request</small></article>
        </section>

        <section className="dashboard-section" aria-labelledby="production-title">
          <div className="section-heading"><div><p className="eyebrow accent">02 · Verified calculations</p><h2 id="production-title">Daily production and labour</h2></div><span>Cutoff: {dateTime(plan.planningWindow.cutoff)}</span></div>
          <div className="table-scroll"><table className="data-table"><thead><tr><th>Date</th>{products.map((p) => <th key={p.productId}>{p.productName}</th>)}<th>Total</th><th>Labour h</th></tr></thead><tbody>
            {plan.dailyProduction.map((row) => <tr key={row.date}><th scope="row">{day(row.date)}</th>{row.products.map((p) => <td key={p.productId}>{number(p.quantity)}</td>)}<td className="table-emphasis">{number(row.totalSandwiches)}</td><td>{number(row.labourHours)}</td></tr>)}
          </tbody></table></div>
          <details className="order-details"><summary>Trace {plan.eligibleOrders.length} eligible orders</summary><div className="table-scroll"><table className="data-table compact-table"><thead><tr><th>Order</th><th>Production</th><th>Cafe</th><th>Product</th><th>Qty</th><th>Received</th></tr></thead><tbody>
            {plan.eligibleOrders.map((order) => <tr key={order.orderId}><th scope="row">{order.orderId}</th><td>{day(order.productionDate)}</td><td>{order.customer}</td><td>{order.productId}</td><td>{number(order.quantity)}</td><td>{dateTime(order.receivedAt)}</td></tr>)}
          </tbody></table></div></details>
        </section>

        <section className="dashboard-section" aria-labelledby="exceptions-title">
          <div className="section-heading"><div><p className="eyebrow accent">03 · Manager decisions</p><h2 id="exceptions-title">Exceptions and leave</h2></div></div>
          <div className="exception-grid"><article><h3>Orders excluded for review</h3>
            {plan.excludedOrders.length ? plan.excludedOrders.map((order) => <div className="exception-item" key={order.orderId}><strong>{order.orderId} · {day(order.productionDate)}</strong><span>{order.customer} · {order.quantity} {order.productId}</span><span>{order.reasons.join(" ")}</span><em>Manager decides whether to accept or defer. Excluded from totals above.</em></div>) : <p>No excluded orders.</p>}
          </article><article><h3>Approved leave</h3>
            {plan.approvedLeave.length ? plan.approvedLeave.map((leave) => <div className="exception-item" key={leave.staffId + leave.date}><strong>{leave.staffName} · {day(leave.date)}</strong><span>{leave.reason ?? "Approved leave"}</span><em>Excluded from the draft roster on this date.</em></div>) : <p>No approved leave this week.</p>}
            <h3>Pending leave alerts</h3>
            {plan.pendingLeaveAlerts?.length ? plan.pendingLeaveAlerts.map((leave) => <div className="exception-item" key={leave.staffId + leave.date}><strong>{leave.staffName} · {day(leave.date)}</strong><span>{leave.reason ?? "Pending leave"}</span><em>Manager review; not an automatic absence.</em></div>) : <p>No pending leave alerts.</p>}
          </article></div>
        </section>

        <section className="dashboard-section" aria-labelledby="roster-title">
          <div className="section-heading"><div><p className="eyebrow accent">04 · Draft roster</p><h2 id="roster-title">Named shifts and cover</h2></div><span>Manager approval required</span></div>
          <div className="roster-grid">{plan.roster?.map((row) => <article className="roster-card" key={row.date}>
            <div className="roster-card-top"><strong>{day(row.date)}</strong><span>{number(row.requiredLabourHours)} needed · {number(row.assignedProductiveHours)} assigned</span></div>
            <ul>{row.assignments.map((person) => <li key={person.staffId}><strong>{person.name}</strong><span>{person.role} · {person.start}–{person.end} · {number(person.productiveHours)} productive h</span></li>)}</ul>
            <p className={row.uncoveredHours ? "gap-warning" : "gap-ok"}>{row.uncoveredHours ? number(row.uncoveredHours) + " uncovered h · request " + row.additionalPartTimeShiftsToRequest + " additional four-hour part-time shift(s)" : "Productive hours covered"}</p>
            {!row.supervisorQualifiedWorkerAvailable && <p className="gap-warning">No supervisor-qualified worker available. Manager review needed.</p>}
          </article>)}</div>
        </section>

        <section className="dashboard-section" aria-labelledby="stock-title">
          <div className="section-heading"><div><p className="eyebrow accent">05 · Stock request</p><h2 id="stock-title">Demand, usable stock and whole packs</h2></div><span>Only a physical receipt changes stock</span></div>
          <div className="table-scroll"><table className="data-table"><thead><tr><th>Ingredient</th><th>Demand</th><th>On hand</th><th>Committed</th><th>Usable</th><th>Shortage</th><th>Request</th></tr></thead><tbody>
            {plan.ingredientDemand.map((item) => <tr key={item.ingredientId}><th scope="row">{item.name}</th><td>{number(item.requiredQuantity)} {item.unit}</td><td>{number(item.onHand)}</td><td>{number(item.committed)}</td><td>{number(item.usableStock)}</td><td>{number(item.shortage)}</td><td className="table-emphasis">{number(item.packsToOrder)} {item.packName ?? "packs"} · {number(item.quantityToOrder)} {item.unit}</td></tr>)}
          </tbody></table></div>
        </section>

        <section className="dashboard-section" aria-labelledby="actions-title">
          <div className="section-heading"><div><p className="eyebrow accent">06 · Dated decisions</p><h2 id="actions-title">Action plan</h2></div><span>Finding → human action</span></div>
          <div className="action-list">{plan.dailyProduction.map((row) => {
            const shift = roster.get(row.date);
            const late = excluded.get(row.date) ?? [];
            const agentAction = run?.recommendations.sales.productionActions.find((item) => item.date === row.date)?.action;
            return <article className="action-row" key={row.date}><strong>{day(row.date)}</strong><div><span className="action-label">Finding</span><p>{row.totalSandwiches} sandwiches need {number(row.labourHours)} productive hours.{shift?.uncoveredHours ? " " + number(shift.uncoveredHours) + " hours remain uncovered." : ""}{late.length ? " " + late.join(", ") + " is excluded for review." : ""}</p></div><div><span className="action-label">Manager action</span><p>{agentAction ?? "Review ingredients, production and the draft roster before approving the day."}{shift?.uncoveredHours ? " Request " + shift.additionalPartTimeShiftsToRequest + " additional part-time shift(s); no one is booked." : ""}{late.length ? " Decide whether to accept or defer the late order." : ""}</p></div></article>;
          })}</div>
        </section>

        <section className="dashboard-section" aria-labelledby="agents-title">
          <div className="section-heading"><div><p className="eyebrow accent">07 · Planning agents</p><h2 id="agents-title">Recommendations and handoff</h2></div><Link href="/agents">Open agent console →</Link></div>
          {run ? <><p className="run-caption">Saved {dateTime(run.createdAt)} · {run.model} · matched to current imports</p>
            <div className="recommendation-grid"><article><h3>Sales & production</h3><p>{run.recommendations.sales.summary}</p></article><article><h3>Manpower</h3><p>{run.recommendations.manpower.summary}</p></article><article><h3>Purchasing</h3><p>{run.recommendations.purchasing.summary}</p></article></div>
            <ol className="dashboard-handoff">{run.handoffTrace.map((step) => <li key={step.sequence}><strong>{step.sequence}. {step.agent}</strong><span>From {step.receivedFrom.join(" + ")} · {step.status}</span></li>)}</ol>
          </> : <p>{savedRun ? "Saved recommendations refer to older imports. Run planning agents again before using them." : "No agent run has been saved for these imports. Run planning agents when you choose."}</p>}
        </section>

        <section className="dashboard-section draft-section" aria-labelledby="draft-title">
          <div className="section-heading"><div><p className="eyebrow accent">08 · Reviewed action</p><h2 id="draft-title">Supplier email draft</h2></div><span>Draft only · never sent by this app</span></div>
          {run ? <><p>Review and edit these details. Creating a draft saves it in your connected Gmail account for a separate human review.</p>
            <div className="draft-form">
              <label htmlFor="draft-to">To</label><input id="draft-to" type="email" value={draft.to} onChange={(event) => { setDraft({ ...draft, to: event.target.value }); setReviewed(false); }} />
              <label htmlFor="draft-subject">Subject</label><input id="draft-subject" value={draft.subject} onChange={(event) => { setDraft({ ...draft, subject: event.target.value }); setReviewed(false); }} />
              <label htmlFor="draft-body">Body</label><textarea id="draft-body" rows={13} value={draft.body} onChange={(event) => { setDraft({ ...draft, body: event.target.value }); setReviewed(false); }} />
              <label className="review-check"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} /><span>I reviewed the recipient, subject and body. Create a Gmail draft only.</span></label>
              <button className="primary-button" type="button" onClick={createDraft} disabled={!zapierReady || !reviewed || draftBusy || draftCreated}>{draftBusy ? "Creating draft…" : draftCreated ? "Draft action completed" : "Create Gmail draft"}</button>
              {!zapierReady && <p className="form-message">Connect Gmail Create Draft through Zapier MCP and add its server-side token before this button is available.</p>}
            </div>
          </> : <p>Run planning agents with the current imports to prepare a supplier draft for review.</p>}
        </section>
      </>}
    </>}
    <footer className="page-footer"><span>Sample Central Kitchen · Draft decisions stay with the manager</span><span>Singapore time</span></footer>
  </main>;
}
