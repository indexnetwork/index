// @vitest-environment node

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
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

  test("serves the apple-app-site-association file as uncached JSON", async () => {
    const fetch = createWebHandler({ distDir, metaMap: {} });

    const response = fetch(
      new Request("https://index.network/.well-known/apple-app-site-association"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(response.headers.get("Cache-Control")).toBe("no-store");

    const body = JSON.stringify(await response.json());
    expect(body).toContain("network.index.system6");
    expect(body).toContain("/c/*");
    expect(body).toContain("/o/*");
    expect(body).toContain("/l/*");
    expect(body).toContain("/index/*");
    expect(body).toContain("/u/*");
  });

  test("excludes deeper /u/ paths so web-only routes are not claimed", async () => {
    const fetch = createWebHandler({ distDir, metaMap: {} });

    const response = fetch(
      new Request("https://index.network/.well-known/apple-app-site-association"),
    );

    const aasa = (await response.json()) as {
      applinks: { details: Array<{ components: Array<{ "/": string; exclude?: boolean }> }> };
    };
    const components = aasa.applinks.details[0].components;
    const excludedComponents = components.filter((c) => c.exclude === true);
    const excludedIndex = components.findIndex((c) => c["/"] === "/u/*/?*");
    const claimedIndex = components.findIndex((c) => c["/"] === "/u/*");

    expect(excludedComponents.map((c) => c["/"])).toEqual(["/u/*/?*"]);
    expect(excludedIndex).toBeGreaterThanOrEqual(0);
    expect(components[excludedIndex].exclude).toBe(true);
    // First match wins, so the exclusion has to precede the broad claim.
    expect(excludedIndex).toBeLessThan(claimedIndex);
    // The other claimed paths are untouched.
    expect(components.filter((c) => c.exclude !== true).map((c) => c["/"])).toEqual([
      "/c/*",
      "/o/*",
      "/l/*",
      "/index/*",
      "/u/*",
    ]);
  });

  test("serves the placeholder team id when APPLE_TEAM_ID is unset", async () => {
    vi.stubEnv("APPLE_TEAM_ID", "");
    const fetch = createWebHandler({ distDir, metaMap: {} });

    const response = fetch(
      new Request("https://index.network/.well-known/apple-app-site-association"),
    );

    expect(JSON.stringify(await response.json())).toContain(
      "TEAMIDPLACEHOLDER.network.index.system6",
    );
    vi.unstubAllEnvs();
  });

  test("uses the APPLE_TEAM_ID env var when set", async () => {
    vi.stubEnv("APPLE_TEAM_ID", "ABCDE12345");
    const fetch = createWebHandler({ distDir, metaMap: {} });

    const response = fetch(
      new Request("https://index.network/.well-known/apple-app-site-association"),
    );

    expect(JSON.stringify(await response.json())).toContain(
      "ABCDE12345.network.index.system6",
    );
    vi.unstubAllEnvs();
  });

  test("answers HEAD for the apple-app-site-association file with an empty body", async () => {
    const fetch = createWebHandler({ distDir, metaMap: {} });

    const response = fetch(
      new Request("https://index.network/.well-known/apple-app-site-association", {
        method: "HEAD",
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(await response.text()).toBe("");
  });

  test.each(["/c/aB3xY9zQ2w", "/o/opp-123"])(
    "injects deep-link meta for document navigations to %s",
    async (pathname) => {
      const fetch = createWebHandler({ distDir, metaMap: {} });

      const response = fetch(
        new Request(`https://index.network${pathname}`, {
          headers: {
            Accept: "text/html,application/xhtml+xml",
            "Sec-Fetch-Mode": "navigate",
          },
        }),
      );

      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain("<title>Open in the Index app</title>");
    },
  );

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
