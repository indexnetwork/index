/**
 * Unit tests for OpportunityGraphState. A minimal LangGraph with a pass-through
 * node is compiled so we exercise the Annotation.Root reducers end-to-end rather
 * than introspecting Annotation internals (which shift across versions).
 */

import { describe, it, expect } from 'bun:test';
import { END, START, StateGraph } from '@langchain/langgraph';
import { OpportunityGraphState } from '../opportunity.state.js';

function buildPassThroughGraph() {
  return new StateGraph(OpportunityGraphState)
    .addNode('passthrough', (state) => ({ userId: state.userId }))
    .addEdge(START, 'passthrough')
    .addEdge('passthrough', END)
    .compile();
}

describe('OpportunityGraphState', () => {
  it('omits retired direct-trigger state while preserving remaining graph state', async () => {
    const graph = buildPassThroughGraph();
    const result = await graph.invoke({ userId: 'u-1' });

    expect(result).not.toHaveProperty('trigger');
    expect(result.userId).toBe('u-1');
    expect(result.options).toEqual({});
  });
});
