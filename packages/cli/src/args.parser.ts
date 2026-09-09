/**
 * Parsed CLI command with all possible options.
 *
 * The `command` field determines which handler runs. Optional fields
 * are populated only when relevant to the active command.
 */
export interface ParsedCommand {
  command: "tool" | "agent" | "login" | "logout" | "profile" | "intent" | "opportunity" | "negotiation" | "network" | "conversation" | "scrape" | "onboarding" | "sync" | "help" | "version" | "unknown";
  /** Override the API base URL. */
  apiUrl?: string;
  /** Override the app URL (frontend, serves /cli-auth). */
  appUrl?: string;
  /** The unrecognized command string (when command === "unknown"). */
  unknown?: string;
  /** Subcommand for multi-level commands (profile, intent, opportunity, network, conversation). */
  subcommand?: "call" | "me" | "turn" | "confirm-profile" | "show" | "sync" | "list" | "create" | "archive" | "accept" | "reject" | "join" | "leave" | "invite" | "with" | "send" | "stream" | "help" | "update" | "delete" | "add-to-network" | "remove-from-network" | "search" | "add" | "remove" | "import" | "complete";
  /** Target user ID for `profile show <user-id>`. */
  userId?: string;
  /** Intent ID for show/archive subcommands. */
  intentId?: string;
  /** Content string for intent create subcommand. */
  intentContent?: string;
  /** Include archived intents in listing. */
  archived?: boolean;
  /** Positional ID argument for subcommands that require a target (e.g. opportunity show <id>). */
  targetId?: string;
  /** Status filter for list subcommands (e.g. --status pending). */
  status?: string;
  /** Limit for list subcommands (e.g. --limit 10). */
  limit?: number;
  /** Positional arguments after command/subcommand (e.g. id, name, email). */
  positionals?: string[];
  /** Prompt text for network create --prompt. */
  prompt?: string;
  /** Output raw JSON instead of formatted text. */
  json?: boolean;
  /** Objective for --objective flag (e.g. scrape). */
  objective?: string;
  /** Title for network update --title. */
  title?: string;
  query?: string;
  state?: string;
  action?: string;
  message?: string;
  expectedTurnCount?: number;
  questionId?: string;
}

const KNOWN_COMMANDS = new Set(["tool", "agent", "login", "logout", "profile", "intent", "opportunity", "negotiation", "network", "conversation", "scrape", "onboarding", "sync", "help", "version"]);

const OPPORTUNITY_SUBCOMMANDS = new Set(["list", "show", "accept", "reject"]);

const NEGOTIATION_SUBCOMMANDS = new Set(["list", "show", "turn"]);

const NETWORK_SUBCOMMANDS = new Set(["list", "create", "show", "join", "leave", "invite", "update", "delete"]);

const CONVERSATION_SUBCOMMANDS = new Set(["list", "with", "show", "send", "stream", "help"]);

/**
 * Parse raw CLI arguments into a structured command object.
 *
 * Arguments follow the pattern: `index <command> [options] [positional]`.
 * Bun strips the binary name and script path, so `args` starts at the
 * first user-provided token.
 *
 * @param args - CLI arguments (typically `process.argv.slice(2)`).
 * @returns Parsed command with options.
 */
export function parseArgs(args: string[]): ParsedCommand {
  const result: ParsedCommand = {
    command: "help",
    json: args.includes("--json"),
  };

  if (args.length === 0) {
    return result;
  }

  // Pre-scan: extract global flags that may appear before the command
  let commandIndex = -1;
  for (let j = 0; j < args.length; j++) {
    const a = args[j];
    if (a === "--api-url" || a === "--app-url") {
      if (!args[j + 1] || args[j + 1].startsWith("--")) throw new Error(`Missing value for ${a}`);
      if (a === "--api-url") result.apiUrl = args[j + 1];
      else result.appUrl = args[j + 1];
      j++; // skip value
    } else if (a === "--help" || a === "-h") {
      result.command = "help";
      return result;
    } else if (a === "--version" || a === "-v") {
      result.command = "version";
      return result;
    } else if (a === "--json") {
      continue;
    } else if (a.startsWith("-")) {
      throw new Error(`Unknown option: ${a}`);
    } else {
      commandIndex = j;
      break;
    }
  }

  if (commandIndex === -1) {
    return result;
  }

  const first = args[commandIndex];

  // Route to command
  if (!KNOWN_COMMANDS.has(first)) {
    result.command = "unknown";
    result.unknown = first;
    return result;
  }

  result.command = first as ParsedCommand["command"];

  // Parse remaining args for the command
  let i = commandIndex + 1;
  const positionals: string[] = [];

  while (i < args.length) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") return { ...result, command: "help" };
    if (arg === "--version" || arg === "-v") return { ...result, command: "version" };
    if (["--api-url", "--app-url", "--status", "--limit", "--prompt", "-p", "--objective", "--title"].includes(arg)
      && (!args[i + 1] || args[i + 1].startsWith("--"))) throw new Error(`Missing value for ${arg}`);

    if (["--query", "--state", "--action", "--message", "--intent-id", "--question-id", "--expected-turn-count"].includes(arg)) {
      const value = args[i + 1];
      if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      switch (arg) {
        case "--query": result.query = value; break;
        case "--state": result.state = value; break;
        case "--action": result.action = value; break;
        case "--message": result.message = value; break;
        case "--intent-id": result.intentId = value; break;
        case "--question-id": result.questionId = value; break;
        case "--expected-turn-count": result.expectedTurnCount = Number(value); break;
      }
      i += 2;
    } else if (arg === "--api-url") {
      result.apiUrl = args[i + 1];
      i += 2;
    } else if (arg === "--app-url") {
      result.appUrl = args[i + 1];
      i += 2;
    } else if (arg === "--archived") {
      result.archived = true;
      i++;
    } else if (arg === "--status") {
      result.status = args[i + 1];
      i += 2;
    } else if (arg === "--limit") {
      result.limit = Number(args[i + 1]);
      if (!Number.isSafeInteger(result.limit) || result.limit < 1) throw new Error("--limit must be a positive integer");
      i += 2;
    } else if (arg === "--prompt" || arg === "-p") {
      result.prompt = args[i + 1];
      i += 2;
    } else if (arg === "--json") {
      result.json = true;
      i++;
    } else if (arg === "--objective") {
      result.objective = args[i + 1];
      i += 2;
    } else if (arg === "--title") {
      result.title = args[i + 1];
      i += 2;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positionals.push(arg);
      i++;
    }
  }

  const subcommands: Partial<Record<ParsedCommand["command"], Set<string>>> = {
    tool: new Set(["list", "call"]), agent: new Set(["me"]),
    opportunity: OPPORTUNITY_SUBCOMMANDS, negotiation: NEGOTIATION_SUBCOMMANDS,
    network: NETWORK_SUBCOMMANDS, conversation: CONVERSATION_SUBCOMMANDS,
    intent: INTENT_SUBCOMMANDS, profile: new Set(["show", "sync"]),
    onboarding: new Set(["confirm-profile", "complete"]),
  };
  const allowed = subcommands[result.command];
  if (allowed && result.command !== "profile" && !positionals[0]) {
    throw new Error(`Missing subcommand for index ${result.command}. Run index --help.`);
  }
  if (allowed && positionals[0] && !allowed.has(positionals[0])) {
    throw new Error(`Unknown command: ${result.command} ${positionals[0]}`);
  }

  if (result.command === "tool" || result.command === "agent") {
    result.subcommand = positionals[0] as ParsedCommand["subcommand"];
    result.positionals = positionals.slice(1);
    return result;
  }

  // Opportunity subcommand parsing
  if (result.command === "opportunity") {
    const sub = positionals[0];
    if (sub && OPPORTUNITY_SUBCOMMANDS.has(sub)) {
      result.subcommand = sub as ParsedCommand["subcommand"];
      if (positionals[1]) {
        // Second positional is the target ID (for show/accept/reject)
        result.targetId = positionals[1];
      }
    } else if (sub) {
      result.command = "unknown";
      result.unknown = `opportunity ${sub}`;
    }
    return result;
  }

  // Negotiation subcommand parsing
  if (result.command === "negotiation") {
    if (result.limit !== undefined || result.status !== undefined) {
      throw new Error("Negotiation filters are --intent-id and --state only");
    }
    const sub = positionals[0];
    if (sub && NEGOTIATION_SUBCOMMANDS.has(sub)) {
      result.subcommand = sub as ParsedCommand["subcommand"];
      if (positionals[1]) {
        result.targetId = positionals[1];
      }
    }
    return result;
  }

  // Profile subcommands: "show <user-id>", "sync", "search <query>", "create", "update <action>"
  if (result.command === "profile" && positionals.length > 0) {
    const sub = positionals[0];
    if (sub === "show") {
      result.subcommand = "show";
      if (positionals[1]) {
        result.userId = positionals[1];
      }
    } else if (sub === "sync") {
      result.subcommand = "sync";
    } else if (sub === "search") {
      result.subcommand = "search";
      result.positionals = positionals.slice(1);
    } else if (sub === "create") {
      result.subcommand = "create";
    } else if (sub === "update") {
      result.subcommand = "update";
      result.positionals = positionals.slice(1);
    }
  }

  // Onboarding command: first positional is subcommand
  if (result.command === "onboarding" && positionals.length > 0) {
    const sub = positionals[0];
    if (sub === "complete" || sub === "confirm-profile") {
      result.subcommand = sub;
    }
  }

  // Scrape command: positionals are the URL and any extra args
  if (result.command === "scrape") {
    result.positionals = positionals;
  }

  // Intent subcommand parsing
  if (result.command === "intent") {
    parseIntentArgs(positionals, result);
  }

  // Network command: first positional is subcommand, rest are args
  if (result.command === "network") {
    if (positionals.length > 0 && NETWORK_SUBCOMMANDS.has(positionals[0])) {
      result.subcommand = positionals[0] as ParsedCommand["subcommand"];
      result.positionals = positionals.slice(1);
    } else if (positionals.length > 0) {
      // Unknown subcommand — treat as positionals
      result.positionals = positionals;
    }
  }

  // Conversation command: first positional is subcommand, rest are args.
  // Anything else leaves the subcommand unset, which the handler reports as
  // the retired agent-chat surface.
  if (result.command === "conversation") {
    if (positionals.length > 0 && CONVERSATION_SUBCOMMANDS.has(positionals[0])) {
      result.subcommand = positionals[0] as ParsedCommand["subcommand"];
      result.positionals = positionals.slice(1);
    }
  }

  return result;
}

const INTENT_SUBCOMMANDS = new Set(["list", "show", "create", "archive", "update", "add-to-network", "remove-from-network"]);

/**
 * Parse intent-specific positional arguments into subcommand, ID, or content.
 *
 * @param positionals - Positional arguments after flags have been extracted.
 * @param result - The parsed command object to populate.
 */
function parseIntentArgs(positionals: string[], result: ParsedCommand): void {
  if (positionals.length === 0) return;

  const sub = positionals[0];
  if (!INTENT_SUBCOMMANDS.has(sub)) return;

  result.subcommand = sub as ParsedCommand["subcommand"];
  const rest = positionals.slice(1);

  switch (result.subcommand) {
    case "show":
    case "archive":
      result.intentId = rest[0];
      break;
    case "create":
      if (rest.length > 0) {
        result.intentContent = rest.join(" ");
      }
      break;
    case "update":
      result.intentId = rest[0];
      if (rest.length > 1) {
        result.intentContent = rest.slice(1).join(" ");
      }
      break;
    case "add-to-network":
    case "remove-from-network":
      result.intentId = rest[0];
      result.targetId = rest[1]; // networkId
      break;
  }
}
