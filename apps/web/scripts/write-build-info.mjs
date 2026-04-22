#!/usr/bin/env node
/**
 * Writes apps/web/build-info.json at build time. Consumed at runtime by the
 * ops endpoint so we can surface the currently-running commit without
 * shelling out per request. Falls back gracefully in a non-git checkout
 * (tarball download, Docker COPY, etc.) — the file is always present.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.resolve(here, "..", "build-info.json");

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function gatherGitInfo() {
  try {
    const commit = git(["rev-parse", "HEAD"]);
    const commitSubject = git(["log", "-1", "--format=%s", "HEAD"]);
    const recent = git(["log", "-5", "--format=%h%x09%s", "HEAD"])
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [sha, ...rest] = line.split("\t");
        return { sha, subject: rest.join("\t") };
      });
    return { commit, commit_subject: commitSubject, recent_commits: recent };
  } catch {
    return {
      commit: "unknown",
      commit_subject: "(not a git checkout)",
      recent_commits: [],
    };
  }
}

const info = {
  ...gatherGitInfo(),
  built_at: new Date().toISOString(),
};

fs.writeFileSync(outPath, JSON.stringify(info, null, 2) + "\n");
console.log(`[build-info] wrote ${path.relative(process.cwd(), outPath)}: ${info.commit.slice(0, 8)}`);
