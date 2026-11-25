import { createContext } from "react";

/**
 * On the new intent page the agent speaks open on the page, as on production: avatar,
 * "your agent", then the text, no box. In Home's agent chat it stays a bubble.
 */
export const OpenAgentLines = createContext(false);
