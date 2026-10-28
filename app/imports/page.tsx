import type { Metadata } from "next";
import Link from "next/link";
import ImportPanel from "./import-panel";

export const metadata: Metadata = { title: "Import data · Kitchen Planner" };

export default function ImportsPage() {
  return (
    <main className="page-shell imports-shell">
      <header className="topbar">
        <Link className="back-link" href="/" aria-label="Back to Kitchen Planner">←</Link>
        <div className="brand-mark" aria-hidden="true">K</div>
        <div>
          <p className="eyebrow">Sample Central Kitchen</p>
          <h1>Import data</h1>
        </div>
        <span className="status-pill"><span className="status-dot" /> Owner access</span>
      </header>

      <ImportPanel />
      <p className="agent-navigation"><Link href="/agents">Run planning agents</Link> after the required imports have been accepted.</p>
    </main>
  );
}
