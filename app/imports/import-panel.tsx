"use client";

import { useState } from "react";

type ImportKind = "STOCK" | "HR_STAFF" | "HR_LEAVE" | "HR_AVAILABILITY" | "CRM";
type ImportSummary = {
  kind: ImportKind;
  sourceFilename: string;
  exportId: string | null;
  sourceSystem: string | null;
  exportStatus: string | null;
  effectiveMonth: string | null;
  exportedAt: string | null;
  checkedAt: string | null;
  importedAt: string;
  recordCount: number;
  duplicate: boolean;
};
type UploadKind = {
  kind: ImportKind;
  title: string;
  description: string;
  accept: string;
  endpoint: string;
};
type UploadState = { file: File | null; busy: boolean; message: string; errors: Array<{ row?: number; field: string; message: string }> };

const uploads: UploadKind[] = [
  { kind: "STOCK", title: "Stock count", description: "Upload the latest physical count. Stock is stored with its checked time.", accept: ".json,application/json", endpoint: "/api/imports/stock" },
  { kind: "HR_STAFF", title: "1 · Staff master", description: "Import this first so leave and availability records can be matched to staff IDs.", accept: ".json,application/json", endpoint: "/api/imports/hr/staff" },
  { kind: "HR_LEAVE", title: "2 · Leave decisions", description: "Approved and pending leave records are retained with their HR export details.", accept: ".json,application/json", endpoint: "/api/imports/hr/leave" },
  { kind: "HR_AVAILABILITY", title: "3 · Part-time availability", description: "Use confirmed availability from HR; the app does not book staff.", accept: ".json,application/json", endpoint: "/api/imports/hr/availability" },
  { kind: "CRM", title: "Weekly CRM orders", description: "Upload the weekly CSV last. Duplicate orders are rejected and late orders remain available for review.", accept: ".csv,text/csv", endpoint: "/api/imports/crm" },
];

function emptyState(): UploadState {
  return { file: null, busy: false, message: "", errors: [] };
}

function formatDate(value: string | null) {
  if (!value) return "Not provided";
  return new Intl.DateTimeFormat("en-SG", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Singapore" }).format(new Date(value));
}

export default function ImportPanel() {
  const [token, setToken] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [checking, setChecking] = useState(false);
  const [accessError, setAccessError] = useState("");
  const [history, setHistory] = useState<ImportSummary[]>([]);
  const [states, setStates] = useState<Record<ImportKind, UploadState>>({
    STOCK: emptyState(), HR_STAFF: emptyState(), HR_LEAVE: emptyState(), HR_AVAILABILITY: emptyState(), CRM: emptyState(),
  });

  function updateState(kind: ImportKind, update: Partial<UploadState>) {
    setStates((current) => ({ ...current, [kind]: { ...current[kind], ...update } }));
  }

  async function refreshHistory(accessKey = token) {
    const response = await fetch("/api/imports", { headers: { Authorization: `Bearer ${accessKey}` }, cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Could not load import history.");
    setHistory(body.imports as ImportSummary[]);
  }

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setChecking(true);
    setAccessError("");
    try {
      await refreshHistory(token);
      setAuthorized(true);
    } catch (error) {
      setAccessError(error instanceof Error ? error.message : "Could not verify owner access.");
    } finally {
      setChecking(false);
    }
  }

  async function importFile(item: UploadKind) {
    const state = states[item.kind];
    if (!state.file) {
      updateState(item.kind, { message: "Choose a file first.", errors: [] });
      return;
    }

    updateState(item.kind, { busy: true, message: "", errors: [] });
    try {
      const form = new FormData();
      form.set("file", state.file);
      const response = await fetch(item.endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const body = await response.json();
      if (!response.ok) {
        updateState(item.kind, { message: body.error ?? "Import was rejected; saved data was not changed.", errors: body.issues ?? [] });
        return;
      }

      const result = body.import as ImportSummary;
      updateState(item.kind, {
        message: result.duplicate ? "This file was already imported; no duplicate records were added." : `Imported ${result.recordCount} record${result.recordCount === 1 ? "" : "s"}.`,
        errors: [],
      });
      await refreshHistory();
    } catch {
      updateState(item.kind, { message: "The import could not be completed. Check the app and database, then try again.", errors: [] });
    } finally {
      updateState(item.kind, { busy: false });
    }
  }

  function signOut() {
    setAuthorized(false);
    setToken("");
    setHistory([]);
  }

  const latestByKind = new Map<ImportKind, ImportSummary>();
  for (const item of history) if (!latestByKind.has(item.kind)) latestByKind.set(item.kind, item);

  if (!authorized) {
    return (
      <section className="welcome-card access-card" aria-labelledby="access-title">
        <p className="eyebrow accent">Private imports</p>
        <h2 id="access-title">Sign in with your owner import key.</h2>
        <p className="intro-copy">The key is stored in your local <code>.env.local</code> file as <code>IMPORT_ADMIN_TOKEN</code>. It stays in this browser’s memory only until you refresh or sign out.</p>
        <form className="access-form" onSubmit={signIn}>
          <label htmlFor="owner-key">Owner import key</label>
          <input id="owner-key" type="password" autoComplete="current-password" value={token} onChange={(event) => setToken(event.target.value)} required />
          <button className="primary-button" type="submit" disabled={checking}>{checking ? "Checking…" : "Continue"}</button>
        </form>
        {accessError && <p className="form-message error-message" role="alert">{accessError}</p>}
      </section>
    );
  }

  return (
    <>
      <section className="welcome-card import-intro">
        <div className="import-intro-heading">
          <div>
            <p className="eyebrow accent">Source data</p>
            <h2>Upload records for the planning workspace.</h2>
          </div>
          <button type="button" className="quiet-button" onClick={signOut}>Sign out</button>
        </div>
        <p className="intro-copy">Files are checked by the backend before saving. A rejected file leaves the last accepted import intact. Re-uploading the same export won’t add duplicate records.</p>
        <p className="upload-order-note"><strong>Recommended order:</strong> stock count, staff master, leave, part-time availability, then weekly CRM orders. HR records must match IDs in the staff master.</p>
      </section>

      <section className="upload-grid" aria-label="Import files">
        {uploads.map((item) => {
          const state = states[item.kind];
          const latest = latestByKind.get(item.kind);
          return (
            <article className="upload-card" key={item.kind}>
              <div className="upload-card-heading">
                <span className="upload-file-icon" aria-hidden="true">{item.kind === "CRM" ? "CSV" : "JSON"}</span>
                <div><h3>{item.title}</h3><p>{item.description}</p></div>
              </div>
              <label className="file-picker">
                <span>{state.file ? state.file.name : `Choose ${item.kind === "CRM" ? "CSV" : "JSON"} file`}</span>
                <input type="file" accept={item.accept} onChange={(event) => updateState(item.kind, { file: event.target.files?.[0] ?? null, message: "", errors: [] })} />
              </label>
              <button className="primary-button upload-button" type="button" disabled={state.busy || !state.file} onClick={() => importFile(item)}>
                {state.busy ? "Validating…" : "Validate and import"}
              </button>
              {state.message && <p className={`form-message ${state.errors.length ? "error-message" : "success-message"}`} role="status">{state.message}</p>}
              {state.errors.length > 0 && <ul className="validation-list">{state.errors.map((error, index) => <li key={`${error.field}-${index}`}>{error.row ? `Row ${error.row} · ` : ""}<strong>{error.field}:</strong> {error.message}</li>)}</ul>}
              <div className="import-status">
                <strong>{latest ? "Last accepted import" : "Waiting for file"}</strong>
                {latest ? <>
                  <span>{latest.sourceFilename} · {latest.recordCount} records</span>
                  {latest.exportId && <span>Export ID: {latest.exportId}</span>}
                  {latest.sourceSystem && <span>Source: {latest.sourceSystem}</span>}
                  {latest.exportStatus && <span>Export status: {latest.exportStatus}</span>}
                  {latest.effectiveMonth && <span>Effective month: {latest.effectiveMonth}</span>}
                  {item.kind === "STOCK" && <span>Count checked: {formatDate(latest.checkedAt)}</span>}
                  {latest.exportedAt && <span>Exported: {formatDate(latest.exportedAt)}</span>}
                  <span>Imported: {formatDate(latest.importedAt)}</span>
                </> : <span>No accepted import saved.</span>}
              </div>
            </article>
          );
        })}
      </section>
    </>
  );
}
