#!/usr/bin/env bun
/**
 * skillctl — helper for the learn-skill meta-skill.
 *
 * Enforces the policy that protected locations (e.g. the home folder) are never
 * mutated. New, migrated, and updated skills always land in the configured
 * project-local target (default: .pi/skills relative to cwd).
 *
 * Commands:
 *   bun skillctl.ts config                 Print resolved config + paths
 *   bun skillctl.ts list                   List discovered skills (location + protected flag)
 *   bun skillctl.ts locate <name>          Show every location a skill name resolves to
 *   bun skillctl.ts resolve <name>         Decide the write action: create | update | migrate
 *   bun skillctl.ts migrate <name>         Copy a protected skill into the local target
 *   bun skillctl.ts validate <path>        Validate a SKILL.md (or skill dir) frontmatter
 *   bun skillctl.ts similar <terms...>     Find skills overlapping given terms (dedup aid)
 *   bun skillctl.ts plan <name> [terms..]  Dry-run: action + dedup hints + active integrations
 *   bun skillctl.ts detect                 Report which configured rpiv helpers are installed
 *   bun skillctl.ts audit [name|all]       Modularization audit: body size, shared-partial
 *                                          candidates (duplicate blocks), shared-dir links
 */

import { existsSync, readdirSync, readFileSync, statSync, mkdirSync, cpSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, basename } from "node:path";

const skillRoot = resolve(import.meta.dir, "..");
const configPath = join(skillRoot, "config.json");

type Features = { crossLink: boolean; dedup: boolean; modularize: boolean };
type Modularize = { maxBodyLines: number; sharedDir: string; minDuplicateBlockLines: number };
type Integrations = {
  useTodo: boolean;
  useAskUserQuestion: boolean;
  useArgs: boolean;
  useAdvisor: boolean;
};
type Config = {
  target: string;
  protectedLocations: string[];
  allowProtectedWrites: boolean;
  features: Features;
  modularize: Modularize;
  integrations: Integrations;
};

const DEFAULTS: Config = {
  target: ".pi/skills",
  protectedLocations: ["~/.pi/agent/skills", "~/.agents/skills"],
  allowProtectedWrites: false,
  features: { crossLink: true, dedup: true, modularize: true },
  modularize: { maxBodyLines: 120, sharedDir: "_shared", minDuplicateBlockLines: 4 },
  integrations: { useTodo: true, useAskUserQuestion: true, useArgs: true, useAdvisor: false },
};

/** Maps an integration flag to the npm package that must be installed for it to work. */
const INTEGRATION_PACKAGES: Record<keyof Integrations, string> = {
  useTodo: "@juicesharp/rpiv-todo",
  useAskUserQuestion: "@juicesharp/rpiv-ask-user-question",
  useArgs: "@juicesharp/rpiv-args",
  useAdvisor: "@juicesharp/rpiv-advisor",
};

function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

function loadConfig(): Config {
  if (!existsSync(configPath)) return DEFAULTS;
  try {
    const raw = JSON.parse(readFileSync(configPath, "utf8"));
    return {
      target: raw.target ?? DEFAULTS.target,
      protectedLocations: raw.protectedLocations ?? DEFAULTS.protectedLocations,
      allowProtectedWrites: raw.allowProtectedWrites ?? DEFAULTS.allowProtectedWrites,
      features: { ...DEFAULTS.features, ...(raw.features ?? {}) },
      modularize: { ...DEFAULTS.modularize, ...(raw.modularize ?? {}) },
      integrations: { ...DEFAULTS.integrations, ...(raw.integrations ?? {}) },
    };
  } catch {
    return DEFAULTS;
  }
}

const config = loadConfig();
const targetDir = resolve(process.cwd(), config.target);
const protectedDirs = config.protectedLocations.map((d) => resolve(expandHome(d)));

type FoundSkill = {
  name: string;
  description: string;
  dir: string;
  skillFile: string;
  location: string;
  protected: boolean;
};

function parseFrontmatter(skillFile: string): { name?: string; description?: string } {
  const text = readFileSync(skillFile, "utf8");
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const body = m[1];
  const name = body.match(/^name:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");
  const description = body
    .match(/^description:\s*(.+)$/m)?.[1]
    ?.trim()
    .replace(/^["']|["']$/g, "");
  return { name, description };
}

function scanLocation(loc: string, isProtected: boolean): FoundSkill[] {
  const out: FoundSkill[] = [];
  if (!existsSync(loc)) return out;
  let entries: string[];
  try {
    entries = readdirSync(loc);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const dir = join(loc, entry);
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    const skillFile = join(dir, "SKILL.md");
    if (!existsSync(skillFile)) continue;
    const fm = parseFrontmatter(skillFile);
    out.push({
      name: fm.name ?? entry,
      description: fm.description ?? "",
      dir,
      skillFile,
      location: loc,
      protected: isProtected,
    });
  }
  return out;
}

function discover(): FoundSkill[] {
  const all: FoundSkill[] = [];
  all.push(...scanLocation(targetDir, false));
  for (const pd of protectedDirs) all.push(...scanLocation(pd, true));
  return all;
}

function findByName(name: string): FoundSkill[] {
  return discover().filter((s) => s.name === name || basename(s.dir) === name);
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "for", "to", "of", "in", "on", "with", "use",
  "when", "this", "that", "it", "is", "are", "be", "skill", "used", "using",
]);

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

/** Rank existing skills by keyword overlap with the supplied terms (dedup aid). */
function similar(terms: string): { skill: FoundSkill; score: number; shared: string[] }[] {
  const want = tokenize(terms);
  return discover()
    .map((skill) => {
      const have = tokenize(`${skill.name} ${skill.description}`);
      const shared = [...want].filter((w) => have.has(w));
      return { skill, score: shared.length, shared };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
}

/** Check candidate node_modules roots to see whether a helper package is installed. */
function isInstalled(pkg: string): boolean {
  const roots = [
    resolve(process.cwd(), ".pi/npm/node_modules"),
    resolve(process.cwd(), "node_modules"),
    resolve(homedir(), ".pi/npm/node_modules"),
    resolve(homedir(), ".bun/install/global/node_modules"),
  ];
  return roots.some((r) => existsSync(join(r, pkg)));
}

/** Effective integration state: enabled only if the flag is on AND the package is installed. */
function integrationStatus() {
  return (Object.keys(INTEGRATION_PACKAGES) as (keyof Integrations)[]).map((key) => {
    const pkg = INTEGRATION_PACKAGES[key];
    const wanted = config.integrations[key];
    const installed = isInstalled(pkg);
    return { key, pkg, wanted, installed, effective: wanted && installed };
  });
}

function validate(skillFile: string): string[] {
  const errors: string[] = [];
  const { name, description } = parseFrontmatter(skillFile);
  if (!name) {
    errors.push("missing 'name' in frontmatter");
  } else {
    if (name.length < 1 || name.length > 64) errors.push("name must be 1-64 chars");
    if (!/^[a-z0-9-]+$/.test(name)) errors.push("name must be lowercase a-z, 0-9, hyphens only");
    if (/^-|-$/.test(name)) errors.push("name must not start/end with a hyphen");
    if (/--/.test(name)) errors.push("name must not contain consecutive hyphens");
  }
  if (!description) {
    errors.push("missing 'description' in frontmatter (skill will NOT load)");
  } else if (description.length > 1024) {
    errors.push("description must be <= 1024 chars");
  }
  return errors;
}

/** SKILL.md body with frontmatter stripped. */
function skillBody(skillFile: string): string {
  const text = readFileSync(skillFile, "utf8");
  return text.replace(/^---\n[\s\S]*?\n---\n?/, "");
}

/** Split a body into blocks separated by blank lines. */
function splitBlocks(body: string): string[] {
  return body
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
}

function normalizeBlock(b: string): string {
  return b
    .split("\n")
    .map((l) => l.trim().replace(/\s+/g, " ").toLowerCase())
    .join("\n");
}

function blockLineCount(b: string): number {
  return b.split("\n").filter((l) => l.trim()).length;
}

/**
 * Find blocks that appear (normalized) in 2+ skills and are at least
 * `minDuplicateBlockLines` lines long — candidates to extract into a shared partial.
 */
function duplicateBlocks(minLines: number): { skills: string[]; preview: string; lines: number }[] {
  const map = new Map<string, { skills: Set<string>; preview: string; lines: number }>();
  for (const s of discover()) {
    for (const block of splitBlocks(skillBody(s.skillFile))) {
      const lines = blockLineCount(block);
      if (lines < minLines) continue;
      const key = normalizeBlock(block);
      const entry = map.get(key) ?? { skills: new Set<string>(), preview: block.split("\n")[0], lines };
      entry.skills.add(s.name);
      map.set(key, entry);
    }
  }
  return [...map.values()]
    .filter((e) => e.skills.size >= 2)
    .map((e) => ({ skills: [...e.skills], preview: e.preview, lines: e.lines }))
    .sort((a, b) => b.lines - a.lines);
}

function resolveSkillFile(pathArg: string): string {
  const p = resolve(process.cwd(), pathArg);
  if (existsSync(p) && statSync(p).isDirectory()) return join(p, "SKILL.md");
  return p;
}

const [, , cmd, arg, ...rest] = process.argv;

switch (cmd) {
  case "config": {
    console.log(JSON.stringify({ ...config, resolvedTarget: targetDir, resolvedProtected: protectedDirs }, null, 2));
    break;
  }

  case "list": {
    const skills = discover();
    if (skills.length === 0) {
      console.log("(no skills found)");
      break;
    }
    for (const s of skills) {
      console.log(`${s.protected ? "[protected]" : "[local]    "} ${s.name.padEnd(28)} ${s.dir}`);
    }
    break;
  }

  case "locate": {
    if (!arg) { console.error("usage: locate <name>"); process.exit(2); }
    const hits = findByName(arg);
    if (hits.length === 0) { console.log("not found"); break; }
    for (const h of hits) console.log(`${h.protected ? "protected" : "local"}\t${h.dir}`);
    break;
  }

  case "resolve": {
    if (!arg) { console.error("usage: resolve <name>"); process.exit(2); }
    const hits = findByName(arg);
    const local = hits.find((h) => !h.protected);
    const prot = hits.find((h) => h.protected);
    let action: string;
    let detail: string;
    if (local) {
      action = "update";
      detail = local.dir;
    } else if (prot) {
      action = config.allowProtectedWrites ? "update-protected" : "migrate";
      detail = config.allowProtectedWrites
        ? prot.dir
        : `${prot.dir}  ->  ${join(targetDir, basename(prot.dir))}`;
    } else {
      action = "create";
      detail = join(targetDir, arg);
    }
    console.log(JSON.stringify({ action, detail }, null, 2));
    break;
  }

  case "migrate": {
    if (!arg) { console.error("usage: migrate <name>"); process.exit(2); }
    const hits = findByName(arg);
    const prot = hits.find((h) => h.protected);
    if (!prot) { console.error(`no protected skill named '${arg}' to migrate`); process.exit(1); }
    if (hits.some((h) => !h.protected)) {
      console.error(`a local skill '${arg}' already exists in ${targetDir} — edit it instead`);
      process.exit(1);
    }
    const dest = join(targetDir, basename(prot.dir));
    mkdirSync(targetDir, { recursive: true });
    cpSync(prot.dir, dest, { recursive: true });
    console.log(`migrated ${prot.dir} -> ${dest}`);
    console.log("Protected original left untouched. Edit the local copy.");
    break;
  }

  case "validate": {
    if (!arg) { console.error("usage: validate <path>"); process.exit(2); }
    const skillFile = resolveSkillFile(arg);
    if (!existsSync(skillFile)) { console.error(`not found: ${skillFile}`); process.exit(1); }
    const errors = validate(skillFile);
    if (errors.length === 0) {
      console.log(`OK: ${skillFile}`);
    } else {
      console.error(`INVALID: ${skillFile}`);
      for (const e of errors) console.error(`  - ${e}`);
      process.exit(1);
    }
    break;
  }

  case "similar": {
    const terms = [arg, ...rest].filter(Boolean).join(" ");
    if (!terms) { console.error("usage: similar <terms...>"); process.exit(2); }
    const hits = similar(terms);
    if (hits.length === 0) { console.log("no overlapping skills — safe to create"); break; }
    console.log("Possible overlaps (prefer UPDATE over a near-duplicate):");
    for (const h of hits) {
      console.log(`  ${String(h.score).padStart(2)}  ${h.skill.name.padEnd(28)} [${h.shared.join(", ")}]`);
    }
    break;
  }

  case "audit": {
    const { maxBodyLines, sharedDir, minDuplicateBlockLines } = config.modularize;
    const target = arg && arg !== "all" ? arg : null;

    // Per-skill size + shared-link report.
    const skills = discover().filter((s) => !target || s.name === target || basename(s.dir) === target);
    if (target && skills.length === 0) { console.error(`skill not found: ${target}`); process.exit(1); }

    console.log(`Modularization audit (maxBodyLines=${maxBodyLines}, sharedDir=${sharedDir})\n`);
    for (const s of skills) {
      const body = skillBody(s.skillFile);
      const lines = body.split("\n").filter((l) => l.trim()).length;
      const linksShared = new RegExp(`${sharedDir}/`).test(body);
      const flags: string[] = [];
      if (lines > maxBodyLines) flags.push(`OVER by ${lines - maxBodyLines} -> split detail into references/`);
      if (linksShared) flags.push(`links ${sharedDir}/`);
      console.log(`  ${s.name.padEnd(28)} ${String(lines).padStart(4)} lines  ${flags.join("; ") || "ok"}`);
    }

    // Cross-skill duplicate blocks -> shared-partial candidates.
    const dups = duplicateBlocks(minDuplicateBlockLines).filter(
      (d) => !target || d.skills.includes(skills[0]?.name),
    );
    if (dups.length) {
      console.log(`\nShared-partial candidates (duplicate blocks ≥${minDuplicateBlockLines} lines in 2+ skills):`);
      for (const d of dups) {
        console.log(`  [${d.lines} lines] ${d.skills.join(", ")}`);
        console.log(`     “${d.preview.slice(0, 70)}…”  -> extract into ${sharedDir}/`);
      }
    } else {
      console.log(`\nNo cross-skill duplicate blocks ≥${minDuplicateBlockLines} lines.`);
    }
    break;
  }

  case "detect": {
    console.log("rpiv helper integrations:");
    for (const s of integrationStatus()) {
      const state = s.effective
        ? "ON"
        : s.wanted && !s.installed
          ? "flagged but NOT installed -> skipped"
          : !s.wanted && s.installed
            ? "installed but flag off"
            : "off";
      console.log(`  ${s.key.padEnd(20)} ${state.padEnd(38)} ${s.pkg}`);
    }
    break;
  }

  case "plan": {
    if (!arg) { console.error("usage: plan <name> [terms...]"); process.exit(2); }
    const hits = findByName(arg);
    const local = hits.find((h) => !h.protected);
    const prot = hits.find((h) => h.protected);
    let action: string;
    let detail: string;
    if (local) {
      action = "update"; detail = local.dir;
    } else if (prot) {
      action = config.allowProtectedWrites ? "update-protected" : "migrate";
      detail = config.allowProtectedWrites ? prot.dir : `${prot.dir} -> ${join(targetDir, basename(prot.dir))}`;
    } else {
      action = "create"; detail = join(targetDir, arg);
    }
    console.log(`DRY RUN — no files will be written\n`);
    console.log(`action:   ${action}`);
    console.log(`detail:   ${detail}`);
    if (config.features.dedup && action === "create") {
      const terms = [arg, ...rest].filter(Boolean).join(" ");
      const overlaps = similar(terms || arg);
      if (overlaps.length) {
        console.log(`\ndedup:    ${overlaps.length} possible overlap(s) — consider updating instead:`);
        for (const h of overlaps.slice(0, 5)) console.log(`            ${h.skill.name} [${h.shared.join(", ")}]`);
      } else {
        console.log(`\ndedup:    no overlaps found`);
      }
    }
    console.log(`\ncrossLink: ${config.features.crossLink ? "on (add see-also/next-step links)" : "off"}`);
    console.log(`integrations active:`);
    for (const s of integrationStatus()) console.log(`  - ${s.key}: ${s.effective ? "yes" : "no"}`);
    break;
  }

  default:
    console.log(`skillctl — learn-skill helper

Usage:
  bun skillctl.ts config              Print resolved config + paths
  bun skillctl.ts list                List discovered skills (protected vs local)
  bun skillctl.ts locate <name>       Show every location a skill name resolves to
  bun skillctl.ts resolve <name>      Decide write action: create | update | migrate
  bun skillctl.ts migrate <name>      Copy a protected skill into the local target
  bun skillctl.ts validate <path>     Validate a SKILL.md (or skill dir) frontmatter
  bun skillctl.ts similar <terms...>  Find skills overlapping given terms (dedup aid)
  bun skillctl.ts plan <name> [terms] Dry-run: action + dedup hints + active integrations
  bun skillctl.ts detect              Report which configured rpiv helpers are installed
  bun skillctl.ts audit [name|all]    Modularization audit: body size + shared-partial candidates
`);
    if (cmd && cmd !== "help") process.exit(2);
}
