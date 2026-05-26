import { describe, it, expect } from "bun:test";

import { parseSSEEvents, type SSEEvent } from "../src/sse.parser";

describe("parseSSEEvents", () => {
  it("parses a single complete event", () => {
    const chunk = 'event: status\ndata: {"sessionId":"abc","message":"Processing..."}\n\n';
    const events = parseSSEEvents(chunk);
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("status");
    expect(events[0].data).toBe('{"sessionId":"abc","message":"Processing..."}');
  });

  it("parses multiple events in one chunk", () => {
    const chunk =
      'event: status\ndata: {"message":"hi"}\n\n' +
      'event: done\ndata: {"sessionId":"123"}\n\n';
    const events = parseSSEEvents(chunk);
    expect(events).toHaveLength(2);
    expect(events[0].event).toBe("status");
    expect(events[1].event).toBe("done");
  });

  it("returns empty array for incomplete event (no double newline)", () => {
    const chunk = 'event: status\ndata: {"message":"hi"}';
    const events = parseSSEEvents(chunk);
    expect(events).toHaveLength(0);
  });

  it("handles data-only events without event field", () => {
    const chunk = 'data: hello world\n\n';
    const events = parseSSEEvents(chunk);
    expect(events).toHaveLength(1);
    expect(events[0].event).toBeUndefined();
    expect(events[0].data).toBe("hello world");
  });

  it("handles multi-line data fields", () => {
    const chunk = 'event: token\ndata: first line\ndata: second line\n\n';
    const events = parseSSEEvents(chunk);
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe("first line\nsecond line");
  });

  it("ignores comment lines", () => {
    const chunk = ': this is a comment\nevent: status\ndata: ok\n\n';
    const events = parseSSEEvents(chunk);
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("status");
  });

  it("returns empty array for empty string", () => {
    expect(parseSSEEvents("")).toHaveLength(0);
  });

  it("parses JSON data correctly when accessed", () => {
    const chunk = 'event: done\ndata: {"sessionId":"s1","response":"Hello","title":"Test"}\n\n';
    const events = parseSSEEvents(chunk);
    const parsed = JSON.parse(events[0].data);
    expect(parsed.sessionId).toBe("s1");
    expect(parsed.response).toBe("Hello");
    expect(parsed.title).toBe("Test");
  });
});
