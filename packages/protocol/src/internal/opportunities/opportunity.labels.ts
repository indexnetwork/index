/** Hardcoded button labels for opportunity cards (not LLM-generated). */
export const PRIMARY_ACTION_LABEL_DEFAULT = "Start Chat";
export const SECONDARY_ACTION_LABEL = "Skip";

/** Returns the primary action label based on the viewer's role. */
export function getPrimaryActionLabel(_viewerRole: string): string {
  return PRIMARY_ACTION_LABEL_DEFAULT;
}
