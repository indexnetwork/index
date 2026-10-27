/**
 * The assessment consult under the draft moralmod-consult-0 contract:
 * `POST {base}/runs {key, packet}` → `{run_id}`, then
 * `GET {base}/runs/{run_id}` → `{status: running|ready|unavailable, result?}`.
 * The contract is pinned here alone and adapts when the lab's memo lands.
 */

export interface ConsultRequest {
  opportunityId: string;
  turnIndex: number;
  ownerUserId: string;
  packet: unknown;
}

export interface ConsultOptions {
  signal?: AbortSignal;
  deadlineMs: number;
}

export interface AssessmentClient {
  /** @returns The raw run result, or null when it is not usable in time (deadline, unavailability, a non-OK reply). */
  consult(request: ConsultRequest, options: ConsultOptions): Promise<unknown | null>;
}

export interface AssessmentClientOptions {
  baseUrl: string;
  token: string;
  fetch?: typeof fetch;
  /** Milliseconds between polls. */
  pollMs?: number;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(timer); reject(signal!.reason); };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** @param options - Endpoint, credential, and injectable clock/transport. @returns A client that joins identical in-flight consults. */
export function createAssessmentClient(options: AssessmentClientOptions): AssessmentClient {
  const transport = options.fetch ?? fetch;
  const pollMs = options.pollMs ?? 3_000;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const inFlight = new Map<string, Promise<unknown | null>>();

  async function call(path: string, init: RequestInit, signal?: AbortSignal): Promise<unknown | null> {
    const response = await transport(`${options.baseUrl}${path}`, {
      ...init,
      headers: { "content-type": "application/json", authorization: `Bearer ${options.token}`, ...init.headers },
      ...(signal ? { signal } : {}),
    });
    if (!response.ok && response.status !== 202) return null;
    return response.json().catch(() => null);
  }

  async function run(request: ConsultRequest, { signal, deadlineMs }: ConsultOptions): Promise<unknown | null> {
    const until = now() + deadlineMs;
    const key = `${request.opportunityId}:${request.turnIndex}`;
    const started = await call("/runs", { method: "POST", body: JSON.stringify({ key, packet: request.packet, owner_user_id: request.ownerUserId }) }, signal);
    if (!record(started) || typeof started.run_id !== "string") return null;
    for (;;) {
      signal?.throwIfAborted();
      if (now() >= until) return null;
      const reply = await call(`/runs/${encodeURIComponent(started.run_id)}`, { method: "GET" }, signal);
      if (record(reply) && reply.status === "ready") return reply.result ?? null;
      if (!record(reply) || reply.status !== "running") return null;
      if (now() + pollMs >= until) return null;
      await sleep(pollMs, signal);
    }
  }

  return {
    consult(request, options) {
      const key = `${request.opportunityId}:${request.turnIndex}:${request.ownerUserId}`;
      const pending = inFlight.get(key);
      if (pending) return pending;
      const work = run(request, options).finally(() => { inFlight.delete(key); });
      inFlight.set(key, work);
      return work;
    },
  };
}
