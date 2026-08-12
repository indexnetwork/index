#!/usr/bin/env bun
import { chmodSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { verifySignedCleanAccountEvidencePair } from "./verify-clean-account-evidence";

const FILES = [
  "Index-macOS-1.0.0-universal.dmg",
  "IndexConnector-1.0.0-universal.dmg",
  "macos-release.json",
  "macos-release.cms",
  "SHA256SUMS",
];
const SHA256 = /^[0-9a-f]{64}$/;
const hash = (bytes: Uint8Array | string) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const refuse = (message: string): never => { throw new Error(`candidate handoff refused: ${message}`); };
const ordered = (value: unknown): unknown => Array.isArray(value)
  ? value.map(ordered)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, ordered((value as Record<string, unknown>)[key])]))
    : value;
const canonical = (value: unknown): string => JSON.stringify(ordered(value)) + "\n";

async function fileRecord(path: string, name: string) {
  const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
  if (!bytes.length) refuse(`${name} is empty`);
  return { name, sha256: hash(bytes), size: bytes.length };
}

async function buildManifest(candidate: string, attestationMarker: string, runId: string, runAttempt: string) {
  const metadataBytes = readFileSync(join(candidate, "macos-release.json"), "utf8");
  const metadata = JSON.parse(metadataBytes);
  const marker = readFileSync(attestationMarker, "utf8").trimEnd().split("\n");
  if (marker.length !== 2 || !SHA256.test(marker[0]) || !/^https:\/\/github\.com\/indexnetwork\/index\/attestations\/[1-9][0-9]*$/.test(marker[1])) refuse("attestation binding is malformed");
  const files = [];
  for (const name of FILES) files.push(await fileRecord(join(candidate, name), name));
  const byName = Object.fromEntries(files.map((item) => [item.name, item]));
  for (const artifact of metadata.artifacts ?? []) {
    const file = byName[artifact.name];
    if (!file || file.sha256 !== artifact.sha256 || file.size !== artifact.size) refuse("metadata artifact binding differs from candidate bytes");
  }
  if (!/^[1-9][0-9]*$/.test(runId) || !/^[1-9][0-9]*$/.test(runAttempt)) refuse("candidate run identity is invalid");
  return {
    schemaVersion: 1,
    candidateRunId: runId,
    candidateRunAttempt: runAttempt,
    releaseVersion: metadata.releaseVersion,
    buildNumber: metadata.buildNumber,
    commit: metadata.commit,
    minimumMacOS: metadata.minimumMacOS,
    attestationUrl: marker[1],
    candidateInventorySealSha256: marker[0],
    publicationFiles: files,
  };
}

export async function createCandidateHandoff(candidate: string, attestationMarker: string, output: string, runId: string, runAttempt: string): Promise<void> {
  mkdirSync(output, { mode: 0o700 });
  const manifest = await buildManifest(candidate, attestationMarker, runId, runAttempt);
  const bytes = canonical(manifest);
  writeFileSync(join(output, "candidate-manifest.json"), bytes, { mode: 0o600, flag: "wx" });
  writeFileSync(join(output, "candidate-manifest.sha256"), `${hash(bytes)}\n`, { mode: 0o600, flag: "wx" });
  for (const name of FILES) {
    copyFileSync(join(candidate, name), join(output, name), 0);
    chmodSync(join(output, name), 0o600);
  }
}

export async function verifyCandidateHandoff(directory: string): Promise<Record<string, unknown>> {
  const bytes = readFileSync(join(directory, "candidate-manifest.json"), "utf8");
  if (!bytes.endsWith("\n")) refuse("manifest is not canonical line terminated");
  const expectedBytes = readFileSync(join(directory, "candidate-manifest.sha256"), "utf8");
  if (!/^[0-9a-f]{64}\n$/.test(expectedBytes)) refuse("manifest digest encoding is noncanonical");
  const expected = expectedBytes.slice(0, -1);
  if (hash(bytes) !== expected) refuse("manifest digest mismatch");
  const manifest = JSON.parse(bytes);
  if (canonical(manifest) !== bytes || manifest.schemaVersion !== 1 || !Array.isArray(manifest.publicationFiles) || manifest.publicationFiles.length !== FILES.length) refuse("manifest shape is invalid");
  if (JSON.stringify(manifest.publicationFiles.map((item: { name: string }) => item.name)) !== JSON.stringify(FILES)) refuse("publication inventory is not exact");
  for (const item of manifest.publicationFiles) {
    const actual = await fileRecord(join(directory, item.name), item.name);
    if (actual.sha256 !== item.sha256 || actual.size !== item.size) refuse(`${item.name} changed`);
  }
  return { ...manifest, candidateSealSha256: expected };
}

export async function verifyCandidateForPublish(directory: string, armPath: string, armCmsPath: string, intelPath: string, intelCmsPath: string, runId?: string, runAttempt?: string): Promise<Record<string, unknown>> {
  const manifest = await verifyCandidateHandoff(directory);
  if ((runId !== undefined || runAttempt !== undefined) && (manifest.candidateRunId !== runId || manifest.candidateRunAttempt !== runAttempt)) refuse("candidate run identity differs from downloaded handoff");
  const records = verifySignedCleanAccountEvidencePair(armPath, armCmsPath, intelPath, intelCmsPath);
  const files = Object.fromEntries((manifest.publicationFiles as { name: string; sha256: string }[]).map((item) => [item.name, item.sha256]));
  const expectedArtifacts = {
    app: files[`Index-macOS-${manifest.releaseVersion}-universal.dmg`],
    connector: files[`IndexConnector-${manifest.releaseVersion}-universal.dmg`],
  };
  for (const record of records) {
    if (record.releaseVersion !== manifest.releaseVersion || record.commit !== manifest.commit || record.minimumMacOS !== manifest.minimumMacOS || record.attestationUrl !== manifest.attestationUrl || record.candidateSealSha256 !== manifest.candidateSealSha256 || record.candidateManifestSha256 !== manifest.candidateSealSha256 || JSON.stringify(record.artifactSha256) !== JSON.stringify(expectedArtifacts)) refuse("clean-account evidence differs from sealed candidate authority");
  }
  return manifest;
}

if (import.meta.main) {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === "create" && args.length === 5) await createCandidateHandoff(args[0], args[1], args[2], args[3], args[4]);
  else if (mode === "verify" && args.length === 1) {
    const manifest = await verifyCandidateHandoff(args[0]);
    process.stdout.write(JSON.stringify(manifest) + "\n");
  } else if (mode === "verify-for-publish" && args.length === 7) {
    const manifest = await verifyCandidateForPublish(args[0], args[1], args[2], args[3], args[4], args[5], args[6]);
    process.stdout.write(JSON.stringify(manifest) + "\n");
  } else refuse("usage: candidate-handoff.ts create CANDIDATE ATTESTATION OUTPUT RUN_ID RUN_ATTEMPT | verify HANDOFF | verify-for-publish HANDOFF ARM64_JSON ARM64_CMS X86_64_JSON X86_64_CMS RUN_ID RUN_ATTEMPT");
}
