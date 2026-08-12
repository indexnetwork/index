#!/usr/bin/env bun
import { chmodSync, closeSync, constants, fstatSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const RELEASE_DIRECTORY = realpathSync(import.meta.dir);
const SCHEMA_PATH = join(RELEASE_DIRECTORY, "release-metadata.schema.json");
const VERSION = "1.0.0";
const RELEASE_BASE_URL = `https://github.com/indexnetwork/index/releases/download/v${VERSION}`;
const ARTIFACTS = [
  { kind: "app-dmg", name: "Index-macOS-1.0.0-universal.dmg" },
  { kind: "connector-dmg", name: "IndexConnector-1.0.0-universal.dmg" },
] as const;
const EVIDENCE_KEYS = [
  "macOS.actual", "macOS.expected", "build.actual", "build.expected",
  "runner.actual", "runner.expected", "artifact.sha256", "finalArtifact.sha256",
];
const FORBIDDEN = /key|token|credential|notary|password|secret|identity/i;

type Artifact = { kind: "app-dmg" | "connector-dmg"; name: string; sha256: string; size: number; url: string };
type Metadata = {
  apiUrl: string; architectures: string[]; artifacts: Artifact[]; buildNumber: string; commit: string;
  connectorProtocolVersion: number; minimumMacOS: string; releaseVersion: string; schemaVersion: number;
  teamId: string; webUrl: string;
};
type FileSnapshot = { bytes: Buffer; device: number; inode: number; size: number };
type Schema = Record<string, unknown>;

function refuse(message: string): never { throw new Error(`release metadata refused: ${message}`); }
function sameIdentity(left: { dev: number; ino: number }, right: { dev: number; ino: number }): boolean { return left.dev === right.dev && left.ino === right.ino; }
function canonicalExistingDirectory(path: string, label: string): string {
  const absolute = resolve(path); let physical: string;
  try { physical = realpathSync(absolute); } catch { refuse(`${label} does not exist`); }
  if (physical !== absolute) refuse(`${label} cannot contain symlink aliases`);
  const details = lstatSync(physical);
  if (!details.isDirectory() || details.isSymbolicLink()) refuse(`${label} must be a physical directory`);
  return physical;
}
function readStableFile(path: string, label: string): FileSnapshot {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.size < 0) refuse(`${label} must be a regular file`);
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    if (!sameIdentity(before, after) || before.size !== after.size || bytes.byteLength !== before.size) refuse(`${label} changed while being read`);
    const pathDetails = lstatSync(path);
    if (!sameIdentity(before, pathDetails) || pathDetails.isSymbolicLink()) refuse(`${label} path changed while being read`);
    return { bytes, device: before.dev, inode: before.ino, size: before.size };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("release metadata refused:")) throw error;
    refuse(`${label} cannot be opened safely`);
  } finally { if (descriptor !== undefined) closeSync(descriptor); }
}
function digest(bytes: Uint8Array): string { return new Bun.CryptoHasher("sha256").update(bytes).digest("hex"); }
function parseEvidence(bytes: Buffer, artifactDigest: string): void {
  const text = bytes.toString("utf8");
  if (FORBIDDEN.test(text)) refuse("reproducibility evidence contains a credential-like field");
  const values = new Map<string, string>();
  for (const line of text.split("\n")) {
    if (!line) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) refuse("reproducibility evidence is malformed");
    const key = line.slice(0, separator); const value = line.slice(separator + 1);
    if (!EVIDENCE_KEYS.includes(key) || values.has(key) || !value) refuse("reproducibility evidence has unapproved, duplicate, or empty fields");
    values.set(key, value);
  }
  if (values.size !== EVIDENCE_KEYS.length) refuse("reproducibility evidence is incomplete");
  for (const field of ["macOS", "build", "runner"]) if (values.get(`${field}.actual`) !== values.get(`${field}.expected`)) refuse(`${field} provenance does not match its reviewed pin`);
  for (const field of ["artifact.sha256", "finalArtifact.sha256"]) if (!/^[0-9a-f]{64}$/.test(values.get(field) ?? "")) refuse(`${field} is not a SHA-256`);
  if (values.get("finalArtifact.sha256") !== artifactDigest) refuse("finalArtifact.sha256 does not match final DMG bytes");
}
function canonical(value: unknown): string { return `${JSON.stringify(value)}\n`; }
function loadArtifact(finalDirectory: string, approved: (typeof ARTIFACTS)[number]): Artifact {
  const path = join(finalDirectory, approved.name); const artifact = readStableFile(path, approved.name);
  if (artifact.size <= 0) refuse(`${approved.name} is empty`);
  const sha256 = digest(artifact.bytes); const evidence = readStableFile(`${path}.reproducibility.txt`, `${approved.name} reproducibility evidence`);
  parseEvidence(evidence.bytes, sha256);
  return { kind: approved.kind, name: approved.name, sha256, size: artifact.size, url: `${RELEASE_BASE_URL}/${approved.name}` };
}
function buildMetadata(finalDirectory: string, buildNumber: string, commit: string): Metadata {
  if (!/^[1-9][0-9]*$/.test(buildNumber)) refuse("build number must be a positive canonical decimal");
  if (!/^[0-9a-f]{40}$/.test(commit)) refuse("commit must be a full lowercase 40-hex Git commit");
  return {
    apiUrl: "https://protocol.index.network", architectures: ["arm64", "x86_64"],
    artifacts: ARTIFACTS.map((approved) => loadArtifact(finalDirectory, approved)), buildNumber, commit,
    connectorProtocolVersion: 1, minimumMacOS: "13.0", releaseVersion: VERSION, schemaVersion: 1,
    teamId: "LMQ3XNXLAD", webUrl: "https://index.network",
  };
}
function schemaObject(value: unknown, label: string): Schema { if (!value || typeof value !== "object" || Array.isArray(value)) refuse(`${label} must be an object`); return value as Schema; }
function resolveSchemaReference(root: Schema, reference: string): Schema {
  if (!reference.startsWith("#/")) refuse("schema uses a non-local reference");
  let value: unknown = root;
  for (const token of reference.slice(2).split("/")) value = schemaObject(value, "schema reference")[token.replaceAll("~1", "/").replaceAll("~0", "~")];
  return schemaObject(value, "schema reference target");
}
function validateAgainstSchema(value: unknown, rawSchema: Schema): void {
  const evaluate = (candidate: unknown, schemaValue: Schema, location: string): void => {
    if (typeof schemaValue.$ref === "string") evaluate(candidate, resolveSchemaReference(rawSchema, schemaValue.$ref), location);
    if (Array.isArray(schemaValue.allOf)) schemaValue.allOf.forEach((entry) => evaluate(candidate, schemaObject(entry, "allOf entry"), location));
    if ("const" in schemaValue && !Bun.deepEquals(candidate, schemaValue.const, true)) refuse(`${location} violates schema const`);
    if (Array.isArray(schemaValue.enum) && !schemaValue.enum.some((entry) => Bun.deepEquals(candidate, entry, true))) refuse(`${location} violates schema enum`);
    const type = schemaValue.type;
    if (type === "object") {
      const object = schemaObject(candidate, location); const properties = schemaObject(schemaValue.properties ?? {}, "schema properties");
      if (Array.isArray(schemaValue.required)) for (const key of schemaValue.required) if (typeof key !== "string" || !(key in object)) refuse(`${location} lacks a schema-required key`);
      if (schemaValue.additionalProperties === false) for (const key of Object.keys(object)) if (!(key in properties)) refuse(`${location} has a schema-forbidden key`);
      for (const [key, child] of Object.entries(properties)) if (key in object) evaluate(object[key], schemaObject(child, `schema property ${key}`), `${location}.${key}`);
    } else if (type === "array") {
      if (!Array.isArray(candidate)) refuse(`${location} must be an array`);
      if (typeof schemaValue.minItems === "number" && candidate.length < schemaValue.minItems) refuse(`${location} has too few items`);
      if (typeof schemaValue.maxItems === "number" && candidate.length > schemaValue.maxItems) refuse(`${location} has too many items`);
      const prefix = Array.isArray(schemaValue.prefixItems) ? schemaValue.prefixItems : [];
      prefix.forEach((entry, index) => { if (index < candidate.length) evaluate(candidate[index], schemaObject(entry, "prefixItems entry"), `${location}[${index}]`); });
      if (schemaValue.items === false && candidate.length > prefix.length) refuse(`${location} has schema-forbidden extra items`);
    } else if (type === "string") {
      if (typeof candidate !== "string") refuse(`${location} must be a string`);
      if (typeof schemaValue.pattern === "string" && !new RegExp(schemaValue.pattern).test(candidate)) refuse(`${location} violates schema pattern`);
    } else if (type === "integer") {
      if (typeof candidate !== "number" || !Number.isInteger(candidate)) refuse(`${location} must be an integer`);
      if (typeof schemaValue.minimum === "number" && candidate < schemaValue.minimum) refuse(`${location} violates schema minimum`);
    } else if (type !== undefined) refuse("schema uses an unsupported type");
    if (!(type === "object") && schemaValue.properties !== undefined) {
      const object = schemaObject(candidate, location); const properties = schemaObject(schemaValue.properties, "schema properties");
      for (const [key, child] of Object.entries(properties)) if (key in object) evaluate(object[key], schemaObject(child, `schema property ${key}`), `${location}.${key}`);
    }
  };
  evaluate(value, rawSchema, "metadata");
}
function loadSchema(): Schema {
  const snapshot = readStableFile(SCHEMA_PATH, "release metadata schema"); let schema: unknown;
  try { schema = JSON.parse(snapshot.bytes.toString("utf8")); } catch { refuse("release metadata schema is not JSON"); }
  const object = schemaObject(schema, "release metadata schema");
  if (object.$schema !== "https://json-schema.org/draft/2020-12/schema") refuse("release metadata schema draft is not approved");
  return object;
}
function validateMetadata(value: unknown, expected: Metadata, schema: Schema): asserts value is Metadata {
  validateAgainstSchema(value, schema);
  if (canonical(value) !== canonical(expected)) refuse("metadata does not match approved release values and final artifacts");
}
function canonicalOutput(finalArgument: string, outputArgument: string): { finalDirectory: string; outputDirectory: string } {
  const finalDirectory = canonicalExistingDirectory(finalArgument, "final directory");
  const outputDirectory = canonicalExistingDirectory(outputArgument, "output directory");
  if (outputDirectory === finalDirectory || outputDirectory.startsWith(`${finalDirectory}/`) || finalDirectory.startsWith(`${outputDirectory}/`)) refuse("metadata output and final artifacts must be physically separate");
  if (/(^|\/)(?:public|publish|published)(\/|$)/.test(outputDirectory)) refuse("metadata output cannot be a public or publishing path");
  return { finalDirectory, outputDirectory };
}
function exists(path: string): boolean { try { lstatSync(path); return true; } catch (error: unknown) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return false; throw error; } }
function unlinkOwned(path: string, identity: { device: number; inode: number }): void {
  try { const details = lstatSync(path); if (details.dev === identity.device && details.ino === identity.inode && details.isFile() && !details.isSymbolicLink()) unlinkSync(path); } catch { /* never delete an identity we do not own */ }
}
function writeAtomic(path: string, bytes: string): void {
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${crypto.randomUUID()}.owned`);
  let identity: { device: number; inode: number } | undefined; let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    const opened = fstatSync(descriptor); identity = { device: opened.dev, inode: opened.ino };
    writeFileSync(descriptor, bytes); const written = fstatSync(descriptor);
    if (!sameIdentity(opened, written) || written.size !== Buffer.byteLength(bytes)) refuse("owned output changed while being written");
    closeSync(descriptor); descriptor = undefined; chmodSync(temporary, 0o600);
    linkSync(temporary, path); unlinkOwned(temporary, identity); identity = undefined;
  } catch (error) { if (descriptor !== undefined) closeSync(descriptor); if (identity) unlinkOwned(temporary, identity); throw error; }
}
function checksums(metadata: Metadata): string { return metadata.artifacts.map(({ sha256, name }) => `${sha256}  ${name}\n`).join(""); }
function validateFiles(finalDirectory: string, outputDirectory: string, build: string, commit: string): { metadata: Metadata; metadataBytes: string } {
  const expected = buildMetadata(finalDirectory, build, commit); const schema = loadSchema();
  const metadataSnapshot = readStableFile(join(outputDirectory, "macos-release.json"), "macos-release.json");
  const sumsSnapshot = readStableFile(join(outputDirectory, "SHA256SUMS"), "SHA256SUMS");
  const metadataBytes = metadataSnapshot.bytes.toString("utf8"); let metadata: unknown;
  try { metadata = JSON.parse(metadataBytes); } catch { refuse("metadata is not JSON"); }
  validateMetadata(metadata, expected, schema);
  if (metadataBytes !== canonical(metadata)) refuse("metadata JSON bytes are not canonical");
  if (sumsSnapshot.bytes.toString("utf8") !== checksums(expected)) refuse("SHA256SUMS is not canonical or does not match final DMGs");
  return { metadata: metadata as Metadata, metadataBytes };
}

const args = process.argv.slice(2); const mode = args[0]?.startsWith("--") ? args.shift() : "--generate";
if ((mode === "--copy-validated" && args.length !== 5) || (mode !== "--copy-validated" && args.length !== 4)) refuse("usage: generate-release-metadata.ts [--verify|--copy-validated] FINAL_DIR OUTPUT_DIR BUILD_NUMBER FULL_COMMIT [COPY_PATH]");
const [finalArgument, outputArgument, buildNumber, commit, copyArgument] = args;
if (mode === "--generate" && !exists(outputArgument)) mkdirSync(resolve(outputArgument), { mode: 0o700 });
const { finalDirectory, outputDirectory } = canonicalOutput(finalArgument, outputArgument);
if (mode === "--generate") {
  const outputDetails = lstatSync(outputDirectory);
  if ((outputDetails.mode & 0o777) !== 0o700 || readdirSync(outputDirectory).length !== 0) refuse("generation requires an empty mode-0700 output directory");
  const metadata = buildMetadata(finalDirectory, buildNumber, commit); validateAgainstSchema(metadata, loadSchema());
  const written: Array<{ path: string; identity: { device: number; inode: number } }> = [];
  try {
    for (const [path, bytes] of [[join(outputDirectory, "macos-release.json"), canonical(metadata)], [join(outputDirectory, "SHA256SUMS"), checksums(metadata)]] as const) {
      writeAtomic(path, bytes); const details = lstatSync(path); written.push({ path, identity: { device: details.dev, inode: details.ino } });
    }
    validateFiles(finalDirectory, outputDirectory, buildNumber, commit);
  } catch (error) { written.forEach(({ path, identity }) => unlinkOwned(path, identity)); throw error; }
} else if (mode === "--verify") validateFiles(finalDirectory, outputDirectory, buildNumber, commit);
else if (mode === "--copy-validated") {
  const { metadataBytes } = validateFiles(finalDirectory, outputDirectory, buildNumber, commit);
  const copyParent = canonicalExistingDirectory(dirname(resolve(copyArgument)), "validated copy parent");
  if (!copyParent.startsWith(`${outputDirectory}/`)) refuse("validated copy must be inside the canonical output directory");
  const copyPath = join(copyParent, basename(copyArgument));
  writeAtomic(copyPath, metadataBytes);
} else refuse("unsupported mode");
