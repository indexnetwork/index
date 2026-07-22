// @vitest-environment node

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { createWebHandler } from "../server";

describe("production web server", () => {
  let distDir: string;

  beforeEach(() => {
    distDir = mkdtempSync(join(tmpdir(), "index-web-server-"));
    mkdirSync(join(distDir, "assets"));
    writeFileSync(
      join(distDir, "index.html"),
      "<!doctype html><html><head><title>Index</title></head><body>SPA entry</body></html>",
    );
    writeFileSync(join(distDir, "assets", "index-abc12345.js"), "export const ok = true;");
    writeFileSync(join(distDir, "favicon.png"), "png");
  });

  afterEach(() => {
    rmSync(distDir, { recursive: true, force: true });
  });

  test("serves the SPA entrypoint for document route navigation", async () => {
    const fetch = createWebHandler({ distDir, metaMap: {} });

    const response = fetch(
      new Request("https://index.network/i/intent-123", {
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "Sec-Fetch-Mode": "navigate",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(await response.text()).toContain("SPA entry");
  });

  test("returns a non-HTML 404 for a missing asset", async () => {
    const fetch = createWebHandler({ distDir, metaMap: {} });

    const response = fetch(
      new Request("https://index.network/assets/page-stale123.js", {
        headers: { Accept: "text/html,*/*" },
      }),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).toBe("Not Found");
  });

  test("prevents HTML caching and caches valid hashed assets immutably", () => {
    const fetch = createWebHandler({ distDir, metaMap: {} });

    const htmlResponse = fetch(
      new Request("https://index.network/settings", {
        headers: { Accept: "text/html" },
      }),
    );
    const assetResponse = fetch(
      new Request("https://index.network/assets/index-abc12345.js"),
    );
    const publicFileResponse = fetch(
      new Request("https://index.network/favicon.png"),
    );

    expect(htmlResponse.headers.get("Cache-Control")).toBe("no-store");
    expect(assetResponse.headers.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(publicFileResponse.headers.get("Cache-Control")).toBe(
      "public, max-age=0, must-revalidate",
    );
  });

  test("does not use the SPA fallback for non-document requests", async () => {
    const fetch = createWebHandler({ distDir, metaMap: {} });

    const response = fetch(
      new Request("https://index.network/i/intent-123", {
        headers: { Accept: "application/json" },
      }),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).toContain("text/plain");
    expect(await response.text()).toBe("Not Found");
  });
});
