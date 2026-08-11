import { afterEach, describe, expect, test } from 'bun:test';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const apiRoot = resolve(import.meta.dir, '../../..');
const scriptPath = resolve(apiRoot, 'scripts/verify-hermes-previous-api-compatibility.sh');
const workflowPath = resolve(apiRoot, '../../.github/workflows/hermes-backend-production-assurance.yml');
const productionDigest = `registry.example/index-api@sha256:${'a'.repeat(64)}`;
const localImageId = `sha256:${'b'.repeat(64)}`;
const disposableDatabaseUrl = 'postgres://postgres:postgres@127.0.0.1:5432/hermes_assurance';
const temporaryDirectories: string[] = [];

async function executable(path: string, source: string) {
  await writeFile(path, source);
  await chmod(path, 0o755);
}

async function contractEnvironment(options: {
  repoDigest?: string;
  probeStatus?: number;
  seedFailure?: boolean;
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
    ${options.seedFailure ? `printf '%s\\n' "idxh_contractSecret contractCredentialHash ${disposableDatabaseUrl}" >&2; exit 68` : `printf 'seed\\n' >>"${lifecyclePath}"`}
    ;;
  cleanup)
    printf 'cleanup\\n' >>"${lifecyclePath}"
    ${options.cleanupFailure ? `printf '%s\\n' "idxh_contractSecret contractCredentialHash ${disposableDatabaseUrl}" >&2; exit 69` : ':'}
    ;;
  *) exit 64 ;;
esac
`);
  await executable(resolve(bin, 'docker'), `#!/usr/bin/env bash
set -euo pipefail
command="\${1:-}"
shift || true
case "$command" in
  pull) exit 0 ;;
  inspect)
    case "$*" in
      *RepoDigests*) printf '%s\\n' '${options.repoDigest ?? productionDigest}' ;;
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
    expect(await readFile(contract.lifecyclePath, 'utf8')).toBe('seed\nstop\nrm\ncleanup\n');
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
    expect(await readFile(contract.lifecyclePath, 'utf8')).toBe('seed\nstop\nrm\ncleanup\n');
  });

  test('fails protected mode when the pulled image has no RepoDigest', async () => {
    const contract = await contractEnvironment({ repoDigest: '' });
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
    expect(await readFile(contract.lifecyclePath, 'utf8')).toBe('seed\nstop\nrm\ncleanup\n');
  });
});

describe('workflow compatibility modes', () => {
  test('keeps PR fixture evidence separate from the protected release-ops gate', async () => {
    const workflow = await readFile(workflowPath, 'utf8');

    expect(workflow).toContain('previous-api-pr-fixture-evidence:');
    expect(workflow).toContain('Non-production PR fixture compatibility evidence');
    expect(workflow).toContain('previous-api-protected-compatibility:');
    expect(workflow).toContain('environment: production');
    expect(workflow).toContain('PREVIOUS_API_IMAGE: ${{ inputs.PREVIOUS_API_IMAGE }}');
    expect(workflow).toContain('required: true');
    const protectedJob = workflow.slice(workflow.indexOf('previous-api-protected-compatibility:'));
    expect(protectedJob).not.toMatch(/PREVIOUS_API_IMAGE:\s*(?:ghcr|docker|index-api|sha256)/);
  });
});
