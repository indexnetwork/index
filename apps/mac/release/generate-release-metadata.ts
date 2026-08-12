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

const SCHEMA_KEYS = new Set(["$schema", "$id", "$ref", "$defs", "title", "type", "additionalProperties", "required", "properties", "const", "enum", "pattern", "prefixItems", "items", "minItems", "maxItems", "allOf", "minimum"]);
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
function schemaObject(value: unknown, label: string): Schema { if (!value || typeof value !== "object" || Array.isArray(value)) refuse(`${label} must be an object schema; boolean schemas are unsupported`); return value as Schema; }
function jsonEqual(left: unknown, right: unknown): boolean {
  if (typeof left === "number" || typeof right === "number") return typeof left === "number" && typeof right === "number" && Number.isFinite(left) && Number.isFinite(right) && left === right;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return left === right;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => jsonEqual(value, right[index]));
  const leftObject = left as Record<string, unknown>; const rightObject = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftObject); const rightKeys = Object.keys(rightObject);
  return leftKeys.length === rightKeys.length && leftKeys.every((key) => Object.hasOwn(rightObject, key) && jsonEqual(leftObject[key], rightObject[key]));
}
function uniqueJsonValues(values: unknown[]): boolean { return values.every((value, index) => values.findIndex((candidate) => jsonEqual(candidate, value)) === index); }
function decodeSchemaReference(reference: string): string[] {
  if (reference === "#") return [];
  if (!reference.startsWith("#/") || reference.slice(2).split("/").some((token) => /~(?![01])/.test(token))) refuse("schema uses an unsupported local reference");
  return reference.slice(2).split("/").map((token) => token.replaceAll("~1", "/").replaceAll("~0", "~"));
}
function resolveSchemaReference(reference: string, schemaPointers: ReadonlyMap<string, Schema>): Schema {
  const tokens = decodeSchemaReference(reference); const pointer = tokens.length === 0 ? "#" : `#/${tokens.map((token) => token.replaceAll("~", "~0").replaceAll("/", "~1")).join("/")}`;
  const target = schemaPointers.get(pointer);
  if (!target) refuse("schema reference target is not a schema node");
  return target;
}
function validateSchemaDocument(rawSchema: Schema): Map<string, Schema> {
  const schemaPointers = new Map<string, Schema>();
  const visitChild = (value: unknown, location: string, pointer: string): void => visit(schemaObject(value, location), location, pointer);
  const visit = (schema: Schema, location: string, pointer: string): void => {
    schemaPointers.set(pointer, schema);
    for (const key of Object.keys(schema)) if (!SCHEMA_KEYS.has(key)) refuse(`${location} uses unsupported schema keyword ${key}`);
    if ("$schema" in schema && typeof schema.$schema !== "string") refuse(`${location} has malformed $schema`);
    if ("$id" in schema && typeof schema.$id !== "string") refuse(`${location} has malformed $id`);
    if ("title" in schema && typeof schema.title !== "string") refuse(`${location} has malformed title`);
    if ("$ref" in schema && typeof schema.$ref !== "string") refuse(`${location} has malformed $ref`);
    if ("type" in schema) {
      if (Array.isArray(schema.type)) refuse(`${location} uses unsupported type array form`);
      if (typeof schema.type !== "string" || !["object", "array", "string", "integer"].includes(schema.type)) refuse(`${location} has unsupported type`);
    }
    const type = schema.type;
    if ("pattern" in schema && type !== "string") refuse(`${location} uses pattern without string type`);
    if ("minimum" in schema && type !== "integer") refuse(`${location} uses minimum without integer type`);
    if (["minItems", "maxItems", "prefixItems", "items"].some((key) => key in schema) && type !== "array") refuse(`${location} uses array constraints without array type`);
    if (["properties", "required", "additionalProperties"].some((key) => key in schema) && type !== "object") refuse(`${location} uses object constraints without object type`);
    if (schema.additionalProperties === true) refuse(`${location} uses unsupported true additionalProperties schema`);
    if ("additionalProperties" in schema && schema.additionalProperties !== false) visitChild(schema.additionalProperties, `${location}.additionalProperties`, `${pointer}/additionalProperties`);
    if ("required" in schema) {
      if (!Array.isArray(schema.required) || schema.required.some((value) => typeof value !== "string") || new Set(schema.required).size !== schema.required.length) refuse(`${location} has malformed or duplicate required entries`);
    }
    if ("properties" in schema) for (const [key, value] of Object.entries(schemaObject(schema.properties, `${location}.properties`))) visitChild(value, `${location}.properties.${key}`, `${pointer}/properties/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`);
    if ("$defs" in schema) for (const [key, value] of Object.entries(schemaObject(schema.$defs, `${location}.$defs`))) visitChild(value, `${location}.$defs.${key}`, `${pointer}/$defs/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`);
    if ("enum" in schema && (!Array.isArray(schema.enum) || schema.enum.length === 0 || !uniqueJsonValues(schema.enum))) refuse(`${location} has malformed, empty, or duplicate enum`);
    if ("pattern" in schema) { if (typeof schema.pattern !== "string") refuse(`${location} has malformed pattern`); try { new RegExp(schema.pattern); } catch { refuse(`${location} has invalid pattern`); } }
    for (const key of ["minItems", "maxItems"]) if (key in schema && (typeof schema[key] !== "number" || !Number.isInteger(schema[key]) || schema[key] < 0)) refuse(`${location} has malformed ${key}`);
    if (typeof schema.minItems === "number" && typeof schema.maxItems === "number" && schema.minItems > schema.maxItems) refuse(`${location} has minItems greater than maxItems`);
    if ("minimum" in schema && (typeof schema.minimum !== "number" || !Number.isFinite(schema.minimum))) refuse(`${location} has malformed minimum`);
    if ("prefixItems" in schema) { if (!Array.isArray(schema.prefixItems)) refuse(`${location} has malformed prefixItems`); schema.prefixItems.forEach((value, index) => visitChild(value, `${location}.prefixItems[${index}]`, `${pointer}/prefixItems/${index}`)); }
    if (schema.items === true) refuse(`${location} uses unsupported true items schema`);
    if ("items" in schema && schema.items !== false) visitChild(schema.items, `${location}.items`, `${pointer}/items`);
    if ("allOf" in schema) { if (!Array.isArray(schema.allOf) || schema.allOf.length === 0) refuse(`${location} has malformed or empty allOf`); schema.allOf.forEach((value, index) => visitChild(value, `${location}.allOf[${index}]`, `${pointer}/allOf/${index}`)); }
  };
  visit(rawSchema, "schema", "#");
  for (const schema of schemaPointers.values()) if (typeof schema.$ref === "string") resolveSchemaReference(schema.$ref, schemaPointers);
  return schemaPointers;
}
function validateAgainstSchema(value: unknown, rawSchema: Schema): void {
  const schemaPointers = validateSchemaDocument(rawSchema); const activeSchemas = new Set<Schema>();
  const evaluate = (candidate: unknown, schemaValue: Schema, location: string): void => {
    if (activeSchemas.has(schemaValue)) refuse("schema evaluation cycle is unsupported");
    activeSchemas.add(schemaValue);
    try {
    if (typeof schemaValue.$ref === "string") evaluate(candidate, resolveSchemaReference(schemaValue.$ref, schemaPointers), location);
    if (Array.isArray(schemaValue.allOf)) schemaValue.allOf.forEach((entry) => evaluate(candidate, schemaObject(entry, "allOf entry"), location));
    if ("const" in schemaValue && !jsonEqual(candidate, schemaValue.const)) refuse(`${location} violates schema const`);
    if (Array.isArray(schemaValue.enum) && !schemaValue.enum.some((entry) => jsonEqual(candidate, entry))) refuse(`${location} violates schema enum`);
    const type = schemaValue.type;
    if (type === "object") {
      const object = schemaObject(candidate, location); const properties = schemaObject(schemaValue.properties ?? {}, "schema properties");
      if (Array.isArray(schemaValue.required)) for (const key of schemaValue.required) if (typeof key !== "string" || !(key in object)) refuse(`${location} lacks a schema-required key`);
      for (const key of Object.keys(object)) if (!(key in properties)) {
        if (schemaValue.additionalProperties === false) refuse(`${location} has a schema-forbidden key`);
        if (schemaValue.additionalProperties && typeof schemaValue.additionalProperties === "object") evaluate(object[key], schemaObject(schemaValue.additionalProperties, "additionalProperties schema"), `${location}.${key}`);
      }
      for (const [key, child] of Object.entries(properties)) if (key in object) evaluate(object[key], schemaObject(child, `schema property ${key}`), `${location}.${key}`);
    } else if (type === "array") {
      if (!Array.isArray(candidate)) refuse(`${location} must be an array`);
      if (typeof schemaValue.minItems === "number" && candidate.length < schemaValue.minItems) refuse(`${location} has too few items`);
      if (typeof schemaValue.maxItems === "number" && candidate.length > schemaValue.maxItems) refuse(`${location} has too many items`);
      const prefix = Array.isArray(schemaValue.prefixItems) ? schemaValue.prefixItems : [];
      prefix.forEach((entry, index) => { if (index < candidate.length) evaluate(candidate[index], schemaObject(entry, "prefixItems entry"), `${location}[${index}]`); });
      if (candidate.length > prefix.length) {
        if (schemaValue.items === false) refuse(`${location} has schema-forbidden extra items`);
        if (schemaValue.items && typeof schemaValue.items === "object") for (let index = prefix.length; index < candidate.length; index += 1) evaluate(candidate[index], schemaObject(schemaValue.items, "items schema"), `${location}[${index}]`);
      }
    } else if (type === "string") {
      if (typeof candidate !== "string") refuse(`${location} must be a string`);
      if (typeof schemaValue.pattern === "string" && !new RegExp(schemaValue.pattern).test(candidate)) refuse(`${location} violates schema pattern`);
    } else if (type === "integer") {
      if (typeof candidate !== "number" || !Number.isInteger(candidate)) refuse(`${location} must be an integer`);
      if (typeof schemaValue.minimum === "number" && candidate < schemaValue.minimum) refuse(`${location} violates schema minimum`);
    } else if (type !== undefined) refuse("schema uses an unsupported type");
    } finally { activeSchemas.delete(schemaValue); }
  };
  evaluate(value, rawSchema, "metadata");
}
function loadSchema(): Schema {
  const snapshot = readStableFile(SCHEMA_PATH, "release metadata schema"); let schema: unknown;
  try { schema = JSON.parse(snapshot.bytes.toString("utf8")); } catch { refuse("release metadata schema is not JSON"); }
  const object = schemaObject(schema, "release metadata schema");
  if (object.$schema !== "https://json-schema.org/draft/2020-12/schema") refuse("release metadata schema draft is not approved");
  validateSchemaDocument(object);
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
