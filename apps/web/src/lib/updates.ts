import "server-only";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const DEFAULT_OPS_ROOT = "/home/ubuntu/storeai-ops";
const LOG_TAIL_BYTES = 50 * 1024;
const LOG_TAIL_LINES = 300;
const MAX_RECENT_RUNS = 20;

export interface LastDeploy {
  status?: string;
  timestamp?: string;
  from?: string;
  to?: string;
  log?: string;
  reason?: string;
  migrations_ran?: boolean;
  [key: string]: unknown;
}

export interface DeployRun {
  filename: string;
  path: string;
  mtime: string;
  size: number;
  shortSha: string | null;
}

export interface DeployCommit {
  shortSha: string | null;
  message: string;
}

export interface UpdatesSnapshot {
  lastDeploy: LastDeploy | null;
  failure: string | null;
  recentRuns: DeployRun[];
  selectedLogTail: string | null;
  includedCommits: DeployCommit[];
  opsRoot: {
    path: string;
    accessible: boolean;
    message: string | null;
  };
}

export function updatesOpsRoot(): string {
  return process.env.STOREAI_OPS_ROOT || DEFAULT_OPS_ROOT;
}

function fixedPaths(root = updatesOpsRoot()) {
  return {
    stateDir: path.join(root, "state"),
    logsDir: path.join(root, "logs"),
    lastDeploy: path.join(root, "state", "last-deploy.json"),
    failure: path.join(root, "state", "FAILURE"),
  };
}

async function readTextIfExists(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
}

function isMissing(err: unknown): boolean {
  return Boolean(
    err &&
      typeof err === "object" &&
      "code" in err &&
      ((err as { code?: string }).code === "ENOENT" ||
        (err as { code?: string }).code === "ENOTDIR"),
  );
}

function parseLastDeploy(raw: string | null): LastDeploy | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as LastDeploy;
  } catch {
    return {
      status: "unreadable",
      reason: "last-deploy.json is not valid JSON",
    };
  }
}

async function inspectOpsRoot(root: string): Promise<UpdatesSnapshot["opsRoot"]> {
  try {
    const info = await stat(root);
    if (!info.isDirectory()) {
      return {
        path: root,
        accessible: false,
        message: "Ops root exists but is not a directory.",
      };
    }
    return { path: root, accessible: true, message: null };
  } catch (err) {
    if (isMissing(err)) {
      return {
        path: root,
        accessible: false,
        message:
          "Ops root is missing or hidden from the web service. Check the systemd BindReadOnlyPaths setting.",
      };
    }
    return {
      path: root,
      accessible: false,
      message:
        err && typeof err === "object" && "code" in err
          ? `Ops root is not accessible: ${(err as { code?: string }).code}`
          : "Ops root is not accessible.",
    };
  }
}

function inferShortSha(filename: string): string | null {
  const match = filename.match(/[a-f0-9]{7,40}/i);
  return match ? match[0]!.slice(0, 12) : null;
}

function tailLog(raw: string): string {
  const byBytes =
    Buffer.byteLength(raw, "utf8") > LOG_TAIL_BYTES
      ? Buffer.from(raw).subarray(-LOG_TAIL_BYTES).toString("utf8")
      : raw;
  const lines = byBytes.split(/\r?\n/);
  return lines.slice(-LOG_TAIL_LINES).join("\n");
}

function parseIncludedCommits(raw: string | null): DeployCommit[] {
  if (!raw) return [];
  const lines = raw.split(/\r?\n/);
  const start = lines.findIndex((line) => line.includes("incoming commits:"));
  if (start === -1) return [];

  const commits: DeployCommit[] = [];
  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (commits.length > 0) break;
      continue;
    }
    if (trimmed.startsWith("[") || trimmed.endsWith(":")) break;

    const match = trimmed.match(/^([a-f0-9]{7,40})\s+(.+)$/i);
    commits.push({
      shortSha: match ? match[1]!.slice(0, 12) : null,
      message: match ? match[2]! : trimmed,
    });
  }
  return commits;
}

async function listDeployRuns(logsDir: string): Promise<DeployRun[]> {
  let entries: string[];
  try {
    entries = await readdir(logsDir);
  } catch (err) {
    if (isMissing(err)) return [];
    throw err;
  }

  const runs = await Promise.all(
    entries
      .filter((name) => /^deploy-.*\.log$/.test(name))
      .map(async (filename): Promise<DeployRun | null> => {
        const filePath = path.join(logsDir, filename);
        try {
          const info = await stat(filePath);
          if (!info.isFile()) return null;
          return {
            filename,
            path: filePath,
            mtime: info.mtime.toISOString(),
            size: info.size,
            shortSha: inferShortSha(filename),
          };
        } catch (err) {
          if (isMissing(err)) return null;
          throw err;
        }
      }),
  );

  return runs
    .filter((run): run is DeployRun => Boolean(run))
    .sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime())
    .slice(0, MAX_RECENT_RUNS);
}

export async function getUpdatesSnapshot(root = updatesOpsRoot()): Promise<UpdatesSnapshot> {
  const paths = fixedPaths(root);
  const [opsRoot, lastDeployRaw, failureRaw, recentRuns] = await Promise.all([
    inspectOpsRoot(root),
    readTextIfExists(paths.lastDeploy),
    readTextIfExists(paths.failure),
    listDeployRuns(paths.logsDir),
  ]);

  const latestLog = recentRuns[0];
  const latestLogRaw = latestLog ? await readTextIfExists(latestLog.path) : null;

  return {
    lastDeploy: parseLastDeploy(lastDeployRaw),
    failure: failureRaw?.trim() || null,
    recentRuns,
    selectedLogTail: latestLogRaw ? tailLog(latestLogRaw) : null,
    includedCommits: parseIncludedCommits(latestLogRaw),
    opsRoot,
  };
}
