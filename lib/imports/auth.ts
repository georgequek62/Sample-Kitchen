import { timingSafeEqual } from "node:crypto";

export function authorizeImportRequest(request: Request): Response | null {
  const expected = process.env.IMPORT_ADMIN_TOKEN;
  if (!expected) {
    return Response.json({ error: "Owner import access is not configured on the server." }, { status: 503 });
  }

  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  const supplied = match?.[1] ?? "";
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  const valid = suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes);

  if (!valid) return Response.json({ error: "Enter the owner import key from your local .env.local file." }, { status: 401 });
  return null;
}
