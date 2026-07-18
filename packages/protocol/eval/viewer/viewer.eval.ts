#!/usr/bin/env bun
import { assertEvalWritePlan } from "../shared/artifact.io.js";
import { compareViewerBaseline as applyViewerBaseline } from "./viewer.baseline.js";
import { renderViewerFailureHtml, renderViewerHtml } from "./viewer.html.js";
import { assertViewerPathSeparation, publishViewerHtml, readViewerJsonArtifact, ViewerArtifactReadError } from "./viewer.io.js";
import { adaptViewerArtifact } from "./viewer.registry.js";
import { ViewerSafeError, type ViewerFailure, type ViewerDocument, type ViewerFailureCode, type ViewerSourceSummary } from "./viewer.types.js";

/** Strictly parsed arguments for the provider-free viewer CLI. */
export interface ViewerCliArguments {
  input?: string;
  out?: string;
  baseline?: string;
  force: boolean;
  help: boolean;
}

/** Injectable text sinks used by CLI tests and embedding callers. */
export interface ViewerCliDeps {
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
}

const VALUE_OPTIONS = new Set(["--input", "--out", "--baseline"]);
const BOOLEAN_OPTIONS = new Set(["--force", "--help"]);

const FAILURE_TITLES: Readonly<Record<ViewerFailureCode, string>> = {
  "malformed-input": "Malformed artifact",
  "unsupported-artifact": "Unsupported artifact",
  "prohibited-artifact": "Prohibited artifact",
  "incompatible-artifact": "Incompatible artifact",
  "incompatible-baseline": "Incompatible baseline",
};

function usage(): string {
  return `Privacy-aware eval artifact viewer\n\n` +
    `Usage (from packages/protocol):\n` +
    `  bun run eval:view -- --input PATH --out PATH [--baseline PATH] [--force]\n\n` +
    `Options:\n` +
    `  --input PATH      Versioned eval artifact to inspect (required)\n` +
    `  --out PATH        Self-contained HTML destination (required)\n` +
    `  --baseline PATH   Optional compatible baseline artifact\n` +
    `  --force           Atomically replace an existing output\n` +
    `  --help            Show this help\n\n` +
    `Exit codes: 0 rendered; 1 argument, preflight, or publication error; ` +
    `2 sanitized artifact rejection.\n`;
}

/**
 * Parses the viewer's deliberately small CLI grammar.
 *
 * Unknown flags, duplicate flags, missing values, and positional arguments are
 * rejected. Help is an exclusive command and does not require input/output.
 *
 * @param args - Argument tokens excluding the runtime and script path.
 * @returns Strictly parsed viewer arguments.
 */
export function parseViewerCliArguments(args: readonly string[]): ViewerCliArguments {
  const values = new Map<string, string>();
  const booleans = new Set<string>();

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (VALUE_OPTIONS.has(token)) {
      if (values.has(token)) throw new Error(`${token} may be supplied only once`);
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${token} requires a value`);
      values.set(token, value);
      index += 1;
      continue;
    }
    if (BOOLEAN_OPTIONS.has(token)) {
      if (booleans.has(token)) throw new Error(`${token} may be supplied only once`);
      booleans.add(token);
      continue;
    }
    if (token.startsWith("--")) throw new Error(`Unknown option: ${token}`);
    throw new Error(`Unexpected positional argument: ${token}`);
  }

  const help = booleans.has("--help");
  if (help) {
    if (values.size > 0 || booleans.size > 1) {
      throw new Error("--help cannot be combined with other arguments");
    }
    return { force: false, help: true };
  }

  const input = values.get("--input");
  const out = values.get("--out");
  if (!input) throw new Error("--input PATH is required");
  if (!out) throw new Error("--out PATH is required");

  const baseline = values.get("--baseline");
  return {
    input,
    out,
    ...(baseline ? { baseline } : {}),
    force: booleans.has("--force"),
    help: false,
  };
}

/** Backwards-friendly short alias for callers that prefer an argv-style name. */
export const parseViewerArgs = parseViewerCliArguments;

function safeFailure(error: unknown, source?: ViewerSourceSummary): ViewerFailure {
  if (error instanceof ViewerSafeError) {
    const failureSource = source ?? (
      error instanceof ViewerArtifactReadError ? error.source : undefined
    );
    return {
      code: error.code,
      title: FAILURE_TITLES[error.code],
      message: error.message,
      ...(failureSource ? { source: failureSource } : {}),
    };
  }
  return {
    code: "incompatible-artifact",
    title: FAILURE_TITLES["incompatible-artifact"],
    message: "The artifact could not be validated by its presentation adapter.",
    ...(source ? { source } : {}),
  };
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function baselineFailure(source?: ViewerSourceSummary): ViewerFailure {
  return {
    code: "incompatible-baseline",
    title: FAILURE_TITLES["incompatible-baseline"],
    message: "The baseline is malformed, unsupported, or incompatible with the input artifact.",
    ...(source ? { source } : {}),
  };
}

async function publishFailure(
  outputPath: string,
  failure: ViewerFailure,
  force: boolean,
  stderr: (text: string) => void,
): Promise<number> {
  try {
    await publishViewerHtml(outputPath, renderViewerFailureHtml(failure), { force });
  } catch {
    stderr("Failed to publish sanitized viewer failure output.");
    return 1;
  }
  stderr(`Viewer artifact rejected (${failure.code}).`);
  return 2;
}

/**
 * Runs the provider-free artifact viewer without mutating `process.exitCode`.
 *
 * Preflight covers the primary input, optional baseline, and output before any
 * input read. Artifact failures publish only deterministic sanitized HTML;
 * preflight and publication failures do not attempt a partial interpretation.
 *
 * @param args - Argument tokens excluding runtime and script path.
 * @param deps - Optional stdout/stderr sinks.
 * @returns Process-style exit status.
 */
export async function runViewerCli(
  args: readonly string[],
  deps: ViewerCliDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? console.log;
  const stderr = deps.stderr ?? console.error;

  let parsed: ViewerCliArguments;
  try {
    parsed = parseViewerCliArguments(args);
  } catch (error) {
    stderr(errorMessage(error, "Invalid viewer arguments. Run with --help for usage."));
    return 1;
  }

  if (parsed.help) {
    stdout(usage());
    return 0;
  }

  const inputPath = parsed.input;
  const outputPath = parsed.out;
  if (!inputPath || !outputPath) {
    stderr("Invalid viewer arguments. Run with --help for usage.");
    return 1;
  }

  let publicationPath: string;
  try {
    const inputPaths = [inputPath, ...(parsed.baseline ? [parsed.baseline] : [])];
    await assertEvalWritePlan({
      inputs: inputPaths,
      outputs: [outputPath],
      force: parsed.force,
    });
    publicationPath = await assertViewerPathSeparation(inputPaths, outputPath);
  } catch (error) {
    stderr(errorMessage(error, "Viewer preflight refused the requested read/write plan."));
    return 1;
  }

  let primarySource: ViewerSourceSummary | undefined;
  let document: ViewerDocument;
  try {
    const primary = await readViewerJsonArtifact(inputPath);
    primarySource = primary.source;
    document = adaptViewerArtifact(primary.value, { source: primary.source });
  } catch (error) {
    return publishFailure(publicationPath, safeFailure(error, primarySource), parsed.force, stderr);
  }

  if (parsed.baseline) {
    let baselineSource: ViewerSourceSummary | undefined;
    try {
      const baseline = await readViewerJsonArtifact(parsed.baseline);
      baselineSource = baseline.source;
      const baselineDocument = adaptViewerArtifact(baseline.value, { source: baseline.source });
      document = applyViewerBaseline(document, baselineDocument);
    } catch (error) {
      const failureSource = baselineSource ?? (
        error instanceof ViewerArtifactReadError ? error.source : undefined
      );
      return publishFailure(publicationPath, baselineFailure(failureSource), parsed.force, stderr);
    }
  }

  let html: string;
  try {
    html = renderViewerHtml(document);
  } catch {
    stderr("Failed to render viewer output.");
    return 1;
  }

  try {
    await publishViewerHtml(publicationPath, html, { force: parsed.force });
  } catch {
    stderr("Failed to publish viewer output.");
    return 1;
  }

  stdout(`Viewer written: ${publicationPath}`);
  return 0;
}

if (import.meta.main) {
  runViewerCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
