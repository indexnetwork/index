/**
 * A real terminal UI — the same full-screen `Tui` the dev console
 * (`cli/console.ts`) uses — for acting as one agent over HTTP instead of
 * holding it in-process. Run `06-server.ts` first — it owns every agent and
 * their sqlite-backed state — then run this any number of times at once,
 * each picking whichever party it wants to act as. Nothing here is agent
 * state: exit and restart the TUI and the conversation is still on the
 * server, because the server never held it in memory either.
 *
 *   bun run examples/06-server.ts        # in one terminal
 *   bun run examples/06-tui.ts           # in as many others as you like
 */
import readline from "node:readline";
import { accent, dim, formatStep, red } from "../cli/format.ts";
import { Tui, type View } from "../cli/tui.ts";
import {
  PARTIES,
  type ChatRequest,
  type ChatResponse,
  type IntentRecord,
  type IntentsResponse,
  type PartyConfig,
  type ScopeRequest,
  type ScopeResponse,
  type WireEvent,
} from "./06-shared.ts";

function pickParty(): Promise<PartyConfig> {
  return new Promise((resolve) => {
    console.log("Act as:");
    PARTIES.forEach((party, i) => console.log(`  ${i + 1}) ${party.name}`));

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.setPrompt("> ");
    rl.prompt();
    rl.on("line", (line) => {
      const party = PARTIES[Number.parseInt(line.trim(), 10) - 1];
      if (!party) {
        console.log("No such party.");
        rl.prompt();
        return;
      }
      rl.close();
      resolve(party);
    });
  });
}

const party = await pickParty();
const paint = accent(0);

const lines: string[] = [];
const wire: string[] = [];
let busy: { label: string; since: number } | undefined;
let pending = false;
let controller: AbortController | undefined;
// What `/intents` last listed, so `/scope <n>` can resolve a number to an
// id without the user ever having to type or see one.
let lastIntents: IntentRecord[] = [];

function view(): View {
  return {
    title: `${party.name} — http://localhost:${party.port} (acting remotely, via /chat)`,
    parties: [{ name: party.name, intent: "connected to 06-server.ts", lines, wire, paint, busy, pending }],
    focus: 0,
    prompt: "> ",
  };
}

const tui = new Tui({
  view,
  submit,
  focus: () => {},
  interrupt: () => controller?.abort(),
  eof: () => {
    tui.close();
    process.exit(0);
  },
});

function submit(line: string): void {
  const text = line.trim();
  if (!text || busy) return;

  if (text.startsWith("/")) {
    void command(text).finally(() => tui.render());
    return;
  }

  lines.push(`${accent(1)("you")} ${text}`);
  pending = false;
  busy = { label: "thinking", since: Date.now() };
  tui.render();

  void chat(text).finally(() => {
    busy = undefined;
    tui.render();
  });
}

// --- scope commands: talk to the server directly, not through the model -

async function command(line: string): Promise<void> {
  const [name, ...rest] = line.slice(1).trim().split(/\s+/);
  const argument = rest.join(" ");

  switch (name) {
    case "help":
      lines.push(
        `  ${accent(1)("/intents")}              this party's published intents`,
        `  ${accent(1)("/scope")} <n>            scope to the nth one listed`,
        `  ${accent(1)("/unscope")}              drop the current scope`,
      );
      return;
    case "intents":
      return listIntents();
    case "scope":
      return setScope(argument);
    case "unscope":
      return clearScope();
    default:
      lines.push(red(`  ! unknown command "/${name}" — /help for the list`));
  }
}

async function listIntents(): Promise<void> {
  const result = await call<IntentsResponse>("/intents");
  if (!result) return;

  lastIntents = result.intents;
  if (!result.intents.length) {
    lines.push(dim("  no intents published yet"));
    return;
  }

  result.intents.forEach((intent, index) => {
    const active = result.scope?.id === intent.id;
    lines.push(`  ${active ? "▸" : " "} ${index + 1}) ${intent.statement}${active ? dim("  (scope)") : ""}`);
  });
}

async function setScope(argument: string): Promise<void> {
  const index = Number.parseInt(argument, 10);
  const record = lastIntents[index - 1];
  if (!record) {
    lines.push(red("  ! usage: /scope <n> — run /intents first to see the numbers"));
    return;
  }

  const body: ScopeRequest = { intentId: record.id };
  const result = await call<ScopeResponse>("/scope", { method: "POST", body: JSON.stringify(body) });
  if (result?.scope) lines.push(dim(`  scoped to: ${result.scope.statement}`));
}

async function clearScope(): Promise<void> {
  const result = await call<ScopeResponse>("/scope", { method: "DELETE" });
  if (result !== undefined) lines.push(dim("  scope cleared"));
}

async function call<T>(path: string, init?: RequestInit): Promise<T | undefined> {
  let response: Response;
  try {
    response = await fetch(`http://localhost:${party.port}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...init,
    });
  } catch {
    lines.push(red(`  ! ${party.name} is not reachable — is 06-server.ts running?`));
    return undefined;
  }

  if (!response.ok) {
    lines.push(red(`  ! server error (${response.status})`));
    return undefined;
  }

  return (await response.json()) as T;
}

// Mirrors the formatting `cli/roster.ts` applies inline in its `onTurn` and
// `onSettled` callbacks, since this party's own turns arrive here as data
// instead of a direct in-process callback.
function formatWireEvent(event: WireEvent): string {
  if (event.kind === "turn") {
    const who = dim(`[${event.peer ?? event.id.slice(0, 8)}]`);
    return `${dim(event.mine ? "→" : "←")} ${event.mine ? accent(1)("me") : dim("them")} ${who}  ${event.message}`;
  }
  const who = event.peer ?? event.id?.slice(0, 8);
  const terms = event.terms ? ` ${JSON.stringify(event.terms)}` : "";
  const line = `${who ? `[${who}] ` : ""}${event.outcome} (${event.basis})${terms} — ${event.reason}`;
  return event.disputed ? red(`  ⚠ ${line}`) : dim(`  ⚖ ${line}`);
}

async function chat(message: string): Promise<void> {
  controller = new AbortController();
  const request: ChatRequest = { message };

  let response: Response;
  try {
    response = await fetch(`http://localhost:${party.port}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
  } catch {
    lines.push(`  ! ${party.name} is not reachable — is 06-server.ts running?`);
    return;
  }

  if (!response.ok) {
    lines.push(`  ! server error (${response.status})`);
    return;
  }

  const result = (await response.json()) as ChatResponse;
  for (const step of result.steps) lines.push(...formatStep(step));
  for (const event of result.wire) wire.push(formatWireEvent(event));

  if (result.end === "needs-input" && result.pending) {
    lines.push(`  ? ${result.pending.question}`);
    pending = true;
    return;
  }

  if (result.output) for (const line of result.output.split("\n")) lines.push(line);
}
