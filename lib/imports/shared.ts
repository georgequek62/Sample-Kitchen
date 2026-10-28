import { createHash } from "node:crypto";
import type { ImportBatch, ImportKind } from "@/generated/prisma/client";

export type ValidationIssue = { row?: number; field: string; message: string };

export class ImportError extends Error {
  constructor(
    message: string,
    readonly status = 422,
    readonly issues?: ValidationIssue[],
  ) {
    super(message);
  }
}

export type UploadedFile = { filename: string; bytes: Buffer; text: string };

export async function readUploadedFile(request: Request, extension: ".json" | ".csv"): Promise<UploadedFile> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new ImportError("Choose a file to upload using the file picker.", 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) throw new ImportError("Choose a file to upload.", 400);
  if (file.size === 0) throw new ImportError("The selected file is empty.", 400);
  if (file.size > 2 * 1024 * 1024) throw new ImportError("Files must be smaller than 2 MB.", 413);
  if (!file.name.toLowerCase().endsWith(extension)) {
    throw new ImportError(`Choose a ${extension.toUpperCase()} file.`, 415);
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  return { filename: file.name, bytes, text: bytes.toString("utf8") };
}

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ImportError("The file is not valid JSON.", 400, [
      { field: "file", message: "Check that the file contains valid JSON." },
    ]);
  }
}

export function hashFile(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ImportError("The uploaded file has an unexpected structure.", 422, [
      { field, message: "Expected an object." },
    ]);
  }
  return value as Record<string, unknown>;
}

export function textValue(value: unknown, field: string, issues: ValidationIssue[], row?: number): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push({ ...(row === undefined ? {} : { row }), field, message: "Enter a non-empty value." });
    return "";
  }
  return value.trim();
}

export function nonNegativeNumber(value: unknown, field: string, issues: ValidationIssue[], row?: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    issues.push({ ...(row === undefined ? {} : { row }), field, message: "Enter a number greater than or equal to zero." });
    return 0;
  }
  return value;
}

export function positiveNumber(value: unknown, field: string, issues: ValidationIssue[], row?: number): number {
  const number = nonNegativeNumber(value, field, issues, row);
  if (typeof value === "number" && Number.isFinite(value) && value <= 0) {
    issues.push({ ...(row === undefined ? {} : { row }), field, message: "Enter a number greater than zero." });
  }
  return number;
}

export function positiveInteger(value: unknown, field: string, issues: ValidationIssue[], row?: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    issues.push({ ...(row === undefined ? {} : { row }), field, message: "Enter a positive whole number." });
    return 0;
  }
  return value;
}

export function timestampValue(value: unknown, field: string, issues: ValidationIssue[], row?: number): Date {
  const valueText = typeof value === "string" ? value.trim() : "";
  if (!valueText || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(valueText)) {
    issues.push({ ...(row === undefined ? {} : { row }), field, message: "Use a date and time with a timezone, for example 2026-10-28T11:55:00+08:00." });
    return new Date(0);
  }
  const result = new Date(valueText);
  if (Number.isNaN(result.getTime())) {
    issues.push({ ...(row === undefined ? {} : { row }), field, message: "Enter a valid date and time." });
    return new Date(0);
  }
  return result;
}

export function dateValue(value: unknown, field: string, issues: ValidationIssue[], row?: number): Date {
  const valueText = typeof value === "string" ? value.trim() : "";
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(valueText) ? new Date(`${valueText}T00:00:00.000Z`) : new Date(Number.NaN);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== valueText) {
    issues.push({ ...(row === undefined ? {} : { row }), field, message: "Use a valid date in YYYY-MM-DD format." });
    return new Date(0);
  }
  return parsed;
}

export function envelopeMetadata(record: Record<string, unknown>, issues: ValidationIssue[]) {
  const sourceSystem = textValue(record.source_system, "source_system", issues);
  const exportId = textValue(record.export_id, "export_id", issues);
  const effectiveMonth = textValue(record.effective_month, "effective_month", issues);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(effectiveMonth)) {
    issues.push({ field: "effective_month", message: "Use YYYY-MM format." });
  }
  const exportedAt = timestampValue(record.exported_at, "exported_at", issues);
  if (!Array.isArray(record.records) || record.records.length === 0) {
    issues.push({ field: "records", message: "Include at least one record." });
  }
  return {
    sourceSystem,
    exportId,
    effectiveMonth,
    exportedAt,
    records: Array.isArray(record.records) ? record.records : [],
  };
}

export function throwIssues(issues: ValidationIssue[]): void {
  if (issues.length) throw new ImportError("The file has validation errors. Fix them and upload it again.", 422, issues);
}

export async function findDuplicateImport(input: {
  kind: ImportKind;
  exportId: string | null;
  contentSha256: string;
  findByExport: (kind: ImportKind, exportId: string) => Promise<ImportBatch | null>;
  findByHash: (kind: ImportKind, contentSha256: string) => Promise<ImportBatch | null>;
}): Promise<ImportBatch | null> {
  if (input.exportId) {
    const sameExport = await input.findByExport(input.kind, input.exportId);
    if (sameExport) {
      if (sameExport.contentSha256 !== input.contentSha256) {
        throw new ImportError("This export ID already exists with different file contents. The saved import was kept.", 409);
      }
      return sameExport;
    }
  }

  const sameFile = await input.findByHash(input.kind, input.contentSha256);
  return sameFile;
}

export function batchSummary(batch: ImportBatch, duplicate = false) {
  return {
    kind: batch.kind,
    sourceFilename: batch.sourceFilename,
    exportId: batch.exportId,
    sourceSystem: batch.sourceSystem,
    exportStatus: batch.exportStatus,
    effectiveMonth: batch.effectiveMonth,
    exportedAt: batch.exportedAt?.toISOString() ?? null,
    checkedAt: batch.checkedAt?.toISOString() ?? null,
    importedAt: batch.importedAt.toISOString(),
    recordCount: batch.recordCount,
    duplicate,
  };
}

export function importErrorResponse(error: unknown): Response {
  if (error instanceof ImportError) {
    return Response.json({ error: error.message, issues: error.issues ?? [] }, { status: error.status });
  }
  return Response.json({ error: "The import could not be saved. Your previous accepted import remains available." }, { status: 500 });
}

export function parseCsv(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      if (field.length !== 0) throw new ImportError("The CSV has an invalid quote placement.", 400);
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (quoted) throw new ImportError("The CSV has an unclosed quoted field.", 400);
  if (field.length || row.length) {
    row.push(field);
    if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  }
  if (rows.length < 2) throw new ImportError("The CSV must include a header and at least one order.", 422);
  return rows;
}
