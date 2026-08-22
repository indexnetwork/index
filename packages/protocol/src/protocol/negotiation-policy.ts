/** Maximum model turns for an interactive, user-visible negotiation. */
export const NEGOTIATION_MAX_TURNS_CHAT = 4;

/** Maximum model turns for an ambient discovery negotiation. */
export const NEGOTIATION_MAX_TURNS_AMBIENT = 6;

/** How long a user may answer a durable negotiation consultation. */
export const ASK_USER_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Extra time retained on the consultation lock after the answer window. */
export const ASK_USER_LOCK_SLACK_MS = 60 * 60 * 1000;
