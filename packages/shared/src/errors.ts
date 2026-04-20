export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.name = "AppError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super(401, "unauthorized", message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super(403, "forbidden", message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super(404, "not_found", message);
  }
}

export class ValidationError extends AppError {
  constructor(message = "Validation error", details?: unknown) {
    super(400, "validation_error", message, details);
  }
}

export class ConflictError extends AppError {
  constructor(message = "Conflict") {
    super(409, "conflict", message);
  }
}

export class RateLimitedError extends AppError {
  constructor(message = "Too many requests") {
    super(429, "rate_limited", message);
  }
}
