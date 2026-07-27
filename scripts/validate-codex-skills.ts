import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { parse } from "yaml";

const root = resolve(import.meta.dir, "..");
const skillsRoot = join(root, ".agents", "skills");
const failures: string[] = [];

function fail(path: string, message: string): void {
  failures.push(`${relative(root, path)}: ${message}`);
}

function parseFrontmatter(path: string): Record<string, unknown> | null {
  const text = readFileSync(path, "utf8");
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    fail(path, "missing YAML frontmatter");
    return null;
  }
  try {
    const value = parse(match[1]);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      fail(path, "frontmatter must be a mapping");
      return null;
    }
    return value as Record<string, unknown>;
  } catch (error) {
    fail(path, `invalid YAML frontmatter: ${String(error)}`);
    return null;
  }
}

function validateReferences(skillFile: string): void {
  const text = readFileSync(skillFile, "utf8");
  for (const match of text.matchAll(/\]\(([^)]+\.md)\)/g)) {
    const reference = match[1];
    if (/^[a-z]+:\/\//i.test(reference)) continue;
    const target = resolve(dirname(skillFile), reference);
    if (!existsSync(target)) fail(skillFile, `missing Markdown reference ${reference}`);
  }
  for (const match of text.matchAll(/`((?:references\/|\.\.\/_shared\/)[a-zA-Z0-9._/-]+\.md)`/g)) {
    const reference = match[1];
    const target = resolve(dirname(skillFile), reference);
    if (!existsSync(target)) fail(skillFile, `missing workflow reference ${reference}`);
  }
}

function skillDirectories() {
  return readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
    .sort((a, b) => a.name.localeCompare(b.name));
}

if (!existsSync(skillsRoot)) {
  fail(skillsRoot, "directory does not exist");
} else {
  const entries = skillDirectories();
  const seen = new Set<string>();

  for (const entry of entries) {
    const skillDir = join(skillsRoot, entry.name);
    const skillFile = join(skillDir, "SKILL.md");
    const metadataFile = join(skillDir, "agents", "openai.yaml");

    if (!existsSync(skillFile) || !statSync(skillFile).isFile()) {
      fail(skillDir, "SKILL.md not found");
      continue;
    }

    const frontmatter = parseFrontmatter(skillFile);
    const name = frontmatter?.name;
    const description = frontmatter?.description;
    if (typeof name !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
      fail(skillFile, "name must use lowercase letters, digits, and single hyphens");
    } else {
      if (name !== basename(skillDir)) fail(skillFile, "name must match its directory");
      if (seen.has(name)) fail(skillFile, `duplicate skill name ${name}`);
      seen.add(name);
    }
    if (typeof description !== "string" || description.trim() !== description || !description) {
      fail(skillFile, "description must be a nonempty trimmed string");
    }
    if (frontmatter && Object.keys(frontmatter).some((key) => key !== "name" && key !== "description")) {
      fail(skillFile, "frontmatter may contain only name and description");
    }

    if (!existsSync(metadataFile)) {
      fail(skillDir, "agents/openai.yaml not found");
    } else {
      try {
        const metadata = parse(readFileSync(metadataFile, "utf8")) as {
          interface?: Record<string, unknown>;
        };
        for (const key of ["display_name", "short_description", "default_prompt"]) {
          if (typeof metadata?.interface?.[key] !== "string" || !metadata.interface[key]) {
            fail(metadataFile, `interface.${key} must be a nonempty string`);
          }
        }
      } catch (error) {
        fail(metadataFile, `invalid YAML: ${String(error)}`);
      }
    }

    validateReferences(skillFile);
  }
}

if (failures.length) {
  for (const failure of failures.sort()) console.error(failure);
  process.exit(1);
}

console.log(`Validated ${skillDirectories().length} Codex skills.`);
