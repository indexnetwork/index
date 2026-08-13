import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CredentialStore } from "../src/auth.store";
import { handleLogin } from "../src/login.command";

function createFakeLoginServer(options: { listenError?: Error; closeError?: Error } = {}) {
  let handler: ((req: IncomingMessage, res: ServerResponse) => void | Promise<void>) | undefined;
  let fakeServerRef: EventEmitter | undefined;
  const port = 43123;

  return {
    factory(nextHandler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>) {
      handler = nextHandler;

      const fakeServer = new EventEmitter();
      fakeServerRef = fakeServer;
      return Object.assign(fakeServer, {
        listen(_listenPort: number, _host: string, callback: () => void) {
          if (options.listenError) {
            queueMicrotask(() => fakeServer.emit("error", options.listenError));
            return;
          }
          callback();
        },
        address() {
          return { port, family: "IPv4", address: "127.0.0.1" };
        },
        close(callback: (err?: Error | null) => void) {
          if (options.closeError) fakeServer.emit("error", options.closeError);
          callback(null);
        },
        closeAllConnections() {},
      });
    },
    emitError(error: Error) {
      if (!handler) throw new Error("Handler not initialized");
      const server = fakeServerRef;
      if (!server) throw new Error("Server not initialized");
      server.emit("error", error);
    },
    async dispatch(path: string, method = "GET") {
      if (!handler) throw new Error("Handler not initialized");

      const req = new EventEmitter() as IncomingMessage;
      req.url = path;
      req.method = method;
      req.headers = {};

      let status = 0;
      let body = "";
      const res = {
        writeHead(nextStatus: number) {
          status = nextStatus;
          return res;
        },
        end(chunk?: string) {
          body = chunk ?? "";
          return res;
        },
      } as unknown as ServerResponse;

      await handler(req, res);
      return { status, body };
    },
  };
}

function stateFromAuthUrl(authUrl: string): string {
  const state = new URL(authUrl).searchParams.get("state");
  if (!state) throw new Error("Missing state in auth URL");
  return state;
}

describe("handleLogin", () => {
  let tempDir: string;
  let store: CredentialStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "index-cli-login-"));
    store = new CredentialStore(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("rejects promptly when the callback server cannot bind", async () => {
    const fakeServer = createFakeLoginServer({
      listenError: new Error("address already in use"),
      closeError: new Error("late bind cleanup error"),
    });

    await expect(handleLogin("http://localhost:3001", "http://localhost:3001", store, {
      serverFactory: fakeServer.factory,
    })).rejects.toThrow("address already in use");
  });

  it("starts a local callback server with a cryptographic one-time state", async () => {
    const apiUrl = "http://localhost:3001";
    const controller = new AbortController();
    const fakeServer = createFakeLoginServer();

    const { authUrl, port, callbackPromise } = await handleLogin(apiUrl, apiUrl, store, {
      signal: controller.signal,
      serverFactory: fakeServer.factory,
    });

    const url = new URL(authUrl);
    expect(url.origin).toBe(apiUrl);
    expect(url.pathname).toBe("/cli-auth");
    expect(url.searchParams.get("callback")).toBe(`http://127.0.0.1:${port}/callback`);
    expect(url.searchParams.get("version")).toBe("2");
    expect(url.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);

    controller.abort();
    await callbackPromise;
  });

  it("handles server errors during response flush and close without an unhandled window", async () => {
    const fakeServer = createFakeLoginServer({ closeError: new Error("late close error") });
    const { authUrl, callbackPromise } = await handleLogin(
      "http://localhost:3001",
      "http://localhost:3001",
      store,
      { serverFactory: fakeServer.factory },
    );

    const response = await fakeServer.dispatch(
      `/callback?api_key=flush-key&key_id=flush-id&state=${stateFromAuthUrl(authUrl)}`,
    );
    // callbackPromise is now in its 100ms response-flush delay.
    fakeServer.emitError(new Error("late flush error"));

    expect(response.status).toBe(200);
    expect(await callbackPromise).toEqual({ success: true });
  });

  it("resolves immediately when started with an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    const fakeServer = createFakeLoginServer();
    const { callbackPromise } = await handleLogin(
      "http://localhost:3001",
      "http://localhost:3001",
      store,
      { signal: controller.signal, serverFactory: fakeServer.factory },
    );

    expect(await callbackPromise).toEqual({ success: false, error: "Login cancelled." });
  });

  it("saves a state-bound CLI API key and its exact key ID", async () => {
    const apiUrl = "http://localhost:3001";
    const fakeServer = createFakeLoginServer();
    const { authUrl, callbackPromise } = await handleLogin(apiUrl, apiUrl, store, {
      serverFactory: fakeServer.factory,
    });
    const state = stateFromAuthUrl(authUrl);

    const response = await fakeServer.dispatch(
      `/callback?api_key=mock-cli-api-key&key_id=key-row-123&state=${state}`,
    );

    expect(response.status).toBe(200);
    expect((await callbackPromise).success).toBe(true);
    expect(await store.load()).toEqual({
      token: "mock-cli-api-key",
      apiUrl,
      authKind: "api_key",
      keyId: "key-row-123",
    });
  });

  it("uses the newly stored browser credential to revoke the previous exact key", async () => {
    const apiUrl = "http://localhost:3001";
    await store.save({
      token: "old-key",
      apiUrl,
      authKind: "api_key",
      keyId: "old-key-id",
    });
    const revokeApiKey = mock(async () => {});
    const credentialClientFactory = mock((nextApiUrl: string, token: string) => {
      expect(nextApiUrl).toBe(apiUrl);
      expect(token).toBe("new-key");
      return { revokeApiKey };
    });
    const fakeServer = createFakeLoginServer();
    const { authUrl, callbackPromise } = await handleLogin(apiUrl, apiUrl, store, {
      serverFactory: fakeServer.factory,
      credentialClientFactory,
    });

    expect((await fakeServer.dispatch(
      `/callback?api_key=new-key&key_id=new-key-id&state=${stateFromAuthUrl(authUrl)}`,
    )).status).toBe(200);
    expect(await callbackPromise).toEqual({ success: true });
    expect(revokeApiKey).toHaveBeenCalledWith("old-key-id", "old-key");
    expect(await store.load()).toEqual({
      token: "new-key",
      apiUrl,
      authKind: "api_key",
      keyId: "new-key-id",
    });
  });

  it("returns a safe failure immediately when API-key credentials cannot be saved", async () => {
    const fakeServer = createFakeLoginServer();
    store.save = async () => {
      throw new Error("secret storage internals");
    };
    const { authUrl, callbackPromise } = await handleLogin("http://localhost:3001", "http://localhost:3001", store, {
      timeoutMs: 10_000,
      serverFactory: fakeServer.factory,
    });

    const response = await fakeServer.dispatch(
      `/callback?api_key=secret-key&key_id=key-id&state=${stateFromAuthUrl(authUrl)}`,
    );

    expect(response.status).toBe(500);
    expect(response.body).toContain("CLI credentials could not be saved");
    expect(response.body).not.toContain("secret-key");
    expect(response.body).not.toContain("secret storage internals");
    expect((await fakeServer.dispatch(
      `/callback?api_key=secret-key&key_id=key-id&state=${stateFromAuthUrl(authUrl)}`,
    )).status).toBe(409);
    expect(await callbackPromise).toEqual({
      success: false,
      error: "Failed to save CLI credentials.",
    });
  });

  it("keeps waiting after missing or wrong state, then accepts the correct state", async () => {
    const apiUrl = "http://localhost:3001";
    const fakeServer = createFakeLoginServer();
    const { authUrl, callbackPromise } = await handleLogin(apiUrl, apiUrl, store, {
      serverFactory: fakeServer.factory,
    });
    const state = stateFromAuthUrl(authUrl);

    expect((await fakeServer.dispatch("/callback?api_key=attacker&key_id=attacker-id")).status).toBe(400);
    expect((await fakeServer.dispatch("/callback?api_key=attacker&key_id=attacker-id&state=wrong-state")).status).toBe(400);
    expect(await store.load()).toBeNull();

    expect((await fakeServer.dispatch(
      `/callback?api_key=real-key&key_id=real-id&state=${state}`,
    )).status).toBe(200);
    expect((await callbackPromise).success).toBe(true);
    expect((await store.load())?.token).toBe("real-key");
  });

  it("consumes a valid state synchronously so replay is rejected", async () => {
    const fakeServer = createFakeLoginServer();
    const { authUrl, callbackPromise } = await handleLogin("http://localhost:3001", "http://localhost:3001", store, {
      serverFactory: fakeServer.factory,
    });
    const callback = `/callback?api_key=only-key&key_id=only-id&state=${stateFromAuthUrl(authUrl)}`;

    expect((await fakeServer.dispatch(callback)).status).toBe(200);
    expect((await fakeServer.dispatch(callback)).status).toBe(409);
    expect((await callbackPromise).success).toBe(true);
  });

  it("accepts only exact GET /callback", async () => {
    const fakeServer = createFakeLoginServer();
    const { authUrl, callbackPromise } = await handleLogin("http://localhost:3001", "http://localhost:3001", store, {
      serverFactory: fakeServer.factory,
    });
    const state = stateFromAuthUrl(authUrl);

    expect((await fakeServer.dispatch(`/callback/?api_key=key&key_id=id&state=${state}`)).status).toBe(404);
    expect((await fakeServer.dispatch(`/callback?api_key=key&key_id=id&state=${state}`, "POST")).status).toBe(404);
    expect((await fakeServer.dispatch(`/callback?api_key=key&key_id=id&state=${state}`)).status).toBe(200);
    expect((await callbackPromise).success).toBe(true);
  });

  it("rejects a legacy session-token callback", async () => {
    const fakeServer = createFakeLoginServer();
    const { authUrl, callbackPromise } = await handleLogin("http://localhost:3001", "http://localhost:3001", store, {
      serverFactory: fakeServer.factory,
    });

    const response = await fakeServer.dispatch(
      `/callback?session_token=mock-jwt-token&state=${stateFromAuthUrl(authUrl)}`,
    );

    expect(response.status).toBe(400);
    expect(await callbackPromise).toEqual({
      success: false,
      error: "No CLI credential received in callback.",
    });
    expect(await store.load()).toBeNull();
  });

  it("rejects an API-key callback that omits the exact key ID", async () => {
    const fakeServer = createFakeLoginServer();
    const { authUrl, callbackPromise } = await handleLogin("http://localhost:3001", "http://localhost:3001", store, {
      serverFactory: fakeServer.factory,
    });

    expect((await fakeServer.dispatch(
      `/callback?api_key=orphan-key&state=${stateFromAuthUrl(authUrl)}`,
    )).status).toBe(400);
    expect(await callbackPromise).toEqual({
      success: false,
      error: "CLI API-key callback did not include its key ID.",
    });
    expect(await store.load()).toBeNull();
  });

  it("times out if no callback is received", async () => {
    const fakeServer = createFakeLoginServer();
    const { callbackPromise } = await handleLogin("http://localhost:3001", "http://localhost:3001", store, {
      timeoutMs: 20,
      serverFactory: fakeServer.factory,
    });

    const result = await callbackPromise;
    expect(result.success).toBe(false);
    expect(result.error).toContain("timed out");
  });
});
