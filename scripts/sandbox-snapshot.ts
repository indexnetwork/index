#!/usr/bin/env bun

import { mkdir } from "node:fs/promises";
import path from "node:path";

const PLAYGROUND_DATABASE = "protocol_sandbox";
const TEMPLATE_PATH = path.join(import.meta.dir, "..", ".cache", "index", "playground-template.dump");

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
  if (!["protocol_prod", PLAYGROUND_DATABASE].includes(configuredDatabase)) {
    throw new Error(`Refusing to derive a sandbox connection from database "${configuredDatabase}".`);
  }
  url.pathname = `/${PLAYGROUND_DATABASE}`;
  return url.toString();
}

async function run(command: string[]) {
  const result = await Bun.spawn(command, { stdout: "inherit", stderr: "inherit" }).exited;
  if (result !== 0) throw new Error(`${command[0]} failed with exit code ${result}`);
}

const action = process.argv[2];
const confirm = process.argv.includes("--confirm");
const replace = process.argv.includes("--replace");
if (!["freeze", "clone"].includes(action) || !confirm || (replace && action !== "freeze")) {
  throw new Error("Usage: bun scripts/sandbox-snapshot.ts <freeze|clone> --confirm [--replace]");
}

const url = await databaseUrl();

if (action === "freeze") {
  if (await Bun.file(TEMPLATE_PATH).exists() && !replace) {
    throw new Error(
      `Playground template already exists at ${TEMPLATE_PATH}. `
      + "It is immutable during normal use; re-run with --replace only after deliberately reseeding the playground.",
    );
  }
  await mkdir(path.dirname(TEMPLATE_PATH), { recursive: true });
  await run(["pg_dump", "--format=custom", "--no-owner", "--no-privileges", `--file=${TEMPLATE_PATH}`, url]);
  console.log(`Frozen playground template at ${TEMPLATE_PATH}`);
} else {
  if (!await Bun.file(TEMPLATE_PATH).exists()) {
    throw new Error(`No playground template at ${TEMPLATE_PATH}. Seed protocol_sandbox, then run db:playground:freeze first.`);
  }
  await run(["pg_restore", "--clean", "--if-exists", "--no-owner", "--no-privileges", `--dbname=${url}`, TEMPLATE_PATH]);
  console.log(`Cloned playground template into ${PLAYGROUND_DATABASE}`);
}
