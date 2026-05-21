import "server-only";

export function storeAiOpenApiSpec(baseUrl = process.env.APP_URL || "http://localhost:3000") {
  return {
    openapi: "3.1.0",
    info: {
      title: "StoreAI API",
      version: "0.1.0",
      description:
        "Self-hosted multi-tenant backend API for projects, JSON records, files, members, audit logs, usage logs, and deploy visibility.",
    },
    servers: [{ url: baseUrl }],
    components: {
      securitySchemes: {
        bearerApiKey: { type: "http", scheme: "bearer" },
        sessionCookie: { type: "apiKey", in: "cookie", name: "sa_session" },
      },
      schemas: {
        ApiEnvelope: {
          type: "object",
          properties: {
            ok: { type: "boolean" },
            data: {},
          },
          required: ["ok", "data"],
        },
        Project: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            tenantId: { type: "string", format: "uuid" },
            name: { type: "string" },
            slug: { type: "string" },
            description: { type: ["string", "null"] },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        Record: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            tenantId: { type: "string", format: "uuid" },
            projectId: { type: "string", format: "uuid" },
            key: { type: "string" },
            data: { type: "object", additionalProperties: true },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
      },
    },
    security: [{ bearerApiKey: [] }, { sessionCookie: [] }],
    paths: {
      "/api/openapi.json": {
        get: {
          summary: "Return this OpenAPI document",
          security: [],
          responses: { "200": { description: "OpenAPI spec" } },
        },
      },
      "/api/health": {
        get: {
          summary: "Health check",
          security: [],
          responses: { "200": { description: "Dependency health" } },
        },
      },
      "/api/projects": {
        get: {
          summary: "List projects",
          responses: { "200": { description: "Paginated project list" } },
        },
        post: {
          summary: "Create a project",
          responses: { "200": { description: "Created project" } },
        },
      },
      "/api/projects/{id}": {
        get: {
          summary: "Get a project",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Project" } },
        },
        patch: {
          summary: "Update a project",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Updated project" } },
        },
        delete: {
          summary: "Delete a project",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Delete confirmation" } },
        },
      },
      "/api/records": {
        get: {
          summary: "List records",
          parameters: [
            { name: "projectId", in: "query", schema: { type: "string" } },
            { name: "key", in: "query", schema: { type: "string" } },
            { name: "keyPrefix", in: "query", schema: { type: "string" } },
          ],
          responses: { "200": { description: "Paginated record list" } },
        },
        post: {
          summary: "Create a record",
          responses: { "200": { description: "Created record" } },
        },
      },
      "/api/records/{id}": {
        get: {
          summary: "Get a record",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Record" } },
        },
        patch: {
          summary: "Update a record",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Updated record" } },
        },
        delete: {
          summary: "Delete a record",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Delete confirmation" } },
        },
      },
      "/api/records/by-key/{key}": {
        get: {
          summary: "Get a record by key",
          parameters: [{ name: "key", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Record" } },
        },
        put: {
          summary: "Upsert a record by key",
          parameters: [{ name: "key", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Record" } },
        },
      },
      "/api/files": {
        get: {
          summary: "List files",
          responses: { "200": { description: "File list" } },
        },
        post: {
          summary: "Upload a file using multipart/form-data",
          responses: { "200": { description: "Uploaded file metadata" } },
        },
      },
      "/api/api-keys": {
        get: {
          summary: "List API keys",
          responses: { "200": { description: "API key list" } },
        },
        post: {
          summary: "Create an API key",
          responses: { "200": { description: "Created key with one-time plaintext secret" } },
        },
      },
      "/api/audit-logs": {
        get: { summary: "List audit logs", responses: { "200": { description: "Audit logs" } } },
      },
      "/api/usage-logs": {
        get: { summary: "List usage logs", responses: { "200": { description: "Usage logs" } } },
      },
      "/api/updates": {
        get: {
          summary: "Read deploy state and latest deploy log tail",
          responses: { "200": { description: "Deploy status snapshot" } },
        },
      },
    },
  };
}
