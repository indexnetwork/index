#!/usr/bin/env bun
import { connectOwner } from "./api";
import { runTui } from "./tui";

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error("Run agent-tui in an interactive terminal.");
  process.exitCode = 1;
} else {
  try {
    await runTui(await connectOwner());
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
