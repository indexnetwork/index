export type Capability =
  | "signals"
  | "participant-context"
  | "communities"
  | "opportunities"
  | "negotiation"
  | "questions"
  | "participant-agents"
  | "contacts"
  | "integrations"
  | "interaction-composition";

/** Single-segment top-level directories with a fixed capability assignment. */
export const CAPABILITY_DIRECTORIES: Readonly<Record<string, Capability>> = {
  // Canonical capability directories and their legacy compatibility paths.
  signals: "signals",
  intent: "signals",
  "participant-context": "participant-context",
  enrichment: "participant-context",
  premise: "participant-context",
  context: "participant-context",
  communities: "communities",
  network: "communities",
  opportunity: "opportunities",
  negotiation: "negotiation",
  questions: "questions",
  questioner: "questions",
  "participant-agents": "participant-agents",
  chat: "participant-agents",
  agent: "participant-agents",
  contacts: "contacts",
  contact: "contacts",
  integrations: "integrations",
  integration: "integrations",
  maintenance: "interaction-composition",
};

/**
 * The capability directory that owns each capability's barrel.
 *
 * A capability can span several top-level directories (participant-context
 * covers enrichment/, premise/, and context/), but exactly one of them holds
 * the `index.ts` that other capabilities are allowed to import.
 */
export const CAPABILITY_BARREL_DIRECTORIES: Readonly<Record<Capability, string | undefined>> = {
  signals: "signals",
  "participant-context": "participant-context",
  communities: "communities",
  opportunities: "opportunity",
  negotiation: "negotiation",
  questions: "questions",
  "participant-agents": "participant-agents",
  contacts: "contacts",
  integrations: "integrations",
  // The composition root is the one all-capability point; it has no barrel of
  // its own and is reached through the package entry point instead.
  "interaction-composition": undefined,
};

/** Every permitted direction is deliberately named and reviewed here. */
export const ALLOWED_CAPABILITY_DIRECTIONS: Readonly<
  Record<Capability, readonly Capability[]>
> = {
  signals: ["participant-agents", "questions"],
  "participant-context": ["participant-agents", "questions"],
  communities: ["participant-agents", "signals"],
  opportunities: ["participant-agents", "signals", "negotiation", "questions"],
  negotiation: ["opportunities", "questions"],
  questions: ["negotiation"],
  "participant-agents": ["negotiation", "questions"],
  contacts: ["opportunities"],
  integrations: [],
  "interaction-composition": [
    "signals",
    "participant-context",
    "communities",
    "opportunities",
    "negotiation",
    "questions",
    "participant-agents",
    "contacts",
    "integrations",
  ],
};

/** Capabilities allowed to import another capability's implementation directly. */
export const DIRECT_IMPLEMENTATION_EXEMPT_CAPABILITIES: ReadonlySet<Capability> =
  new Set<Capability>(["interaction-composition"]);

export function capabilityForSourcePath(pathFromSource: string): Capability | undefined {
  const normalized = pathFromSource.replace(/\\/g, "/");
  const [topLevel] = normalized.split("/");
  if (topLevel === "shared" && /^shared\/agent\/tool\.(?:factory|registry|helpers)\.ts$/.test(normalized)) {
    return "interaction-composition";
  }
  return CAPABILITY_DIRECTORIES[topLevel];
}

export function implementationCapabilityForSourcePath(
  pathFromSource: string,
): Capability | undefined {
  const normalized = pathFromSource.replace(/\\/g, "/");
  const [topLevel] = normalized.split("/");
  return CAPABILITY_DIRECTORIES[topLevel];
}

/**
 * The capability a path is the public barrel *of*, if any.
 *
 * This is the single seam a cross-capability import may target. It replaces the
 * capabilities/*.facade.ts layer: the barrel now lives inside the capability it
 * describes rather than in a separate directory of re-export files.
 */
export function barrelCapabilityForSourcePath(
  pathFromSource: string,
): Capability | undefined {
  const normalized = pathFromSource.replace(/\\/g, "/");
  const match = /^([a-z-]+)\/index\.ts$/.exec(normalized);
  if (!match) return undefined;
  const directory = match[1];
  const capability = CAPABILITY_DIRECTORIES[directory];
  if (!capability) return undefined;
  return CAPABILITY_BARREL_DIRECTORIES[capability] === directory ? capability : undefined;
}
