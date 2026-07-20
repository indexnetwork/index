import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CredentialStore } from "../src/auth.store";
import { handleLogout } from "../src/logout.command";

describe("handleLogout", () => {
  let tempDir: string;
  let store: CredentialStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "index-cli-logout-"));
    store = new CredentialStore(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("revokes the exact stored key before clearing credentials", async () => {
    await store.save({
      token: "secret-for-login-a",
      apiUrl: "https://api.index.network",
      authKind: "api_key",
      keyId: "key-id-login-a",
    });
    const revokeApiKey = mock(async () => {});
    const clientFactory = mock((apiUrl: string, token: string) => {
      expect(apiUrl).toBe("https://api.index.network");
      expect(token).toBe("secret-for-login-a");
      return { revokeApiKey };
    });

    await expect(handleLogout(store, { clientFactory })).resolves.toEqual({
      success: true,
      message: "Logged out. CLI API key revoked.",
    });
    expect(revokeApiKey).toHaveBeenCalledTimes(1);
    expect(revokeApiKey).toHaveBeenCalledWith("key-id-login-a", "secret-for-login-a");
    expect(await store.load()).toBeNull();
  });

  it("retains credentials and reports failure when exact revocation fails", async () => {
    const credentials = {
      token: "secret-for-login-a",
      apiUrl: "https://api.index.network",
      authKind: "api_key" as const,
      keyId: "key-id-login-a",
    };
    await store.save(credentials);
    const revokeApiKey = mock(async () => {
      throw new Error("server unavailable");
    });

    const result = await handleLogout(store, {
      clientFactory: () => ({ revokeApiKey }),
    });

    expect(result.success).toBe(false);
    expect(result).toEqual({
      success: false,
      warning: expect.stringContaining("credentials were retained"),
    });
    expect(await store.load()).toEqual(credentials);
  });

  it("reports non-success when server revocation succeeds but local cleanup fails", async () => {
    const revokeApiKey = mock(async () => {});
    const clear = mock(async () => {
      throw new Error("read-only filesystem");
    });
    const failingStore = {
      load: mock(async () => ({
        token: "secret-for-login-a",
        apiUrl: "https://api.index.network",
        authKind: "api_key" as const,
        keyId: "key-id-login-a",
      })),
      clear,
    };

    await expect(handleLogout(failingStore, {
      clientFactory: () => ({ revokeApiKey }),
    })).resolves.toEqual({
      success: false,
      warning: "The server API key was revoked, but local credential cleanup failed. Remove the local credentials file manually before signing in again.",
    });
    expect(revokeApiKey).toHaveBeenCalledWith("key-id-login-a", "secret-for-login-a");
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("never guesses another key for legacy ID-less API credentials", async () => {
    const credentials = {
      token: "legacy-api-key",
      apiUrl: "https://api.index.network",
      authKind: "api_key" as const,
    };
    await store.save(credentials);
    const clientFactory = mock(() => ({ revokeApiKey: mock(async () => {}) }));

    const result = await handleLogout(store, { clientFactory });

    expect(result).toEqual({
      success: false,
      warning: expect.stringContaining("Remove the old key in Index web settings first"),
    });
    expect(clientFactory).not.toHaveBeenCalled();
    expect(await store.load()).toEqual(credentials);
  });

  it("clears legacy session credentials locally without an API request", async () => {
    await store.save({
      token: "legacy-session",
      apiUrl: "https://api.index.network",
    });
    const clientFactory = mock(() => ({ revokeApiKey: mock(async () => {}) }));

    await expect(handleLogout(store, { clientFactory })).resolves.toEqual({
      success: true,
      message: "Logged out. Session cleared.",
    });
    expect(clientFactory).not.toHaveBeenCalled();
    expect(await store.load()).toBeNull();
  });
});
