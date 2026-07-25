/** Max chars for main text in minimal opportunity cards (chat tool payload). Full text shown so cards are not truncated. */
export const MINIMAL_MAIN_TEXT_MAX_CHARS = 2000;

/** Hardcoded button labels for opportunity cards (not LLM-generated). */
export const PRIMARY_ACTION_LABEL_INTRODUCER = "Good match";
export const PRIMARY_ACTION_LABEL_DEFAULT = "Start Chat";
export const SECONDARY_ACTION_LABEL = "Skip";

/** Returns the primary action label based on the viewer's role. */
export function getPrimaryActionLabel(viewerRole: string): string {
  return viewerRole === "introducer" ? PRIMARY_ACTION_LABEL_INTRODUCER : PRIMARY_ACTION_LABEL_DEFAULT;
}
