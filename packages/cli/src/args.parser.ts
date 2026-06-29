/**
 * Parsed CLI command with all possible options.
 *
 * The `command` field determines which handler runs. Optional fields
 * are populated only when relevant to the active command.
 */
export interface ParsedCommand {
  command: "login" | "logout" | "profile" | "intent" | "opportunity" | "negotiation" | "network" | "conversation" | "contact" | "scrape" | "onboarding" | "sync" | "help" | "version" | "unknown";
  /** One-shot message for conversation command (H2A agent chat). */
  message?: string;
  /** Resume a specific chat session (--session flag). */
  sessionId?: string;
  /** @deprecated Unused — sessions are listed via 'conversation sessions' subcommand. */
  list: boolean;
  /** Override the API base URL. */
  apiUrl?: string;
  /** Override the app URL (frontend, serves /cli-auth). */
  appUrl?: string;
  /** Manually provided bearer token for login. */
  token?: string;
  /** The unrecognized command string (when command === "unknown"). */
  unknown?: string;
  /** Subcommand for multi-level commands (profile, intent, opportunity, network, conversation). */
  subcommand?: "show" | "sync" | "list" | "create" | "archive" | "accept" | "reject" | "join" | "leave" | "invite" | "with" | "send" | "stream" | "sessions" | "help" | "update" | "delete" | "link" | "unlink" | "links" | "discover" | "search" | "add" | "remove" | "import" | "complete";
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
  /** Name for --name flag (e.g. contact add). */
  name?: string;
  /** Gmail import flag for contact import. */
  gmail?: boolean;
  /** Objective for --objective flag (e.g. scrape). */
  objective?: string;
  /** Target for --target flag (e.g. opportunity discover). */
  target?: string;
  /** Introduce for --introduce flag (e.g. opportunity discover). */
  introduce?: string;
  /** LinkedIn URL for profile create. */
  linkedin?: string;
  /** GitHub URL for profile create. */
  github?: string;
  /** Twitter URL for profile create. */
  twitter?: string;
  /** Title for network update --title. */
  title?: string;
  /** Details text for profile update --details. */
  details?: string;
  /** ISO date string for --since filter (e.g. negotiation list). */
  since?: string;
}

const KNOWN_COMMANDS = new Set(["login", "logout", "profile", "intent", "opportunity", "negotiation", "network", "conversation", "contact", "scrape", "onboarding", "sync", "help", "version"]);

const OPPORTUNITY_SUBCOMMANDS = new Set(["list", "show", "accept", "reject", "discover"]);

const NEGOTIATION_SUBCOMMANDS = new Set(["list", "show"]);

const NETWORK_SUBCOMMANDS = new Set(["list", "create", "show", "join", "leave", "invite", "update", "delete"]);

const CONVERSATION_SUBCOMMANDS = new Set(["list", "with", "show", "send", "stream", "sessions", "help"]);

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
    list: false,
  };

  if (args.length === 0) {
    return result;
  }

  // Pre-scan: extract global flags that may appear before the command
  let commandIndex = -1;
  for (let j = 0; j < args.length; j++) {
    const a = args[j];
    if (a === "--api-url" || a === "--app-url" || a === "--token" || a === "-t") {
      if (a === "--api-url") result.apiUrl = args[j + 1];
      else if (a === "--app-url") result.appUrl = args[j + 1];
      else result.token = args[j + 1];
      j++; // skip value
    } else if (a === "--help" || a === "-h") {
      result.command = "help";
      return result;
    } else if (a === "--version" || a === "-v") {
      result.command = "version";
      return result;
    } else if (!a.startsWith("--")) {
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

    if (arg === "--list" || arg === "-l") {
      result.list = true;
      i++;
    } else if (arg === "--session" || arg === "-s") {
      result.sessionId = args[i + 1];
      i += 2;
    } else if (arg === "--api-url") {
      result.apiUrl = args[i + 1];
      i += 2;
    } else if (arg === "--app-url") {
      result.appUrl = args[i + 1];
      i += 2;
    } else if (arg === "--token" || arg === "-t") {
      result.token = args[i + 1];
      i += 2;
    } else if (arg === "--archived") {
      result.archived = true;
      i++;
    } else if (arg === "--status") {
      result.status = args[i + 1];
      i += 2;
    } else if (arg === "--limit") {
      result.limit = parseInt(args[i + 1], 10);
      i += 2;
    } else if (arg === "--prompt" || arg === "-p") {
      result.prompt = args[i + 1];
      i += 2;
    } else if (arg === "--json") {
      result.json = true;
      i++;
    } else if (arg === "--name") {
      result.name = args[i + 1];
      i += 2;
    } else if (arg === "--gmail") {
      result.gmail = true;
      i++;
    } else if (arg === "--objective") {
      result.objective = args[i + 1];
      i += 2;
    } else if (arg === "--target") {
      result.target = args[i + 1];
      i += 2;
    } else if (arg === "--introduce") {
      result.introduce = args[i + 1];
      i += 2;
    } else if (arg === "--linkedin") {
      result.linkedin = args[i + 1];
      i += 2;
    } else if (arg === "--github") {
      result.github = args[i + 1];
      i += 2;
    } else if (arg === "--twitter") {
      result.twitter = args[i + 1];
      i += 2;
    } else if (arg === "--title") {
      result.title = args[i + 1];
      i += 2;
    } else if (arg === "--details") {
      result.details = args[i + 1];
      i += 2;
    } else if (arg === "--since") {
      result.since = args[i + 1];
      i += 2;
    } else if (arg.startsWith("--")) {
      // Skip unknown flags
      i++;
    } else {
      positionals.push(arg);
      i++;
    }
  }

  // Opportunity subcommand parsing
  if (result.command === "opportunity") {
    const sub = positionals[0];
    if (sub && OPPORTUNITY_SUBCOMMANDS.has(sub)) {
      result.subcommand = sub as ParsedCommand["subcommand"];
      if (sub === "discover") {
        // Remaining positionals are the search query
        result.positionals = positionals.slice(1);
      } else if (positionals[1]) {
        // Second positional is the target ID (for show/accept/reject)
        result.targetId = positionals[1];
      }
    }
    return result;
  }

  // Negotiation subcommand parsing
  if (result.command === "negotiation") {
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
    if (sub === "complete") {
      result.subcommand = "complete";
    }
  }

  // Contact command: first positional is subcommand, rest are args
  if (result.command === "contact") {
    if (positionals.length > 0) {
      const sub = positionals[0];
      if (["list", "add", "remove", "import"].includes(sub)) {
        result.subcommand = sub as ParsedCommand["subcommand"];
        result.positionals = positionals.slice(1);
      }
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
  // If the first positional is not a known subcommand, treat all positionals
  // as a one-shot message to the AI agent.
  if (result.command === "conversation") {
    if (positionals.length > 0 && CONVERSATION_SUBCOMMANDS.has(positionals[0])) {
      result.subcommand = positionals[0] as ParsedCommand["subcommand"];
      result.positionals = positionals.slice(1);
    } else if (positionals.length > 0) {
      // Not a known subcommand — treat as one-shot agent message
      result.message = positionals.join(" ");
    }
  }

  return result;
}

const INTENT_SUBCOMMANDS = new Set(["list", "show", "create", "archive", "update", "link", "unlink", "links"]);

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
    case "links":
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
    case "link":
    case "unlink":
      result.intentId = rest[0];
      result.targetId = rest[1]; // networkId
      break;
  }
}
