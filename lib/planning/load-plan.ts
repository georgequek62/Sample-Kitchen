import { prisma } from "@/lib/prisma";
import { calculatePlan } from "@/lib/planning/calculations";
import type { ImportKind } from "@/generated/prisma/client";

const requiredKinds: ImportKind[] = ["CRM", "STOCK", "HR_STAFF", "HR_LEAVE", "HR_AVAILABILITY"];

export async function loadPlan() {
  const [scenarioSetting, products, recipes, ingredients, ...latestBatches] = await Promise.all([
    prisma.referenceSetting.findUnique({ where: { key: "scenario" } }),
    prisma.product.findMany({ orderBy: { id: "asc" } }),
    prisma.recipe.findMany({ orderBy: [{ productId: "asc" }, { ingredientId: "asc" }] }),
    prisma.ingredient.findMany({ orderBy: { id: "asc" }, select: { id: true, name: true, unit: true } }),
    ...requiredKinds.map((kind) => prisma.importBatch.findFirst({
      where: { kind },
      orderBy: [{ importedAt: "desc" }, { id: "desc" }],
    })),
  ]);

  if (!scenarioSetting) throw new Error("The planning scenario has not been seeded.");
  const batchByKind = new Map(requiredKinds.map((kind, index) => [kind, latestBatches[index]]));
  const crmBatch = batchByKind.get("CRM");
  const stockBatch = batchByKind.get("STOCK");
  const staffBatch = batchByKind.get("HR_STAFF");
  const leaveBatch = batchByKind.get("HR_LEAVE");
  const availabilityBatch = batchByKind.get("HR_AVAILABILITY");

  const [orders, inventory, staff, leave, availability] = await Promise.all([
    crmBatch ? prisma.salesOrder.findMany({ where: { batchId: crmBatch.id }, orderBy: [{ productionDate: "asc" }, { orderId: "asc" }] }) : Promise.resolve([]),
    stockBatch ? prisma.inventoryRecord.findMany({ where: { batchId: stockBatch.id }, orderBy: { ingredientId: "asc" } }) : Promise.resolve([]),
    staffBatch ? prisma.staffImportRecord.findMany({ where: { batchId: staffBatch.id }, orderBy: [{ name: "asc" }, { staffId: "asc" }] }) : Promise.resolve([]),
    leaveBatch ? prisma.leaveRecord.findMany({ where: { batchId: leaveBatch.id }, orderBy: [{ date: "asc" }, { staffId: "asc" }] }) : Promise.resolve([]),
    availabilityBatch ? prisma.availabilityRecord.findMany({ where: { batchId: availabilityBatch.id }, orderBy: [{ date: "asc" }, { staffId: "asc" }] }) : Promise.resolve([]),
  ]);

  const result = calculatePlan({
    scenario: scenarioSetting.value as unknown as Parameters<typeof calculatePlan>[0]["scenario"],
    products: products.map((product) => ({ id: product.id, name: product.name, labourHoursPerUnit: product.labourHoursPerUnit })),
    recipes: recipes.map((recipe) => ({ productId: recipe.productId, ingredientId: recipe.ingredientId, quantityPerUnit: recipe.quantityPerUnit })),
    orders: orders.map((order) => ({
      orderId: order.orderId,
      productionDate: order.productionDate,
      customer: order.customer,
      productId: order.productId,
      quantity: order.quantity,
      status: order.status,
      receivedAt: order.receivedAt,
    })),
    ingredients,
    inventory: inventory.map((record) => ({
      ingredientId: record.ingredientId,
      onHand: record.onHand,
      committed: record.committed,
      packSize: record.packSize,
      packName: record.packName,
    })),
    staff: staffBatch ? staff.map((record) => ({
      id: record.staffId,
      name: record.name,
      employmentType: record.employmentType,
      role: record.role,
      skills: record.skills,
    })) : null,
    leave: leaveBatch ? leave.map((record) => ({ staffId: record.staffId, date: record.date, status: record.status, reason: record.reason })) : null,
    availability: availabilityBatch ? availability.map((record) => ({
      staffId: record.staffId,
      date: record.date,
      start: record.start,
      end: record.end,
      status: record.status,
    })) : null,
  });

  const sourceVersions = Object.fromEntries(requiredKinds.map((kind) => {
    const batch = batchByKind.get(kind);
    return [kind, batch ? {
      sourceFilename: batch.sourceFilename,
      exportId: batch.exportId,
      sourceSystem: batch.sourceSystem,
      importedAt: batch.importedAt.toISOString(),
      recordCount: batch.recordCount,
    } : null];
  }));
  const missingImports = requiredKinds.filter((kind) => !batchByKind.get(kind));
  const missingInventoryIngredients = stockBatch ? result.missingInventoryIngredients : [];
  const staffNames = new Map(staff.map((record) => [record.staffId, record.name]));
  const approvedLeave = leave
    .filter((record) => record.status.toLowerCase() === "approved")
    .map((record) => ({
      staffId: record.staffId,
      staffName: staffNames.get(record.staffId) ?? record.staffId,
      date: record.date.toISOString().slice(0, 10),
      reason: record.reason,
    }))
    .filter((record) => record.date >= result.planningWindow.start && record.date <= result.planningWindow.end)
    .sort((a, b) => a.date.localeCompare(b.date) || a.staffName.localeCompare(b.staffName));
  return {
    ...result,
    approvedLeave,
    ready: missingImports.length === 0 && missingInventoryIngredients.length === 0,
    missingImports,
    missingInventoryIngredients,
    sourceVersions,
  };
}

export type AwaitedPlan = Awaited<ReturnType<typeof loadPlan>>;
