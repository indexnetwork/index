import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, test, vi } from "vitest";

import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import { classifyChunkLoadError, lazyRoute, type ChunkRecoveryRuntime } from "@/lib/lazy-route-recovery";

const CHUNK_ERROR = new TypeError(
  "Failed to fetch dynamically imported module: https://index.network/assets/page-stale123.js",
);

class MemoryRecoveryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function createRuntime(overrides: Partial<ChunkRecoveryRuntime> = {}): ChunkRecoveryRuntime {
  return {
    href: "/i/intent-123?view=radar#latest",
    buildIdentity: "index-oldbuild.js",
    storage: new MemoryRecoveryStorage(),
    reload: vi.fn(),
    report: vi.fn(),
    ...overrides,
  };
}

describe("lazy route chunk recovery", () => {
  test("classifies known chunk errors without treating ordinary fetch failures as chunks", () => {
    expect(classifyChunkLoadError(CHUNK_ERROR)).toEqual({
      category: "dynamic-import",
      failedChunkPath: "/assets/page-stale123.js",
    });
    expect(classifyChunkLoadError(new Error("Failed to fetch intent"))).toBeNull();
    expect(classifyChunkLoadError(new Error("Intent not found"))).toBeNull();
  });

  test("reloads at most once and preserves the requested URL", async () => {
    const reloadedUrls: string[] = [];
    const runtime = createRuntime({
      reload: () => reloadedUrls.push(runtime.href),
    });
    const load = lazyRoute(
      "/i/:intentId",
      () => Promise.reject(CHUNK_ERROR),
      () => runtime,
    );

    await expect(load()).rejects.toBe(CHUNK_ERROR);
    await expect(load()).rejects.toBe(CHUNK_ERROR);

    expect(reloadedUrls).toEqual(["/i/intent-123?view=radar#latest"]);
    expect(runtime.report).toHaveBeenCalledWith(
      "error",
      "Lazy route asset failed to load",
      expect.objectContaining({
        buildIdentity: "index-oldbuild.js",
        route: "/i/:intentId",
        failedChunkPath: "/assets/page-stale123.js",
        recoveryResult: "reload_started",
      }),
    );
    expect(runtime.report).toHaveBeenLastCalledWith(
      "error",
      "Lazy route asset failed to load",
      expect.objectContaining({ recoveryResult: "reload_blocked_pending" }),
    );
  });

  test("reports a successful route load after the recovery reload", async () => {
    const storage = new MemoryRecoveryStorage();
    const staleRuntime = createRuntime({ storage });
    const staleLoad = lazyRoute(
      "/i/:intentId",
      () => Promise.reject(CHUNK_ERROR),
      () => staleRuntime,
    );
    await expect(staleLoad()).rejects.toBe(CHUNK_ERROR);

    const currentRuntime = createRuntime({
      buildIdentity: "index-currentbuild.js",
      storage,
    });
    const recoveredLoad = lazyRoute(
      "/i/:intentId",
      () => Promise.resolve({ Component: () => null }),
      () => currentRuntime,
    );

    await expect(recoveredLoad()).resolves.toBeDefined();
    expect(currentRuntime.report).toHaveBeenCalledWith(
      "info",
      "Lazy route asset recovered after reload",
      expect.objectContaining({
        buildIdentity: "index-currentbuild.js",
        route: "/i/:intentId",
        recoveryResult: "route_loaded",
      }),
    );
  });

  test("does not reload or relabel ordinary route errors", async () => {
    const ordinaryError = new Error("Intent loader failed");
    const runtime = createRuntime();
    const load = lazyRoute(
      "/i/:intentId",
      () => Promise.reject(ordinaryError),
      () => runtime,
    );

    await expect(load()).rejects.toBe(ordinaryError);

    expect(runtime.reload).not.toHaveBeenCalled();
    expect(runtime.report).not.toHaveBeenCalled();
  });

  test("renders clear refresh UI when a chunk failure reaches the route boundary", async () => {
    const router = createMemoryRouter(
      [
        {
          path: "/i/:intentId",
          lazy: () => Promise.reject(CHUNK_ERROR),
          hydrateFallbackElement: <div>Loading</div>,
          errorElement: <RouteErrorBoundary />,
        },
      ],
      { initialEntries: ["/i/intent-123"] },
    );

    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("heading", { name: "This page needs a refresh" })).toBeVisible();
    expect(screen.getByText(/updated while this page was open/i)).toBeVisible();
    expect(screen.getByRole("button", { name: "Refresh page" })).toBeVisible();
    expect(screen.queryByText(/Unexpected Application Error/i)).not.toBeInTheDocument();
  });

  test("renders an ordinary application error without chunk-update messaging", async () => {
    const router = createMemoryRouter(
      [
        {
          path: "/settings",
          loader: () => {
            throw new Error("Settings loader failed");
          },
          element: <div>Settings</div>,
          hydrateFallbackElement: <div>Loading</div>,
          errorElement: <RouteErrorBoundary />,
        },
      ],
      { initialEntries: ["/settings"] },
    );

    render(<RouterProvider router={router} />);

    expect(await screen.findByRole("heading", { name: "Something went wrong" })).toBeVisible();
    expect(screen.queryByText(/updated while this page was open/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh page" })).toBeVisible();
  });
});
