import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { CredentialStore } from "../src/auth.store";

describe("CredentialStore", () => {
  let tempDir: string;
  let store: CredentialStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "index-cli-test-"));
    store = new CredentialStore(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns null when no credentials exist", async () => {
    const creds = await store.load();
    expect(creds).toBeNull();
  });

  it("saves and loads credentials", async () => {
    const credentials = {
      token: "test-jwt-token-123",
      apiUrl: "http://localhost:3001",
    };
    await store.save(credentials);

    const loaded = await store.load();
    expect(loaded).toEqual(credentials);
  });

  it("overwrites existing credentials on save", async () => {
    await store.save({ token: "old-token", apiUrl: "http://localhost:3001" });
    await store.save({ token: "new-token", apiUrl: "http://localhost:3002" });

    const loaded = await store.load();
    expect(loaded?.token).toBe("new-token");
    expect(loaded?.apiUrl).toBe("http://localhost:3002");
  });

  it("clears credentials", async () => {
    await store.save({ token: "test-token", apiUrl: "http://localhost:3001" });
    await store.clear();

    const loaded = await store.load();
    expect(loaded).toBeNull();
  });

  it("creates the directory if it does not exist", async () => {
    const nestedDir = join(tempDir, "nested", ".index");
    const nestedStore = new CredentialStore(nestedDir);

    await nestedStore.save({ token: "test", apiUrl: "http://localhost:3001" });
    const loaded = await nestedStore.load();
    expect(loaded?.token).toBe("test");
  });
});
