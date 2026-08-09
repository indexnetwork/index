import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";

/**
 * `/download` is the post-invite install page. It always shows Index + Hermes
 * cards in the centered download layout; the Mac card links only once
 * `VITE_MAC_APP_DOWNLOAD_URL` is configured.
 */
async function renderDownload() {
  vi.resetModules();
  const mod = await import("@/app/download/page");
  const Download = mod.default;
  render(
    <MemoryRouter>
      <Download />
    </MemoryRouter>,
  );
  return mod;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("/download", () => {
  test("shows card layout with Hermes install link and disabled Mac action when unpublished", async () => {
    vi.stubEnv("VITE_MAC_APP_DOWNLOAD_URL", "");

    const mod = await renderDownload();

    expect(mod.MAC_APP_DOWNLOAD_URL).toBe("");
    expect(screen.getByText(/You're in/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Get the apps" })).toBeInTheDocument();
    expect(screen.getByText(/Coming soon/i)).toBeInTheDocument();
    expect(screen.getByText(mod.MAC_APP_REQUIREMENTS)).toBeInTheDocument();

    const hermes = screen.getByRole("link", { name: /install hermes plugin/i });
    expect(hermes).toHaveAttribute("href", mod.HERMES_INSTALL_URL);

    expect(
      screen.queryByRole("link", { name: /download index for mac/i }),
    ).not.toBeInTheDocument();
  });

  test("renders a real Mac download card once the artifact URL is configured", async () => {
    const artifact = "https://downloads.index.network/Index-1.0.0.dmg";
    vi.stubEnv("VITE_MAC_APP_DOWNLOAD_URL", artifact);

    const mod = await renderDownload();

    expect(mod.MAC_APP_DOWNLOAD_URL).toBe(artifact);
    const index = screen.getByRole("link", { name: /download index for mac/i });
    expect(index).toHaveAttribute("href", artifact);
    expect(screen.getByRole("link", { name: /install/i })).toBeInTheDocument();
    expect(screen.queryByText(/Coming soon/i)).not.toBeInTheDocument();
  });

});
