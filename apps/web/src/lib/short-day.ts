/** A short date for a settings row ("Nov 26, 2026"), or `fallback` when there is none. */
export function shortDay(value: string | null | undefined, fallback = "never"): string {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? fallback
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
