/** The exception on the same line Railway indexes. The JSON record after it is not searchable. */
export function describeFailure(title: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `${title}: ${detail}`;
}
