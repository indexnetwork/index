#!/usr/bin/env bun
/**
 * Provider-free stand-in for a harness CLI, used by executor tests.
 *   --emit <text>   write a line to stdout
 *   --exit <code>   exit with this code
 *   --sleep <ms>    stay alive so cancellation can be tested
 */
const arg = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

process.on("SIGINT", () => {
  console.log("cancelled");
  process.exit(130);
});

console.log(arg("--emit") ?? "fake harness");
const sleepMs = Number(arg("--sleep") ?? 0);
if (sleepMs > 0) await Bun.sleep(sleepMs);
process.exit(Number(arg("--exit") ?? 0));
