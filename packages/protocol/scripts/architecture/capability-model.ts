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
  | "interaction-composition"
  | "ambient-background"
  | "neutral-platform"
  | "public-compatibility";

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
  questioner: "questions",
  "participant-agents": "participant-agents",
  chat: "participant-agents",
  agent: "participant-agents",
  contacts: "contacts",
  contact: "contacts",
  integrations: "integrations",
  integration: "integrations",
  maintenance: "interaction-composition",
  platform: "neutral-platform",
  public: "public-compatibility",
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
  "participant-agents": ["negotiation"],
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
  "ambient-background": [
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
  "neutral-platform": [],
  "public-compatibility": [
    "signals",
    "participant-context",
    "communities",
    "opportunities",
    "negotiation",
    "questions",
    "participant-agents",
    "contacts",
    "integrations",
    "interaction-composition",
  ],
};

/** Capabilities allowed to import another capability's implementation directly. */
export const DIRECT_IMPLEMENTATION_EXEMPT_CAPABILITIES: ReadonlySet<Capability> =
  new Set<Capability>(["interaction-composition", "ambient-background"]);

export function capabilityForSourcePath(pathFromSource: string): Capability | undefined {
  const normalized = pathFromSource.replace(/\\/g, "/");
  const [topLevel, second] = normalized.split("/");
  if (topLevel === "runtime") {
    if (second === "foreground") return "interaction-composition";
    if (second === "background") return "ambient-background";
    return undefined;
  }
  if (topLevel === "capabilities") return facadeCapabilityForSourcePath(normalized);
  if (topLevel === "shared" && /^shared\/agent\/tool\.(?:factory|registry|helpers)\.ts$/.test(normalized)) {
    return "interaction-composition";
  }
  return CAPABILITY_DIRECTORIES[topLevel];
}

export function implementationCapabilityForSourcePath(
  pathFromSource: string,
): Capability | undefined {
  const normalized = pathFromSource.replace(/\\/g, "/");
  const [topLevel, second] = normalized.split("/");
  if (topLevel === "runtime") {
    if (second === "foreground") return "interaction-composition";
    if (second === "background") return "ambient-background";
    return undefined;
  }
  return CAPABILITY_DIRECTORIES[topLevel];
}

export function facadeCapabilityForSourcePath(
  pathFromSource: string,
): Capability | undefined {
  const normalized = pathFromSource.replace(/\\/g, "/");
  const match = /^capabilities\/([a-z-]+)(?:\.[a-z-]+)?\.facade\.ts$/.exec(normalized);
  return match?.[1] as Capability | undefined;
}
