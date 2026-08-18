import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { parse } from 'yaml';

const apiRoot = path.resolve(import.meta.dir, '../../..');
const manifest = readFileSync(path.join(apiRoot, '.test-isolated'), 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith('#'));

const minimumArguments: Record<string, number> = {
  pickup: 3,
  respond: 5,
  consult: 5,
  respondHermes: 6,
};

const principalArgumentIndex: Record<string, number> = {
  pickup: 2,
  respond: 4,
  consult: 4,
  respondHermes: 4,
};

function serviceCalls(sourceText: string, fileName: string): Array<{
  method: string;
  argumentCount: number;
  principalArgument: string | null;
  line: number;
}> {
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const calls: Array<{ method: string; argumentCount: number; principalArgument: string | null; line: number }> = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      if (method in minimumArguments) {
        const principal = node.arguments[principalArgumentIndex[method]];
        calls.push({
          method,
          argumentCount: node.arguments.length,
          principalArgument: principal?.getText(sourceFile) ?? null,
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return calls;
}

describe('registered negotiation-polling isolated fixture contract', () => {
  it('passes a credential principal to every direct pickup/respond/consult call', () => {
    const staleCalls: string[] = [];
    for (const relativePath of manifest) {
      const source = readFileSync(path.join(apiRoot, relativePath), 'utf8');
      if (!source.includes('negotiation-polling.service')) continue;
      for (const call of serviceCalls(source, relativePath)) {
        if (call.argumentCount < minimumArguments[call.method]) {
          staleCalls.push(`${relativePath}:${call.line} ${call.method} has ${call.argumentCount} arguments`);
        }
        if (!call.principalArgument || call.principalArgument === 'undefined' || call.principalArgument === 'null') {
          staleCalls.push(`${relativePath}:${call.line} ${call.method} has no credential-principal expression`);
        }
      }
    }

    expect(staleCalls).toEqual([]);
  });

  it('keeps every DB-backed direct fixture on production-shaped executor authority', () => {
    const violations: string[] = [];
    for (const relativePath of manifest) {
      const source = readFileSync(path.join(apiRoot, relativePath), 'utf8');
      const calls = source.includes('negotiation-polling.service')
        ? serviceCalls(source, relativePath)
        : [];
      if (calls.length === 0 || !source.includes("config({ path: '.env.test'")) continue;

      const provisionsSelectedExecutor = source.includes('setNegotiationExecutorBinding({')
        || source.includes('.setRuntime(');
      if (!provisionsSelectedExecutor) violations.push(`${relativePath}: selected executor is not provisioned`);
      if (!source.includes('credentialId:')) violations.push(`${relativePath}: credential principal is missing`);
      if (
        !source.includes('manage:negotiations')
        && !source.includes('exactTargetPermissions:')
        && !source.includes('.setRuntime(')
      ) {
        violations.push(`${relativePath}: global negotiation authority is not provisioned`);
      }
    }

    expect(violations).toEqual([]);
  });

  it('keeps the max-turn fixture registered and executed through the fresh-process import harness in security CI', () => {
    const maxTarget = 'src/services/tests/negotiation-polling.max-turns.isolated.ts';
    expect(manifest).toContain(maxTarget);

    const workflowPath = path.resolve(apiRoot, '../../.github/workflows/hermes-runtime-security.yml');
    const workflow = parse(readFileSync(workflowPath, 'utf8')) as {
      jobs?: Record<string, { steps?: Array<{ run?: string }> }>;
    };
    const runScripts = Object.values(workflow.jobs ?? {})
      .flatMap((job) => job.steps ?? [])
      .flatMap((step) => typeof step.run === 'string' ? [step.run] : []);
    expect(runScripts.some((run) =>
      run.includes(`API_TEST_ISOLATED_TARGET=${maxTarget}`)
      && run.includes('isolated-test-import-harness.spec.ts'))).toBe(true);
  });

  it.each([
    'src/services/tests/negotiation-polling.seat.isolated.ts',
    'src/services/tests/negotiation-polling.memory.isolated.ts',
    'src/adapters/tests/archive-legacy-negotiations.isolated.ts',
  ])('%s uses the exact selected legacy principal without an authorization bypass', (relativePath) => {
    const source = readFileSync(path.join(apiRoot, relativePath), 'utf8');

    expect(source).toContain('setNegotiationExecutorBinding({');
    expect(source).toContain('exactTargetPermissions: false');
    expect(source).toContain('audience: null');
    expect(source).toContain('setupAttemptId: null');
    expect(source).not.toContain('authorizePickup: async () => true');
    expect(source).not.toContain('authorizeRespond: async () => true');
  });

  it('raw agent_permissions upserts supply id before ON CONFLICT', () => {
    const source = readFileSync(path.join(apiRoot, 'src/adapters/agent.database.adapter.ts'), 'utf8');
    expect(source).toContain('INSERT INTO agent_permissions (id, agent_id, user_id, scope, scope_id, actions)');
    expect(source).not.toContain('INSERT INTO agent_permissions (agent_id, user_id, scope, scope_id, actions)');
  });
});
