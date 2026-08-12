#!/usr/bin/env bun
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const EXPECTED_TEAM_ID = "LMQ3XNXLAD";
const EXPECTED_BUNDLE_ID = "network.index.connector";
const EXPECTED_REQUIREMENT = 'anchor apple generic and certificate leaf[subject.OU] = "LMQ3XNXLAD" and identifier "network.index.connector"';
const DOWNLOAD_URL = "https://index.network/download";

type Metadata = {
  bundleId: string;
  connectorProtocolVersion: number;
  designatedRequirement: string;
  downloadUrl: string;
  schemaVersion: number;
  sha256: string;
  teamId: string;
};

function refuse(message: string): never {
  throw new Error(`connector release metadata refused: ${message}`);
}

function readStableRegularFile(path: string): Buffer {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.size <= 0) refuse("connector must be a nonempty regular file");
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    const current = lstatSync(path);
    if (current.isSymbolicLink() || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.dev !== current.dev || before.ino !== current.ino || bytes.length !== before.size) {
      refuse("connector changed while being read");
    }
    return bytes;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("connector release metadata refused:")) throw error;
    refuse("connector cannot be opened safely");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function canonical(metadata: Metadata): string {
  return `${JSON.stringify(metadata)}\n`;
}

const [connectorArg, outputArg] = process.argv.slice(2);
if (!connectorArg || !outputArg || process.argv.length !== 4) {
  refuse("usage: generate-connector-release-metadata.ts CONNECTOR_EXECUTABLE OUTPUT_JSON");
}
const connector = resolve(connectorArg);
const output = resolve(outputArg);
if (connector === output) refuse("output must differ from connector");
const bytes = readStableRegularFile(connector);
const metadata: Metadata = {
  bundleId: EXPECTED_BUNDLE_ID,
  connectorProtocolVersion: 1,
  designatedRequirement: EXPECTED_REQUIREMENT,
  downloadUrl: DOWNLOAD_URL,
  schemaVersion: 1,
  sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
  teamId: EXPECTED_TEAM_ID,
};
const encoded = canonical(metadata);
try {
  const descriptor = openSync(output, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(descriptor, encoded); } finally { closeSync(descriptor); }
} catch {
  refuse("output must not already exist and must be writable without links");
}
