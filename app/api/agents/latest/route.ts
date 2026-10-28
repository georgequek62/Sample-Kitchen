import { prisma } from "@/lib/prisma";
import { authorizeImportRequest } from "@/lib/imports/auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const denied = authorizeImportRequest(request);
  if (denied) return denied;

  try {
    const latest = await prisma.agentRun.findFirst({ orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    if (!latest) return Response.json({ run: null });
    return Response.json({
      run: {
        id: latest.id,
        model: latest.model,
        createdAt: latest.createdAt.toISOString(),
        importVersions: latest.importVersions,
        recommendations: latest.recommendations,
        handoffTrace: latest.handoffTrace,
      },
    });
  } catch {
    return Response.json({ error: "Saved planning recommendations are temporarily unavailable." }, { status: 503 });
  }
}
