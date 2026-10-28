import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { AwaitedPlan } from "@/lib/planning/load-plan";
import type { AgentRunResult } from "@/lib/agents/planning-agents";

export async function saveAgentRun(plan: AwaitedPlan, result: AgentRunResult) {
  return prisma.agentRun.create({
    data: {
      model: result.model,
      importVersions: JSON.parse(JSON.stringify(plan.sourceVersions)) as Prisma.InputJsonValue,
      recommendations: JSON.parse(JSON.stringify(result.recommendations)) as Prisma.InputJsonValue,
      handoffTrace: JSON.parse(JSON.stringify(result.handoffTrace)) as Prisma.InputJsonValue,
    },
  });
}
