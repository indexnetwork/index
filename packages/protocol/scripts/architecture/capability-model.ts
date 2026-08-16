export type Capability =
  | "intents"
  | "contexts"
  | "networks"
  | "opportunities"
  | "negotiations"
  | "questions"
  | "agents"
  | "contacts"
  | "integrations"
  | "discovery"
  | "interaction-composition";

/** Single-segment top-level directories with a fixed capability assignment. */
export const CAPABILITY_DIRECTORIES: Readonly<Record<string, Capability>> = {
  // Every top-level directory maps to exactly one capability.
  intents: "intents",
  contexts: "contexts",
  enrichment: "contexts",
  premises: "contexts",
  networks: "networks",
  opportunities: "opportunities",
  negotiations: "negotiations",
  questions: "questions",
  agents: "agents",
  chat: "agents",
  contacts: "contacts",
  integrations: "integrations",
  discovery: "discovery",
  maintenance: "interaction-composition",
};

/**
 * The capability directory that owns each capability's barrel.
 *
 * A capability can span several top-level directories (contexts
 * covers enrichment/ and premises/ as well as contexts/), but exactly one of them holds
 * the `index.ts` that other capabilities are allowed to import.
 */
export const CAPABILITY_BARREL_DIRECTORIES: Readonly<Record<Capability, string | undefined>> = {
  intents: "intents",
  contexts: "contexts",
  networks: "networks",
  opportunities: "opportunities",
  negotiations: "negotiations",
  questions: "questions",
  agents: "agents",
  contacts: "contacts",
  integrations: "integrations",
  discovery: "discovery",
  // The composition root is the one all-capability point; it has no barrel of
  // its own and is reached through the package entry point instead.
  "interaction-composition": undefined,
};

/** Every permitted direction is deliberately named and reviewed here. */
export const ALLOWED_CAPABILITY_DIRECTIONS: Readonly<
  Record<Capability, readonly Capability[]>
> = {
  intents: ["agents", "questions"],
  contexts: ["agents", "questions", "discovery"],
  networks: ["agents", "intents"],
  opportunities: ["agents", "intents", "negotiations", "questions", "discovery"],
  negotiations: ["opportunities", "questions"],
  questions: ["negotiations"],
  agents: ["negotiations", "questions"],
  contacts: ["opportunities"],
  integrations: [],
  // discovery needs only the debug-metadata type it stamps on graph state.
  discovery: ["agents"],
  "interaction-composition": [
    "intents",
    "contexts",
    "networks",
    "opportunities",
    "negotiations",
    "questions",
    "agents",
    "contacts",
    "integrations",
    "discovery",
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
