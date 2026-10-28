import { prisma } from "@/lib/prisma";
import { authorizeImportRequest } from "@/lib/imports/auth";
import { loadPlan } from "@/lib/planning/load-plan";
import { sameImportVersions } from "@/lib/planning/versions";
import { createGmailDraft } from "@/lib/draft/zapier";

export const runtime = "nodejs";
export const maxDuration = 90;

export async function GET(request: Request) {
  const denied = authorizeImportRequest(request);
  if (denied) return denied;
  return Response.json({ configured: Boolean(process.env.ZAPIER_MCP_TOKEN?.trim()) });
}

function validEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 && /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(value);
}

export async function POST(request: Request) {
  const denied = authorizeImportRequest(request);
  if (denied) return denied;

  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Review the draft details before creating it." }, { status: 400 });
  const input = body as Record<string, unknown>;
  if (input.reviewed !== true || typeof input.runId !== "string" || !validEmail(input.to)
    || typeof input.subject !== "string" || input.subject.trim().length < 1 || input.subject.length > 200
    || typeof input.body !== "string" || input.body.trim().length < 1 || input.body.length > 20_000) {
    return Response.json({ error: "Review the recipient, subject and body, then confirm the draft action." }, { status: 400 });
  }

  const token = process.env.ZAPIER_MCP_TOKEN?.trim();
  if (!token) return Response.json({ error: "Zapier MCP is not connected. Add its server-side token and configure Gmail Create Draft first." }, { status: 503 });

  try {
    const [plan, latest] = await Promise.all([
      loadPlan(),
      prisma.agentRun.findFirst({ orderBy: [{ createdAt: "desc" }, { id: "desc" }] }),
    ]);
    if (!plan.ready || !latest || latest.id !== input.runId || !sameImportVersions(latest.importVersions, plan.sourceVersions)) {
      return Response.json({ error: "The saved agent recommendations no longer match the latest imports. Run planning agents again before drafting." }, { status: 409 });
    }
    const result = await createGmailDraft({ to: input.to, subject: input.subject.trim(), body: input.body }, token);
    return Response.json({ created: true, draftId: result.draftId, message: "Zapier reported a Gmail draft was created. Check Gmail Drafts before making another one." }, { status: 201 });
  } catch {
    return Response.json({ error: "The draft action could not be confirmed. Check Gmail Drafts and Zapier History before retrying." }, { status: 502 });
  }
}
