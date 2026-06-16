/**
 * Tiny argv helpers shared by every harness CLI. Each harness still owns its own
 * flag set and validation; these just read process.argv consistently.
 */

/** The value following `flag` in argv, or undefined. */
export function arg(flag: string, argv: string[] = process.argv): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** True when `flag` is present in argv. */
export function has(flag: string, argv: string[] = process.argv): boolean {
  return argv.includes(flag);
}

/** A flag's value only when it's a real value, not the next flag (e.g. `--report --runs`). */
export function flagValue(flag: string, argv: string[] = process.argv): string | undefined {
  const v = arg(flag, argv);
  return v && !v.startsWith("--") ? v : undefined;
}
