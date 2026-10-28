import type { Metadata } from "next";
import Link from "next/link";
import AgentsPanel from "./panel";

export const metadata: Metadata = { title: "Planning agents · Kitchen Planner" };

export default function AgentsPage() {
  return (
    <main className="page-shell imports-shell">
      <header className="topbar">
        <Link className="back-link" href="/" aria-label="Back to Kitchen Planner">←</Link>
        <div className="brand-mark" aria-hidden="true">K</div>
        <div>
          <p className="eyebrow">Sample Central Kitchen</p>
          <h1>Planning agents</h1>
        </div>
        <span className="status-pill"><span className="status-dot" /> Owner action</span>
      </header>

      <AgentsPanel />
    </main>
  );
}
