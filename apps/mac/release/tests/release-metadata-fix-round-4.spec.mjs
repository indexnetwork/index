import { afterEach, expect, test } from "bun:test";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const repo = resolve(import.meta.dir, "../../../..");
const release = resolve(import.meta.dir, "..");
const generator = join(release, "generate-release-metadata.ts");
const schemaPath = join(release, "release-metadata.schema.json");
const commit = "8e676b6b143ca7339d5e7ee3391faebc2fb8f69b";
const roots = [];
afterEach(() => roots.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));
function run(argv) { return Bun.spawnSync(argv, { cwd: repo, stdout: "pipe", stderr: "pipe" }); }
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "metadata-r4-")); roots.push(root);
  const final = join(root, "final"); mkdirSync(final);
  ["Index-macOS-1.0.0-universal.dmg", "IndexConnector-1.0.0-universal.dmg"].forEach((name, index) => {
    const artifact = join(final, name); writeFileSync(artifact, index ? "connector" : "app");
    const digest = Bun.SHA256.hash(readFileSync(artifact), "hex");
    writeFileSync(`${artifact}.reproducibility.txt`, `macOS.actual=13.6.9\nmacOS.expected=13.6.9\nbuild.actual=22G830\nbuild.expected=22G830\nrunner.actual=macos-13:1\nrunner.expected=macos-13:1\nartifact.sha256=${"a".repeat(64)}\nfinalArtifact.sha256=${digest}\n`);
  });
  return { root, final };
}
function copiedRelease({ mutateSchema = () => {}, transformSchema = (text) => text, transformGenerator = (text) => text } = {}) {
  const fx = fixture(); const copy = join(fx.root, "release"); const output = join(fx.root, "output"); mkdirSync(copy); mkdirSync(output, { mode: 0o700 });
  writeFileSync(join(copy, basename(generator)), transformGenerator(readFileSync(generator, "utf8")));
  const schema = JSON.parse(readFileSync(schemaPath, "utf8")); mutateSchema(schema);
  writeFileSync(join(copy, basename(schemaPath)), transformSchema(JSON.stringify(schema)));
  return { ...fx, copy, output, copiedGenerator: join(copy, basename(generator)) };
}
function evaluateMutation(mutateSchema) {
  const fx = copiedRelease({ mutateSchema });
  return run(["bun", fx.copiedGenerator, fx.final, fx.output, "7", commit]);
}

const nonSchemaReferences = [
  ["properties container", "#/properties"],
  ["$defs container", "#/$defs"],
  ["array container", "#/properties/artifacts/prefixItems"],
];
test("local refs resolve only to marked schema nodes and ref evaluation cycles are refused", () => {
  for (const [label, reference] of nonSchemaReferences) {
    const result = evaluateMutation((schema) => { schema.properties.buildNumber.$ref = reference; });
    expect(result.exitCode, label).not.toBe(0);
  }
  const cycle = evaluateMutation((schema) => { schema.$defs.artifact.$ref = "#/$defs/artifact"; });
  expect(cycle.exitCode).not.toBe(0);
  expect(cycle.stderr.toString()).toContain("cycle");
  const committed = evaluateMutation(() => {});
  expect(committed.exitCode).toBe(0);
});

const inapplicableKeywords = [
  ["pattern without type", (schema) => { delete schema.properties.buildNumber.type; }],
  ["pattern on integer", (schema) => { schema.properties.schemaVersion.type = "integer"; schema.properties.schemaVersion.pattern = "^1$"; }],
  ["array keyword without type", (schema) => { delete schema.properties.architectures.type; }],
  ["array keyword on string", (schema) => { schema.properties.buildNumber.minItems = 1; }],
  ["object keyword without type", (schema) => { delete schema.type; }],
  ["object keyword on string", (schema) => { schema.properties.buildNumber.required = []; }],
  ["minimum without type", (schema) => { delete schema.$defs.artifact.properties.size.type; }],
  ["minimum on string", (schema) => { schema.properties.releaseVersion.type = "string"; schema.properties.releaseVersion.minimum = 0; }],
];
test("supported constraint keywords require their applicable explicit type", () => {
  for (const [label, mutate] of inapplicableKeywords) expect(evaluateMutation(mutate).exitCode, label).not.toBe(0);
});

test("JSON numeric equality rejects signed-zero enum duplicates", () => {
  const fx = copiedRelease({
    mutateSchema(schema) { delete schema.properties.connectorProtocolVersion.const; schema.properties.connectorProtocolVersion.enum = [0, 1]; },
    transformSchema(text) { return text.replace('"enum":[0,1]', '"enum":[0,-0]'); },
    transformGenerator(text) { return text.replace("connectorProtocolVersion: 1", "connectorProtocolVersion: -0"); },
  });
  const result = run(["bun", fx.copiedGenerator, fx.final, fx.output, "7", commit]);
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr.toString()).toContain("duplicate enum");
});

test("schema const treats parsed -0 as JSON-equal to 0 while canonical bytes remain normalized", () => {
  const fx = copiedRelease({
    mutateSchema(schema) { schema.properties.connectorProtocolVersion.const = 0; },
    transformGenerator(text) { return text.replace("connectorProtocolVersion: 1", "connectorProtocolVersion: -0"); },
  });
  const generated = run(["bun", fx.copiedGenerator, fx.final, fx.output, "7", commit]);
  expect(generated.exitCode).toBe(0);
  const metadataPath = join(fx.output, "macos-release.json");
  const canonicalBytes = readFileSync(metadataPath, "utf8");
  expect(canonicalBytes).toContain('"connectorProtocolVersion":0');
  writeFileSync(metadataPath, canonicalBytes.replace('"connectorProtocolVersion":0', '"connectorProtocolVersion":-0'));
  const verified = run(["bun", fx.copiedGenerator, "--verify", fx.final, fx.output, "7", commit]);
  expect(verified.exitCode).not.toBe(0);
  expect(verified.stderr.toString()).toContain("metadata JSON bytes are not canonical");
  expect(verified.stderr.toString()).not.toContain("violates schema const");
});
