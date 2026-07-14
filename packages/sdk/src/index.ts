export type StoreAIEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; requestId?: string } };

export type StoreAIRecord<T = unknown> = {
  id: string;
  tenantId?: string;
  projectId: string;
  key: string;
  data: T;
  immutable?: boolean;
  version?: number;
  createdAt: string;
  updatedAt: string;
};

export type StoreAIFile = {
  id: string;
  tenantId?: string;
  projectId: string | null;
  objectKey?: string;
  originalName?: string;
  name?: string;
  sizeBytes?: number | null;
  size?: number | null;
  contentType?: string | null;
  mimeType?: string | null;
  downloadUrl: string | null;
  createdAt: string;
  updatedAt?: string;
  meta?: unknown;
};

export type StoreAIProject = {
  id: string;
  tenantId?: string;
  name: string;
  slug: string;
  description?: string | null;
  integrityMode?: "legacy" | "strict";
  createdAt: string;
  updatedAt: string;
};

export type ProjectIntegrityReadiness = {
  integrityMode: "legacy" | "strict";
  recordCount: number;
  duplicateKeyGroups: number;
  canUpgrade: boolean;
};

export type ListRecordsOptions = {
  projectId?: string;
  page?: number;
  pageSize?: number;
  sort?: "created_at" | "-created_at" | "updated_at" | "-updated_at";
  key?: string;
  keyPrefix?: string;
};

export type ListRecordsResult<T = unknown> = {
  items: StoreAIRecord<T>[];
  page: number;
  pageSize: number;
  total: number;
};

export type AtomicRecordOperation<T = unknown> =
  | { op: "create"; key: string; data: T; ifAbsent?: true; immutable?: boolean }
  | { op: "update"; key: string; data: T; expectedVersion?: number }
  | { op: "delete"; key: string; expectedVersion?: number };

export type AtomicRecordResult<T = unknown> =
  | { op: "create" | "update"; record: StoreAIRecord<T> }
  | { op: "delete"; key: string; deleted: true };

export type StoreAIUploadBody =
  | Blob
  | ArrayBuffer
  | ArrayBufferView
  | string;

export type UploadFileOptions = {
  body: StoreAIUploadBody;
  filename: string;
  contentType?: string;
  projectId?: string | null;
  meta?: unknown;
};

export type CreateSmartRecordOptions = {
  contentType?: string;
  inlineLimitBytes?: number;
  fileMeta?: unknown;
};

export type StoreAIClientOptions = {
  baseUrl: string;
  apiKey: string;
  projectId?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
};

const DEFAULT_INLINE_LIMIT_BYTES = 900_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_DELAY_MS = 150;
const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

export class StoreAIError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId?: string;
  readonly retryable: boolean;

  constructor(input: { code: string; message: string; status: number; requestId?: string; retryable?: boolean; cause?: unknown }) {
    super(input.message);
    this.name = "StoreAIError";
    this.code = input.code;
    this.status = input.status;
    this.requestId = input.requestId;
    this.retryable = input.retryable ?? RETRYABLE_STATUS_CODES.has(input.status);
    if (input.cause !== undefined) this.cause = input.cause;
  }
}

function cleanBaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function byteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterMs(response: Response): number | null {
  const value = response.headers.get("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function isEnvelope<T>(value: unknown): value is StoreAIEnvelope<T> {
  if (!value || typeof value !== "object" || !("ok" in value)) return false;
  const envelope = value as { ok?: unknown; data?: unknown; error?: unknown };
  if (envelope.ok === true) return "data" in envelope;
  if (envelope.ok !== false || !envelope.error || typeof envelope.error !== "object") return false;
  const error = envelope.error as { code?: unknown; message?: unknown };
  return typeof error.code === "string" && typeof error.message === "string";
}

function inferContentType(input: UploadFileOptions) {
  if (input.contentType) return input.contentType;
  if (input.body instanceof Blob && input.body.type) return input.body.type;
  return "application/octet-stream";
}

function uploadFormData(input: UploadFileOptions, defaultProjectId?: string) {
  const form = new FormData();
  const body = input.body instanceof Blob ? input.body : new Blob([input.body as BlobPart], { type: inferContentType(input) });
  form.append("file", body, input.filename);
  const projectId = input.projectId ?? defaultProjectId;
  if (projectId) form.append("projectId", projectId);
  if (input.meta !== undefined) form.append("meta", JSON.stringify(input.meta));
  return form;
}

export class StoreAI {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly projectId?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;

  constructor(options: StoreAIClientOptions) {
    if (!options.baseUrl) throw new Error("StoreAI baseUrl is required");
    if (!options.apiKey) throw new Error("StoreAI apiKey is required");
    this.baseUrl = cleanBaseUrl(options.baseUrl);
    this.apiKey = options.apiKey;
    this.projectId = options.projectId;
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    this.maxRetries = Math.max(0, Math.floor(options.maxRetries ?? DEFAULT_MAX_RETRIES));
    this.retryBaseDelayMs = Math.max(0, options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS);
  }

  private async api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const method = (init.method ?? "GET").toUpperCase();
    const attempts = method === "GET" || method === "HEAD" ? this.maxRetries + 1 : 1;
    let lastError: StoreAIError | undefined;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      const abortFromCaller = () => controller.abort();
      init.signal?.addEventListener("abort", abortFromCaller, { once: true });

      let response: Response | undefined;
      try {
        response = await this.fetchImpl(`${this.baseUrl}${path}`, {
          ...init,
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            Accept: "application/json",
            ...(init.headers ?? {}),
          },
        });
        const text = await response.text();
        let parsed: unknown;
        try {
          parsed = text ? JSON.parse(text) : undefined;
        } catch (cause) {
          throw new StoreAIError({
            code: "invalid_response",
            message: `StoreAI returned invalid JSON (HTTP ${response.status})`,
            status: response.status,
            requestId: response.headers.get("x-request-id") ?? undefined,
            retryable: response.status >= 500,
            cause,
          });
        }
        if (!isEnvelope<T>(parsed)) {
          throw new StoreAIError({
            code: "invalid_response",
            message: `StoreAI returned an invalid response envelope (HTTP ${response.status})`,
            status: response.status,
            requestId: response.headers.get("x-request-id") ?? undefined,
            retryable: response.status >= 500,
          });
        }
        if (!parsed.ok) {
          throw new StoreAIError({
            code: parsed.error.code,
            message: parsed.error.message,
            requestId: parsed.error.requestId ?? response.headers.get("x-request-id") ?? undefined,
            status: response.status,
          });
        }
        if (!response.ok) {
          throw new StoreAIError({
            code: "http_error",
            message: `StoreAI returned HTTP ${response.status}`,
            status: response.status,
            requestId: response.headers.get("x-request-id") ?? undefined,
          });
        }
        return parsed.data;
      } catch (cause) {
        const callerAborted = init.signal?.aborted === true;
        if (callerAborted) throw cause;
        lastError = cause instanceof StoreAIError
          ? cause
          : new StoreAIError({
              code: controller.signal.aborted ? "timeout" : "network_error",
              message: controller.signal.aborted
                ? `StoreAI request timed out after ${this.timeoutMs}ms`
                : "StoreAI request failed before a response was received",
              status: 0,
              retryable: true,
              cause,
            });
        if (!lastError.retryable || attempt === attempts - 1) throw lastError;
        const serverDelay = response ? retryAfterMs(response) : null;
        const backoff = this.retryBaseDelayMs * 2 ** attempt;
        await sleep(Math.min(serverDelay ?? backoff, 5_000));
      } finally {
        clearTimeout(timeout);
        init.signal?.removeEventListener("abort", abortFromCaller);
      }
    }

    throw lastError ?? new StoreAIError({ code: "network_error", message: "StoreAI request failed", status: 0, retryable: true });
  }

  projects = {
    list: () => this.api<{ items: StoreAIProject[] }>("/api/projects").then((data) => data.items),
    create: (input: { name: string; slug: string; description?: string }) =>
      this.json<StoreAIProject>("/api/projects", "POST", input),
    update: (id: string, patch: { name?: string; slug?: string; description?: string }) =>
      this.json<StoreAIProject>(`/api/projects/${encodeURIComponent(id)}`, "PATCH", patch),
    delete: (id: string) =>
      this.api<{ deleted: true }>(`/api/projects/${encodeURIComponent(id)}`, { method: "DELETE" }),
    integrityReadiness: (id: string) =>
      this.api<ProjectIntegrityReadiness>(`/api/projects/${encodeURIComponent(id)}/integrity`),
    upgradeIntegrity: (id: string) =>
      this.json<{ integrityMode: "strict"; upgraded: boolean }>(
        `/api/projects/${encodeURIComponent(id)}/integrity`,
        "POST",
        { integrityMode: "strict" },
      ),
  };

  records = {
    create: <T = unknown>(key: string, data: T, projectId = this.requiredProjectId()) =>
      this.json<StoreAIRecord<T>>("/api/records", "POST", { projectId, key, data }),
    list: <T = unknown>(options: ListRecordsOptions = {}) => {
      const qs = new URLSearchParams({
        projectId: options.projectId ?? this.requiredProjectId(),
        page: String(options.page ?? 1),
        pageSize: String(options.pageSize ?? 20),
        sort: options.sort ?? "-created_at",
      });
      if (options.key) qs.set("key", options.key);
      if (options.keyPrefix) qs.set("keyPrefix", options.keyPrefix);
      return this.api<ListRecordsResult<T>>(`/api/records?${qs}`);
    },
    get: <T = unknown>(id: string) =>
      this.api<StoreAIRecord<T>>(`/api/records/${encodeURIComponent(id)}`),
    getByKey: <T = unknown>(key: string, projectId = this.requiredProjectId()) =>
      this.api<StoreAIRecord<T>>(
        `/api/records/by-key/${encodeURIComponent(key)}?projectId=${encodeURIComponent(projectId)}`,
      ),
    update: <T = unknown>(id: string, patch: { key?: string; data?: T; expectedVersion?: number }) => {
      const headers = patch.expectedVersion ? { "x-storeai-record-version": String(patch.expectedVersion) } : undefined;
      return this.json<StoreAIRecord<T>>(
        `/api/records/${encodeURIComponent(id)}`,
        "PATCH",
        { key: patch.key, data: patch.data },
        headers,
      );
    },
    upsertByKey: <T = unknown>(key: string, data: T, projectId = this.requiredProjectId()) =>
      this.json<StoreAIRecord<T>>(
        `/api/records/by-key/${encodeURIComponent(key)}?projectId=${encodeURIComponent(projectId)}`,
        "PUT",
        { projectId, key, data },
      ),
    delete: (id: string) =>
      this.api<{ deleted: true }>(`/api/records/${encodeURIComponent(id)}`, { method: "DELETE" }),
    atomic: <T = unknown>(
      operations: AtomicRecordOperation<T>[],
      options: { idempotencyKey: string; projectId?: string },
    ) =>
      this.json<{ results: AtomicRecordResult<T>[] }>(
        "/api/atomic/records",
        "POST",
        { projectId: options.projectId ?? this.requiredProjectId(), operations },
        { "Idempotency-Key": options.idempotencyKey },
      ),
  };

  files = {
    list: () => this.api<StoreAIFile[]>("/api/files"),
    get: (id: string) => this.api<StoreAIFile>(`/api/files/${encodeURIComponent(id)}`),
    downloadUrl: (id: string) => `${this.baseUrl}/api/files/${encodeURIComponent(id)}/download`,
    delete: (id: string) =>
      this.api<{ deleted: true }>(`/api/files/${encodeURIComponent(id)}`, { method: "DELETE" }),
    upload: (input: UploadFileOptions) => this.uploadFile(input),
  };

  async createSmartRecord<T = unknown>(
    key: string,
    data: T,
    options: CreateSmartRecordOptions = {},
  ): Promise<StoreAIRecord<T | { storage: "file"; fileId: string; kind: string; originalBytes: number }>> {
    const serialized = JSON.stringify(data ?? {});
    const bytes = byteLength(serialized);
    if (bytes <= (options.inlineLimitBytes ?? DEFAULT_INLINE_LIMIT_BYTES)) {
      return this.records.create<T>(key, data);
    }
    const file = await this.uploadFile({
      body: serialized,
      filename: `${key}.json`,
      contentType: options.contentType ?? "application/json",
      meta: options.fileMeta,
    });
    return this.records.create(key, {
      storage: "file",
      fileId: file.id,
      kind: "json",
      originalBytes: bytes,
    });
  }

  private requiredProjectId() {
    if (!this.projectId) throw new Error("StoreAI projectId is required for this operation");
    return this.projectId;
  }

  private json<T>(path: string, method: string, body: unknown, headers?: HeadersInit) {
    return this.api<T>(path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(headers ?? {}),
      },
      body: JSON.stringify(body),
    });
  }

  private async uploadFile(input: UploadFileOptions) {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.api<StoreAIFile>("/api/files", {
          method: "POST",
          body: uploadFormData(input, this.projectId),
        });
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        if (!/internal_error|parse multipart|parse body as FormData/i.test(message)) break;
      }
    }
    throw lastError;
  }
}

export function createStoreAI(options: StoreAIClientOptions) {
  return new StoreAI(options);
}
