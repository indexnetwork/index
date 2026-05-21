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
    if (arg === name && i + 1 < args.length) return args[i + 1];
    if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
  }
  return undefined;
}
