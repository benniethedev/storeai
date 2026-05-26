export type StoreAIEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; requestId?: string } };

export type StoreAIRecord<T = unknown> = {
  id: string;
  tenantId?: string;
  projectId: string;
  key: string;
  data: T;
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
  createdAt: string;
  updatedAt: string;
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
};

const DEFAULT_INLINE_LIMIT_BYTES = 900_000;
export class StoreAIError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId?: string;

  constructor(input: { code: string; message: string; status: number; requestId?: string }) {
    super(input.message);
    this.name = "StoreAIError";
    this.code = input.code;
    this.status = input.status;
    this.requestId = input.requestId;
  }
}

function cleanBaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function isNodeRuntime() {
  return typeof process !== "undefined" && Boolean(process.versions?.node);
}

function safeMultipartName(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r|\n/g, "_");
}

function byteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function concatBytes(chunks: Uint8Array[]) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function utf8(value: string) {
  return new TextEncoder().encode(value);
}

async function toBytes(value: StoreAIUploadBody): Promise<Uint8Array> {
  if (typeof value === "string") return utf8(value);
  if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

function inferContentType(input: UploadFileOptions) {
  if (input.contentType) return input.contentType;
  if (input.body instanceof Blob && input.body.type) return input.body.type;
  return "application/octet-stream";
}

async function multipartBody(input: UploadFileOptions, defaultProjectId?: string) {
  const boundary = `------------------------${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
  const chunks: Uint8Array[] = [];
  const projectId = input.projectId ?? defaultProjectId;
  const appendField = (name: string, value: string) => {
    chunks.push(
      utf8(`--${boundary}\r\nContent-Disposition: form-data; name="${safeMultipartName(name)}"\r\n\r\n${value}\r\n`),
    );
  };
  if (projectId) appendField("projectId", projectId);
  if (input.meta !== undefined) appendField("meta", JSON.stringify(input.meta));
  chunks.push(
    utf8(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeMultipartName(input.filename)}"\r\nContent-Type: ${inferContentType(input)}\r\n\r\n`,
    ),
  );
  chunks.push(await toBytes(input.body));
  chunks.push(utf8(`\r\n--${boundary}--\r\n`));
  const body = concatBytes(chunks);
  const headers: Record<string, string> = {
    "Content-Type": `multipart/form-data; boundary=${boundary}`,
  };
  if (isNodeRuntime()) {
    headers["Content-Length"] = String(body.byteLength);
    headers.Connection = "close";
  }
  return { body, headers };
}

function browserFormData(input: UploadFileOptions, defaultProjectId?: string) {
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

  constructor(options: StoreAIClientOptions) {
    if (!options.baseUrl) throw new Error("StoreAI baseUrl is required");
    if (!options.apiKey) throw new Error("StoreAI apiKey is required");
    this.baseUrl = cleanBaseUrl(options.baseUrl);
    this.apiKey = options.apiKey;
    this.projectId = options.projectId;
    this.fetchImpl = options.fetch ?? fetch;
  }

  private async api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        ...(init.headers ?? {}),
      },
    });
    const text = await res.text();
    const envelope = text ? (JSON.parse(text) as StoreAIEnvelope<T>) : ({ ok: true, data: undefined as T } as const);
    if (!envelope.ok) {
      throw new StoreAIError({
        code: envelope.error.code,
        message: envelope.error.message,
        requestId: envelope.error.requestId,
        status: res.status,
      });
    }
    return envelope.data;
  }

  projects = {
    list: () => this.api<{ items: StoreAIProject[] }>("/api/projects").then((data) => data.items),
    create: (input: { name: string; slug: string; description?: string }) =>
      this.json<StoreAIProject>("/api/projects", "POST", input),
    update: (id: string, patch: { name?: string; slug?: string; description?: string }) =>
      this.json<StoreAIProject>(`/api/projects/${encodeURIComponent(id)}`, "PATCH", patch),
    delete: (id: string) =>
      this.api<{ deleted: true }>(`/api/projects/${encodeURIComponent(id)}`, { method: "DELETE" }),
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
    getByKey: <T = unknown>(key: string) =>
      this.api<StoreAIRecord<T>>(`/api/records/by-key/${encodeURIComponent(key)}`),
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
      this.json<StoreAIRecord<T>>(`/api/records/by-key/${encodeURIComponent(key)}`, "PUT", { projectId, key, data }),
    delete: (id: string) =>
      this.api<{ deleted: true }>(`/api/records/${encodeURIComponent(id)}`, { method: "DELETE" }),
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
        if (!isNodeRuntime()) {
          return await this.api<StoreAIFile>("/api/files", {
            method: "POST",
            body: browserFormData(input, this.projectId),
          });
        }
        const upload = await multipartBody(input, this.projectId);
        return await this.api<StoreAIFile>("/api/files", {
          method: "POST",
          headers: upload.headers,
          body: upload.body,
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
