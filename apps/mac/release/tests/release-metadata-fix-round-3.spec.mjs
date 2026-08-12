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
  const root = mkdtempSync(join(tmpdir(), "metadata-r3-")); roots.push(root); const final = join(root, "final"); mkdirSync(final); const names = ["Index-macOS-1.0.0-universal.dmg", "IndexConnector-1.0.0-universal.dmg"];
  names.forEach((name, index) => { const artifact = join(final, name); writeFileSync(artifact, index ? "connector" : "app"); const digest = Bun.SHA256.hash(readFileSync(artifact), "hex"); writeFileSync(`${artifact}.reproducibility.txt`, `macOS.actual=13.6.9\nmacOS.expected=13.6.9\nbuild.actual=22G830\nbuild.expected=22G830\nrunner.actual=macos-13:1\nrunner.expected=macos-13:1\nartifact.sha256=${"a".repeat(64)}\nfinalArtifact.sha256=${digest}\n`); });
  return { root, final };
}
function evaluateMutation(mutate) {
  const fx = fixture(); const copy = join(fx.root, "release"); const output = join(fx.root, "output"); mkdirSync(copy); mkdirSync(output, { mode: 0o700 }); cpSync(generator, join(copy, basename(generator))); const schema = JSON.parse(readFileSync(schemaPath, "utf8")); mutate(schema); writeFileSync(join(copy, basename(schemaPath)), JSON.stringify(schema)); return run(["bun", join(copy, basename(generator)), fx.final, output, "7", commit]);
}

const malformed = [
  ["minItems negative", (schema) => { schema.properties.artifacts.minItems = -1; }],
  ["minItems fractional", (schema) => { schema.properties.artifacts.minItems = 1.5; }],
  ["minItems string NaN analogue", (schema) => { schema.properties.artifacts.minItems = "NaN"; }],
  ["maxItems negative", (schema) => { schema.properties.artifacts.maxItems = -1; }],
  ["maxItems fractional", (schema) => { schema.properties.artifacts.maxItems = 2.5; }],
  ["minItems exceeds maxItems", (schema) => { schema.properties.artifacts.minItems = 3; schema.properties.artifacts.maxItems = 2; }],
  ["minimum string", (schema) => { schema.$defs.artifact.properties.size.minimum = "1"; }],
  ["required duplicate", (schema) => { schema.required.push(schema.required[0]); }],
  ["required non-string", (schema) => { schema.required.push(7); }],
  ["enum duplicate", (schema) => { schema.$defs.artifact.properties.kind.enum.push("app-dmg"); }],
  ["enum not array", (schema) => { schema.$defs.artifact.properties.kind.enum = "app-dmg"; }],
  ["type array unsupported", (schema) => { schema.type = ["object", "null"]; }],
  ["type unknown", (schema) => { schema.type = "number"; }],
  ["invalid pattern", (schema) => { schema.properties.buildNumber.pattern = "["; }],
  ["additionalProperties malformed number", (schema) => { schema.additionalProperties = 7; }],
  ["additionalProperties boolean schema rejected explicitly", (schema) => { schema.additionalProperties = true; schema.properties.extra = true; }],
  ["properties array", (schema) => { schema.properties = []; }],
  ["defs array", (schema) => { schema.$defs = []; }],
  ["prefixItems contains boolean schema", (schema) => { schema.properties.architectures.prefixItems[0] = true; }],
  ["allOf contains boolean schema", (schema) => { schema.properties.artifacts.prefixItems[0].allOf[0] = true; }],
  ["items malformed number", (schema) => { schema.properties.artifacts.items = 7; }],
  ["items boolean schema rejected explicitly", (schema) => { schema.properties.artifacts.items = true; schema.properties.artifacts.prefixItems = []; }],
  ["boolean root schema unsupported", (schema) => { Object.keys(schema).forEach((key) => delete schema[key]); schema.any = true; }],
  ["remote ref", (schema) => { schema.properties.buildNumber.$ref = "https://example.invalid/schema"; }],
  ["missing local ref", (schema) => { schema.properties.buildNumber.$ref = "#/$defs/missing"; }],
  ["malformed local ref", (schema) => { schema.properties.buildNumber.$ref = "#"; }],
];

test("closed schema vocabulary rejects every malformed supported keyword shape", () => {
  for (const [label, mutate] of malformed) expect(evaluateMutation(mutate).exitCode, label).not.toBe(0);
});

test("committed schema still validates and generates the exact release contract", () => {
  const fx = fixture(); const output = join(fx.root, "output"); mkdirSync(output, { mode: 0o700 }); const result = run(["bun", generator, fx.final, output, "7", commit]); expect(result.exitCode).toBe(0); expect(JSON.parse(readFileSync(join(output, "macos-release.json"), "utf8")).releaseVersion).toBe("1.0.0");
});
