import { prisma } from "@/lib/prisma";
import { authorizeImportRequest } from "@/lib/imports/auth";
import { loadPlan } from "@/lib/planning/load-plan";
import { runPlanningAgents, type SupplierDetails } from "@/lib/agents/planning-agents";
import { saveAgentRun } from "@/lib/agents/persistence";

export const runtime = "nodejs";
export const maxDuration = 180;

function parseSupplier(value: unknown): SupplierDetails | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const supplier = value as Record<string, unknown>;
  if (typeof supplier.display_name !== "string" || typeof supplier.default_draft_to !== "string") return null;
  return { displayName: supplier.display_name, defaultDraftTo: supplier.default_draft_to };
}

export async function POST(request: Request) {
  const denied = authorizeImportRequest(request);
  if (denied) return denied;

  let numericPlan: Awaited<ReturnType<typeof loadPlan>>;
  try {
    numericPlan = await loadPlan();
  } catch {
    return Response.json({ error: "The saved plan could not be loaded. No planning agents were called." }, { status: 503 });
  }

  if (!numericPlan.ready) {
    return Response.json({
      error: "Import the missing planning data before running the agents. No OpenAI request was made.",
      missingImports: numericPlan.missingImports,
      missingInventoryIngredients: numericPlan.missingInventoryIngredients,
      plan: numericPlan,
    }, { status: 409 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "OPENAI_API_KEY is not configured on the server. The numeric plan is still available.", plan: numericPlan }, { status: 503 });
  }

  try {
    const supplierSetting = await prisma.referenceSetting.findUnique({ where: { key: "supplier" } });
    const supplier = supplierSetting ? parseSupplier(supplierSetting.value) : null;
    if (!supplier) {
      return Response.json({ error: "Supplier reference details are unavailable. The numeric plan is still available.", plan: numericPlan }, { status: 503 });
    }

    const agentRun = await runPlanningAgents({ plan: numericPlan, supplier, apiKey });
    const currentPlan = await loadPlan();
    if (JSON.stringify(currentPlan.sourceVersions) !== JSON.stringify(numericPlan.sourceVersions)) {
      return Response.json({
        error: "Planning imports changed while the agents were running. Their recommendations were not saved; use the refreshed numeric plan and run again.",
        plan: currentPlan,
      }, { status: 409 });
    }

    const saved = await saveAgentRun(numericPlan, agentRun);
    return Response.json({
      run: {
        id: saved.id,
        model: saved.model,
        createdAt: saved.createdAt.toISOString(),
        importVersions: saved.importVersions,
        recommendations: saved.recommendations,
        handoffTrace: saved.handoffTrace,
      },
      plan: numericPlan,
    }, { status: 201 });
  } catch {
    return Response.json({
      error: "Planning agents could not complete. The numeric plan remains available, and no partial recommendations were saved.",
      plan: numericPlan,
    }, { status: 502 });
  }
}
