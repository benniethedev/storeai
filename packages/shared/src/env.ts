import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default("us-east-1"),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_FORCE_PATH_STYLE: z
    .string()
    .default("true")
    .transform((v) => v === "true"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  SESSION_COOKIE_NAME: z.string().default("sa_session"),
  AUTH_SECRET: z.string().min(32),
  SEED_ADMIN_EMAIL: z.string().email().default("admin@storeai.local"),
  SEED_ADMIN_PASSWORD: z.string().min(8).default("admin12345"),
  SEED_TENANT_SLUG: z.string().default("demo"),
  SEED_TENANT_NAME: z.string().default("Demo Workspace"),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment: ${msg}`);
  }
  cached = parsed.data;
  return cached;
}
