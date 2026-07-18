import { afterEach, describe, expect, it } from "bun:test";

import { buildExecutionEvidence, executeRuns, repeatRuns, sanitizeEvalError, summarizeExecution } from "../runner.js";

const originalSecret = process.env.TEST_EVAL_SECRET;
afterEach(() => {
  if (originalSecret === undefined) delete process.env.TEST_EVAL_SECRET;
  else process.env.TEST_EVAL_SECRET = originalSecret;
});

describe("executeRuns", () => {
  it("records deterministic first-attempt success evidence", async () => {
    const batch = await executeRuns(async ({ runIndex, signal }) => {
      expect(signal).toBeInstanceOf(AbortSignal);
      return `out-${runIndex}`;
    }, 2, { caseId: "case/one", attemptTimeoutMs: 100, retryDelayMs: 0 });

    expect(batch.outputs).toEqual(["out-0", "out-1"]);
    expect(batch.runs.map((run) => run.runId)).toEqual([
      "case%2Fone::run:1",
      "case%2Fone::run:2",
    ]);
    expect(batch.runs[0].attempts[0].attemptId).toBe("case%2Fone::run:1::attempt:1");
    expect(batch.runs[0]).toMatchObject({ runIndex: 0, outcome: "success", recovered: false });
    expect(batch.runs[0].attempts[0]).toMatchObject({
      attemptNumber: 1,
      outcome: "success",
      retryable: false,
      backoffMs: 0,
    });
  });

  it("keeps a recovered retry while exposing only the terminal output to scorers", async () => {
    let attempts = 0;
    const batch = await executeRuns(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary");
      return "ok";
    }, 1, {
      caseId: "recover",
      attemptTimeoutMs: 100,
      maxAttempts: 3,
      retryDelayMs: 1,
    });

    expect(batch.outputs).toEqual(["ok"]);
    expect(batch.runs[0].recovered).toBe(true);
    expect(batch.runs[0].attempts.map((attempt) => attempt.outcome)).toEqual(["failure", "success"]);
    expect(batch.runs[0].attempts[0]).toMatchObject({ retryable: true, backoffMs: 1 });
    expect(summarizeExecution(buildExecutionEvidence([batch]))).toMatchObject({
      requestedRuns: 1,
      completedRuns: 1,
      failedRuns: 0,
      recoveredRuns: 1,
      totalAttempts: 2,
      complete: true,
    });
  });

  it("preserves an exhausted failure and continues later requested slots", async () => {
    let calls = 0;
    const batch = await executeRuns(async ({ runIndex }) => {
      calls += 1;
      if (runIndex === 0) throw Object.assign(new Error("provider unavailable"), { code: "503" });
      return "later-success";
    }, 2, {
      caseId: "continue",
      attemptTimeoutMs: 100,
      maxAttempts: 2,
      retryDelayMs: 0,
      policy: "strict",
    });

    expect(calls).toBe(3);
    expect(batch.outputs).toEqual(["later-success"]);
    expect(batch.runs.map((run) => run.outcome)).toEqual(["failed", "success"]);
    expect(batch.runs[0].attempts).toHaveLength(2);
    expect(batch.runs[0].attempts[1].error).toMatchObject({ class: "Error", code: "503" });
    expect(summarizeExecution(buildExecutionEvidence([batch], "strict"))).toMatchObject({
      requestedRuns: 2,
      completedRuns: 1,
      failedRuns: 1,
      totalAttempts: 3,
      complete: false,
    });
  });

  it("times out an ignored provider promise and records timeout evidence", async () => {
    const batch = await executeRuns(
      async () => await new Promise<string>(() => {}),
      1,
      { caseId: "timeout", attemptTimeoutMs: 5, maxAttempts: 1, retryDelayMs: 0 },
    );

    expect(batch.outputs).toEqual([]);
    expect(batch.runs[0].outcome).toBe("failed");
    expect(batch.runs[0].attempts[0]).toMatchObject({
      outcome: "timeout",
      retryable: true,
      backoffMs: 0,
      error: { class: "EvalAttemptTimeoutError", code: "EVAL_ATTEMPT_TIMEOUT" },
    });
  });

  it("records active cancellation and marks unstarted slots without fabricating attempts", async () => {
    const controller = new AbortController();
    const execution = executeRuns(
      async () => await new Promise<string>(() => {}),
      2,
      { caseId: "cancel", attemptTimeoutMs: 1_000, signal: controller.signal },
    );
    setTimeout(() => controller.abort("stop"), 5);
    const batch = await execution;

    expect(batch.runs.map((run) => run.outcome)).toEqual(["cancelled", "cancelled"]);
    expect(batch.runs[0].attempts[0]).toMatchObject({ outcome: "cancelled", retryable: false });
    expect(batch.runs[1].attempts).toEqual([]);
  });

  it("honors a non-retryable decision", async () => {
    let calls = 0;
    const batch = await executeRuns(async () => {
      calls += 1;
      throw new Error("bad request");
    }, 1, {
      caseId: "non-retryable",
      attemptTimeoutMs: 100,
      maxAttempts: 3,
      retryDelayMs: 0,
      isRetryable: () => false,
    });
    expect(calls).toBe(1);
    expect(batch.runs[0].attempts[0]).toMatchObject({ retryable: false, backoffMs: 0 });
  });

  it("appends the provider attempt when retry classification throws", async () => {
    const batch = await executeRuns(async () => {
      throw new Error("original provider failure");
    }, 1, {
      caseId: "classifier-failure",
      attemptTimeoutMs: 100,
      maxAttempts: 3,
      isRetryable: () => {
        throw new Error("classifier bookkeeping failure");
      },
    });

    expect(batch.runs[0]).toMatchObject({ outcome: "failed", recovered: false });
    expect(batch.runs[0].attempts).toHaveLength(1);
    expect(batch.runs[0].attempts[0]).toMatchObject({
      outcome: "failure",
      retryable: false,
      backoffMs: 0,
      error: { message: "original provider failure" },
    });
  });

  it("records arbitrary and hostile rejection values without losing the attempt", async () => {
    const hostile = new Proxy(Object.create(null) as object, {
      get: () => {
        throw new Error("throwing getter raw-hostile-secret-901");
      },
      getPrototypeOf: () => {
        throw new Error("throwing prototype raw-hostile-secret-902");
      },
    });
    for (const rejected of [undefined, Symbol("provider"), () => "provider", hostile] as unknown[]) {
      const batch = await executeRuns(async () => await Promise.reject(rejected), 1, {
        caseId: "odd-rejection",
        attemptTimeoutMs: 100,
        maxAttempts: 1,
      });
      expect(batch.runs[0].attempts).toHaveLength(1);
      expect(batch.runs[0].attempts[0].outcome).toBe("failure");
      expect(typeof batch.runs[0].attempts[0].error?.message).toBe("string");
      expect(JSON.stringify(batch.runs[0].attempts[0].error)).not.toContain("raw-hostile-secret");
    }
  });

  it("sanitizes quoted headers, full cookies, bearer tokens, and raw environment values", () => {
    process.env.TEST_EVAL_SECRET = "raw-environment-secret-123";
    const fixtures = [
      {
        message: '{"x-api-key":"quoted-json-header-secret-1001","Authorization":"Bearer quoted-auth-secret-1002"}',
        secrets: ["quoted-json-header-secret-1001", "quoted-auth-secret-1002"],
      },
      {
        message: '{"Cookie":"session=quoted-cookie-secret-2001; refresh=quoted-cookie-secret-2002"}',
        secrets: ["quoted-cookie-secret-2001", "quoted-cookie-secret-2002"],
      },
      {
        message: "Cookie: session=plain-cookie-secret-3001; refresh=plain-cookie-secret-3002\nstatus=failed",
        secrets: ["plain-cookie-secret-3001", "plain-cookie-secret-3002"],
      },
      {
        message: "provider response Set-Cookie: session=set-cookie-secret-4001; Path=/; refresh=set-cookie-secret-4002; HttpOnly\nstatus=failed",
        secrets: ["set-cookie-secret-4001", "set-cookie-secret-4002"],
      },
      {
        message: "Authorization: Bearer abc.def.ghi x-api-key=sk-secretvalue raw-environment-secret-123?token=visible",
        secrets: ["abc.def.ghi", "sk-secretvalue", "raw-environment-secret-123", "token=visible"],
      },
    ];

    for (const fixture of fixtures) {
      const serialized = JSON.stringify(sanitizeEvalError(new Error(fixture.message)));
      for (const secret of fixture.secrets) expect(serialized).not.toContain(secret);
      expect(serialized).toContain("REDACTED");
    }
  });

  it("keeps sanitization total for throwing getters, proxies, and coercion traps", () => {
    const hostile = new Proxy(Object.create(null) as object, {
      get: () => {
        throw new Error("getter-secret-5001");
      },
      getPrototypeOf: () => {
        throw new Error("prototype-secret-5002");
      },
    });
    expect(() => sanitizeEvalError(hostile)).not.toThrow();
    const serialized = JSON.stringify(sanitizeEvalError(hostile));
    expect(serialized).not.toContain("getter-secret-5001");
    expect(serialized).not.toContain("prototype-secret-5002");
    expect(serialized).toContain("Unserializable provider error");
  });
});

describe("repeatRuns compatibility", () => {
  it("invokes exactly runs times and collects outputs in order", async () => {
    let number = 0;
    expect(await repeatRuns(async () => ++number, 3)).toEqual([1, 2, 3]);
  });

  it("still retries then returns only the successful output", async () => {
    let attempts = 0;
    const output = await repeatRuns(async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("transient");
      return "ok";
    }, 1, { maxAttempts: 3, retryDelayMs: 0 });
    expect(output).toEqual(["ok"]);
    expect(attempts).toBe(3);
  });

  it("still fails fast on the first exhausted slot", async () => {
    let attempts = 0;
    await expect(repeatRuns(async () => {
      attempts += 1;
      throw new Error(`fail-${attempts}`);
    }, 2, { maxAttempts: 2, retryDelayMs: 0 })).rejects.toThrow("fail-2");
    expect(attempts).toBe(2);
  });
});
