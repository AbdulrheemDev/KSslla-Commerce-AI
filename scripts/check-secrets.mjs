#!/usr/bin/env node
/**
 * Secret scanner for tracked files.
 *
 * Goals:
 * - fail CI if a credential looks committed
 * - never print the matched secret
 * - no external dependencies
 */

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const MAX_FILE_BYTES = 1_000_000;
const SKIP_FILES = new Set(["package-lock.json", ".env.example"]);
const SKIP_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".pdf",
  ".zip",
]);

const RULES = [
  {
    id: "private-key",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
    message: "Private key material",
  },
  {
    id: "aws-access-key",
    pattern: /\bAKIA[0-9A-Z]{16}\b/,
    message: "AWS access key id",
  },
  {
    id: "github-token",
    pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/,
    message: "GitHub token",
  },
  {
    id: "slack-token",
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
    message: "Slack token",
  },
  {
    id: "openai-style-key",
    pattern: /\bsk-[A-Za-z0-9_-]{32,}\b/,
    message: "Provider API key",
  },
  {
    id: "jwt",
    pattern: /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}\b/,
    message: "JWT",
  },
  {
    id: "env-assignment",
    pattern:
      /^(?:export\s+)?(?:DATABASE_URL|AUTH_SECRET|ENCRYPTION_KEY|SALLA_CLIENT_SECRET|SALLA_CLIENT_ID|SALLA_WEBHOOK_SECRET|AI_API_KEY|AI_PROVIDER)\s*=\s*["']?[^\s"'#]{8,}/m,
    message: "Real-looking env assignment",
    onlyEnvFiles: true,
  },
];

function listTrackedFiles() {
  try {
    const output = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" });
    return output.split("\0").filter(Boolean);
  } catch {
    console.error("check-secrets: unable to read tracked files (git ls-files failed).");
    process.exit(1);
  }
}

function isEnvFile(file) {
  const name = file.split("/").pop() ?? "";
  return name === ".env" || name.startsWith(".env.") || name.endsWith(".env");
}

function shouldSkip(file) {
  if (SKIP_FILES.has(file)) return true;
  if (isEnvFile(file) && file !== ".env.example") return false;
  const extension = file.includes(".") ? file.slice(file.lastIndexOf(".")) : "";
  return SKIP_EXTENSIONS.has(extension);
}

const tracked = listTrackedFiles();

// 1) Real env files must never be tracked.
const trackedEnv = tracked.filter((file) => isEnvFile(file) && file !== ".env.example");
if (trackedEnv.length > 0) {
  console.error("check-secrets: environment files are tracked in git:");
  for (const file of trackedEnv) console.error(`  - ${file}`);
  process.exit(1);
}

const findings = [];
let scanned = 0;

for (const file of tracked) {
  if (shouldSkip(file)) continue;

  let content;
  try {
    if (statSync(file).size > MAX_FILE_BYTES) continue;
    content = readFileSync(file, "utf8");
  } catch {
    continue;
  }

  scanned += 1;
  const lines = content.split(/\r?\n/);

  for (const rule of RULES) {
    if (rule.onlyEnvFiles && !isEnvFile(file)) continue;

    lines.forEach((line, index) => {
      if (rule.pattern.test(line)) {
        findings.push({ file, line: index + 1, rule: rule.id, message: rule.message });
      }
    });
  }
}

if (findings.length > 0) {
  console.error(`check-secrets: ${findings.length} potential secret(s) found:`);
  for (const finding of findings) {
    console.error(`  ${finding.file}:${finding.line} — ${finding.id} (${finding.message})`);
  }
  console.error("Remove the value, rotate the credential, and use environment variables.");
  process.exit(1);
}

console.log(`check-secrets: OK — ${scanned} tracked file(s) scanned, no secrets found.`);
