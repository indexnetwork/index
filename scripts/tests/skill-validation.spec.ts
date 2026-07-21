import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const skillctl = resolve(import.meta.dir, "../../.pi/skills/learn-skill/scripts/skillctl.ts");
const tempDirs: string[] = [];

function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "skill-validation-"));
  tempDirs.push(dir);
  return dir;
}

function writeSkill(project: string, directory: string, frontmatter: string): void {
  const dir = join(project, ".pi/skills", directory);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\n${frontmatter}\n---\n\n# ${directory}\n`);
}

async function validate(project: string, args: string[]) {
  const process = Bun.spawn(["bun", skillctl, "validate", ...args], {
    cwd: project,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("skillctl validate", () => {
  it("parses multiline YAML and emits a stable sorted all-skills report", async () => {
    const project = makeProject();
    writeSkill(project, "run-zeta-task", "name: run-zeta-task\ndescription: >-\n  Run the zeta task when a fixture needs it.");
    writeSkill(project, "audit-alpha-data", "name: audit-alpha-data\ndescription: Audit alpha data when validating fixtures.");

    const result = await validate(project, ["all", "--json"]);

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      schemaVersion: 1,
      valid: true,
      skills: [
        {
          path: ".pi/skills/audit-alpha-data/SKILL.md",
          name: "audit-alpha-data",
          errors: [],
        },
        {
          path: ".pi/skills/run-zeta-task/SKILL.md",
          name: "run-zeta-task",
          errors: [],
        },
      ],
    });
  });

  it("reports YAML, naming, directory, description, and duplicate failures", async () => {
    const project = makeProject();
    writeSkill(project, "wrong-directory", "name: audit-data\ndescription: '   '");
    writeSkill(project, "audit-data", "name: audit-data\ndescription: Valid duplicate fixture.");
    writeSkill(project, "duplicate-copy", "name: audit-data\ndescription: Another duplicate fixture.");
    writeSkill(project, "opaque", "name: opaque\ndescription: Opaque fixture.");
    writeSkill(project, "broken-yaml", "name: [unterminated\ndescription: broken");

    const result = await validate(project, ["all", "--json"]);
    const report = JSON.parse(result.stdout) as {
      valid: boolean;
      skills: Array<{ path: string; errors: string[] }>;
    };

    expect(result.code).toBe(1);
    expect(report.valid).toBe(false);
    const errors = report.skills.flatMap((skill) => skill.errors);
    expect(errors).toContain("name must be unique among project-local skills");
    expect(errors).toContain("name must equal the parent directory name");
    expect(errors).toContain("description must be trimmed and nonempty");
    expect(errors).toContain("name must contain at least 2 hyphen-separated segments");
    expect(errors.some((error) => error.startsWith("name must start with an allowed imperative verb:"))).toBe(true);
    expect(errors.some((error) => error.startsWith("invalid YAML frontmatter:"))).toBe(true);
  });

  it("validates a single directory and reserves exit 2 for usage errors", async () => {
    const project = makeProject();
    writeSkill(project, "create-test-fixture", "name: create-test-fixture\ndescription: Create a deterministic test fixture.");

    const valid = await validate(project, [".pi/skills/create-test-fixture", "--json"]);
    expect(valid.code).toBe(0);
    expect(JSON.parse(valid.stdout).skills).toHaveLength(1);

    const usage = await validate(project, ["all", "--unknown"]);
    expect(usage.code).toBe(2);
    expect(usage.stderr).toContain("usage: validate <path|all> [--json]");
  });
});
