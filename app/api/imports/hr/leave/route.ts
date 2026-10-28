import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { authorizeImportRequest } from "@/lib/imports/auth";
import {
  batchSummary,
  dateValue,
  envelopeMetadata,
  findDuplicateImport,
  hashFile,
  importErrorResponse,
  parseJson,
  readUploadedFile,
  requireRecord,
  textValue,
  throwIssues,
  type ValidationIssue,
} from "@/lib/imports/shared";

export async function POST(request: Request) {
  const denied = authorizeImportRequest(request);
  if (denied) return denied;

  try {
    const upload = await readUploadedFile(request, ".json");
    const root = requireRecord(parseJson(upload.text), "file");
    const issues: ValidationIssue[] = [];
    const metadata = envelopeMetadata(root, issues);
    const records = metadata.records.map((value, index) => {
      const rowNumber = index + 1;
      const row = typeof value === "object" && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
      const id = textValue(row.id, "id", issues, rowNumber);
      const status = textValue(row.status, "status", issues, rowNumber);
      if (!(["Approved", "Pending", "Rejected"] as string[]).includes(status)) {
        issues.push({ row: rowNumber, field: "status", message: "Use Approved, Pending, or Rejected." });
      }
      if (row.reason !== undefined && row.reason !== null && typeof row.reason !== "string") {
        issues.push({ row: rowNumber, field: "reason", message: "Reason must be text." });
      }
      return {
        sourceRecordId: id,
        staffId: textValue(row.staff_id, "staff_id", issues, rowNumber),
        date: dateValue(row.date, "date", issues, rowNumber),
        status,
        reason: typeof row.reason === "string" ? row.reason.trim() || null : null,
      };
    });
    const ids = new Set<string>();
    records.forEach((record, index) => {
      if (ids.has(record.sourceRecordId)) issues.push({ row: index + 1, field: "id", message: "Duplicate leave record ID in this export." });
      ids.add(record.sourceRecordId);
    });
    const existingStaff = await prisma.staffMember.findMany({ where: { id: { in: records.map((record) => record.staffId) } }, select: { id: true } });
    const knownStaff = new Set(existingStaff.map((staff) => staff.id));
    records.forEach((record, index) => {
      if (!knownStaff.has(record.staffId)) issues.push({ row: index + 1, field: "staff_id", message: `Unknown staff ID: ${record.staffId}. Import the staff master first.` });
    });
    throwIssues(issues);

    const contentSha256 = hashFile(upload.bytes);
    const duplicate = await findDuplicateImport({
      kind: "HR_LEAVE",
      exportId: metadata.exportId,
      contentSha256,
      findByExport: (kind, exportId) => prisma.importBatch.findUnique({ where: { kind_exportId: { kind, exportId } } }),
      findByHash: (kind, hash) => prisma.importBatch.findUnique({ where: { kind_contentSha256: { kind, contentSha256: hash } } }),
    });
    if (duplicate) return Response.json({ import: batchSummary(duplicate, true) });

    const batch = await prisma.$transaction(async (tx) => {
      const createdBatch = await tx.importBatch.create({
        data: {
          kind: "HR_LEAVE",
          sourceFilename: upload.filename,
          exportId: metadata.exportId,
          sourceSystem: metadata.sourceSystem,
          effectiveMonth: metadata.effectiveMonth,
          exportedAt: metadata.exportedAt,
          recordCount: records.length,
          contentSha256,
        },
      });
      await tx.leaveRecord.createMany({
        data: records.map((record) => ({ id: randomUUID(), batchId: createdBatch.id, ...record })),
      });
      return createdBatch;
    });
    return Response.json({ import: batchSummary(batch) }, { status: 201 });
  } catch (error) {
    return importErrorResponse(error);
  }
}
