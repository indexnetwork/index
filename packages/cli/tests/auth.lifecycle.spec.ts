import { describe, expect, it, mock } from "bun:test";

import { storeReplacementCredentials } from "../src/auth.lifecycle";
import type { Credentials } from "../src/auth.store";

const previousApiKey: Credentials = {
  token: "old-secret",
  apiUrl: "https://old-api.index.network",
  authKind: "api_key",
  keyId: "old-key-id",
};

const replacementApiKey: Credentials = {
  token: "new-secret",
  apiUrl: "https://new-api.index.network",
  authKind: "api_key",
  keyId: "new-key-id",
};

describe("storeReplacementCredentials", () => {
  it("stores the new credential before using it to revoke the prior exact key", async () => {
    const events: string[] = [];
    const save = mock(async (credentials: Credentials) => {
      expect(credentials).toEqual(replacementApiKey);
      events.push("save");
    });
    const revokeApiKey = mock(async (keyId: string, targetKey: string) => {
      expect(keyId).toBe("old-key-id");
      expect(targetKey).toBe("old-secret");
      events.push("revoke");
    });
    const clientFactory = mock((apiUrl: string, token: string) => {
      expect(apiUrl).toBe(replacementApiKey.apiUrl);
      expect(token).toBe(replacementApiKey.token);
      return { revokeApiKey };
    });

    await expect(storeReplacementCredentials(
      { save },
      previousApiKey,
      replacementApiKey,
      { clientFactory },
    )).resolves.toEqual({});
    expect(events).toEqual(["save", "revoke"]);
  });

  it("does not revoke when the exact key ID is unchanged", async () => {
    const save = mock(async () => {});
    const clientFactory = mock(() => ({ revokeApiKey: mock(async () => {}) }));

    await expect(storeReplacementCredentials(
      { save },
      previousApiKey,
      { ...replacementApiKey, keyId: previousApiKey.keyId },
      { clientFactory },
    )).resolves.toEqual({});
    expect(save).toHaveBeenCalledTimes(1);
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it("does not revoke anything on a fresh first login", async () => {
    const save = mock(async () => {});
    const clientFactory = mock(() => ({ revokeApiKey: mock(async () => {}) }));

    await expect(storeReplacementCredentials(
      { save },
      null,
      replacementApiKey,
      { clientFactory },
    )).resolves.toEqual({});
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it("keeps the successful replacement and warns when prior-key revocation fails", async () => {
    const save = mock(async () => {});
    const revokeApiKey = mock(async () => {
      throw new Error("server unavailable");
    });

    const result = await storeReplacementCredentials(
      { save },
      previousApiKey,
      replacementApiKey,
      { clientFactory: () => ({ revokeApiKey }) },
    );

    expect(save).toHaveBeenCalledTimes(1);
    expect(result.warning).toContain("previous CLI API key remains active");
    expect(result.warning).toContain("removed in Index web settings");
  });

});
