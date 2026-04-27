import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { AppError } from "@storeai/shared/errors";
import { ZodError } from "zod";

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init);
}

interface ErrorPayload {
  code: string;
  message: string;
  details?: unknown;
  requestId: string;
  stack?: string;
}

export function error(
  status: number,
  code: string,
  message: string,
  details?: unknown,
  extra?: { requestId?: string; stack?: string },
) {
  const requestId = extra?.requestId ?? newRequestId();
  const payload: ErrorPayload = { code, message, requestId };
  if (details !== undefined) payload.details = details;
  if (extra?.stack) payload.stack = extra.stack;
  return NextResponse.json(
    { ok: false, error: payload },
    { status, headers: { "x-request-id": requestId } },
  );
}

const REQUEST_ID_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"; // Crockford base32
function newRequestId(): string {
  const bytes = randomBytes(5);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += REQUEST_ID_ALPHABET[bytes[i]! % REQUEST_ID_ALPHABET.length];
  }
  return out + REQUEST_ID_ALPHABET[Math.floor(Math.random() * REQUEST_ID_ALPHABET.length)];
}

function verboseErrorsEnabled(): boolean {
  if (process.env.STOREAI_VERBOSE_ERRORS === "true") return true;
  return process.env.NODE_ENV !== "production";
}

// Map Postgres error codes to public-facing API error codes. We avoid leaking
// raw constraint names but keep the response specific enough to debug against.
function mapDbError(err: unknown): { status: number; code: string; message: string } | null {
  if (!err || typeof err !== "object") return null;
  const e = err as { code?: string; message?: string };
  switch (e.code) {
    case "23505":
      return { status: 409, code: "unique_violation", message: "Resource already exists" };
    case "23503":
      return { status: 409, code: "foreign_key_violation", message: "Referenced resource missing" };
    case "23502":
      return { status: 400, code: "not_null_violation", message: "Required field missing" };
    case "23514":
      return { status: 400, code: "check_violation", message: "Value violates a constraint" };
    case "22001":
      return { status: 400, code: "value_too_long", message: "Value exceeds field length" };
    case "54000":
    case "22023":
      return { status: 413, code: "payload_too_large", message: "Payload exceeds the allowed size" };
    default:
      return null;
  }
}

export function handleError(err: unknown) {
  const requestId = newRequestId();
  if (err instanceof AppError) {
    return error(err.status, err.code, err.message, err.details, { requestId });
  }
  if (err instanceof ZodError) {
    return error(400, "validation_error", "Validation failed", err.issues, { requestId });
  }

  const dbMapped = mapDbError(err);
  if (dbMapped) {
    console.error(`[${requestId}] db error`, err);
    return error(dbMapped.status, dbMapped.code, dbMapped.message, undefined, { requestId });
  }

  console.error(`[${requestId}] unhandled error`, err);
  if (verboseErrorsEnabled()) {
    const e = err as Error;
    return error(
      500,
      "internal_error",
      e?.message ? `Internal server error: ${e.message}` : "Internal server error",
      undefined,
      { requestId, stack: e?.stack },
    );
  }
  return error(500, "internal_error", "Internal server error", undefined, { requestId });
}
