import { afterEach, describe, expect, test } from 'bun:test';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const apiRoot = resolve(import.meta.dir, '../../..');
const scriptPath = resolve(apiRoot, 'scripts/verify-hermes-previous-api-compatibility.sh');
const workflowPath = resolve(apiRoot, '../../.github/workflows/hermes-backend-production-assurance.yml');
const fixtureDockerfilePath = resolve(import.meta.dir, 'fixtures/previous-api.Dockerfile');
const baseDockerfilePath = resolve(import.meta.dir, 'fixtures/previous-api-base.Dockerfile');
const fixtureServerPath = resolve(import.meta.dir, 'fixtures/previous-api-server.ts');
const taskReportPath = resolve(apiRoot, '../../.superpowers/sdd/2026-08-09-hermes-backend-production-assurance/task-4-report.md');
const approvedRollbackBaseSha = '751f5a7ed143150488543db9a1b4ee1f1b833bfc';
const productionDigest = `registry.example/index-api@sha256:${'a'.repeat(64)}`;
const localImageId = `sha256:${'b'.repeat(64)}`;
const disposableDatabaseUrl = 'postgres://postgres:postgres@127.0.0.1:5432/hermes_assurance';
const temporaryDirectories: string[] = [];

async function executable(path: string, source: string) {
  await writeFile(path, source);
  await chmod(path, 0o755);
}

async function contractEnvironment(options: {
  repoDigests?: string;
  probeStatus?: number;
  seedFailure?: boolean;
  seedCommitThenFailure?: boolean;
  currentAuthenticationFailure?: boolean;
  currentAuthenticationHang?: boolean;
  cleanupFailure?: boolean;
} = {}) {
  const directory = await mkdtemp(resolve(tmpdir(), 'hermes-previous-api-contract-'));
  temporaryDirectories.push(directory);
  const bin = resolve(directory, 'bin');
  await Bun.write(resolve(bin, '.keep'), '');
  const reportPath = resolve(directory, 'report.json');
  const lifecyclePath = resolve(directory, 'lifecycle.log');
  const healthStatePath = resolve(directory, 'health-state');

  await executable(resolve(bin, 'bun'), `#!/usr/bin/env bash
set -euo pipefail
cat >/dev/null
case "\${HERMES_COMPAT_OPERATION:-}" in
  generate) printf 'idxh_contractSecret\\n' ;;
  hash) printf 'contractCredentialHash\\n' ;;
  seed)
    test "\${HERMES_COMPAT_CREDENTIAL:-}" = idxh_contractSecret
    ${options.seedFailure
    ? `printf '%s\\n' "idxh_contractSecret contractCredentialHash ${disposableDatabaseUrl}" >&2; exit 68`
    : options.seedCommitThenFailure
      ? `printf 'seed-committed\\n' >>"${lifecyclePath}"; exit 68`
      : `printf 'seed\\n' >>"${lifecyclePath}"`}
    ;;
  verify-current)
    printf 'verify-current\\n' >>"${lifecyclePath}"
    ${options.currentAuthenticationHang
    ? '/bin/sleep 3'
    : options.currentAuthenticationFailure
      ? `printf '%s\\n' "idxh_contractSecret contractCredentialHash ${disposableDatabaseUrl}" >&2; exit 70`
      : ':'}
    ;;
  cleanup)
    printf 'cleanup\\n' >>"${lifecyclePath}"
    ${options.cleanupFailure ? `printf '%s\\n' "idxh_contractSecret contractCredentialHash ${disposableDatabaseUrl}" >&2; exit 69` : ':'}
    ;;
  *) exit 64 ;;
esac
`);
  await executable(resolve(bin, 'timeout'), `#!/usr/bin/env bash
set -euo pipefail
if test "\${HERMES_COMPAT_OPERATION:-}" = verify-current && test "\${FAKE_TIMEOUT_CURRENT_PROOF:-}" = 1; then
  printf 'verify-timeout\\n' >>"${lifecyclePath}"
  exit 124
fi
exec /usr/bin/timeout "$@"
`);
  await executable(resolve(bin, 'docker'), `#!/usr/bin/env bash
set -euo pipefail
command="\${1:-}"
shift || true
case "$command" in
  pull) exit 0 ;;
  inspect)
    case "$*" in
      *RepoDigests*) printf '%b' '${(options.repoDigests ?? `${productionDigest}\\n`).replaceAll("'", "'\\''")}' ;;
      *'.Id'*) printf '%s\\n' '${localImageId}' ;;
      *HostPort*) printf '49173\\n' ;;
      *) exit 65 ;;
    esac
    ;;
  run) printf 'fixture-container\\n' ;;
  stop|rm) printf '%s\\n' "$command" >>"${lifecyclePath}" ;;
  *) exit 66 ;;
esac
`);
  await executable(resolve(bin, 'curl'), `#!/usr/bin/env bash
set -euo pipefail
case " $* " in
  *' --config - '*)
    config="$(cat)"
    case "$config" in
      *'x-api-key: idxh_contractSecret'*) ;;
      *) exit 67 ;;
    esac
    printf '${options.probeStatus ?? 401}'
    ;;
  *)
    if test -e "${healthStatePath}"; then printf '200'; else : >"${healthStatePath}"; printf '503'; fi
    ;;
esac
`);
  await executable(resolve(bin, 'sleep'), '#!/usr/bin/env bash\nexit 0\n');

  return {
    directory,
    reportPath,
    lifecyclePath,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      DATABASE_URL: disposableDatabaseUrl,
      TEST_DATABASE_SAFE: '1',
      NODE_ENV: 'production',
      ALLOW_MUTABLE_PREVIOUS_IMAGE: '',
      HERMES_PREVIOUS_API_REPORT: reportPath,
      FAKE_TIMEOUT_CURRENT_PROOF: options.currentAuthenticationHang ? '1' : '',
    },
  };
}

function runCompatibility(env: Record<string, string | undefined>) {
  return Bun.spawnSync(['bash', scriptPath], {
    cwd: apiRoot,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('previous API compatibility shell gate', () => {
  test('fails closed when the image input is missing', async () => {
    const contract = await contractEnvironment();
    const result = runCompatibility(contract.env);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain('PREVIOUS_API_IMAGE is required');
    expect(await Bun.file(contract.lifecyclePath).exists()).toBe(false);
  });

  test('rejects mutable production references before starting a container', async () => {
    const contract = await contractEnvironment();
    const result = runCompatibility({
      ...contract.env,
      PREVIOUS_API_IMAGE: 'registry.example/index-api:current',
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain('immutable digest');
    expect(await Bun.file(contract.lifecyclePath).exists()).toBe(false);
  });

  test('requires both explicit test gates before allowing a mutable fixture', async () => {
    for (const extra of [
      { NODE_ENV: 'test' },
      { ALLOW_MUTABLE_PREVIOUS_IMAGE: '1' },
    ]) {
      const contract = await contractEnvironment();
      const result = runCompatibility({
        ...contract.env,
        ...extra,
        PREVIOUS_API_IMAGE: 'index-api-previous-fixture:local',
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.toString()).toContain('immutable digest');
    }
  });

  test('resolves the protected image RepoDigest and emits only the exact sanitized report', async () => {
    const contract = await contractEnvironment();
    const result = runCompatibility({
      ...contract.env,
      PREVIOUS_API_IMAGE: productionDigest,
    });

    expect(result.exitCode).toBe(0);
    const reportSource = await readFile(contract.reportPath, 'utf8');
    const report = JSON.parse(reportSource);
    expect(Object.keys(report).sort()).toEqual(['checkedAt', 'imageDigest', 'rejected', 'status']);
    expect(report).toMatchObject({ imageDigest: productionDigest, rejected: true, status: 401 });
    expect(report.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);

    const observableOutput = `${result.stdout}${result.stderr}${reportSource}`;
    expect(observableOutput).not.toContain('idxh_');
    expect(observableOutput).not.toContain('contractCredentialHash');
    expect(observableOutput).not.toContain(disposableDatabaseUrl);
    expect(await readFile(contract.lifecyclePath, 'utf8')).toBe('seed\nverify-current\nstop\nrm\ncleanup\n');
  });

  test('sanitizes database seeding failures instead of forwarding secret-bearing diagnostics', async () => {
    const contract = await contractEnvironment({ seedFailure: true });
    const result = runCompatibility({
      ...contract.env,
      PREVIOUS_API_IMAGE: productionDigest,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain('Failed to seed the dedicated compatibility credential');
    const observableOutput = `${result.stdout}${result.stderr}`;
    expect(observableOutput).not.toContain('idxh_');
    expect(observableOutput).not.toContain('contractCredentialHash');
    expect(observableOutput).not.toContain(disposableDatabaseUrl);
    expect(await readFile(contract.lifecyclePath, 'utf8')).toBe('cleanup\n');
  });

  test('binds the validated canonical actions through postgres typed-array support', async () => {
    const script = await readFile(scriptPath, 'utf8');

    expect(script).toContain('const actions = JSON.parse(actionsJson);');
    expect(script).toContain('actions.some((action, index) => action !== canonicalActions[index])');
    expect(script).toContain('${tx.array(actions)}');
    expect(script).not.toContain('jsonb_array_elements_text');
  });

  test('deletes credential and agent rows before the owning user', async () => {
    const script = await readFile(scriptPath, 'utf8');
    const credentialDelete = script.indexOf("DELETE FROM hermes_agent_credentials WHERE id = $1");
    const agentDelete = script.indexOf("DELETE FROM agents WHERE id = $1");
    const userDelete = script.indexOf("DELETE FROM users WHERE id = $1");

    expect(credentialDelete).toBeGreaterThan(-1);
    expect(agentDelete).toBeGreaterThan(credentialDelete);
    expect(userDelete).toBeGreaterThan(agentDelete);
  });

  test('fails cleanup visibly without forwarding secret-bearing diagnostics', async () => {
    const contract = await contractEnvironment({ cleanupFailure: true });
    const result = runCompatibility({
      ...contract.env,
      PREVIOUS_API_IMAGE: productionDigest,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain('Failed to clean up previous API compatibility fixtures.');
    const observableOutput = `${result.stdout}${result.stderr}`;
    expect(observableOutput).not.toContain('idxh_');
    expect(observableOutput).not.toContain('contractCredentialHash');
    expect(observableOutput).not.toContain(disposableDatabaseUrl);
    expect(await readFile(contract.lifecyclePath, 'utf8')).toBe('seed\nverify-current\nstop\nrm\ncleanup\n');
  });

  test('cleans up a transaction that commits before the seed process exits nonzero', async () => {
    const contract = await contractEnvironment({ seedCommitThenFailure: true });
    const result = runCompatibility({ ...contract.env, PREVIOUS_API_IMAGE: productionDigest });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain('Failed to seed the dedicated compatibility credential');
    expect(await readFile(contract.lifecyclePath, 'utf8')).toBe('seed-committed\ncleanup\n');
  });

  test('fails closed when current production authentication cannot resolve the seeded credential', async () => {
    const contract = await contractEnvironment({ currentAuthenticationFailure: true });
    const result = runCompatibility({ ...contract.env, PREVIOUS_API_IMAGE: productionDigest });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain('failed current authentication');
    const observableOutput = `${result.stdout}${result.stderr}`;
    expect(observableOutput).not.toContain('idxh_');
    expect(observableOutput).not.toContain('contractCredentialHash');
    expect(observableOutput).not.toContain(disposableDatabaseUrl);
    expect(await readFile(contract.lifecyclePath, 'utf8')).toBe('seed\nverify-current\ncleanup\n');
  });

  test('bounds a proof subprocess with open handles and still cleans up', async () => {
    const contract = await contractEnvironment({ currentAuthenticationHang: true });
    const startedAt = performance.now();
    const result = runCompatibility({ ...contract.env, PREVIOUS_API_IMAGE: productionDigest });
    const durationMs = performance.now() - startedAt;

    expect(durationMs).toBeLessThan(1_000);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain('failed current authentication');
    expect(await readFile(contract.lifecyclePath, 'utf8')).toBe('seed\nverify-timeout\ncleanup\n');
  });

  test('accepts an exact supplied repository digest found after another RepoDigest alias', async () => {
    const contract = await contractEnvironment({
      repoDigests: `other.example/index-api@sha256:${'c'.repeat(64)}\\n${productionDigest}\\n`,
    });
    const result = runCompatibility({ ...contract.env, PREVIOUS_API_IMAGE: productionDigest });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(await readFile(contract.reportPath, 'utf8')).imageDigest).toBe(productionDigest);
  });

  test('rejects a different repository alias even when its digest suffix matches', async () => {
    const contract = await contractEnvironment({
      repoDigests: `other.example/index-api@sha256:${'a'.repeat(64)}\\n`,
    });
    const result = runCompatibility({ ...contract.env, PREVIOUS_API_IMAGE: productionDigest });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain('exact supplied repository and digest');
  });

  test('fails protected mode when the pulled image has no RepoDigest', async () => {
    const contract = await contractEnvironment({ repoDigests: '' });
    const result = runCompatibility({
      ...contract.env,
      PREVIOUS_API_IMAGE: productionDigest,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain('RepoDigest');
    expect(await Bun.file(contract.reportPath).exists()).toBe(false);
  });

  test('allows the local fixture only in test mode and still requires exact rejection', async () => {
    const contract = await contractEnvironment();
    const result = runCompatibility({
      ...contract.env,
      NODE_ENV: 'test',
      ALLOW_MUTABLE_PREVIOUS_IMAGE: '1',
      PREVIOUS_API_IMAGE: 'index-api-previous-fixture:local',
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(await readFile(contract.reportPath, 'utf8'))).toMatchObject({
      imageDigest: localImageId,
      rejected: true,
      status: 401,
    });
  });

  test('fails and cleans up when the previous API accepts the dedicated credential', async () => {
    const contract = await contractEnvironment({ probeStatus: 200 });
    const result = runCompatibility({
      ...contract.env,
      PREVIOUS_API_IMAGE: productionDigest,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain('expected HTTP 401');
    expect(await Bun.file(contract.reportPath).exists()).toBe(false);
    expect(await readFile(contract.lifecyclePath, 'utf8')).toBe('seed\nverify-current\nstop\nrm\ncleanup\n');
  });

  test('seeds and removes the complete current dedicated authority contract', async () => {
    const script = await readFile(scriptPath, 'utf8');
    const permissionInsert = script.indexOf('INSERT INTO agent_permissions');
    const permissionDelete = script.indexOf('DELETE FROM agent_permissions WHERE id = $1');
    const credentialDelete = script.indexOf('DELETE FROM hermes_agent_credentials WHERE id = $1');

    expect(permissionInsert).toBeGreaterThan(-1);
    expect(script).toContain("'global', ${tx.array(actions)}");
    expect(script).toMatch(/status,\s+runtime_kind, installation_id,\s+runtime_setup_attempt_id/);
    expect(script).toContain('resolveHermesAgentCredential(credential)');
    expect(script).toContain('SELECT count(*)::int AS count FROM apikey WHERE key =');
    expect(permissionDelete).toBeGreaterThan(-1);
    expect(credentialDelete).toBeGreaterThan(permissionDelete);
  });

  test('bounds every database Bun subprocess and exits proof only after local pool shutdown', async () => {
    const script = await readFile(scriptPath, 'utf8');
    expect(script.match(/timeout --signal=TERM --kill-after=5s 20s bun -/g)).toHaveLength(3);
    const proof = script.slice(script.indexOf('HERMES_COMPAT_OPERATION=verify-current'));
    expect(proof).toContain('process.exit(0);');
    expect(proof.indexOf('process.exit(0);')).toBeGreaterThan(proof.indexOf('await sql.end();'));
  });

  test('disables Docker request logs and documents the external-sink boundary', async () => {
    const script = await readFile(scriptPath, 'utf8');
    const report = await readFile(taskReportPath, 'utf8');
    expect(script).toContain('--log-driver none');
    expect(report).toContain('independent external logging sink');
  });
});

describe('workflow compatibility modes', () => {
  test('builds the derived approved rollback-base API and keeps it distinct from protected evidence', async () => {
    const workflow = await readFile(workflowPath, 'utf8');

    expect(workflow).toContain('previous-api-pr-base-evidence:');
    expect(workflow).toContain('Non-production PR rollback-base API evidence');
    expect(workflow).toContain(`EXPECTED_ROLLBACK_BASE_SHA: ${approvedRollbackBaseSha}`);
    expect(workflow).toContain('git merge-base origin/main origin/feat/hermes-secure-standalone-connect');
    expect(workflow).toContain('git archive "$derived_base_sha"');
    expect(workflow).toContain('previous-api-base.Dockerfile');
    expect(workflow).not.toContain('Build local previous-API fixture');
    expect(workflow).toContain('previous-api-compatibility-base-${{ steps.rollback_base.outputs.base_sha }}.json');
    expect(workflow).toContain('previous-api-protected-compatibility:');
    expect(workflow).toContain('environment: production');
    expect(workflow).toContain('PREVIOUS_API_IMAGE: ${{ inputs.PREVIOUS_API_IMAGE }}');
    expect(workflow).toContain('required: true');
    const protectedJob = workflow.slice(workflow.indexOf('previous-api-protected-compatibility:'));
    expect(protectedJob).not.toMatch(/PREVIOUS_API_IMAGE:\s*(?:ghcr|docker|index-api|sha256)/);
  });

  test('pins both image harnesses and installs only from a frozen repository lockfile', async () => {
    const fixtureDockerfile = await readFile(fixtureDockerfilePath, 'utf8');
    const baseDockerfile = await readFile(baseDockerfilePath, 'utf8').catch(() => '');
    for (const dockerfile of [fixtureDockerfile, baseDockerfile]) {
      expect(dockerfile).toMatch(/^FROM oven\/bun:1\.3\.14-alpine@sha256:[0-9a-f]{64}$/m);
      expect(dockerfile).toContain('bun install --frozen-lockfile');
      expect(dockerfile).not.toContain('bun add');
    }
    expect(baseDockerfile).toContain('CMD ["bun", "--preload", "./dist/instrument.js", "./dist/main.js"]');
  });

  test('the synthetic contract server hashes legacy credentials with the historical algorithm', async () => {
    const fixtureServer = await readFile(fixtureServerPath, 'utf8');
    expect(fixtureServer).toContain("crypto.subtle.digest('SHA-256'");
    expect(fixtureServer).toContain("Buffer.from(digest).toString('base64url')");
    expect(fixtureServer).toContain('WHERE key = ${credentialHash}');
    expect(fixtureServer).not.toContain('WHERE key = ${credential}');
  });
});
