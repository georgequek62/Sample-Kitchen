const importKinds = ["CRM", "STOCK", "HR_STAFF", "HR_LEAVE", "HR_AVAILABILITY"] as const;

type Version = {
  sourceFilename: string;
  exportId: string | null;
  sourceSystem: string | null;
  importedAt: string;
  recordCount: number;
};

function readVersion(value: unknown): Version | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (typeof item.sourceFilename !== "string" || typeof item.importedAt !== "string" || typeof item.recordCount !== "number") return null;
  return {
    sourceFilename: item.sourceFilename,
    exportId: typeof item.exportId === "string" ? item.exportId : null,
    sourceSystem: typeof item.sourceSystem === "string" ? item.sourceSystem : null,
    importedAt: item.importedAt,
    recordCount: item.recordCount,
  };
}

export function sameImportVersions(left: unknown, right: unknown): boolean {
  if (!left || !right || typeof left !== "object" || typeof right !== "object" || Array.isArray(left) || Array.isArray(right)) return false;
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  return importKinds.every((kind) => {
    const first = readVersion(a[kind]);
    const second = readVersion(b[kind]);
    return first !== null && second !== null
      && first.sourceFilename === second.sourceFilename
      && first.exportId === second.exportId
      && first.sourceSystem === second.sourceSystem
      && first.importedAt === second.importedAt
      && first.recordCount === second.recordCount;
  });
}
