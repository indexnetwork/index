#!/usr/bin/env bun
// Replaces the local-development clone in Protocol-dev-europe (eu-central-1) with
// a fresh copy of US production, then migrates it. Neon cannot branch across
// regions, so the copy is a pg_dump | pg_restore.

import path from "node:path";

const SOURCE = { project: "shiny-cloud-34341469", branch: "br-fragrant-brook-ahexgsek" };
const TARGET = { project: "patient-pine-89907813", branch: "br-polished-bread-agalu9tk" };
const DATABASE = "protocol";
const OWNER = "neondb_owner";
const ROOT = path.resolve(import.meta.dir, "..");

if (!process.argv.includes("--confirm")) {
  throw new Error("This replaces the EU clone and discards its local changes. Re-run with --confirm.");
}
if (!process.env.NEON_API_KEY) throw new Error("NEON_API_KEY is required.");

async function run(command: string[], options: { cwd?: string } = {}): Promise<string> {
  const proc = Bun.spawn(command, { cwd: options.cwd, stdout: "pipe", stderr: "inherit" });
  const output = await new Response(proc.stdout).text();
  if ((await proc.exited) !== 0) throw new Error(`${command.slice(0, 3).join(" ")} failed`);
  return output.trim();
}

const neon = (target: typeof SOURCE, ...args: string[]) =>
  run(["bunx", "--bun", "neonctl", ...args, `--project-id=${target.project}`, "--no-color"]);

// Migrations read .env.development, so it must name the database being refreshed.
const target = new URL(await neon(TARGET, "connection-string", TARGET.branch, `--database-name=${DATABASE}`));
const envFile = await Bun.file(path.join(ROOT, ".env.development")).text();
const local = new URL(envFile.match(/^DATABASE_URL=(.*)$/m)?.[1].trim() ?? "postgres://missing");
if (local.hostname.replace("-pooler", "") !== target.hostname || local.pathname !== target.pathname) {
  throw new Error(`.env.development must point at the EU clone (${target.hostname}${target.pathname}).`);
}

const source = await neon(SOURCE, "connection-string", SOURCE.branch, `--database-name=${DATABASE}`);
console.log(`[eu-refresh] ${SOURCE.project}/${SOURCE.branch}/${DATABASE} -> ${TARGET.project}/${TARGET.branch}/${DATABASE}`);

await neon(TARGET, "databases", "delete", DATABASE, `--branch=${TARGET.branch}`);
await neon(TARGET, "databases", "create", `--name=${DATABASE}`, `--owner-name=${OWNER}`, `--branch=${TARGET.branch}`);

const dump = Bun.spawn(["pg_dump", "--format=custom", "--no-owner", "--no-privileges", source], { stderr: "inherit" });
const restore = Bun.spawn(
  ["pg_restore", "--no-owner", "--no-privileges", "--exit-on-error", `--dbname=${target}`],
  { stdin: dump.stdout, stderr: "inherit" },
);
if ((await dump.exited) !== 0 || (await restore.exited) !== 0) throw new Error("Copy failed; the EU clone is incomplete.");

console.log(await run(["bun", "run", "db:migrate"], { cwd: path.join(ROOT, "services/api") }));
console.log("[eu-refresh] Done.");
