import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { authorizeImportRequest } from "@/lib/imports/auth";
import {
  batchSummary,
  envelopeMetadata,
  findDuplicateImport,
  hashFile,
  ImportError,
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
    const ids = new Set<string>();
    const staff = metadata.records.map((value, index) => {
      const rowNumber = index + 1;
      const row = typeof value === "object" && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
      const id = textValue(row.id, "id", issues, rowNumber);
      if (ids.has(id)) issues.push({ row: rowNumber, field: "id", message: "Duplicate staff ID in this export." });
      ids.add(id);

      let employmentType: "PERMANENT" | "PART_TIME" = "PERMANENT";
      if (row.employment_type === "Permanent") employmentType = "PERMANENT";
      else if (row.employment_type === "Part-time") employmentType = "PART_TIME";
      else issues.push({ row: rowNumber, field: "employment_type", message: "Use Permanent or Part-time." });

      const skills = Array.isArray(row.skills) ? row.skills : [];
      if (!Array.isArray(row.skills) || skills.length === 0 || skills.some((skill) => typeof skill !== "string" || !skill.trim())) {
        issues.push({ row: rowNumber, field: "skills", message: "Enter one or more non-empty skills." });
      }
      return {
        id,
        name: textValue(row.name, "name", issues, rowNumber),
        employmentType,
        role: textValue(row.role, "role", issues, rowNumber),
        skills: skills.filter((skill): skill is string => typeof skill === "string").map((skill) => skill.trim()),
      };
    });
    throwIssues(issues);

    const contentSha256 = hashFile(upload.bytes);
    const duplicate = await findDuplicateImport({
      kind: "HR_STAFF",
      exportId: metadata.exportId,
      contentSha256,
      findByExport: (kind, exportId) => prisma.importBatch.findUnique({ where: { kind_exportId: { kind, exportId } } }),
      findByHash: (kind, hash) => prisma.importBatch.findUnique({ where: { kind_contentSha256: { kind, contentSha256: hash } } }),
    });
    if (duplicate) return Response.json({ import: batchSummary(duplicate, true) });

    const batch = await prisma.$transaction(async (tx) => {
      const createdBatch = await tx.importBatch.create({
        data: {
          kind: "HR_STAFF",
          sourceFilename: upload.filename,
          exportId: metadata.exportId,
          sourceSystem: metadata.sourceSystem,
          effectiveMonth: metadata.effectiveMonth,
          exportedAt: metadata.exportedAt,
          recordCount: staff.length,
          contentSha256,
        },
      });
      await tx.staffImportRecord.createMany({
        data: staff.map(({ id: staffId, ...row }) => ({
          id: randomUUID(),
          batchId: createdBatch.id,
          staffId,
          ...row,
        })),
      });
      for (const row of staff) {
        await tx.staffMember.upsert({
          where: { id: row.id },
          create: row,
          update: { name: row.name, employmentType: row.employmentType, role: row.role, skills: row.skills },
        });
      }
      return createdBatch;
    });
    return Response.json({ import: batchSummary(batch) }, { status: 201 });
  } catch (error) {
    return importErrorResponse(error);
  }
}
