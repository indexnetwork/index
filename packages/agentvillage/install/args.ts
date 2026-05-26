/**
 * Shared CLI flag reader for the Edge Hermes installer.
 */

export function readFlag(name: string): string | undefined {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === name) {
      const next = args[i + 1];
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
