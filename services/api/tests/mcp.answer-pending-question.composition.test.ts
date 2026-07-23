import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

const mcp = readFileSync(new URL('../src/controllers/mcp.controller.ts', import.meta.url), 'utf8');
const factory = readFileSync(new URL('../../../packages/protocol/src/shared/agent/tool.factory.ts', import.meta.url), 'utf8');
const tools = readFileSync(new URL('../../../packages/protocol/src/questioner/questioner.tools.ts', import.meta.url), 'utf8');
const direct = readFileSync(new URL('../src/services/tool.service.ts', import.meta.url), 'utf8');

describe('MCP/direct answer_pending_question composition', () => {
  it('wires lookup and canonical answer dependencies into MCP and chat factories', () => {
    expect(mcp).toContain('findPendingQuestions: findPendingQuestionsForTools');
    expect(mcp).toContain('answerPendingQuestion: answerPendingQuestionForTools');
    expect(mcp).toContain('questionService.answer(questionId, userId');
    expect(mcp).toContain('answerPendingQuestion: protocolDeps.answerPendingQuestion');
    expect(factory).toContain('answerPendingQuestion: deps.answerPendingQuestion');
  });

  it('keeps authenticated principal and network-scope refusal ahead of the host bridge', () => {
    expect(tools).toContain('focusedNetworkId(context)');
    expect(tools.indexOf('focusedNetworkId(context)')).toBeLessThan(tools.indexOf('deps.answerPendingQuestion('));
    expect(tools).toContain('deps.findPendingQuestions(context.userId');
    expect(tools).toContain('deps.answerPendingQuestion(context.userId');
  });

  it('leaves no alternate direct-tool settlement bypass around the authoritative adapter', () => {
    expect(direct).toContain('questionerAdapter.answer(questionId, userId');
    expect(direct).not.toContain('update(tasks)');
    expect(direct).not.toContain('getNegotiationTaskForOpportunity');
  });
});
