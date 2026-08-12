#!/usr/bin/env bun
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";

const FILES = ["Index-macOS-1.0.0-universal.dmg", "IndexConnector-1.0.0-universal.dmg", "macos-release.json", "macos-release.cms", "SHA256SUMS"];
const SHA256 = /^[0-9a-f]{64}$/; const COMMIT = /^[0-9a-f]{40}$/;
const refuse = (message: string): never => { throw new Error(`candidate attestation refused: ${message}`); };
const text = (value: unknown): string => typeof value === "string" ? value : "";

function extension(extensions: Record<string, unknown>, ...names: string[]): string {
  for (const name of names) if (typeof extensions[name] === "string") return extensions[name] as string;
  return "";
}
function exactSubjects(value: unknown, directory: string): boolean {
  if (!Array.isArray(value) || value.length !== FILES.length) return false;
  const expected = new Map(FILES.map((name) => [name, new Bun.CryptoHasher("sha256").update(readFileSync(join(directory, name))).digest("hex")]));
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const item = raw as Record<string, unknown>, digest = item.digest as Record<string, unknown> | undefined, name = basename(text(item.name));
    if (!FILES.includes(name) || !digest || digest.sha256 !== expected.get(name)) return false;
    expected.delete(name);
  }
  return expected.size === 0;
}

export function verifyCandidateAttestationResult(result: unknown, directory: string, attestationId: string, repository: string, runId: string, runAttempt: string, commit: string): void {
  if (!Array.isArray(result) || result.length !== 1) refuse("exactly one verified attestation result is required");
  const item = result[0] as Record<string, unknown>, attestation = item?.attestation as Record<string, unknown> | undefined;
  const verification = item?.verificationResult as Record<string, unknown> | undefined, statement = verification?.statement as Record<string, unknown> | undefined;
  const signature = verification?.signature as Record<string, unknown> | undefined, certificate = signature?.certificate as Record<string, unknown> | undefined;
  const extensions = certificate?.extensions as Record<string, unknown> | undefined;
  const resultId = String(attestation?.id ?? attestation?.attestationId ?? attestation?.attestation_id ?? "");
  const bundleUrl = text(attestation?.bundle_url ?? attestation?.bundleUrl);
  if (resultId !== attestationId && !new RegExp(`(?:^|/)${attestationId}(?:\\.|/|$)`).test(bundleUrl)) refuse("verified bundle is not the recorded attestation id");
  if (!statement || !exactSubjects(statement.subject, directory)) refuse("attestation subjects do not equal all candidate files");
  if (!extensions) refuse("verified certificate extensions are missing");
  const repoUri = extension(extensions, "SourceRepositoryURI", "sourceRepositoryURI"), sourceDigest = extension(extensions, "SourceRepositoryDigest", "sourceRepositoryDigest");
  const buildSigner = extension(extensions, "BuildSignerURI", "buildSignerURI"), invocation = extension(extensions, "RunInvocationURI", "runInvocationURI"), runner = extension(extensions, "RunnerEnvironment", "runnerEnvironment");
  if (repoUri !== `https://github.com/${repository}` || sourceDigest !== commit || !COMMIT.test(sourceDigest)) refuse("attestation repository/commit identity differs");
  if (buildSigner !== `https://github.com/${repository}/.github/workflows/mac-production-release.yml@refs/tags/v1.0.0`) refuse("attestation signer workflow/ref differs");
  if (invocation !== `https://github.com/${repository}/actions/runs/${runId}/attempts/${runAttempt}` || runner !== "github-hosted") refuse("attestation run/attempt/runner identity differs");
}

if (import.meta.main) {
  if (process.argv.length !== 8) refuse("usage: verify-candidate-attestation.ts CANDIDATE ATTESTATION_URL REPOSITORY RUN_ID RUN_ATTEMPT COMMIT");
  const [directory, urlValue, repository, runId, runAttempt, commit] = process.argv.slice(2);
  const names = readdirSync(directory).sort(); if (JSON.stringify(names) !== JSON.stringify([...FILES].sort())) refuse("candidate file inventory is not exact");
  let url: URL; try { url = new URL(urlValue); } catch { refuse("attestation URL is invalid"); }
  if (url.protocol !== "https:" || url.host !== "github.com" || url.username || url.password || url.search || url.hash || url.pathname !== `/indexnetwork/index/attestations/${url.pathname.split("/").at(-1)}`) refuse("attestation URL authority is invalid");
  const id = url.pathname.split("/").at(-1) ?? ""; if (!/^[1-9][0-9]*$/.test(id) || repository !== "indexnetwork/index" || !/^[1-9][0-9]*$/.test(runId) || !/^[1-9][0-9]*$/.test(runAttempt) || !COMMIT.test(commit)) refuse("attestation binding arguments are invalid");
  const verified = spawnSync("gh", ["attestation", "verify", join(directory, FILES[0]), "--repo", repository, "--signer-workflow", `${repository}/.github/workflows/mac-production-release.yml`, "--signer-digest", commit, "--source-digest", commit, "--deny-self-hosted-runners", "--format", "json"], { encoding: "utf8" });
  if (verified.status !== 0) refuse("GitHub cryptographic attestation verification failed");
  let result: unknown; try { result = JSON.parse(verified.stdout); } catch { refuse("GitHub verification result is not JSON"); }
  verifyCandidateAttestationResult(result, directory, id, repository, runId, runAttempt, commit);
  process.stdout.write("exact candidate attestation valid\n");
}
