#!/usr/bin/env bun

import { mkdir } from "node:fs/promises";
import path from "node:path";

const SANDBOX_DATABASE = "protocol_sandbox";
const SNAPSHOT_PATH = path.join(import.meta.dir, "..", ".cache", "index", `${SANDBOX_DATABASE}.dump`);

async function databaseUrl(): Promise<string> {
  const envPath = path.join(import.meta.dir, "..", ".env.development");
  const env = Bun.file(envPath);
  if (!env.size) throw new Error(`Missing ${envPath}`);

  const databaseUrlLine = (await env.text()).split(/\r?\n/)
    .find((line) => line.startsWith("DATABASE_URL="));
  const configuredUrl = databaseUrlLine?.slice("DATABASE_URL=".length).trim().replace(/^['"]|['"]$/g, "");
  if (!configuredUrl) throw new Error("DATABASE_URL is required in .env.development");

  const url = new URL(configuredUrl);
  const configuredDatabase = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!["protocol_prod", SANDBOX_DATABASE].includes(configuredDatabase)) {
    throw new Error(`Refusing to derive a sandbox connection from database "${configuredDatabase}".`);
  }
  url.pathname = `/${SANDBOX_DATABASE}`;
  return url.toString();
}

async function run(command: string[]) {
  const result = await Bun.spawn(command, { stdout: "inherit", stderr: "inherit" }).exited;
  if (result !== 0) throw new Error(`${command[0]} failed with exit code ${result}`);
}

const action = process.argv[2];
if (!["save", "restore"].includes(action) || !process.argv.includes("--confirm")) {
  throw new Error("Usage: bun scripts/sandbox-snapshot.ts <save|restore> --confirm");
}

const url = await databaseUrl();

if (action === "save") {
  await mkdir(path.dirname(SNAPSHOT_PATH), { recursive: true });
  await run(["pg_dump", "--format=custom", "--no-owner", "--no-privileges", `--file=${SNAPSHOT_PATH}`, url]);
  console.log(`Saved sandbox snapshot to ${SNAPSHOT_PATH}`);
} else {
  if (!await Bun.file(SNAPSHOT_PATH).exists()) {
    throw new Error(`No sandbox snapshot at ${SNAPSHOT_PATH}. Run db:snapshot:sandbox first.`);
  }
  await run(["pg_restore", "--clean", "--if-exists", "--no-owner", "--no-privileges", `--dbname=${url}`, SNAPSHOT_PATH]);
  console.log(`Restored sandbox snapshot from ${SNAPSHOT_PATH}`);
}
