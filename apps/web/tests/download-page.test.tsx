import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { Window } from "happy-dom";
import Download, { MAC_APP_MIN_OS, type MacReleaseDownload } from "@/app/download/page";

let installedWindow: Window | null = null;

beforeAll(() => {
  if (typeof document !== "undefined") return;
  installedWindow = new Window();
  installedWindow.SyntaxError = SyntaxError;
  for (const key of Reflect.ownKeys(installedWindow)) {
    if (key in globalThis) continue;
    const descriptor = Object.getOwnPropertyDescriptor(installedWindow, key);
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
  }
  Object.assign(globalThis, {
    window: installedWindow,
    document: installedWindow.document,
    navigator: installedWindow.navigator,
    HTMLElement: installedWindow.HTMLElement,
    Node: installedWindow.Node,
  });
});

afterEach(() => cleanup());

afterAll(() => installedWindow?.close());

const release: MacReleaseDownload = {
  version: "1.0.0",
  appUrl:
    "https://github.com/indexnetwork/index/releases/download/v1.0.0/Index-macOS-1.0.0-universal.dmg",
  appSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  connectorUrl:
    "https://github.com/indexnetwork/index/releases/download/v1.0.0/IndexConnector-1.0.0-universal.dmg",
  connectorSha256:
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  metadataUrl:
    "https://github.com/indexnetwork/index/releases/download/v1.0.0/macos-release.cms",
};

describe("/download", () => {
  test("fails closed when the foundational release contract is incomplete", () => {
    const view = render(<Download release={{ ...release, metadataUrl: "" }} />);

    expect(view.getByText(/Download unavailable/)).toBeTruthy();
    expect(view.queryByRole("link", { name: /download index app/i })).toBeNull();
    expect(view.queryByRole("link", { name: /download index connector/i })).toBeNull();
  });

  test("shows versioned app and connector artifacts, checksums, and signed metadata", () => {
    const view = render(<Download release={release} />);

    expect(MAC_APP_MIN_OS).toBe("macOS 13 or later");
    expect(view.getByText("Version 1.0.0")).toBeTruthy();
    expect(view.getByText(MAC_APP_MIN_OS)).toBeTruthy();
    expect(view.getByRole("link", { name: /download index app/i }).getAttribute("href"))
      .toBe(release.appUrl);
    expect(view.getByRole("link", { name: /download index connector/i }).getAttribute("href"))
      .toBe(release.connectorUrl);
    expect(view.getByText(release.appSha256)).toBeTruthy();
    expect(view.getByText(release.connectorSha256)).toBeTruthy();
    expect(view.getByRole("link", { name: /signed release metadata/i }).getAttribute("href"))
      .toBe(release.metadataUrl);
    expect(view.queryByText(/private testing/i)).toBeNull();
  });

  test("always offers a way back", () => {
    const view = render(<Download release={release} />);

    expect(view.getByRole("link", { name: /back to index/i }).getAttribute("href"))
      .toBe("/");
  });
});
