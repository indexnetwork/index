/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, it, expect } from "bun:test";
import { ResponseStreamer } from "../response.streamer.js";
import type { TokenEvent, ErrorEvent } from "../../../chat/chat-streaming.types.js";

describe('ResponseStreamer', () => {
  const streamer = new ResponseStreamer();
  const sessionId = 'session-test-123';

  it('returns a token event when responseText is present', () => {
    const result = streamer.handleAgentLoopEnd(sessionId, {
      data: { output: { responseText: 'Hello, here is your answer.' } },
    });

    expect(result.responseText).toBe('Hello, here is your answer.');
    expect(result.hadError).toBe(false);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].type).toBe('token');
    expect((result.events[0] as TokenEvent).content).toBe('Hello, here is your answer.');
  });

  it('returns an error event when output.error is present', () => {
    const result = streamer.handleAgentLoopEnd(sessionId, {
      data: { output: { error: 'Something went wrong.' } },
    });

    expect(result.hadError).toBe(true);
    expect(result.events.some(e => e.type === 'error')).toBe(true);
  });

  it('returns both error and token events when both error and responseText are present', () => {
    const result = streamer.handleAgentLoopEnd(sessionId, {
      data: { output: { responseText: 'Partial response', error: 'Minor error' } },
    });

    expect(result.hadError).toBe(true);
    expect(result.responseText).toBe('Partial response');
    expect(result.events.some(e => e.type === 'error')).toBe(true);
    expect(result.events.some(e => e.type === 'token')).toBe(true);
  });

  it('returns empty events and empty responseText when output is absent', () => {
    const result = streamer.handleAgentLoopEnd(sessionId, {});

    expect(result.responseText).toBe('');
    expect(result.hadError).toBe(false);
    expect(result.events).toHaveLength(0);
  });

  it('replaces the JSON injection sentinel with a user-friendly message', () => {
    const result = streamer.handleAgentLoopEnd(sessionId, {
      data: { output: { error: 'JSON error injected into SSE stream' } },
    });

    const errorEvent = result.events.find(e => e.type === 'error') as ErrorEvent | undefined;
    expect(errorEvent).toBeDefined();
    expect(errorEvent!.message).not.toBe('JSON error injected into SSE stream');
    expect(errorEvent!.message.length).toBeGreaterThan(0);
  });

  it('includes sessionId on all events', () => {
    const result = streamer.handleAgentLoopEnd(sessionId, {
      data: { output: { responseText: 'OK', error: 'Oops' } },
    });

    for (const event of result.events) {
      expect(event.sessionId).toBe(sessionId);
    }
  });
});
