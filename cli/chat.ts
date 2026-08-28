#!/usr/bin/env bun
/**
 * A terminal chat with the agent — the smallest possible host.
 *
 * Everything the centralized host does, this does in ~300 lines: build an
 * `Agent` with an identity and a system prompt, inject whatever operations
 * it may perform, call `run()`, and carry `messages`/`negotiations` from
 * one call to the next. When a run comes back `needs-input`, the question
 * becomes the prompt and your reply resumes it. That loop is the whole
 * live-chat story; there is no separate callback API.
 *
 *   bun run chat
 *   bun run chat -- --intent "Buy a used road bike under $450" --serve 8080
 *
 * Not published — `files` is `dist` only. This is for driving the package
 * by hand, the way `dev/local.ts` is for driving a negotiation by hand.
 */
import { userInfo } from "node:os";
import { parseArgs } from "node:util";
import {
  Agent,
  defaultTools,
  type Intent,
  type ModelMessage,
  type NegotiationSession,
  type PendingQuestion,
  type RunResult,
  type Settlement,
  type Step,
  type Tool,
  TaskStore,
} from "../src/index.ts";
import { Directory, type DirectoryEntry } from "./directory.ts";
import {
  bold,
  cyan,
  dim,
  formatStep,
  formatTurn,
  green,
  magenta,
  red,
  short,
  yellow,
} from "./format.ts";
import { createSurface, type Surface } from "./surface.ts";

// --- arguments -------------------------------------------------------

const { values } = parseArgs({
  options: {
    name: { type: "string", short: "n" },
    id: { type: "string" },
    intent: { type: "string", short: "i" },
    system: { type: "string", short: "s" },
    "system-file": { type: "string" },
    model: { type: "string", short: "m" },
    "max-steps": { type: "string" },
    serve: { type: "string" },
    url: { type: "string" },
    peer: { type: "string", multiple: true },
    registry: { type: "string" },
    seed: { type: "string" },
    "no-seed": { type: "boolean" },
    resume: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
  allowPositionals: true,
});

if (values.help) {
  console.log(`
${bold("chat")} — talk to a @indexnetwork/agent in the terminal

  ${dim("bun run chat -- [options]")}

  -n, --name <name>        display name       ${dim("(default: <user>'s Agent)")}
      --id <id>            party identity     ${dim("(default: local:<user>)")}
  -i, --intent <text>      scope the agent to an intent
  -s, --system <text>      system prompt      ${dim("(--system-file <path> to read one)")}
  -m, --model <model>      OpenRouter model
      --max-steps <n>      step cap per run   ${dim("(default: 10)")}
      --serve <port>       also answer inbound A2A negotiations
      --url <url>          public URL published on the AgentCard
      --peer <url>         a counterparty to offer regardless of matching ${dim("(repeatable)")}
      --registry <file>    shared intent directory ${dim("(default: .agents.json)")}
      --seed <file>        made-up intents to match against ${dim("(--no-seed for none)")}
      --resume <file>      continue a saved session
`);
  process.exit(0);
}

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.error(red("OPENROUTER_API_KEY is not set. Put it in .env or the environment."));
  process.exit(1);
}

const port = values.serve ? Number(values.serve) : undefined;
if (values.serve && !Number.isFinite(port)) {
  console.error(red(`--serve wants a port number, got "${values.serve}".`));
  process.exit(1);
}

const who = userInfo().username;
const systemPrompt = values["system-file"]
  ? await Bun.file(values["system-file"]).text()
  : (values.system ?? DEFAULT_PROMPT());

// --- state -----------------------------------------------------------

let saved = values.resume ? await load(values.resume) : undefined;

let messages: ModelMessage[] = saved?.messages ?? [];
let negotiations: NegotiationSession[] = saved?.negotiations ?? [];
let pending: PendingQuestion | undefined = saved?.pending;
let lastSteps: Step[] = [];

const peers = values.peer ?? [];

// Panes if this is a terminal, plain lines if stdout is a pipe. Built
// before anything can print: it takes over the screen.
const surface: Surface = createSurface();

// Discovery, as the host provides it. Registering publishes this agent's
// intent; `find_matches` reads everyone else's. Index Network is what this
// stands in for.
const directory = new Directory(values.registry ?? ".agents.json", await seeds());

const identity = {
  name: values.name ?? saved?.identity?.name ?? `${who}'s Agent`,
  id: values.id ?? saved?.identity?.id ?? `local:${who}`,
  description: "A personal agent, driven from a terminal chat.",
  url: values.url ?? (port ? `http://localhost:${port}` : undefined),
};

const base = new Agent({
  identity,
  systemPrompt,
  // Shared across intent scopes, so an inbound negotiation survives a
  // rescope — the default store is created per handler.
  taskStore: port ? new TaskStore() : undefined,
  tools: [...defaultTools(), matchTool()],
  model: values.model,
  maxSteps: values["max-steps"] ? Number(values["max-steps"]) : undefined,
  // Fires for both sides of every turn, outbound and inbound alike, so a
  // negotiation reads as a conversation rather than as tool output.
  onTurn: (turn, direction) => surface.negotiation(formatTurn(identity.name, turn, direction)),
  // Fires on both sides of a close, so this terminal and the counterparty's
  // reach the same verdict rather than each reporting its own action.
  onSettled: (settlement) => settled(settlement),
  // A retry looks exactly like slowness unless it says so.
  onRetry: (attempt, reason) => {
    surface.start(`retrying (${attempt}/3) — ${short(reason, 60)}`);
    say(dim(`⟳ retrying: ${short(reason, 120)}`));
  },
});

let intent: Intent | undefined =
  (values.intent ? { statement: values.intent } : undefined) ?? saved?.intent;
let agent = intent ? base.for(intent) : base;

// Built once: `handler()` closes over a fresh A2A handler each call, and
// rebuilding one per request would lose the tasks in flight.
let handler = agent.handler();
const server = port ? Bun.serve({ port, fetch: (request) => handler(request) }) : undefined;

// Only an agent that can be reached is worth matching with, so publishing
// waits on --serve. The URL is the point of a match.
await publish();

// --- session ---------------------------------------------------------

banner();

let inflight: AbortController | undefined;
let interruptedAt = 0;

// ^C aborts the run in flight; twice in a row, with nothing running, ends
// the session.
surface.onInterrupt(() => {
  if (inflight) {
    inflight.abort();
    inflight = undefined;
    return;
  }
  const now = Date.now();
  if (now - interruptedAt < 1500) return surface.end();
  interruptedAt = now;
  say(dim("(^C again to exit, or /exit)"));
});

for (;;) {
  const line = await surface.ask(pending ? yellow("answer › ") : cyan("› "));

  if (line === null) break; // ^D, or ^C twice
  const input = line.trim();
  if (!input) continue;

  if (input.startsWith("/")) {
    if (await command(input)) continue;
    break;
  }

  await turn(input);
}

await shutdown();

// --- the loop --------------------------------------------------------

/**
 * One exchange. `input` is a new instruction, or — when the last run
 * stopped on a question — the answer to it; `run()` tells the two apart by
 * looking at the transcript, so this side just passes it through.
 */
async function turn(input: string): Promise<void> {
  inflight = new AbortController();
  surface.start(pending ? "resuming" : "thinking");

  let result: RunResult;
  try {
    result = await agent.run(input, {
      messages,
      negotiations,
      signal: inflight.signal,
      onStep: report,
    });
  } catch (cause) {
    const aborted = inflight?.signal.aborted ?? true;
    say(aborted ? dim("(interrupted)") : red(`✗ ${message(cause)}`));
    return;
  } finally {
    surface.stop();
    inflight = undefined;
  }

  // Everything that has to survive to the next call: the transcript, and
  // any negotiation left open in it.
  messages = result.messages;
  negotiations = result.negotiations;
  lastSteps = result.steps;
  pending = result.pending;

  if (result.output) say(`\n${result.output}\n`);

  if (pending) {
    say(`${yellow("?")} ${bold(pending.question)}`);
    if (pending.options?.length) say(dim(`  ${pending.options.join("  ·  ")}`));
    say("");
    return;
  }

  if (result.end === "max-steps") {
    say(dim(`(stopped at the step cap — say "carry on" to continue)\n`));
  }
}

/** Steps go to the pane they belong to: negotiating is its own stream, and
 * reading it interleaved with the conversation is what the panes are for. */
function report(step: Step): void {
  const negotiating = step.kind === "tool" && step.name.startsWith("negotiate_");
  for (const line of formatStep(step)) {
    if (negotiating) surface.negotiation(line);
    else say(line);
  }
}

/**
 * How the exchange actually ended, if it did. Worth its own line, and a
 * warning in the conversation when it is disputed: one side's `accept` is
 * not an agreement, and this is the moment the two parties would otherwise
 * walk away believing different things.
 */
function settled(settlement: Settlement): void {
  // Worth a warning whenever this agent closed on a deal and the exchange
  // didn't: an accept met with a rejection reads as "declined", which is
  // true and still not what the party was expecting.
  const closedOnADeal = settlement.mine.action === "accept";
  const disputed =
    settlement.outcome === "conflict" ||
    settlement.outcome === "unconfirmed" ||
    (closedOnADeal && settlement.outcome !== "agreed");

  const terms = settlement.terms ? ` ${JSON.stringify(settlement.terms)}` : "";
  const line = `${settlement.outcome} (${settlement.basis})${terms} — ${settlement.reason}`;
  surface.negotiation(disputed ? red(`⚠ ${line}`) : dim(`— ${line}`));
  if (disputed) say(red(`⚠ negotiation ${settlement.outcome}: ${settlement.reason}`));
  else if (settlement.terms) say(dim(`agreed: ${JSON.stringify(settlement.terms)}`));
}

// --- commands --------------------------------------------------------

/** Returns false to end the session. */
async function command(line: string): Promise<boolean> {
  const [name, ...rest] = line.slice(1).split(/\s+/);
  const argument = rest.join(" ").trim();

  switch (name) {
    case "exit":
    case "quit":
      return false;

    case "help":
      help();
      return true;

    case "card":
      say(JSON.stringify(agent.card(), null, 2));
      return true;

    case "instructions":
      say(dim(agent.instructions()));
      return true;

    case "intent": {
      if (!argument) {
        say(intent ? `intent: ${intent.statement}` : dim("no intent — unscoped agent"));
        return true;
      }
      // The same identity, a narrower context: `for()` shares the identity
      // object, so the card doesn't move. The conversation carries over —
      // only the system message the model runs under changes.
      intent = argument === "none" ? undefined : { statement: argument };
      agent = intent ? base.for(intent) : base;
      handler = agent.handler();
      await publish();
      surface.header(
        [bold(identity.name), dim(identity.id), intent?.statement ?? dim("unscoped")]
          .join(dim(" · ")),
      );
      say(dim(intent ? `scoped to: ${intent.statement}` : "unscoped"));
      return true;
    }

    case "matches": {
      const rows = await matches(argument);
      if (typeof rows === "string") {
        say(dim(rows));
        return true;
      }
      for (const row of rows) {
        const mark = row.status === "live" ? green("●") : dim("○");
        say(
          `  ${mark} ${bold(row.name)} ${dim(row.url)} ${dim(`${row.score} · ${row.status}`)}\n` +
            `    ${row.intent}\n` +
            `    ${dim(row.why)}`,
        );
      }
      return true;
    }

    case "negotiate": {
      const [url, ...objective] = argument.split(/\s+/);
      if (!url) {
        say(red("usage: /negotiate <url> [objective]"));
        return true;
      }
      await negotiate(url, objective.join(" "));
      return true;
    }

    case "inspect": {
      if (!argument) {
        say(red("usage: /inspect <url>"));
        return true;
      }
      surface.start("fetching card");
      try {
        surface.stop();
        say(JSON.stringify(await agent.inspect(argument), null, 2));
      } catch (cause) {
        surface.stop();
        say(red(`✗ ${message(cause)}`));
      }
      return true;
    }

    case "negotiations": {
      if (!negotiations.length) {
        say(dim("none open"));
        return true;
      }
      for (const session of negotiations) {
        const turns = session.task?.history?.length ?? 0;
        say(
          `  ${magenta(session.id.slice(0, 8))} ${session.peer?.name ?? session.url} ` +
            dim(`${session.task?.status?.state ?? "?"} · ${turns} turns`),
        );
      }
      return true;
    }

    case "steps": {
      if (!lastSteps.length) {
        say(dim("nothing run yet"));
        return true;
      }
      say(JSON.stringify(lastSteps, null, 2));
      return true;
    }

    case "clear":
      messages = [];
      negotiations = [];
      pending = undefined;
      lastSteps = [];
      say(dim("conversation cleared"));
      return true;

    case "save": {
      const file = argument || `.sessions/${stamp()}.json`;
      await Bun.write(
        file,
        JSON.stringify({ identity, intent, messages, negotiations, pending }, null, 2),
      );
      say(dim(`saved to ${file} — resume with --resume ${file}`));
      return true;
    }

    default:
      say(red(`unknown command "/${name}" — /help for the list`));
      return true;
  }
}

/** Runs a negotiation to completion, outside the agent loop. The loop uses
 * the turn-level tools instead, so it can stop in between. */
async function negotiate(url: string, objective: string): Promise<void> {
  surface.start("negotiating");
  try {
    const result = await agent.negotiate(url, objective ? { objective } : {});
    surface.stop();
    const by = result.endedBy
      ? `${result.endedBy.speaker} took "${result.endedBy.action}"`
      : "nobody took a terminal action";
    surface.negotiation(dim(`— ${result.end} (${by}), task ${result.state}`));
  } catch (cause) {
    surface.stop();
    surface.negotiation(red(`✗ ${message(cause)}`));
  }
}

// --- host-injected operations ----------------------------------------

/**
 * Discovery, injected the way a host injects it.
 *
 * The agent doesn't know what a match is or where one comes from — it gets
 * a tool that answers "who should I be talking to?", and the answer
 * carries the A2A URL that `negotiate_open` needs. Swapping this for a
 * call into Index Network changes nothing above it.
 */
function matchTool(): Tool<never> {
  const tool: Tool<{ looking_for?: string }> = {
    name: "find_matches",
    description:
      "Find agents whose parties want the other end of what yours wants, matched on intent. Returns each match with its A2A url, so you can open a negotiation with it. Pass `looking_for` to match on something other than your standing intent.",
    parameters: {
      type: "object",
      properties: {
        looking_for: {
          type: "string",
          description: "What to match on, if not your current intent.",
        },
      },
    },
    run: ({ looking_for }) => matches(looking_for),
  };
  return tool as Tool<never>;
}

interface MatchRow {
  name: string;
  id: string;
  url: string;
  intent: string;
  score: number;
  why: string;
  /** Whether there is anything behind the URL right now. Seeded intents
   * are nobody; a registered agent that has since exited is unreachable. */
  status: "live" | "offline" | "unreachable";
}

async function matches(lookingFor?: string): Promise<MatchRow[] | string> {
  const statement = (lookingFor || intent?.statement || "").trim();

  const manual: MatchRow[] = peers.map((url) => ({
    name: url,
    id: url,
    url,
    intent: "given on the command line",
    score: 1,
    why: "passed in with --peer, not matched",
    status: "live",
  }));

  if (!statement && !manual.length) {
    return "No intent to match on. Set one with /intent, or pass `looking_for`.";
  }

  const found = statement
    ? await directory.matchesFor({ id: identity.id, intent: statement })
    : [];

  const rows = [
    ...manual,
    ...found.map((match) => ({
      name: match.entry.name,
      id: match.entry.id,
      url: match.entry.url,
      intent: match.entry.intent,
      score: match.score,
      why: match.why,
      status: (match.entry.live ? "live" : "offline") as MatchRow["status"],
    })),
  ];

  // A registered agent that exited without deregistering still has a row.
  // Say so, rather than letting the model negotiate with a dead port.
  await Promise.all(
    rows.map(async (row) => {
      if (row.status === "offline") return;
      if (!(await reachable(row.url))) row.status = "unreachable";
    }),
  );

  return rows.length ? rows : `Nothing matched "${statement}".`;
}

async function reachable(url: string): Promise<boolean> {
  try {
    const response = await fetch(new URL("/.well-known/agent-card.json", url), {
      signal: AbortSignal.timeout(1500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Publishes this agent's intent, so the other terminal can match on it. */
async function publish(): Promise<void> {
  if (!server) return;
  await directory.register({
    id: identity.id,
    name: identity.name,
    url: server.url.toString(),
    intent: intent?.statement ?? "",
  });
}

/** Made-up intents, so a two-terminal test still reads like a directory
 * rather than a pair. Nobody is behind them. */
async function seeds(): Promise<DirectoryEntry[]> {
  if (values["no-seed"]) return [];
  const file = values.seed ?? new URL("./fixtures/intents.json", import.meta.url).pathname;
  try {
    return (await Bun.file(file).json()) as DirectoryEntry[];
  } catch {
    return [];
  }
}

// --- odds and ends ---------------------------------------------------

function DEFAULT_PROMPT(): string {
  return [
    `You are a personal agent acting for ${who}. You talk with them directly in a terminal, and you can negotiate with other agents on their behalf.`,
    "Ask them about anything you have not been told — a budget, a date, a preference, approval to commit to something — rather than inventing it. One question at a time.",
    "Keep your replies short and plain. Say what you did and what you need.",
  ].join(" ");
}

function banner(): void {
  // The header is one line and stays put; the rest is conversation.
  const parts = [bold(identity.name), dim(identity.id)];
  if (intent) parts.push(intent.statement);
  if (server) parts.push(dim(`serving ${server.url.toString()}`));
  surface.header(parts.join(dim(" · ")));

  say(`${bold(identity.name)} ${dim(identity.id)}`);
  if (intent) say(dim(`intent    ${intent.statement}`));
  if (server) say(dim(`serving   ${server.url.toString()} (inbound A2A)`));
  if (server) say(dim(`published to ${values.registry ?? ".agents.json"}`));
  if (peers.length) say(dim(`peers     ${peers.join(", ")}`));
  if (saved) say(dim(`resumed   ${messages.length} messages, ${negotiations.length} open`));
  say(dim("/help for commands"));
  say("");

  if (pending) {
    say(`${yellow("?")} ${bold(pending.question)}`);
    say("");
  }
}

function help(): void {
  say(`
  ${bold("/intent")} <text>       scope the agent ${dim("(/intent none to unscope)")}
  ${bold("/matches")} [intent]     agents whose intent pairs with this one
  ${bold("/negotiate")} <url> [objective]  run one negotiation to completion
  ${bold("/inspect")} <url>       fetch a counterparty's AgentCard
  ${bold("/negotiations")}        exchanges left open in this session
  ${bold("/card")}                the AgentCard this agent publishes
  ${bold("/instructions")}        the system message the model runs under
  ${bold("/steps")}               full detail of the last run
  ${bold("/save")} [file]         write the session out ${dim("(resume with --resume)")}
  ${bold("/clear")}               forget the conversation
  ${bold("/exit")}
`);
}

interface Saved {
  identity?: { name?: string; id?: string };
  intent?: Intent;
  messages: ModelMessage[];
  negotiations: NegotiationSession[];
  pending?: PendingQuestion;
}

async function load(file: string): Promise<Saved | undefined> {
  try {
    return (await Bun.file(file).json()) as Saved;
  } catch (cause) {
    console.error(red(`could not read ${file}: ${message(cause)}`));
    process.exit(1);
  }
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

async function shutdown(): Promise<never> {
  surface.stop();
  // Leaving the entry behind would advertise a port that is about to close.
  if (server) await directory.deregister(identity.id).catch(() => {});
  server?.stop(true);
  surface.close();
  process.exit(0);
}

/** Writes to the chat pane. Multi-line output — a card, a step dump —
 * becomes one entry per line, so it wraps and scrolls like everything
 * else. */
function say(text: string): void {
  for (const line of text.split("\n")) surface.chat(line);
}
