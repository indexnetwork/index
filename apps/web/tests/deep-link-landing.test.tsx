import { afterEach, describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";

import DeepLinkLanding, { DOWNLOAD_PATH } from "@/components/DeepLinkLanding";

const ORIGINAL_UA = window.navigator.userAgent;
const MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function stubUserAgent(ua: string) {
  Object.defineProperty(window.navigator, "userAgent", {
    value: ua,
    configurable: true,
  });
}

afterEach(() => {
  stubUserAgent(ORIGINAL_UA);
});

describe("DeepLinkLanding", () => {
  test("shows the full original URL with a copy affordance", () => {
    render(<DeepLinkLanding />);

    expect(screen.getByText(window.location.href)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy/i })).toBeInTheDocument();
  });

  test("shows the download CTA and re-click hint on macOS", () => {
    stubUserAgent(MAC_UA);
    render(<DeepLinkLanding />);

    const cta = screen.getByRole("link", { name: "Get the Index app" });
    expect(cta).toHaveAttribute("href", DOWNLOAD_PATH);
    // Never link straight at an artifact from here: /download owns the
    // published-vs-not state, so this CTA cannot dead-end.
    expect(cta.getAttribute("href")).not.toMatch(/\.dmg|\.zip|https?:/);
    expect(
      screen.getByText(/Already installed\? Re-click your link/),
    ).toBeInTheDocument();
  });

  test("shows open-on-your-Mac copy without a download CTA on other platforms", () => {
    stubUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    );
    render(<DeepLinkLanding />);

    expect(
      screen.getByText(/Index connect links open in the macOS app/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Get the Index app" }),
    ).not.toBeInTheDocument();
  });
});
