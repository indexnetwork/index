import { describe, expect, it } from 'bun:test';
import { PgDialect, getTableConfig } from 'drizzle-orm/pg-core';
import path from 'node:path';

import { createEmergencyPlan, formatEmergencyOutput, type EmergencySnapshot } from '../hermes-emergency-control.contract';
import { parseHermesEmergencyArguments, runHermesEmergencyMain } from '../hermes-emergency-control.main';
import { emergencyEmptyTargetPermissionDeleteQuery, emergencyExecutionLockQuery, emergencyOwnerLockQuery, emergencyPermissionUpdateQuery, executeEmergencyControl, planEmergencyControl } from '../hermes-emergency-control';
import { hermesEmergencyReceipts } from '../../schemas/database.schema';

const snapshot: EmergencySnapshot = {
  agents: [
    {
      id: 'agent-b', ownerId: 'owner-b', installationId: 'install-b',
      status: 'active', handleNegotiations: true, setupAttemptId: 'generation-b',
    },
    {
      id: 'agent-a', ownerId: 'owner-a', installationId: 'install-a',
      status: 'active', handleNegotiations: false, setupAttemptId: 'generation-a',
    },
  ],
  credentials: [
    {
      id: 'credential-a', ownerId: 'owner-a', agentId: 'agent-a',
      installationId: 'install-a', setupAttemptId: 'generation-a',
      activationState: 'active', actions: ['manage:intents', 'manage:negotiations'],
    },
  ],
  permissions: [
    {
      id: 'permission-a', agentId: 'agent-a', ownerId: 'owner-a', userId: 'owner-a',
      scope: 'global', scopeId: null, actions: ['manage:intents', 'manage:negotiations'],
    },
  ],
};

describe('Hermes emergency control contract', () => {
  it('builds a deterministic count-only opaque plan bound to the exact snapshot', () => {
    const first = createEmergencyPlan(snapshot, 'hermes-agent');
    const reordered = createEmergencyPlan({
      agents: [...snapshot.agents].reverse(),
      credentials: [...snapshot.credentials].reverse(),
      permissions: [...snapshot.permissions].reverse(),
    }, 'hermes-agent');

    expect(first).toEqual(reordered);
    expect(first).toEqual({
      planId: expect.stringMatching(/^hecp_[A-Za-z0-9_-]{43}$/),
      audience: 'hermes-agent',
      installations: 2,
      credentials: 1,
      permissions: 1,
      owners: 2,
      reason: 'dry-run',
    });
    const output = JSON.stringify(first);
    for (const identifier of ['agent-a', 'owner-a', 'install-a', 'credential-a', 'permission-a', 'generation-a']) {
      expect(output).not.toContain(identifier);
    }

    const drifted = structuredClone(snapshot);
    drifted.permissions[0]!.actions = ['manage:negotiations'];
    expect(createEmergencyPlan(drifted, 'hermes-agent').planId).not.toBe(first.planId);
  });

  it('binds credential identity and mutation fields without selecting a credential hash', async () => {
    for (const mutate of [
      (value: EmergencySnapshot) => { value.credentials[0]!.id = 'credential-b'; },
      (value: EmergencySnapshot) => { value.credentials[0]!.setupAttemptId = 'generation-b'; },
      (value: EmergencySnapshot) => { value.credentials[0]!.activationState = 'pending'; },
      (value: EmergencySnapshot) => { value.credentials[0]!.actions = ['manage:negotiations']; },
    ]) {
      const changed = structuredClone(snapshot);
      mutate(changed);
      expect(createEmergencyPlan(changed, 'hermes-agent').planId)
        .not.toBe(createEmergencyPlan(snapshot, 'hermes-agent').planId);
    }
    const implementation = await Bun.file(path.resolve(import.meta.dir, '../hermes-emergency-control.ts')).text();
    const credentialProjection = implementation.slice(
      implementation.indexOf('const credentials ='),
      implementation.indexOf('const permissions ='),
    );
    expect(credentialProjection).not.toContain('secretHash');
    expect(credentialProjection).not.toContain('secret_hash');
  });

  it('refuses every non-dedicated audience', () => {
    for (const audience of ['generic', 'legacy', 'negotiator', 'index-owner', 'unknown', '', 'Hermes-agent']) {
      expect(() => createEmergencyPlan(snapshot, audience)).toThrow('audience must be exactly hermes-agent');
    }
  });

  it('formats only approved count, reason, duration and opaque ID fields', () => {
    const plan = createEmergencyPlan(snapshot, 'hermes-agent');
    const rendered = formatEmergencyOutput({ ...plan, durationMs: 12.5, ignored: 'owner-a' } as never);
    expect(JSON.parse(rendered)).toEqual({
      planId: plan.planId,
      audience: 'hermes-agent',
      installations: 2,
      credentials: 1,
      permissions: 1,
      owners: 2,
      reason: 'dry-run',
      durationMs: 12.5,
    });
    expect(rendered).not.toContain('owner-a');
  });
});

describe('Hermes emergency CLI arguments', () => {
  it('defaults to dry-run and requires the exact audience', () => {
    expect(parseHermesEmergencyArguments(['--audience', 'hermes-agent'])).toEqual({
      mode: 'plan', audience: 'hermes-agent',
    });
    for (const audience of ['generic', 'legacy', 'negotiator', 'index-owner', 'unknown']) {
      expect(() => parseHermesEmergencyArguments(['--audience', audience]))
        .toThrow('audience must be exactly hermes-agent');
    }
  });

  it('refuses unconfirmed or malformed direct execution before database access', async () => {
    const unreachableDatabase = { transaction: () => { throw new Error('database reached'); } } as never;
    await expect(planEmergencyControl(unreachableDatabase, { audience: 'generic' }))
      .rejects.toThrow('audience must be exactly hermes-agent');
    await expect(executeEmergencyControl(unreachableDatabase, {
      planId: `hecp_${'a'.repeat(43)}`, expectedInstallations: 0, confirm: false,
    })).rejects.toThrow('confirmation required');
    await expect(executeEmergencyControl(unreachableDatabase, {
      planId: 'owner-a', expectedInstallations: 0, confirm: true,
    })).rejects.toThrow('planId must be an opaque Hermes emergency plan ID');
    await expect(executeEmergencyControl(unreachableDatabase, {
      planId: `hecp_${'a'.repeat(43)}`, expectedInstallations: -1, confirm: true,
    })).rejects.toThrow('expected count mismatch');
  });

  it('accepts only canonical nonnegative decimal expected-installation syntax before database initialization', async () => {
    const base = [
      '--audience', 'hermes-agent', '--confirm', '--plan-id', `hecp_${'a'.repeat(43)}`,
      '--expected-installations',
    ] as const;
    for (const value of ['', ' ', '\t', '0x10', '2e0', '+2', '-0', '02', '2.0', 'NaN', 'Infinity']) {
      const args = [...base, value];
      expect(() => parseHermesEmergencyArguments(args)).toThrow(
        '--expected-installations must be a canonical non-negative decimal safe integer',
      );
      let databaseInitializations = 0;
      await expect(runHermesEmergencyMain({
        args,
        plan: async () => { databaseInitializations += 1; throw new Error('database reached'); },
        execute: async () => { databaseInitializations += 1; throw new Error('database reached'); },
      })).rejects.toThrow('--expected-installations must be a canonical non-negative decimal safe integer');
      expect(databaseInitializations).toBe(0);
    }
    expect(parseHermesEmergencyArguments([...base, '0'])).toMatchObject({ expectedInstallations: 0 });
    expect(parseHermesEmergencyArguments([...base, '9007199254740991']))
      .toMatchObject({ expectedInstallations: Number.MAX_SAFE_INTEGER });
    expect(() => parseHermesEmergencyArguments([...base, '9007199254740992'])).toThrow(
      '--expected-installations must be a canonical non-negative decimal safe integer',
    );
  });

  it('requires the complete exact confirmation triple and refuses unknown or duplicate flags', () => {
    expect(parseHermesEmergencyArguments([
      '--audience', 'hermes-agent', '--confirm', '--plan-id', `hecp_${'a'.repeat(43)}`,
      '--expected-installations', '2',
    ])).toEqual({
      mode: 'execute', audience: 'hermes-agent', confirm: true,
      planId: `hecp_${'a'.repeat(43)}`, expectedInstallations: 2,
    });

    const invalid: readonly string[][] = [
      ['--audience', 'hermes-agent', '--confirm'],
      ['--audience', 'hermes-agent', '--plan-id', `hecp_${'a'.repeat(43)}`, '--expected-installations', '2'],
      ['--audience', 'hermes-agent', '--confirm', '--plan-id', 'raw-owner-id', '--expected-installations', '2'],
      ['--audience', 'hermes-agent', '--confirm', '--plan-id', `hecp_${'a'.repeat(43)}`, '--expected-installations', '-1'],
      ['--audience', 'hermes-agent', '--confirm', '--plan-id', `hecp_${'a'.repeat(43)}`, '--expected-installations', '2', '--unknown'],
      ['--audience', 'hermes-agent', '--audience', 'hermes-agent'],
    ];
    for (const args of invalid) expect(() => parseHermesEmergencyArguments(args)).toThrow();
  });
});

describe('Hermes emergency receipt schema and migration', () => {
  it('registers the exact maintenance command and guarded disposable database target', async () => {
    const apiRoot = path.resolve(import.meta.dir, '../../..');
    const packageJson = await Bun.file(path.join(apiRoot, 'package.json')).json() as { scripts: Record<string, string> };
    expect(packageJson.scripts['maintenance:hermes-emergency-control'])
      .toBe('bun ./src/cli/hermes-emergency-control.ts');
    const inventory = await Bun.file(path.join(apiRoot, '.test-isolated')).text();
    expect(inventory.match(/src\/lib\/drizzle\/tests\/hermes-emergency-control\.database\.isolated\.ts/g)).toHaveLength(1);
    const databaseSuite = await Bun.file(path.join(
      apiRoot, 'src/lib/drizzle/tests/hermes-emergency-control.database.isolated.ts',
    )).text();
    expect(databaseSuite).toContain("process.env.TEST_DATABASE_SAFE !== '1'");
    expect(databaseSuite).toContain("databaseName !== 'hermes_assurance'");
    expect(databaseSuite).not.toContain('process.env.TEST_DATABASE_SAFE =');
    const implementation = await Bun.file(path.join(apiRoot, 'src/cli/hermes-emergency-control.ts')).text();
    const cliEntry = implementation.slice(implementation.indexOf('if (import.meta.main)'));
    expect(cliEntry).not.toContain('afterPlanSnapshot');
    expect(cliEntry).not.toContain('afterPreliminaryPlan');
    expect(cliEntry).not.toContain('afterMutations');
  });

  it('stores only opaque identity, bounded reason, counts and creation time', async () => {
    const table = getTableConfig(hermesEmergencyReceipts);
    expect(table.name).toBe('hermes_emergency_receipts');
    expect(table.columns.map((column) => column.name)).toEqual([
      'plan_id', 'audience', 'installations', 'credentials', 'permissions', 'owners',
      'selected_paused', 'credentials_revoked', 'permissions_removed',
      'installations_disconnected', 'result_reason', 'created_at',
    ]);
    const forbidden = ['owner_id', 'agent_id', 'installation_id', 'credential_id', 'secret', 'hash', 'database_url', 'error'];
    for (const name of forbidden) expect(table.columns.some((column) => column.name === name)).toBe(false);

    const migration = await Bun.file(path.resolve(import.meta.dir, '../../../drizzle/0124_add_hermes_emergency_receipts.sql')).text();
    expect(migration).toContain('CREATE TABLE "hermes_emergency_receipts"');
    expect(migration).toContain('PRIMARY KEY');
    expect(migration).toContain("= 'hermes-agent'");
    expect(migration).toContain("= 'executed'");
    for (const name of forbidden) expect(migration).not.toContain(`"${name}"`);
  });
});

describe('Hermes emergency rendered SQL boundaries', () => {
  const dialect = new PgDialect();

  it('binds execution and owner lock keys as explicitly cast scalars', () => {
    const execution = dialect.sqlToQuery(emergencyExecutionLockQuery(`hecp_${'a'.repeat(43)}`));
    expect(execution.sql).toContain('hashtextextended($1::text, 0)');
    expect(execution.params).toEqual([`hermes-emergency-control:hecp_${'a'.repeat(43)}`]);
    const owner = dialect.sqlToQuery(emergencyOwnerLockQuery('owner-a'));
    expect(owner.sql).toContain('hashtextextended($1::text, 0)');
    expect(owner.params).toEqual(['agent-runtime:owner-a']);
  });

  it('binds snapshot permission IDs and action scalars for delete-then-update mutation', () => {
    const ids = ['permission-b', 'permission-a'];
    const deletion = dialect.sqlToQuery(emergencyEmptyTargetPermissionDeleteQuery(ids));
    expect(deletion.sql).toContain('DELETE FROM agent_permissions');
    expect(deletion.sql).toContain('WHERE id IN');
    expect(deletion.sql).toContain('cardinality(array_remove');
    expect(deletion.sql).not.toContain('cardinality(actions) = 0');
    expect(deletion.sql).toContain('RETURNING id');
    expect(deletion.params).toEqual([
      'permission-a', 'permission-b', 'manage:negotiations', 'manage:negotiations',
    ]);

    const update = dialect.sqlToQuery(emergencyPermissionUpdateQuery(ids));
    expect(update.sql).toContain('UPDATE agent_permissions');
    expect(update.sql).toContain('array_remove');
    expect(update.sql).toContain('RETURNING id');
    expect(update.params).toEqual([
      'manage:negotiations', 'permission-a', 'permission-b', 'manage:negotiations',
    ]);
    expect([...deletion.params, ...update.params].every((parameter) => !Array.isArray(parameter))).toBe(true);
    expect(() => emergencyEmptyTargetPermissionDeleteQuery([])).toThrow('permission target IDs required');
    expect(() => emergencyPermissionUpdateQuery([])).toThrow('permission target IDs required');
  });
});
