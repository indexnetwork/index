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
import { accent, formatStep } from "../cli/format.ts";
import { Tui, type View } from "../cli/tui.ts";
import { PARTIES, type ChatRequest, type ChatResponse, type PartyConfig } from "./06-shared.ts";

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
let busy: { label: string; since: number } | undefined;
let pending = false;
let controller: AbortController | undefined;

function view(): View {
  return {
    title: `${party.name} — http://localhost:${party.port} (acting remotely, via /chat)`,
    parties: [{ name: party.name, intent: "connected to 06-server.ts", lines, wire: [], paint, busy, pending }],
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

  lines.push(`${accent(1)("you")} ${text}`);
  pending = false;
  busy = { label: "thinking", since: Date.now() };
  tui.render();

  void chat(text).finally(() => {
    busy = undefined;
    tui.render();
  });
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

  if (result.end === "needs-input" && result.pending) {
    lines.push(`  ? ${result.pending.question}`);
    pending = true;
    return;
  }

  if (result.output) lines.push(result.output);
}
