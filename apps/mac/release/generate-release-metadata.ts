#!/usr/bin/env bun
import { chmodSync, closeSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const VERSION = "1.0.0";
const RELEASE_BASE_URL = `https://github.com/indexnetwork/index/releases/download/v${VERSION}`;
const ARTIFACTS = [
  { kind: "app-dmg", name: "Index-macOS-1.0.0-universal.dmg" },
  { kind: "connector-dmg", name: "IndexConnector-1.0.0-universal.dmg" },
] as const;
const ROOT_KEYS = [
  "apiUrl", "architectures", "artifacts", "buildNumber", "commit", "connectorProtocolVersion",
  "minimumMacOS", "releaseVersion", "schemaVersion", "teamId", "webUrl",
];
const ARTIFACT_KEYS = ["kind", "name", "sha256", "size", "url"];
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

function refuse(message: string): never { throw new Error(`release metadata refused: ${message}`); }
function sha256(path: string): string { return new Bun.CryptoHasher("sha256").update(readFileSync(path)).digest("hex"); }
function exactKeys(value: Record<string, unknown>, expected: string[], label: string): void {
  const actual = Object.keys(value).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) refuse(`${label} has unapproved keys`);
}
function requireRegularFile(path: string, label: string): void {
  const details = lstatSync(path);
  if (!details.isFile() || details.isSymbolicLink()) refuse(`${label} must be a regular non-link file`);
}
function parseEvidence(path: string, artifactDigest: string): void {
  requireRegularFile(path, "reproducibility evidence");
  const bytes = readFileSync(path, "utf8");
  if (FORBIDDEN.test(bytes)) refuse("reproducibility evidence contains a credential-like field");
  const values = new Map<string, string>();
  for (const line of bytes.split("\n")) {
    if (!line) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) refuse("reproducibility evidence is malformed");
    const key = line.slice(0, separator); const value = line.slice(separator + 1);
    if (!EVIDENCE_KEYS.includes(key) || values.has(key) || !value) refuse("reproducibility evidence has unapproved, duplicate, or empty fields");
    values.set(key, value);
  }
  if (values.size !== EVIDENCE_KEYS.length) refuse("reproducibility evidence is incomplete");
  for (const field of ["macOS", "build", "runner"]) {
    if (values.get(`${field}.actual`) !== values.get(`${field}.expected`)) refuse(`${field} provenance does not match its reviewed pin`);
  }
  for (const field of ["artifact.sha256", "finalArtifact.sha256"]) {
    if (!/^[0-9a-f]{64}$/.test(values.get(field) ?? "")) refuse(`${field} is not a SHA-256`);
  }
  if (values.get("finalArtifact.sha256") !== artifactDigest) refuse("finalArtifact.sha256 does not match final DMG bytes");
}
function canonical(value: unknown): string { return `${JSON.stringify(value)}\n`; }
function loadArtifact(finalDirectory: string, approved: (typeof ARTIFACTS)[number]): Artifact {
  const path = join(finalDirectory, approved.name);
  requireRegularFile(path, approved.name);
  const details = statSync(path);
  if (details.size <= 0) refuse(`${approved.name} is empty`);
  const digest = sha256(path);
  parseEvidence(`${path}.reproducibility.txt`, digest);
  return { kind: approved.kind, name: approved.name, sha256: digest, size: details.size, url: `${RELEASE_BASE_URL}/${approved.name}` };
}
function buildMetadata(finalDirectory: string, buildNumber: string, commit: string): Metadata {
  if (!/^[1-9][0-9]*$/.test(buildNumber)) refuse("build number must be a positive canonical decimal");
  if (!/^[0-9a-f]{40}$/.test(commit)) refuse("commit must be a full lowercase 40-hex Git commit");
  return {
    apiUrl: "https://protocol.index.network",
    architectures: ["arm64", "x86_64"],
    artifacts: ARTIFACTS.map((approved) => loadArtifact(finalDirectory, approved)),
    buildNumber,
    commit,
    connectorProtocolVersion: 1,
    minimumMacOS: "13.0",
    releaseVersion: VERSION,
    schemaVersion: 1,
    teamId: "LMQ3XNXLAD",
    webUrl: "https://index.network",
  };
}
function validateMetadata(value: unknown, expected: Metadata): asserts value is Metadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) refuse("metadata root must be an object");
  const metadata = value as Record<string, unknown>;
  exactKeys(metadata, ROOT_KEYS, "metadata");
  if (canonical(metadata) !== canonical(expected)) refuse("metadata does not match approved release values and final artifacts");
  const artifacts = metadata.artifacts;
  if (!Array.isArray(artifacts) || artifacts.length !== 2) refuse("metadata must contain exactly two artifacts");
  artifacts.forEach((artifact, index) => {
    if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) refuse("artifact must be an object");
    exactKeys(artifact as Record<string, unknown>, ARTIFACT_KEYS, `artifact ${index}`);
  });
}
function outputIsPrivate(outputDirectory: string, finalDirectory: string): void {
  if (outputDirectory === finalDirectory || outputDirectory.startsWith(`${finalDirectory}/`)) refuse("metadata output must be separate from final artifacts");
  if (/(^|\/)(?:public|publish|published)(\/|$)/.test(outputDirectory)) refuse("metadata output cannot be a public or publishing path");
}
function writeAtomic(path: string, bytes: string): void {
  const temporary = `${path}.incomplete`;
  if (lstatExists(path) || lstatExists(temporary)) refuse(`${basename(path)} already exists`);
  const descriptor = openSync(temporary, "wx", 0o600);
  try { writeFileSync(descriptor, bytes); } finally { closeSync(descriptor); }
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
}
function lstatExists(path: string): boolean {
  try { lstatSync(path); return true; }
  catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}
function checksums(metadata: Metadata): string { return metadata.artifacts.map(({ sha256: digest, name }) => `${digest}  ${name}\n`).join(""); }
function verify(finalDirectory: string, outputDirectory: string, buildNumber: string, commit: string): void {
  const expected = buildMetadata(finalDirectory, buildNumber, commit);
  const metadataPath = join(outputDirectory, "macos-release.json");
  const sumsPath = join(outputDirectory, "SHA256SUMS");
  requireRegularFile(metadataPath, "macos-release.json"); requireRegularFile(sumsPath, "SHA256SUMS");
  const metadataBytes = readFileSync(metadataPath, "utf8");
  let metadata: unknown; try { metadata = JSON.parse(metadataBytes); } catch { refuse("metadata is not JSON"); }
  validateMetadata(metadata, expected);
  if (metadataBytes !== canonical(metadata)) refuse("metadata JSON bytes are not canonical");
  if (readFileSync(sumsPath, "utf8") !== checksums(expected)) refuse("SHA256SUMS is not canonical or does not match final DMGs");
}

const args = process.argv.slice(2); const verifyMode = args[0] === "--verify"; if (verifyMode) args.shift();
if (args.length !== 4) refuse("usage: generate-release-metadata.ts [--verify] FINAL_DIR OUTPUT_DIR BUILD_NUMBER FULL_COMMIT");
const [finalArgument, outputArgument, buildNumber, commit] = args;
const finalDirectory = resolve(finalArgument); const outputDirectory = resolve(outputArgument);
if (verifyMode) {
  outputIsPrivate(outputDirectory, finalDirectory); verify(finalDirectory, outputDirectory, buildNumber, commit);
} else {
  const parent = resolve(dirname(outputDirectory)); mkdirSync(parent, { recursive: true });
  if (!lstatExists(outputDirectory)) mkdirSync(outputDirectory, { mode: 0o700 });
  const outputDetails = lstatSync(outputDirectory);
  if (!outputDetails.isDirectory() || outputDetails.isSymbolicLink()) refuse("output must be a non-link directory");
  if ((outputDetails.mode & 0o777) !== 0o700) refuse("output directory must be mode 0700");
  if (readdirSync(outputDirectory).length !== 0) refuse("generation requires an empty output directory");
  outputIsPrivate(outputDirectory, finalDirectory);
  const metadata = buildMetadata(finalDirectory, buildNumber, commit);
  try {
    writeAtomic(join(outputDirectory, "macos-release.json"), canonical(metadata));
    writeAtomic(join(outputDirectory, "SHA256SUMS"), checksums(metadata));
    verify(finalDirectory, outputDirectory, buildNumber, commit);
  } catch (error) {
    rmSync(join(outputDirectory, "macos-release.json"), { force: true });
    rmSync(join(outputDirectory, "SHA256SUMS"), { force: true });
    throw error;
  }
}
