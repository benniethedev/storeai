import { NextResponse } from "next/server";
import { AppError } from "@storeai/shared/errors";
import { ZodError } from "zod";

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init);
}

export function error(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json({ ok: false, error: { code, message, details } }, { status });
}

export function handleError(err: unknown) {
  if (err instanceof AppError) return error(err.status, err.code, err.message, err.details);
  if (err instanceof ZodError) {
    return error(400, "validation_error", "Validation failed", err.issues);
  }
  console.error("[unhandled error]", err);
  return error(500, "internal_error", "Internal server error");
}
