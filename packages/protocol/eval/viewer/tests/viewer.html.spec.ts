import { describe, expect, it } from "bun:test";

import { renderViewerFailureHtml, renderViewerHtml } from "../viewer.html.js";
import type { ViewerDocument } from "../viewer.types.js";

const documentFixture = (): ViewerDocument => ({
  viewerSchemaVersion: 1,
  kind: "shared-scorecard-v2",
  adapterId: "shared-matching-run-report-v2",
  title: "Matching <script> viewer",
  source: { sha256: "a".repeat(64), byteLength: 123 },
  artifact: [{ label: "Artifact", value: "index-eval/run-report" }],
  provenance: [{ label: "Model", value: "test/model" }],
  completeness: [{ label: "Cases", value: "2" }],
  summary: [{ label: "Aggregate", value: "50%" }],
  aggregatePassRate: 0.5,
  sharedComparison: {
    artifactKind: "run-report",
    artifactSchemaVersion: 2,
    harness: "matching",
    harnessVersion: "1",
    fullCorpus: true,
    corpusFingerprint: "c".repeat(64),
    executionComplete: false,
  },
  rules: [{ id: "rule-a", itemCount: 2, passRate: 0.5 }],
  telemetryNotice: "Retry telemetry was not recorded.",
  items: [
    {
      id: "case-1</script><script>ALERT_SENTINEL</script>",
      group: "rule-a",
      state: "pass",
      runs: 1,
      passes: 1,
      passRate: 1,
      fields: [{ label: "Public note", value: "Visible & safe" }],
      diagnostics: [{ run: 2, passed: true, checks: [{ kind: "match", passed: true }] }],
      diagnosticsAvailable: true,
      executionRuns: [
        {
          runId: "case-1::run:1",
          run: 1,
          outcome: "failed",
          recovered: false,
          attempts: [{
            attemptId: "case-1::run:1::attempt:1",
            attemptNumber: 1,
            startedAt: "2026-01-01T00:00:00.000Z",
            completedAt: "2026-01-01T00:00:00.010Z",
            durationMs: 10,
            outcome: "timeout",
            retryable: false,
            backoffMs: 0,
          }],
        },
        {
          runId: "case-1::run:2",
          run: 2,
          outcome: "cancelled",
          recovered: false,
          attempts: [],
        },
      ],
      executionAvailable: true,
    },
    {
      id: "case-2",
      group: "rule-a",
      state: "fail",
      runs: 1,
      passes: 0,
      passRate: 0,
      fields: [],
      diagnostics: [],
      diagnosticsAvailable: false,
      executionRuns: [],
      executionAvailable: true,
    },
  ],
});

const RUNTIME_NETWORK_PATTERNS = [
  /<script\s+[^>]*src=/i,
  /<link\s+[^>]*href=/i,
  /https?:\/\//i,
  /\bfetch\s*\(/,
  /XMLHttpRequest/,
  /WebSocket/,
  /sendBeacon/,
  /EventSource/,
  /\bimport\s*\(/,
];

describe("viewer HTML", () => {
  it("is deterministic, self-contained, and script-injection safe", () => {
    const first = renderViewerHtml(documentFixture());
    const second = renderViewerHtml(documentFixture());
    expect(first).toBe(second);
    expect(first).toStartWith("<!doctype html>");
    expect(first).not.toContain("</script><script>ALERT_SENTINEL</script>");
    expect(first).toContain("\\u003c/script\\u003e");
    const script = first.match(/<script nonce="[^"]+">([\s\S]*)<\/script>/)?.[1];
    expect(script).toBeDefined();
    expect(() => new Function(script!)).not.toThrow();
    for (const pattern of RUNTIME_NETWORK_PATTERNS) expect(first).not.toMatch(pattern);
  });

  it("locks runtime networking down and exposes accessible read-only controls", () => {
    const html = renderViewerHtml(documentFixture());
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain('name="referrer" content="no-referrer"');
    expect(html).toContain("<main");
    expect(html).toContain("<nav");
    expect(html).toContain("<label");
    expect(html).toContain("aria-live");
    expect(html).toContain(":focus-visible");
    expect(html).toContain("prefers-reduced-motion");
    expect(html).toContain("Keyboard");
    expect(html).toContain("Execution");
    expect(html).toContain("case-1::run:1::attempt:1");
    expect(html).toContain("Previous");
    expect(html).toContain("Next");
    expect(html).toContain("Random");
    expect(html).not.toContain("contenteditable");
    expect(html).not.toContain("<form");
  });

  it("renders a static deterministic safe-failure page", () => {
    const failure = {
      code: "prohibited-artifact" as const,
      title: "Artifact could not be displayed safely",
      message: "Private material is not supported.",
      source: { sha256: "b".repeat(64), byteLength: 456 },
    };
    const html = renderViewerFailureHtml(failure);
    expect(html).toBe(renderViewerFailureHtml(failure));
    expect(html).toContain("Artifact could not be displayed safely");
    expect(html).toContain("Private material is not supported.");
    expect(html).toContain("b".repeat(64));
    expect(html).not.toContain("<script");
    for (const pattern of RUNTIME_NETWORK_PATTERNS) expect(html).not.toMatch(pattern);
  });
});
