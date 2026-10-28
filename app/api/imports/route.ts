import { prisma } from "@/lib/prisma";
import { authorizeImportRequest } from "@/lib/imports/auth";
import { batchSummary } from "@/lib/imports/shared";

export async function GET(request: Request) {
  const denied = authorizeImportRequest(request);
  if (denied) return denied;

  try {
    const batches = await prisma.importBatch.findMany({
      orderBy: { importedAt: "desc" },
      take: 50,
    });
    return Response.json({ imports: batches.map((batch) => batchSummary(batch)) });
  } catch {
    return Response.json({ error: "Import history is temporarily unavailable." }, { status: 503 });
  }
}
