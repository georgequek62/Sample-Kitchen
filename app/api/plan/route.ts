import { authorizeImportRequest } from "@/lib/imports/auth";
import { loadPlan } from "@/lib/planning/load-plan";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const denied = authorizeImportRequest(request);
  if (denied) return denied;

  try {
    return Response.json(await loadPlan());
  } catch {
    return Response.json({ error: "The plan could not be calculated from the current saved data." }, { status: 503 });
  }
}
