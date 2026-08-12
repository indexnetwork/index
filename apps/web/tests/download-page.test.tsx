import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import Download from "@/app/download/page";
import type { MacReleaseMetadata } from "@/lib/mac-release";

afterEach(cleanup);

const version = "1.0.0";
const metadataUrl = `https://github.com/indexnetwork/index/releases/download/v${version}/macos-release.json`;
const release: MacReleaseMetadata = {
  apiUrl: "https://protocol.index.network",
  architectures: ["arm64", "x86_64"],
  artifacts: [
    { kind: "app-dmg", name: `Index-macOS-${version}-universal.dmg`, url: `https://github.com/indexnetwork/index/releases/download/v${version}/Index-macOS-${version}-universal.dmg`, sha256: "a".repeat(64), size: 1_048_576 },
    { kind: "connector-dmg", name: `IndexConnector-${version}-universal.dmg`, url: `https://github.com/indexnetwork/index/releases/download/v${version}/IndexConnector-${version}-universal.dmg`, sha256: "b".repeat(64), size: 2_097_152 },
  ],
  buildNumber: "7",
  commit: "c".repeat(40),
  connectorProtocolVersion: 1,
  minimumMacOS: "13.0",
  releaseVersion: version,
  schemaVersion: 1,
  teamId: "LMQ3XNXLAD",
  webUrl: "https://index.network",
};

function view(value: MacReleaseMetadata | null) {
  return render(<MemoryRouter><Download release={value} metadataUrl={metadataUrl} /></MemoryRouter>);
}

describe("/download", () => {
  test("fails closed without verified release metadata", () => {
    view(null);
    expect(screen.getByText(/download unavailable/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /download index for mac/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /download index connector/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /install hermes plugin/i })).toHaveAttribute("href");
  });

  test("renders exact app, connector, checksum, JSON, and CMS links", () => {
    view(release);
    expect(screen.getByText(/macOS 13\+ · Universal 2/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /download index for mac/i })).toHaveAttribute("href", release.artifacts[0].url);
    expect(screen.getByRole("link", { name: /download index connector/i })).toHaveAttribute("href", release.artifacts[1].url);
    expect(screen.getByText(release.artifacts[0].sha256)).toBeInTheDocument();
    expect(screen.getByText(release.artifacts[1].sha256)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /release metadata/i })).toHaveAttribute("href", metadataUrl);
    expect(screen.getByRole("link", { name: /cms signature/i })).toHaveAttribute("href", metadataUrl.replace(".json", ".cms"));
  });
});
