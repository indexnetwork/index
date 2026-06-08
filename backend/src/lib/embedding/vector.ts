/**
 * Normalize an embedding value read from the database into a real `number[]`.
 *
 * Drizzle's `vector` column mapper parses a pgvector column (`"[0.1,0.2]"`) into
 * a `number[]` only when read through the query builder (`db.select()`). A raw
 * `db.execute(sql\`...\`)` read bypasses that mapper, so the column arrives as a
 * string. Consumers that call `.join(',')` to rebuild a pgvector literal then
 * crash with `embedding.join is not a function`. Apply this at every raw-read
 * boundary so downstream code always receives the declared `number[]`.
 *
 * @param value - The embedding as it came back from the driver (array, pgvector string, or null)
 * @returns The embedding as a `number[]`; `[]` when absent or unparseable
 */
export function normalizeEmbedding(value: unknown): number[] {
  if (Array.isArray(value)) return value as number[];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as number[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}
