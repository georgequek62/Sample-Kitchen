import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { authorizeImportRequest } from "@/lib/imports/auth";
import {
  batchSummary,
  findDuplicateImport,
  hashFile,
  ImportError,
  importErrorResponse,
  nonNegativeNumber,
  parseJson,
  positiveNumber,
  readUploadedFile,
  textValue,
  throwIssues,
  timestampValue,
  type ValidationIssue,
} from "@/lib/imports/shared";

type StockRow = {
  ingredientId: string;
  name: string;
  unit: string;
  onHand: number;
  committed: number;
  packSize: number;
  packName: string;
  checkedAt: Date;
};

export async function POST(request: Request) {
  const denied = authorizeImportRequest(request);
  if (denied) return denied;

  try {
    const upload = await readUploadedFile(request, ".json");
    const raw = parseJson(upload.text);
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new ImportError("Stock count must be a JSON array with at least one row.", 422, [
        { field: "file", message: "Expected an array of stock records." },
      ]);
    }

    const issues: ValidationIssue[] = [];
    const seen = new Set<string>();
    const rows: StockRow[] = raw.map((value: unknown, index: number) => {
      const rowNumber = index + 1;
      const row = typeof value === "object" && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
      const ingredientId = textValue(row.ingredient_id, "ingredient_id", issues, rowNumber);
      if (ingredientId && seen.has(ingredientId)) {
        issues.push({ row: rowNumber, field: "ingredient_id", message: "Duplicate ingredient in this stock count." });
      }
      seen.add(ingredientId);

      return {
        ingredientId,
        name: textValue(row.name, "name", issues, rowNumber),
        unit: textValue(row.unit, "unit", issues, rowNumber),
        onHand: nonNegativeNumber(row.on_hand, "on_hand", issues, rowNumber),
        committed: nonNegativeNumber(row.committed, "committed", issues, rowNumber),
        packSize: positiveNumber(row.pack_size, "pack_size", issues, rowNumber),
        packName: textValue(row.pack_name, "pack_name", issues, rowNumber),
        checkedAt: timestampValue(row.checked_at, "checked_at", issues, rowNumber),
      };
    });

    const ingredients = await prisma.ingredient.findMany({ select: { id: true } });
    const knownIngredients = new Set(ingredients.map((ingredient) => ingredient.id));
    rows.forEach((row, index) => {
      if (row.ingredientId && !knownIngredients.has(row.ingredientId)) {
        issues.push({ row: index + 1, field: "ingredient_id", message: `Unknown ingredient ID: ${row.ingredientId}.` });
      }
    });
    throwIssues(issues);

    const contentSha256 = hashFile(upload.bytes);
    const duplicate = await findDuplicateImport({
      kind: "STOCK",
      exportId: null,
      contentSha256,
      findByExport: async () => null,
      findByHash: (kind, hash) => prisma.importBatch.findUnique({ where: { kind_contentSha256: { kind, contentSha256: hash } } }),
    });
    if (duplicate) return Response.json({ import: batchSummary(duplicate, true) });

    const checkedAt = rows.reduce((latest, row) => row.checkedAt > latest ? row.checkedAt : latest, rows[0].checkedAt);
    const batch = await prisma.$transaction(async (tx) => {
      const createdBatch = await tx.importBatch.create({
        data: {
          kind: "STOCK",
          sourceFilename: upload.filename,
          sourceSystem: "Physical stock count",
          recordCount: rows.length,
          contentSha256,
          checkedAt,
        },
      });
      await tx.inventoryRecord.createMany({
        data: rows.map((row) => ({
          id: randomUUID(),
          batchId: createdBatch.id,
          ingredientId: row.ingredientId,
          onHand: row.onHand,
          committed: row.committed,
          packSize: row.packSize,
          packName: row.packName,
          checkedAt: row.checkedAt,
        })),
      });
      for (const row of rows) {
        await tx.ingredient.update({ where: { id: row.ingredientId }, data: { name: row.name, unit: row.unit } });
      }
      return createdBatch;
    });

    return Response.json({ import: batchSummary(batch) }, { status: 201 });
  } catch (error) {
    return importErrorResponse(error);
  }
}
