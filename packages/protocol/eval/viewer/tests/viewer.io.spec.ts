import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseViewerCliArguments, runViewerCli } from "../viewer.eval.js";
import { publishViewerHtml } from "../viewer.io.js";
import { makeAttemptAwareV2RunReport, SHARED_HARNESSES, V2_ERROR_SENTINEL } from "./viewer.fixtures.js";

const digest = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

async function freshDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "eval-viewer-"));
}

const NETWORK_CONSTRUCTS = [
  /<script\s+[^>]*src=/i,
  /<link\s+[^>]*href=/i,
  /https?:\/\//i,
  /\bfetch\s*\(/,
  /XMLHttpRequest/,
  /WebSocket/,
  /sendBeacon/,
  /EventSource/,
];

describe("viewer CLI arguments", () => {
  it("accepts the strict supported grammar", () => {
    expect(parseViewerCliArguments(["--input", "run.json", "--out", "view.html"])).toEqual({
      input: "run.json",
      out: "view.html",
      force: false,
      help: false,
    });
    expect(parseViewerCliArguments(["--help"])).toEqual({ force: false, help: true });
  });

  it("rejects unknown, duplicate, positional, and missing options", () => {
    expect(() => parseViewerCliArguments(["--input", "a", "--input", "b", "--out", "c"])).toThrow(/only once/);
    expect(() => parseViewerCliArguments(["--input", "a", "--out"])).toThrow(/requires a value/);
    expect(() => parseViewerCliArguments(["artifact.json"])).toThrow(/positional/);
    expect(() => parseViewerCliArguments(["--unsafe", "yes"])).toThrow(/Unknown option/);
    expect(() => parseViewerCliArguments(["--input", "a"])).toThrow(/--out/);
  });
});

describe("atomic viewer output", () => {
  it("publishes no-clobber by default and atomically replaces only with force", async () => {
    const dir = await freshDir();
    const output = join(dir, "nested", "viewer.html");
    await publishViewerHtml(output, "first");
    await expect(publishViewerHtml(output, "second")).rejects.toThrow();
    expect(await readFile(output, "utf8")).toBe("first");
    await publishViewerHtml(output, "second", { force: true });
    expect(await readFile(output, "utf8")).toBe("second");
    expect((await readdir(join(dir, "nested"))).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    await rm(dir, { recursive: true, force: true });
  });
});

describe("read-only provider-free viewer generation", () => {
  it("renders all four committed baselines deterministically without changing source bytes", async () => {
    const dir = await freshDir();
    for (const harness of SHARED_HARNESSES) {
      const input = fileURLToPath(new URL(`../../${harness}/baselines/${harness}.baseline.json`, import.meta.url));
      const before = await readFile(input);
      const firstOutput = join(dir, `${harness}.first.html`);
      const secondOutput = join(dir, `${harness}.second.html`);
      expect(await runViewerCli(["--input", input, "--out", firstOutput], { stdout: () => {}, stderr: () => {} })).toBe(0);
      expect(await runViewerCli(["--input", input, "--out", secondOutput], { stdout: () => {}, stderr: () => {} })).toBe(0);
      const firstHtml = await readFile(firstOutput, "utf8");
      const secondHtml = await readFile(secondOutput, "utf8");
      const after = await readFile(input);

      expect(firstHtml).toBe(secondHtml);
      expect(digest(after)).toBe(digest(before));
      expect(after.equals(before)).toBe(true);
      for (const construct of NETWORK_CONSTRUCTS) expect(firstHtml).not.toMatch(construct);
      expect(firstHtml).toContain("Execution retry/attempt telemetry was not recorded");
    }
    await rm(dir, { recursive: true, force: true });
  });

  it("keeps both input and baseline byte-identical while rendering deltas", async () => {
    const dir = await freshDir();
    const baselinePath = join(dir, "baseline.json");
    const runPath = join(dir, "run.json");
    const outputPath = join(dir, "viewer.html");
    const sourceBaseline = await readFile(
      fileURLToPath(new URL("../../matching/baselines/matching.baseline.json", import.meta.url)),
    );
    const run = JSON.parse(sourceBaseline.toString("utf8")) as Record<string, unknown>;
    run.artifactType = "index-eval/run-report";
    run.corpusFingerprint = "c".repeat(64);
    await writeFile(baselinePath, sourceBaseline);
    await writeFile(runPath, JSON.stringify(run, null, 2) + "\n");
    const baselineBefore = await readFile(baselinePath);
    const runBefore = await readFile(runPath);

    expect(await runViewerCli([
      "--input", runPath,
      "--baseline", baselinePath,
      "--out", outputPath,
    ], { stdout: () => {}, stderr: () => {} })).toBe(0);

    expect((await readFile(baselinePath)).equals(baselineBefore)).toBe(true);
    expect((await readFile(runPath)).equals(runBefore)).toBe(true);
    const html = await readFile(outputPath, "utf8");
    expect(html).toContain("Baseline comparison");
    expect(html).toContain("legacy-baseline-unverified");
    expect(html).toContain("Descriptive only");
    await rm(dir, { recursive: true, force: true });
  });

  it("renders v2 attempt evidence without exposing error text and refuses incomplete comparison", async () => {
    const dir = await freshDir();
    const input = join(dir, "attempt-report.json");
    const output = join(dir, "attempt-viewer.html");
    const artifact = makeAttemptAwareV2RunReport();
    await writeFile(input, JSON.stringify(artifact, null, 2) + "\n");
    const before = await readFile(input);

    expect(await runViewerCli(["--input", input, "--out", output], {
      stdout: () => {}, stderr: () => {},
    })).toBe(0);
    const html = await readFile(output, "utf8");
    expect((await readFile(input)).equals(before)).toBe(true);
    expect(html).toContain("attempt-partial::run:2::attempt:2");
    expect(html).not.toContain(V2_ERROR_SENTINEL);
    for (const construct of NETWORK_CONSTRUCTS) expect(html).not.toMatch(construct);

    const baseline = fileURLToPath(new URL("../../matching/baselines/matching.baseline.json", import.meta.url));
    const comparisonFailure = join(dir, "incomplete-comparison.html");
    expect(await runViewerCli([
      "--input", input,
      "--baseline", baseline,
      "--out", comparisonFailure,
    ], { stdout: () => {}, stderr: () => {} })).toBe(2);
    expect(await readFile(comparisonFailure, "utf8")).toContain("Incompatible baseline");
    await rm(dir, { recursive: true, force: true });
  });

  it("attributes an incompatible-baseline failure to the baseline bytes", async () => {
    const dir = await freshDir();
    const runPath = join(dir, "run.json");
    const baselinePath = join(dir, "broken-baseline.json");
    const outputPath = join(dir, "failure.html");
    const source = await readFile(
      fileURLToPath(new URL("../../matching/baselines/matching.baseline.json", import.meta.url)),
    );
    const run = JSON.parse(source.toString("utf8")) as Record<string, unknown>;
    run.artifactType = "index-eval/run-report";
    run.corpusFingerprint = "c".repeat(64);
    const baselineBytes = Buffer.from('{"baseline":"BROKEN_BASELINE_SENTINEL"');
    await writeFile(runPath, JSON.stringify(run));
    await writeFile(baselinePath, baselineBytes);

    expect(await runViewerCli([
      "--input", runPath,
      "--baseline", baselinePath,
      "--out", outputPath,
    ], { stdout: () => {}, stderr: () => {} })).toBe(2);
    const html = await readFile(outputPath, "utf8");
    expect(html).toContain(digest(baselineBytes));
    expect(html).not.toContain(digest(await readFile(runPath)));
    expect(html).not.toContain("BROKEN_BASELINE_SENTINEL");
    await rm(dir, { recursive: true, force: true });
  });

  it("writes a visibly safe failure for malformed, invalid UTF-8, and prohibited artifacts", async () => {
    const dir = await freshDir();
    const fixtures: Array<{ name: string; bytes: Uint8Array; sentinel: string }> = [
      {
        name: "malformed",
        bytes: Buffer.from('{"artifactType":"index-eval/baseline","private":"MALFORMED_SECRET_SENTINEL"'),
        sentinel: "MALFORMED_SECRET_SENTINEL",
      },
      {
        name: "utf8",
        bytes: Uint8Array.from([0xff, 0xfe, 0x53, 0x45, 0x43, 0x52, 0x45, 0x54]),
        sentinel: "SECRET",
      },
      {
        name: "private",
        bytes: Buffer.from(JSON.stringify({
          artifactType: "hyde-blind-private-key",
          hmacSecret: "PRIVATE_KEY_SENTINEL",
          mappings: ["PRIVATE_MAPPING_SENTINEL"],
        })),
        sentinel: "PRIVATE_KEY_SENTINEL",
      },
    ];

    for (const fixture of fixtures) {
      const input = join(dir, `${fixture.name}.json`);
      const output = join(dir, `${fixture.name}.html`);
      await writeFile(input, fixture.bytes);
      const before = await readFile(input);
      expect(await runViewerCli(["--input", input, "--out", output], { stdout: () => {}, stderr: () => {} })).toBe(2);
      const html = await readFile(output, "utf8");
      expect((await readFile(input)).equals(before)).toBe(true);
      expect(html).toContain("The viewer stopped without rendering any artifact content");
      expect(html).not.toContain(fixture.sentinel);
      expect(html).not.toContain("PRIVATE_MAPPING_SENTINEL");
      expect(html).not.toContain("hyde-blind-private-key");
      expect(html).not.toContain("<script");
    }
    await rm(dir, { recursive: true, force: true });
  });

  it("refuses input/output collisions even with force", async () => {
    const dir = await freshDir();
    const artifactPath = join(dir, "artifact.json");
    const source = await readFile(
      fileURLToPath(new URL("../../profile/baselines/profile.baseline.json", import.meta.url)),
    );
    await writeFile(artifactPath, source);
    const before = await readFile(artifactPath);
    const errors: string[] = [];
    const exitCode = await runViewerCli(
      ["--input", artifactPath, "--out", artifactPath, "--force"],
      { stdout: () => {}, stderr: (text) => errors.push(text) },
    );
    expect(exitCode).toBe(1);
    expect(errors.join("\n")).toContain("would overwrite an input artifact");
    expect((await readFile(artifactPath)).equals(before)).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });

  it("refuses symlink-aliased input/output collisions even with force", async () => {
    const dir = await freshDir();
    const realDirectory = join(dir, "real");
    const aliasDirectory = join(dir, "alias");
    await mkdir(realDirectory);
    await symlink(realDirectory, aliasDirectory, "dir");
    const input = join(realDirectory, "artifact.json");
    const aliasedOutput = join(aliasDirectory, "artifact.json");
    const source = await readFile(
      fileURLToPath(new URL("../../premise/baselines/premise.baseline.json", import.meta.url)),
    );
    await writeFile(input, source);
    const before = await readFile(input);
    const errors: string[] = [];

    expect(await runViewerCli(
      ["--input", input, "--out", aliasedOutput, "--force"],
      { stdout: () => {}, stderr: (text) => errors.push(text) },
    )).toBe(1);
    expect(errors.join("\n")).toContain("would overwrite an input artifact");
    expect((await readFile(input)).equals(before)).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });
});
