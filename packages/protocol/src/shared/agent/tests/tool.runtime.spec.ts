import { describe, expect, test } from "bun:test";

import { invokeWithAbortSignal } from "../model-signal.js";
import { requestContext } from "../../observability/request-context.js";
import type { ResolvedToolContext } from "../tool.helpers.js";
import {
  ToolRuntimeError,
  getToolTimeoutPolicy,
  invokeToolRuntime,
  toolRuntimeErrorToResult,
} from "../tool.runtime.js";

const context = {
  userId: "user-1",
  userName: "User",
  userEmail: "user@example.com",
  user: { id: "user-1", name: "User", email: "user@example.com" },
  userProfile: null,
  userNetworks: [],
  indexScope: [],
  isOnboarding: false,
  hasName: true,
} as unknown as ResolvedToolContext;

describe("tool runtime", () => {
  test("classifies audited tool timeout policies", () => {
    expect(getToolTimeoutPolicy("read_docs").class).toBe("fast");
    expect(getToolTimeoutPolicy("get_discovery_run").class).toBe("fast");
    expect(getToolTimeoutPolicy("cancel_discovery_run").class).toBe("fast");
    expect(getToolTimeoutPolicy("get_profile_run").class).toBe("fast");
    expect(getToolTimeoutPolicy("cancel_profile_run").class).toBe("fast");
    expect(getToolTimeoutPolicy("read_docs").maxOutputBytes).toBeGreaterThan(0);
    expect(getToolTimeoutPolicy("list_opportunities").class).toBe("bounded_slow");
    expect(getToolTimeoutPolicy("discover_opportunities").class).toBe("async_candidate");
    expect(getToolTimeoutPolicy("update_user_profile").class).toBe("async_candidate");
  });

  test("injects requestContext abort signal into tool handlers", async () => {
    const result = await invokeToolRuntime({
      toolName: "read_docs",
      tool: {
        handler: async () => {
          const signal = requestContext.getStore()?.abortSignal;
          expect(signal).toBeInstanceOf(AbortSignal);
          expect(signal?.aborted).toBe(false);
          return JSON.stringify({ success: true });
        },
      },
      context,
      query: {},
      timeoutMs: 100,
    });

    expect(JSON.parse(result)).toEqual({ success: true });
  });

  test("rejects with a typed timeout error", async () => {
    await expect(invokeToolRuntime({
      toolName: "scrape_url",
      tool: { handler: async () => new Promise<string>(() => undefined) },
      context,
      query: {},
      timeoutMs: 10,
    })).rejects.toMatchObject({ code: "TOOL_TIMEOUT" });
  });

  test("rejects with a typed cancellation error", async () => {
    const controller = new AbortController();
    const promise = invokeToolRuntime({
      toolName: "read_docs",
      tool: { handler: async () => new Promise<string>(() => undefined) },
      context,
      query: {},
      signal: controller.signal,
      timeoutMs: 1_000,
    });

    controller.abort(new Error("test cancellation"));
    await expect(promise).rejects.toMatchObject({ code: "TOOL_CANCELLED" });
  });

  test("normalizes string abort reasons into typed cancellation errors", async () => {
    const controller = new AbortController();
    const promise = invokeToolRuntime({
      toolName: "create_premise",
      tool: {
        handler: async () => {
          await Promise.resolve();
          throw "local client cancelled";
        },
      },
      context,
      query: {},
      signal: controller.signal,
      timeoutMs: 1_000,
    });

    controller.abort("local client cancelled");
    await expect(promise).rejects.toMatchObject({ code: "TOOL_CANCELLED" });
  });

  test("rejects with a typed output-too-large error", async () => {
    await expect(invokeToolRuntime({
      toolName: "read_docs",
      tool: { handler: async () => "0123456789" },
      context,
      query: {},
      timeoutMs: 100,
      maxOutputBytes: 5,
    })).rejects.toMatchObject({ code: "TOOL_OUTPUT_TOO_LARGE" });
  });

  test("passes request abort signal into model invocations", async () => {
    const controller = new AbortController();
    let observedSignal: AbortSignal | undefined;
    const runnable = {
      invoke: async (_input: string, config?: { signal?: AbortSignal }) => {
        observedSignal = config?.signal;
        return "ok";
      },
    };

    const result = await requestContext.run({ abortSignal: controller.signal }, () =>
      invokeWithAbortSignal(runnable, "input"),
    );

    expect(result).toBe("ok");
    expect(observedSignal).toBe(controller.signal);
  });

  test("combines explicit and request abort signals for model invocations", async () => {
    const inherited = new AbortController();
    const explicit = new AbortController();
    let observedSignal: AbortSignal | undefined;
    const runnable = {
      invoke: async (_input: string, config?: { signal?: AbortSignal }) => {
        observedSignal = config?.signal;
        return "ok";
      },
    };

    await requestContext.run({ abortSignal: inherited.signal }, () =>
      invokeWithAbortSignal(runnable, "input", explicit.signal),
    );

    expect(observedSignal).toBeInstanceOf(AbortSignal);
    expect(observedSignal?.aborted).toBe(false);
    inherited.abort(new Error("request cancelled"));
    expect(observedSignal?.aborted).toBe(true);
  });

  test("serializes runtime errors into MCP/REST-safe JSON envelopes", () => {
    const err = new ToolRuntimeError(
      "TOOL_TIMEOUT",
      "Tool scrape_url timed out after 10ms.",
      "scrape_url",
      { class: "async_candidate", timeoutMs: 10, maxOutputBytes: 1000 },
    );

    expect(JSON.parse(toolRuntimeErrorToResult(err) ?? "{}")).toEqual({
      success: false,
      code: "TOOL_TIMEOUT",
      error: "Tool scrape_url timed out after 10ms.",
      data: {
        tool: "scrape_url",
        timeoutClass: "async_candidate",
        timeoutMs: 10,
        maxOutputBytes: 1000,
      },
    });
  });
});
