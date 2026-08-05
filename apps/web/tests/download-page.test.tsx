import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * `/download` is the destination of the deep-link landing CTA, so its two
 * states are load-bearing: with no published artifact it must explain itself
 * rather than link at nothing, and once `VITE_MAC_APP_DOWNLOAD_URL` is set it
 * must become a real download with no code change.
 *
 * The module reads the env var at import time, so each case re-imports it
 * after stubbing.
 */
async function renderDownload() {
  vi.resetModules();
  const mod = await import("@/app/download/page");
  const Download = mod.default;
  render(<Download />);
  return mod;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("/download", () => {
  test("explains the state instead of linking at nothing when no artifact is published", async () => {
    vi.stubEnv("VITE_MAC_APP_DOWNLOAD_URL", "");

    const mod = await renderDownload();

    expect(mod.MAC_APP_DOWNLOAD_URL).toBe("");
    expect(
      screen.getByText(/Not yet publicly available/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /download for macos/i }),
    ).not.toBeInTheDocument();
  });

  test("renders a real download button once the artifact URL is configured", async () => {
    const artifact = "https://downloads.index.network/Index-1.0.0.dmg";
    vi.stubEnv("VITE_MAC_APP_DOWNLOAD_URL", artifact);

    const mod = await renderDownload();

    expect(mod.MAC_APP_DOWNLOAD_URL).toBe(artifact);
    const cta = screen.getByRole("link", { name: /download for macos/i });
    expect(cta).toHaveAttribute("href", artifact);
    expect(screen.getByText(mod.MAC_APP_MIN_OS)).toBeInTheDocument();
    expect(
      screen.queryByText(/Not yet publicly available/),
    ).not.toBeInTheDocument();
  });

  test("always offers a way back, in both states", async () => {
    vi.stubEnv("VITE_MAC_APP_DOWNLOAD_URL", "");

    await renderDownload();

    expect(screen.getByRole("link", { name: /back to index/i })).toHaveAttribute(
      "href",
      "/",
    );
  });
});
