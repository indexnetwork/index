/**
 * HyDE generation mode. Source-grounded frame-v1 generation and validation is
 * the only mode; the legacy generator is gone.
 */
export const HYDE_FRAME_GENERATION_VERSION = 'frame-v1' as const;

export type HydeGenerationMode = typeof HYDE_FRAME_GENERATION_VERSION;
