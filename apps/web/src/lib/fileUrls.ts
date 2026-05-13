import "server-only";
import { env } from "@/env.server";

export function appHostedFileDownloadUrl(fileId: string): string {
  return new URL(`/api/files/${fileId}/download`, env.APP_URL).toString();
}
