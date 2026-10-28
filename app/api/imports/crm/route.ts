import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { authorizeImportRequest } from "@/lib/imports/auth";
import {
  batchSummary,
  dateValue,
  findDuplicateImport,
  hashFile,
  ImportError,
  importErrorResponse,
  parseCsv,
  positiveInteger,
  readUploadedFile,
  textValue,
  throwIssues,
  timestampValue,
  type ValidationIssue,
} from "@/lib/imports/shared";

const expectedHeaders = [
  "export_id",
  "exported_at",
  "export_status",
  "id",
  "production_date",
  "customer",
  "product_id",
  "quantity",
  "status",
  "received_at",
];

export async function POST(request: Request) {
  const denied = authorizeImportRequest(request);
  if (denied) return denied;

  try {
    const upload = await readUploadedFile(request, ".csv");
    const csvRows = parseCsv(upload.text);
    const headers = csvRows[0].map((header) => header.trim());
    const issues: ValidationIssue[] = [];
    const headerSet = new Set(headers);
    for (const expected of expectedHeaders) {
      if (!headerSet.has(expected)) issues.push({ field: "header", message: `Missing required column: ${expected}.` });
    }
    for (const header of headers) {
      if (!expectedHeaders.includes(header)) issues.push({ field: "header", message: `Unexpected column: ${header || "(blank)"}.` });
    }
    if (headerSet.size !== headers.length) issues.push({ field: "header", message: "Column names must not be duplicated." });
    throwIssues(issues);

    const columnIndex = new Map(headers.map((header, index) => [header, index]));
    const get = (cells: string[], column: string) => cells[columnIndex.get(column) ?? -1] ?? "";
    const firstDataRow = csvRows[1];
    const exportId = get(firstDataRow, "export_id").trim();
    const exportedAtRaw = get(firstDataRow, "exported_at").trim();
    const exportStatus = get(firstDataRow, "export_status").trim();
    const exportedAt = timestampValue(exportedAtRaw, "exported_at", issues, 2);
    if (!exportId) issues.push({ row: 2, field: "export_id", message: "Enter an export ID." });
    if (!exportStatus) issues.push({ row: 2, field: "export_status", message: "Enter an export status." });

    const orders = csvRows.slice(1).map((cells, index) => {
      const rowNumber = index + 2;
      if (cells.length !== headers.length) {
        issues.push({ row: rowNumber, field: "row", message: `Expected ${headers.length} columns, received ${cells.length}.` });
      }
      const rowExportId = get(cells, "export_id").trim();
      const rowExportedAt = get(cells, "exported_at").trim();
      const rowExportStatus = get(cells, "export_status").trim();
      if (rowExportId !== exportId) issues.push({ row: rowNumber, field: "export_id", message: "All rows must have the same export ID." });
      if (rowExportedAt !== exportedAtRaw) issues.push({ row: rowNumber, field: "exported_at", message: "All rows must have the same export time." });
      if (rowExportStatus !== exportStatus) issues.push({ row: rowNumber, field: "export_status", message: "All rows must have the same export status." });
      const receivedAt = timestampValue(get(cells, "received_at").trim(), "received_at", issues, rowNumber);
      const productId = textValue(get(cells, "product_id"), "product_id", issues, rowNumber);
      return {
        orderId: textValue(get(cells, "id"), "id", issues, rowNumber),
        productionDate: dateValue(get(cells, "production_date").trim(), "production_date", issues, rowNumber),
        customer: textValue(get(cells, "customer"), "customer", issues, rowNumber),
        productId,
        quantity: positiveInteger(Number(get(cells, "quantity")), "quantity", issues, rowNumber),
        status: textValue(get(cells, "status"), "status", issues, rowNumber),
        receivedAt,
      };
    });

    const orderIds = new Set<string>();
    orders.forEach((order, index) => {
      if (orderIds.has(order.orderId)) issues.push({ row: index + 2, field: "id", message: "Duplicate order ID in this export." });
      orderIds.add(order.orderId);
    });
    const products = await prisma.product.findMany({ select: { id: true } });
    const knownProducts = new Set(products.map((product) => product.id));
    orders.forEach((order, index) => {
      if (!knownProducts.has(order.productId)) issues.push({ row: index + 2, field: "product_id", message: `Unknown product ID: ${order.productId}.` });
    });
    throwIssues(issues);

    const contentSha256 = hashFile(upload.bytes);
    const duplicate = await findDuplicateImport({
      kind: "CRM",
      exportId,
      contentSha256,
      findByExport: (kind, id) => prisma.importBatch.findUnique({ where: { kind_exportId: { kind, exportId: id } } }),
      findByHash: (kind, hash) => prisma.importBatch.findUnique({ where: { kind_contentSha256: { kind, contentSha256: hash } } }),
    });
    if (duplicate) return Response.json({ import: batchSummary(duplicate, true) });

    const batch = await prisma.$transaction(async (tx) => {
      const createdBatch = await tx.importBatch.create({
        data: {
          kind: "CRM",
          sourceFilename: upload.filename,
          exportId,
          sourceSystem: "CRM weekly sales export",
          exportStatus,
          exportedAt,
          recordCount: orders.length,
          contentSha256,
        },
      });
      await tx.salesOrder.createMany({
        data: orders.map((order) => ({ id: randomUUID(), batchId: createdBatch.id, ...order })),
      });
      return createdBatch;
    });
    return Response.json({ import: batchSummary(batch) }, { status: 201 });
  } catch (error) {
    return importErrorResponse(error);
  }
}
