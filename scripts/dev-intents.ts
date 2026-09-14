#!/usr/bin/env bun
import { setTimeout as sleep } from 'node:timers/promises';
import type postgres from 'postgres';

import { DEV, RESET_LOCK, REPLAY_LOCK, acquireLock, devDatabaseUrl, openDevControl, resetReplay } from '../services/api/src/cli/dev-intents';

const targetArgs = ['--project', DEV.project, '--environment', DEV.environment, '--service', DEV.service];
const worker = '/app/services/api/dist/cli/dev-intents.js';
const deploymentFields = 'id environmentId serviceId status deploymentStopped instances { id status }';

export interface Deployment {
  id: string;
  environmentId: string;
  serviceId: string;
  status: string;
  deploymentStopped: boolean;
  instances: Array<{ id: string; status: string }>;
}

async function railwayJson<T>(args: string[]): Promise<T> {
  const child = Bun.spawn(['railway', ...args], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (code !== 0) throw new Error(`Railway ${args[0]} failed: ${stderr.trim()}`);
  return JSON.parse(stdout) as T;
}

async function api<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const response = await railwayJson<{ data: T; errors?: Array<{ message: string }> }>([
    'api', query, '--variables', JSON.stringify(variables),
  ]);
  if (response.errors?.length) throw new Error(response.errors.map(error => error.message).join('; '));
  return response.data;
}

async function deployments(): Promise<Deployment[]> {
  const data = await api<{ deployments: { edges: Array<{ node: Deployment }> } }>(
    `query($input: DeploymentListInput!) { deployments(input: $input, first: 20) { edges { node { ${deploymentFields} } } } }`,
    { input: { projectId: DEV.project, environmentId: DEV.environment, serviceId: DEV.service } },
  );
  return data.deployments.edges.map(edge => edge.node);
}

function assertSettled(records: Deployment[]): void {
  for (const deployment of records) {
    if (deployment.environmentId !== DEV.environment || deployment.serviceId !== DEV.service) {
      throw new Error('Railway returned a deployment outside the dev API service.');
    }
    if (!['SUCCESS', 'REMOVED', 'FAILED', 'CRASHED', 'SKIPPED'].includes(deployment.status)) {
      throw new Error(`Railway deployment ${deployment.id} is ${deployment.status}; wait for deployment activity to finish.`);
    }
  }
}

/** Select the actual running image; the newest deployment can be SKIPPED. */
export function runningDeployment(records: Deployment[]): Deployment {
  assertSettled(records);
  const running = records.filter(deployment => deployment.instances.some(instance => instance.status === 'RUNNING'));
  if (running.length !== 1 || running[0].status !== 'SUCCESS' || running[0].deploymentStopped
    || running[0].instances.filter(instance => instance.status === 'RUNNING').length !== 1) {
    throw new Error('Expected exactly one healthy running Railway dev API instance.');
  }
  return running[0];
}

async function readDeployment(id: string): Promise<Deployment> {
  const { deployment } = await api<{ deployment: Deployment }>(
    `query($id: String!) { deployment(id: $id) { ${deploymentFields} } }`, { id },
  );
  if (deployment.environmentId !== DEV.environment || deployment.serviceId !== DEV.service) {
    throw new Error('The pinned deployment is outside Railway dev.');
  }
  return deployment;
}

async function changeDeployment(id: string, action: 'deploymentStop' | 'deploymentRestart'): Promise<void> {
  const data = await api<Record<string, boolean>>(`mutation($id: String!) { ${action}(id: $id) }`, { id });
  if (data[action] !== true) throw new Error(`Railway did not acknowledge ${action} for ${id}.`);
}

async function waitForDeployment(id: string, stopped: boolean): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const deployment = await readDeployment(id);
    const exited = deployment.instances.every(instance => ['EXITED', 'REMOVED'].includes(instance.status));
    if (stopped ? deployment.deploymentStopped && exited
      : !deployment.deploymentStopped && deployment.status === 'SUCCESS'
        && deployment.instances.some(instance => instance.status === 'RUNNING')) return;
    await sleep(2_000);
  }
  throw new Error(`Timed out waiting for deployment ${id} to ${stopped ? 'stop' : 'restart'}.`);
}

async function waitForHealth(): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(DEV.health, { signal: AbortSignal.timeout(5_000) });
      if (response.ok && (await response.json() as { status?: string }).status === 'ok') return;
    } catch { /* The instance may still be starting. */ }
    await sleep(2_000);
  }
  throw new Error('Railway dev did not pass its health check after restart.');
}

/** Stop all dev writers before cleanup, then restore the exact image even on failure. */
export async function resetDeployment(control: postgres.Sql, deployment: Deployment): Promise<void> {
  await acquireLock(control, RESET_LOCK);
  let stopRequested = false;
  const interrupt = () => console.log('[dev-intents] Finishing the current reset and restoring the API before exiting.');
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  try {
    // Recheck after obtaining the reset lock: a deployment or another reset may have intervened.
    if (runningDeployment(await deployments()).id !== deployment.id) throw new Error('The running deployment changed; rerun reset.');
    stopRequested = true;
    console.log(`[dev-intents] Stopping API deployment ${deployment.id} and its replay process.`);
    await changeDeployment(deployment.id, 'deploymentStop');
    await waitForDeployment(deployment.id, true);
    const current = await deployments();
    assertSettled(current);
    if (current.some(record => record.instances.some(instance => !['EXITED', 'REMOVED'].includes(instance.status)))) {
      throw new Error('A dev deployment still has a live instance; refusing to clear data.');
    }
    await acquireLock(control, REPLAY_LOCK);
    await resetReplay(control);
  } finally {
    try {
      if (stopRequested) {
        // If the connection was lost, reacquire the reset lock before recovery.
        await acquireLock(control, RESET_LOCK);
        console.log(`[dev-intents] Restarting API deployment ${deployment.id}.`);
        await changeDeployment(deployment.id, 'deploymentRestart');
        await waitForDeployment(deployment.id, false);
        await waitForHealth();
        console.log('[dev-intents] Railway dev API is healthy.');
      }
    } finally {
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', interrupt);
    }
  }
  console.log('[dev-intents] Reset complete. Run bun run db:dev:resume --confirm to begin again.');
}

async function main(): Promise<void> {
  const [action, confirm, ...extra] = process.argv.slice(2);
  if (!['resume', 'reset'].includes(action) || confirm !== '--confirm' || extra.length) {
    throw new Error('Use bun run db:dev:resume --confirm or bun run db:dev:reset --confirm.');
  }
  // Always fetch the pinned Railway service's variables; never read a local env file.
  const variables = await railwayJson<Record<string, string>>(['variables', ...targetArgs, '--json']);
  devDatabaseUrl(variables.DATABASE_URL);
  const deployment = runningDeployment(await deployments());
  console.log(`[dev-intents] Target: Railway dev / ${DEV.database} / ${DEV.hostname}`);
  if (action === 'resume') {
    const instance = deployment.instances.find(instance => instance.status === 'RUNNING')!;
    const sshArgs = ['ssh', ...targetArgs, '--deployment-instance', instance.id, '--'];
    // The non-interactive preflight also detects missing registered SSH keys without prompting.
    const check = Bun.spawn(['railway', ...sshArgs, 'test', '-f', worker], { stdin: 'ignore', stdout: 'ignore', stderr: 'inherit' });
    if (await check.exited !== 0) throw new Error('Resume requires a registered Railway SSH key and this CLI in the deployed image. See services/api/README.md.');
    const child = Bun.spawn(['railway', ...sshArgs, 'sh', '-c', `exec bun ${worker} resume --confirm`], {
      stdin: 'inherit', stdout: 'inherit', stderr: 'inherit',
    });
    // SSH's foreground terminal sends Ctrl+C to the remote runner, which drains its scans.
    const keepWaiting = () => {};
    process.on('SIGINT', keepWaiting);
    try { process.exitCode = await child.exited; }
    finally { process.off('SIGINT', keepWaiting); }
  } else {
    let closing = false;
    const pool = openDevControl(variables.DATABASE_URL, () => {
      if (!closing) console.error('[dev-intents] Control connection closed; any uncommitted cleanup is rolled back.');
    });
    try { await resetDeployment(pool, deployment); }
    finally { closing = true; await pool.end({ timeout: 5 }); }
  }
}

if (import.meta.main) {
  await main().catch((error: unknown) => {
    console.error('[dev-intents]', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
