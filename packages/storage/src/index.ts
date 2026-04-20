import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getEnv } from "@storeai/shared/env";
import { randomBytes } from "node:crypto";

let cached: S3Client | null = null;

export function getS3(): S3Client {
  if (cached) return cached;
  const env = getEnv();
  cached = new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY,
      secretAccessKey: env.S3_SECRET_KEY,
    },
  });
  return cached;
}

export function getBucket(): string {
  return getEnv().S3_BUCKET;
}

export async function ensureBucket(): Promise<void> {
  const s3 = getS3();
  const bucket = getBucket();
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  }
}

export function buildObjectKey(args: {
  tenantId: string;
  projectId?: string | null;
  originalName: string;
}): string {
  const safe = args.originalName.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 200);
  const rand = randomBytes(8).toString("hex");
  const date = new Date().toISOString().slice(0, 10);
  const base = `tenants/${args.tenantId}`;
  const mid = args.projectId ? `/projects/${args.projectId}` : "";
  return `${base}${mid}/${date}/${rand}-${safe}`;
}

export function assertTenantOwnsKey(tenantId: string, objectKey: string): void {
  if (!objectKey.startsWith(`tenants/${tenantId}/`)) {
    throw new Error("Object key does not belong to this tenant");
  }
}

export async function putObject(args: {
  objectKey: string;
  body: Buffer | Uint8Array;
  contentType: string;
}): Promise<void> {
  await getS3().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: args.objectKey,
      Body: args.body,
      ContentType: args.contentType,
    }),
  );
}

export async function deleteObject(objectKey: string): Promise<void> {
  await getS3().send(new DeleteObjectCommand({ Bucket: getBucket(), Key: objectKey }));
}

export async function getSignedDownloadUrl(objectKey: string, ttlSeconds = 300): Promise<string> {
  return getSignedUrl(
    getS3(),
    new GetObjectCommand({ Bucket: getBucket(), Key: objectKey }),
    { expiresIn: ttlSeconds },
  );
}

export async function getSignedUploadUrl(args: {
  objectKey: string;
  contentType: string;
  ttlSeconds?: number;
}): Promise<string> {
  return getSignedUrl(
    getS3(),
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: args.objectKey,
      ContentType: args.contentType,
    }),
    { expiresIn: args.ttlSeconds ?? 300 },
  );
}
