import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok", service: "kitchen-planner", database: "connected" });
  } catch {
    return Response.json(
      { status: "error", service: "kitchen-planner", database: "unavailable" },
      { status: 503 },
    );
  }
}
