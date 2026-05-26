import { existsSync } from "node:fs";

const CANDIDATES = ["/opt/hermes/.venv/bin/hermes", "/usr/local/bin/hermes"];

/** Resolve Hermes CLI (container image installs under /opt/hermes/.venv/bin). */
export function hermesBin(): string {
  const fromEnv = process.env.HERMES_BIN?.trim();
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  for (const path of CANDIDATES) {
    if (existsSync(path)) return path;
  }
  return "hermes";
}

export function hermesExecEnv(): NodeJS.ProcessEnv {
  const bin = hermesBin();
  const binDir = bin.includes("/") ? bin.slice(0, bin.lastIndexOf("/")) : "";
  const pathParts = [
    binDir,
    "/opt/hermes/.venv/bin",
    `${process.env.HOME}/.npm/bin`,
    `${process.env.HOME}/.local/bin`,
    process.env.PATH ?? "",
  ].filter(Boolean);
  return { ...process.env, PATH: [...new Set(pathParts)].join(":") };
}
