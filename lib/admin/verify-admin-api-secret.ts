import type { NextRequest } from "next/server";

const HEADER = "x-admin-api-secret";

export function readAdminApiSecret(req: NextRequest): string | null {
  return req.headers.get(HEADER) ?? req.headers.get(HEADER.toUpperCase());
}

export function isAdminApiAuthorized(req: NextRequest): boolean {
  const expected = process.env.ADMIN_API_SECRET;
  if (!expected || expected.length === 0) return false;
  const got = readAdminApiSecret(req);
  return got === expected;
}
