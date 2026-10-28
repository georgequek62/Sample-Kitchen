import assert from "node:assert/strict";
import dotenv from "dotenv";
import { runPlanningAgents } from "../lib/agents/planning-agents";
import type { AwaitedPlan } from "../lib/planning/load-plan";

dotenv.config({ path: ".env.local", quiet: true });

const plan = {
  ready: true,
  missingImports: [],
  missingInventoryIngredients: [],
  sourceVersions: {
    CRM: { sourceFilename: "synthetic-crm.csv", exportId: "SYNTH-CRM", sourceSystem: "Synthetic", importedAt: "2026-10-28T04:00:00.000Z", recordCount: 2 },
    STOCK: { sourceFilename: "synthetic-stock.json", exportId: null, sourceSystem: "Synthetic", importedAt: "2026-10-28T04:01:00.000Z", recordCount: 1 },
    HR_STAFF: { sourceFilename: "synthetic-staff.json", exportId: "SYNTH-HR", sourceSystem: "Synthetic", importedAt: "2026-10-28T04:02:00.000Z", recordCount: 1 },
    HR_LEAVE: { sourceFilename: "synthetic-leave.json", exportId: "SYNTH-LEAVE", sourceSystem: "Synthetic", importedAt: "2026-10-28T04:03:00.000Z", recordCount: 1 },
    HR_AVAILABILITY: { sourceFilename: "synthetic-availability.json", exportId: "SYNTH-AVAIL", sourceSystem: "Synthetic", importedAt: "2026-10-28T04:04:00.000Z", recordCount: 1 },
  },
  planningWindow: { timezone: "Asia/Singapore", cutoff: "2026-10-28T04:00:00.000Z", start: "2026-11-02", end: "2026-11-06" },
  eligibleOrders: [{ orderId: "ORD-OK", productionDate: "2026-11-02", customer: "Synthetic Cafe", productId: "CHEESE", quantity: 10, status: "Confirmed", receivedAt: "2026-10-28T03:00:00.000Z" }],
  excludedOrders: [{ orderId: "ORD-LATE-7", productionDate: "2026-11-02", customer: "Synthetic Cafe", productId: "CHEESE", quantity: 2, status: "Confirmed", receivedAt: "2026-10-28T04:01:00.000Z", reasons: ["Order was received after the cutoff."] }],
  dailyProduction: [{
    date: "2026-11-02",
    products: [{ productId: "CHEESE", productName: "Cheese sandwich", quantity: 10 }],
    totalSandwiches: 10,
    labourHours: 0.2,
  }],
  roster: [{
    date: "2026-11-02",
    requiredLabourHours: 0.2,
    assignedProductiveHours: 0,
    uncoveredHours: 2,
    additionalPartTimeShiftsToRequest: 1,
    supervisorQualifiedWorkerAvailable: false,
    supervisorAssigned: null,
    assignments: [],
  }],
  pendingLeaveAlerts: [{ staffId: "STAFF-1", staffName: "Synthetic Staff", date: "2026-11-02", reason: null }],
  ingredientDemand: [{
    ingredientId: "CHEESE",
    name: "Sliced cheese",
    unit: "g",
    requiredQuantity: 300,
    onHand: 100,
    committed: 0,
    usableStock: 100,
    shortage: 200,
    packSize: 100,
    packName: "small pack",
    packsToOrder: 2,
    quantityToOrder: 200,
  }],
} as unknown as AwaitedPlan;

const modelOutputs = {
  sales_production_recommendation: {
    summary: "One late order needs manager review before production changes.",
    lateOrderExplanations: [{ orderId: "ORD-LATE-7", reason: "This order arrived after the cutoff.", managerAction: "Ask the manager whether to accept it." }],
    productionActions: [{ date: "2026-11-02", action: "Prepare the planned production for this date." }],
  },
  manpower_recommendation: {
    summary: "The available roster leaves a staffing gap for manager review.",
    staffingGaps: [{ date: "2026-11-02", uncoveredHours: 2, additionalPartTimeShiftsToRequest: 1, requestForManagerReview: "Ask the manager to request part-time cover." }],
    pendingLeaveNotes: [{ staffId: "STAFF-1", date: "2026-11-02", note: "Keep this pending request visible for the manager." }],
  },
  purchasing_recommendation: {
    summary: "Saved stock does not cover all planned ingredient demand.",
    shortageLines: [{ ingredientId: "CHEESE", packsToOrder: 2, quantityToOrder: 200, unit: "g", explanation: "Whole packs cover the saved stock shortage." }],
    draftIntro: "Please review the draft request below.",
    draftClosing: "Thank you for reviewing this request.",
  },
};

function fakeFetch(outputs: Record<string, unknown>, captured: Array<Record<string, unknown>>) {
  return async (url: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(url), "https://api.openai.com/v1/responses");
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer synthetic-test-key");
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    assert.equal(body.model, "gpt-6-luna");
    assert.equal(body.store, false);
    const format = (body.text as { format: { name: string; strict: boolean; schema: Record<string, unknown> } }).format;
    assert.equal(format.strict, true);
    assert.equal(format.schema.additionalProperties, false);
    captured.push(body);
    const output = outputs[format.name];
    if (!output) throw new Error(`No mock output for ${format.name}.`);
    return Response.json({
      id: `response-${format.name}`,
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(output) }] }],
    });
  };
}

async function main() {
  const captured: Array<Record<string, unknown>> = [];
  const run = await runPlanningAgents({
    plan,
    supplier: { displayName: "Synthetic supplier", defaultDraftTo: "draft@example.invalid" },
    apiKey: "synthetic-test-key",
    fetchImpl: fakeFetch(modelOutputs, captured),
  });
  assert.equal(captured.length, 3);
  assert.deepEqual(run.handoffTrace.map((item) => item.agent), ["sales-production", "manpower", "purchasing"]);
  assert.equal(run.handoffTrace[1].receivedFrom.includes("sales-production"), true);
  assert.equal(run.handoffTrace[2].receivedFrom.includes("sales-production"), true);
  const manpowerInput = JSON.parse(String((captured[1].input as Array<{ content: string }>)[1].content)) as { salesRecommendation: unknown };
  const purchasingInput = JSON.parse(String((captured[2].input as Array<{ content: string }>)[1].content)) as { salesRecommendation: unknown };
  assert.deepEqual(manpowerInput.salesRecommendation, run.recommendations.sales);
  assert.deepEqual(purchasingInput.salesRecommendation, run.recommendations.sales);
  assert.equal(run.recommendations.purchasing.supplierDraft.to, "draft@example.invalid");
  assert.match(run.recommendations.purchasing.supplierDraft.body, /2 x small pack \(200 g\)/);

  const incorrectOutput = structuredClone(modelOutputs);
  incorrectOutput.purchasing_recommendation.shortageLines[0].packsToOrder = 99;
  await assert.rejects(runPlanningAgents({
    plan,
    supplier: { displayName: "Synthetic supplier", defaultDraftTo: "draft@example.invalid" },
    apiKey: "synthetic-test-key",
    fetchImpl: fakeFetch(incorrectOutput, []),
  }), /changed or omitted deterministic pack requests/);

  const { prisma } = await import("../lib/prisma");
  const { saveAgentRun } = await import("../lib/agents/persistence");
  let savedId: string | null = null;
  try {
    const saved = await saveAgentRun(plan, run);
    savedId = saved.id;
    const reloaded = await prisma.agentRun.findUnique({ where: { id: saved.id } });
    assert.ok(reloaded);
    assert.equal(reloaded.model, "gpt-6-luna");
    assert.deepEqual(reloaded.importVersions, plan.sourceVersions);
    assert.deepEqual(reloaded.recommendations, run.recommendations);
    assert.deepEqual(reloaded.handoffTrace, run.handoffTrace);
  } finally {
    if (savedId) await prisma.agentRun.deleteMany({ where: { id: savedId } });
    await prisma.$disconnect();
  }

  process.stdout.write("Agent check passed: three mocked Responses calls, structured handoffs, numeric validation, supplier draft composition, and Postgres save/reload/version read-back.\n");
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Agent check failed."}\n`);
  process.exitCode = 1;
});
