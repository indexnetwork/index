/** HyDE generation modes. */
export const HYDE_FRAME_GENERATION_VERSION = 'frame-v1' as const;

export type HydeGenerationMode = 'legacy' | typeof HYDE_FRAME_GENERATION_VERSION;

/**
 * Resolve the HyDE generation mode from the feature flag.
 * Only the exact literal `true` enables frame-constrained generation.
 */
export function getHydeGenerationMode(
  value: string | undefined = process.env.HYDE_FRAME_CONSTRAINTS_ENABLED,
): HydeGenerationMode {
  return value === 'true' ? HYDE_FRAME_GENERATION_VERSION : 'legacy';
}
