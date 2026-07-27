import { afterEach, describe, expect, it } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const skillctl = resolve(import.meta.dir, "../../.agents/skills/learn-skill/scripts/skillctl.ts");
const tempDirs: string[] = [];

function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "skill-validation-"));
  tempDirs.push(dir);
  return dir;
}

function writeSkill(project: string, directory: string, frontmatter: string): void {
  const dir = join(project, ".agents/skills", directory);
  mkdirSync(join(dir, "agents"), { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\n${frontmatter}\n---\n\n# ${directory}\n`);
  writeFileSync(
    join(dir, "agents/openai.yaml"),
    `interface:\n  display_name: "${directory}"\n  short_description: "Test workflow for ${directory}"\n  default_prompt: "Use $${directory} for this test workflow."\n`,
  );
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
    const sharedDir = join(project, ".agents/skills/_shared");
    mkdirSync(sharedDir, { recursive: true });
    writeFileSync(join(sharedDir, "release.md"), "# Shared release workflow\n");
    appendFileSync(
      join(project, ".agents/skills/run-zeta-task/SKILL.md"),
      "\nFollow `../_shared/release.md`. Generic examples like `references/*.md` are not concrete links.\n",
    );

    const result = await validate(project, ["all", "--json"]);

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      schemaVersion: 1,
      valid: true,
      skills: [
        {
          path: ".agents/skills/audit-alpha-data/SKILL.md",
          name: "audit-alpha-data",
          errors: [],
        },
        {
          path: ".agents/skills/run-zeta-task/SKILL.md",
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

  it("requires metadata, valid references, and a SKILL.md in every skill directory", async () => {
    const project = makeProject();
    writeSkill(project, "run-missing-metadata", "name: run-missing-metadata\ndescription: Run a fixture without metadata.");
    rmSync(join(project, ".agents/skills/run-missing-metadata/agents/openai.yaml"));

    writeSkill(project, "review-broken-reference", "name: review-broken-reference\ndescription: Review a fixture with a broken reference.");
    writeFileSync(
      join(project, ".agents/skills/review-broken-reference/SKILL.md"),
      "---\nname: review-broken-reference\ndescription: Review a fixture with a broken reference.\n---\n\n[Missing](references/missing.md)\n",
    );

    mkdirSync(join(project, ".agents/skills/audit-empty-directory"), { recursive: true });

    const result = await validate(project, ["all", "--json"]);
    const report = JSON.parse(result.stdout) as {
      valid: boolean;
      skills: Array<{ path: string; name: string | null; errors: string[] }>;
    };

    expect(result.code).toBe(1);
    expect(report.valid).toBe(false);
    expect(report.skills).toEqual([
      {
        path: ".agents/skills/audit-empty-directory/SKILL.md",
        name: null,
        errors: ["SKILL.md not found"],
      },
      {
        path: ".agents/skills/review-broken-reference/SKILL.md",
        name: "review-broken-reference",
        errors: ["missing Markdown reference references/missing.md"],
      },
      {
        path: ".agents/skills/run-missing-metadata/SKILL.md",
        name: "run-missing-metadata",
        errors: ["agents/openai.yaml not found"],
      },
    ]);
  });

  it("reports direct-file skills without recursively treating references as skills", async () => {
    const project = makeProject();
    writeSkill(project, "create-test-fixture", "name: create-test-fixture\ndescription: Create a deterministic test fixture.");
    const skillRoot = join(project, ".agents/skills");
    writeFileSync(
      join(skillRoot, "run-direct-helper.md"),
      "---\nname: run-direct-helper\ndescription: Run a direct-file helper fixture.\n---\n",
    );
    const references = join(skillRoot, "create-test-fixture", "references");
    mkdirSync(references, { recursive: true });
    writeFileSync(join(references, "SKILL.md"), "not valid frontmatter and not a skill");

    const result = await validate(project, ["all", "--json"]);
    const report = JSON.parse(result.stdout) as {
      valid: boolean;
      skills: Array<{ path: string; name: string | null; errors: string[] }>;
    };

    expect(result.code).toBe(1);
    expect(report.valid).toBe(false);
    expect(report.skills.map((skill) => skill.path)).toEqual([
      ".agents/skills/create-test-fixture/SKILL.md",
      ".agents/skills/run-direct-helper.md",
    ]);
    expect(report.skills[0].errors).toEqual([]);
    expect(report.skills[1]).toEqual({
      path: ".agents/skills/run-direct-helper.md",
      name: "run-direct-helper",
      errors: ["direct-file skills are not allowed; move this skill to .agents/skills/<name>/SKILL.md"],
    });
  });

  it("validates a single directory and reserves exit 2 for usage errors", async () => {
    const project = makeProject();
    writeSkill(project, "create-test-fixture", "name: create-test-fixture\ndescription: Create a deterministic test fixture.");

    const valid = await validate(project, [".agents/skills/create-test-fixture", "--json"]);
    expect(valid.code).toBe(0);
    expect(JSON.parse(valid.stdout).skills).toHaveLength(1);

    const usage = await validate(project, ["all", "--unknown"]);
    expect(usage.code).toBe(2);
    expect(usage.stderr).toContain("usage: validate <path|all> [--json]");
  });
});
