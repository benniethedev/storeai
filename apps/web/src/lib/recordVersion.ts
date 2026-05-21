import "server-only";
import type { NextRequest } from "next/server";
import { AppError } from "@storeai/shared/errors";

export class VersionConflictError extends AppError {
  constructor() {
    super(409, "version_conflict", "Record version does not match");
  }
}

export function expectedRecordVersion(req: NextRequest): number | null {
  const raw = req.headers.get("x-storeai-record-version") ?? req.headers.get("if-match");
  if (!raw) return null;
  const normalized = raw.trim().replace(/^W\//, "").replace(/^"|"$/g, "");
  const version = Number(normalized);
  if (!Number.isInteger(version) || version < 1) {
    throw new AppError(400, "invalid_record_version", "Record version must be a positive integer");
  }
  return version;
}
