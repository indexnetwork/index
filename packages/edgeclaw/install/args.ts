/**
 * Shared CLI flag reader for the EdgeClaw installer.
 *
 * Supports both `--name value` and `--name=value` forms. Returns `undefined`
 * when the flag is absent so each backend installer can decide whether the
 * flag is required (Index) or optional (EdgeOS).
 */

export function readFlag(name: string): string | undefined {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === name) {
      const next = args[i + 1];
      // Guard against `--flag --other-flag` — refuse to consume another flag
      // as if it were a value. Exit with a clear message; otherwise the
      // installer would silently set <flag>=<--other-flag>.
      if (next === undefined || next.startsWith("--")) {
        console.error(`error: ${name} requires a value (got ${next ?? "nothing"})`);
        process.exit(1);
      }
      return next;
    }
    if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
  }
  return undefined;
}
