/** A corpus that can be searched through inferred semantic lenses. */
export type HydeTargetCorpus = "profiles" | "intents" | "premises";

/** A model-inferred perspective for retrieval. */
export interface Lens {
  label: string;
  corpus: HydeTargetCorpus;
  reasoning: string;
}
