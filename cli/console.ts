#!/usr/bin/env bun
/**
 * A console for driving several agents at once.
 *
 * The package is meant to be run by a centralized host, one agent per
 * party, negotiating with agents belonging to other people. That's hard to
 * exercise from the inside, so this stands the whole arrangement up in one
 * process: add parties, give them intents, watch them match, and talk to
 * any of them while the others work.
 *
 *   bun run console
 *   bun run console -- --with Alice --with Bob
 *
 * Not published — `files` is `dist` only.
 */
import { userInfo } from "node:os";
import { parseArgs } from "node:util";
import { Directory, type DirectoryEntry } from "./directory.ts";
import { bold, dim, formatStep, green, red, short, yellow } from "./format.ts";
import { Roster, type Party } from "./roster.ts";
import { Tui, type View } from "./tui.ts";
import type { RunResult, Settlement, Step } from "../src/index.ts";

const { values } = parseArgs({
  options: {
    with: { type: "string", multiple: true },
    model: { type: "string", short: "m" },
    registry: { type: "string" },
    seed: { type: "string" },
    "no-seed": { type: "boolean" },
    port: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
  allowPositionals: true,
});

if (values.help) {
  console.log(`
${bold("agent console")} — drive several agents at once

  ${dim("bun run console -- [options]")}

      --with <name>      add a party at startup ${dim("(repeatable)")}
  -m, --model <model>    OpenRouter model for every party
      --registry <file>  shared intent directory ${dim("(default: .agents.json)")}
      --seed <file>      made-up intents to match against ${dim("(--no-seed for none)")}
      --port <n>         first port to serve from ${dim("(default: ephemeral)")}

Once inside, ${bold("/help")} lists the commands.
`);
  process.exit(0);
}

if (!process.env.OPENROUTER_API_KEY) {
  console.error(red("OPENROUTER_API_KEY is not set. Put it in .env or the environment."));
  process.exit(1);
}

// --- state -----------------------------------------------------------

const directory = new Directory(values.registry ?? ".agents.json", await seeds());
let focus = 0;
let closing = false;

const roster = new Roster({
  directory,
  model: values.model,
  basePort: values.port ? Number(values.port) : 0,
  onChange: () => tui?.render(),
  onWire: () => tui?.render(),
  onDisputed: (party, line) => say(party, red(`⚠ ${line}`)),
  onRetry: (party, attempt, reason) =>
    say(party, dim(`⟳ retrying (${attempt}/3) — ${short(reason, 80)}`)),
});

const tui: Tui | undefined = process.stdout.isTTY
  ? new Tui({
      view,
      submit: (line) => void handle(line),
      focus: (delta) => {
        const parties = roster.list();
        if (parties.length) focus = (focus + delta + parties.length) % parties.length;
      },
      interrupt,
      eof: () => void shutdown(),
    })
  : undefined;

// --- startup ---------------------------------------------------------

const who = userInfo().username;
for (const name of values.with ?? [capitalize(who)]) {
  await roster.add({ name, port: values.port ? Number(values.port) + roster.list().length : 0 });
}

const first = roster.list()[0];
if (first) {
  say(first, dim("Say something, or /help for what this console can do."));
}

if (!tui) await piped();

// --- the view --------------------------------------------------------

function view(): View {
  const parties = roster.list();
  const current = parties[focus];

  return {
    title: ` agent console · ${parties.length} ${parties.length === 1 ? "party" : "parties"} · ${values.registry ?? ".agents.json"}`,
    parties: parties.map((party) => ({
      name: party.name,
      intent: party.intent,
      lines: party.lines,
      wire: party.wire,
      paint: party.paint,
      ...(party.busy ? { busy: { label: party.busy.label, since: party.busy.since } } : {}),
      pending: Boolean(party.pending),
    })),
    focus,
    prompt: current
      ? `${current.paint(current.name)}${current.pending ? yellow(" ?") : ""}${dim(" › ")}`
      : dim("no parties › "),
  };
}

function say(party: Party, text: string): void {
  for (const line of text.split("\n")) party.lines.push(line);
  tui?.render();
}

// --- input -----------------------------------------------------------

async function handle(line: string): Promise<void> {
  const input = line.trim();
  if (!input) return;

  const party = roster.list()[focus];
  if (input.startsWith("/")) return command(input, party);

  if (!party) return;
  say(party, `${dim("›")} ${input}`);
  await turn(party, input);
}

/**
 * One exchange with a party. Runs detached: several parties can be working
 * at once, which is the point of having them side by side.
 */
async function turn(party: Party, input: string): Promise<void> {
  if (party.busy) {
    say(party, dim("(still working — that will be queued after ^C)"));
    return;
  }

  const controller = new AbortController();
  party.busy = { label: party.pending ? "resuming" : "thinking", since: Date.now(), controller };
  tui?.render();

  let result: RunResult;
  try {
    result = await party.agent.run(input, {
      messages: party.messages,
      negotiations: party.negotiations,
      signal: controller.signal,
      onStep: (step) => report(party, step),
    });
  } catch (cause) {
    say(party, controller.signal.aborted ? dim("(interrupted)") : red(`✗ ${message(cause)}`));
    return;
  } finally {
    party.busy = undefined;
    tui?.render();
  }

  party.messages = result.messages;
  party.negotiations = result.negotiations;
  party.steps = result.steps;
  party.pending = result.pending;

  if (result.output) say(party, `\n${result.output}\n`);
  if (result.pending) {
    say(party, `${yellow("?")} ${bold(result.pending.question)}`);
    if (result.pending.options?.length) {
      say(party, dim(`  ${result.pending.options.join("  ·  ")}`));
    }
  }
  if (result.end === "max-steps") say(party, dim('(step cap — say "carry on" to continue)'));
}

/** Tool activity goes to the party's own column; the wire carries the
 * negotiation itself, which arrives through onTurn. */
function report(party: Party, step: Step): void {
  if (step.kind === "tool" && step.name.startsWith("negotiate_")) return;
  for (const rendered of formatStep(step)) say(party, rendered);
}

function interrupt(): void {
  const party = roster.list()[focus];
  if (party?.busy) {
    party.busy.controller.abort();
    return;
  }
  const working = roster.list().filter((other) => other.busy);
  if (working.length) {
    for (const other of working) other.busy?.controller.abort();
    return;
  }
  void shutdown();
}

// --- commands --------------------------------------------------------

async function command(line: string, party: Party | undefined): Promise<void> {
  const [name, ...rest] = line.slice(1).split(/\s+/);
  const argument = rest.join(" ").trim();
  const tell = (text: string) => (party ? say(party, text) : console.log(text));

  switch (name) {
    case "help":
      tell(help());
      return;

    case "exit":
    case "quit":
      return shutdown();

    // --- the parties ---------------------------------------------------

    case "add": {
      const [who, ...where] = argument.split(/\s+--intent\s+/);
      if (!who) return tell(red('usage: /add <name> [--intent "..."]'));
      try {
        const added = await roster.add({
          name: who.trim(),
          intent: where.join(" ").trim() || undefined,
          port: values.port ? Number(values.port) + roster.list().length : 0,
        });
        focus = roster.list().indexOf(added);
        say(added, dim(`${added.name} joined · ${added.url}`));
      } catch (cause) {
        tell(red(`✗ ${message(cause)}`));
      }
      return;
    }

    case "remove":
    case "rm": {
      const removed = await roster.remove(argument);
      if (!removed) return tell(red(`No party called "${argument}".`));
      focus = Math.min(focus, Math.max(0, roster.list().length - 1));
      tui?.render();
      return;
    }

    case "use": {
      const wanted = roster.get(argument);
      if (!wanted) return tell(red(`No party called "${argument}".`));
      focus = roster.list().indexOf(wanted);
      tui?.render();
      return;
    }

    case "parties":
    case "who": {
      const lines = roster
        .list()
        .map(
          (other, index) =>
            `  ${index === focus ? "▸" : " "} ${other.paint(other.name)} ${dim(other.url)}\n    ${dim(other.intent ?? "no intent")}`,
        );
      tell(lines.length ? lines.join("\n") : dim("no parties — /add <name>"));
      return;
    }

    // --- what they're here for ------------------------------------------

    case "intent": {
      if (!party) return tell(red("No party in focus."));
      const [verb, ...words] = argument.split(/\s+/);
      const text = words.join(" ").trim();

      if (verb === "add") {
        if (!text) return tell(red('usage: /intent add "<text>"'));
        // A published intent with nobody behind it — useful for giving the
        // matcher something to find without standing an agent up.
        await directory.register({
          id: `phantom:${text.slice(0, 24).toLowerCase().replace(/\W+/g, "-")}`,
          name: `${text.slice(0, 24)}…`,
          url: "",
          intent: text,
        });
        tell(dim(`published (no agent behind it): ${text}`));
        return;
      }

      if (verb === "rm" || verb === "remove") {
        if (!text) return tell(red("usage: /intent rm <id>"));
        await directory.deregister(text);
        tell(dim(`removed ${text}`));
        return;
      }

      if (!argument) return tell(party.intent ? `intent: ${party.intent}` : dim("no intent"));
      await roster.rescope(party, argument === "none" ? undefined : argument);
      say(party, dim(argument === "none" ? "unscoped" : `scoped to: ${argument}`));
      return;
    }

    case "intents": {
      const entries = await directory.all();
      tell(
        entries.length
          ? entries
              .map(
                (entry) =>
                  `  ${entry.live ? green("●") : dim("○")} ${entry.name} ${dim(entry.id)}\n    ${entry.intent || dim("—")}`,
              )
              .join("\n")
          : dim("nothing published"),
      );
      return;
    }

    // --- putting them together ------------------------------------------

    case "match": {
      if (!party) return tell(red("No party in focus."));
      if (!party.intent) return tell(dim("Give this party an intent first: /intent <text>"));

      const matches = await directory.matchesFor({ id: party.id, intent: party.intent });
      tell(
        matches.length
          ? matches
              .map(
                (match) =>
                  `  ${match.entry.live ? green("●") : dim("○")} ${bold(match.entry.name)} ${dim(String(match.score))}\n    ${match.entry.intent}\n    ${dim(match.why)}`,
              )
              .join("\n")
          : dim("nothing matched"),
      );
      return;
    }

    case "negotiate": {
      if (!party) return tell(red("No party in focus."));
      const [target, ...objective] = argument.split(/\s+/);
      if (!target) return tell(red("usage: /negotiate <party|url> [objective]"));

      const peer = roster.get(target);
      const url = peer?.url ?? (target.startsWith("http") ? target : undefined);
      if (!url) return tell(red(`No party or URL "${target}".`));

      void negotiate(party, url, objective.join(" "));
      return;
    }

    // --- looking inside ---------------------------------------------------

    case "card":
      if (!party) return tell(red("No party in focus."));
      tell(JSON.stringify(party.agent.card(), null, 2));
      return;

    case "instructions":
      if (!party) return tell(red("No party in focus."));
      tell(dim(party.agent.instructions()));
      return;

    case "steps":
      if (!party) return tell(red("No party in focus."));
      tell(party.steps.length ? JSON.stringify(party.steps, null, 2) : dim("nothing run yet"));
      return;

    case "negotiations": {
      if (!party) return tell(red("No party in focus."));
      tell(
        party.negotiations.length
          ? party.negotiations
              .map(
                (session) =>
                  `  ${session.id.slice(0, 8)} ${dim(session.direction)} ${session.task?.status.state ?? "?"}`,
              )
              .join("\n")
          : dim("none"),
      );
      return;
    }

    case "clear":
      if (!party) return;
      party.lines.length = 0;
      party.messages = [];
      party.negotiations = [];
      party.pending = undefined;
      tui?.render();
      return;

    case "wire":
      if (!party) return;
      party.wire.length = 0;
      tui?.render();
      return;

    default:
      tell(red(`unknown command "/${name}" — /help for the list`));
  }
}

/** Runs one exchange to completion, outside the agent loop. */
async function negotiate(party: Party, url: string, objective: string): Promise<void> {
  const controller = new AbortController();
  party.busy = { label: "negotiating", since: Date.now(), controller };
  tui?.render();

  try {
    const result = await party.agent.negotiate(url, {
      ...(objective ? { objective } : {}),
      signal: controller.signal,
    });
    party.wire.push(dim(`  — ${result.end}, task ${result.state}`));
  } catch (cause) {
    party.wire.push(red(`  ✗ ${message(cause)}`));
  } finally {
    party.busy = undefined;
    tui?.render();
  }
}

function help(): string {
  return [
    "",
    `  ${bold("/add")} <name> [--intent "..."]   stand up another party`,
    `  ${bold("/rm")} <name>                     and take one away`,
    `  ${bold("/use")} <name>${dim(" · tab")}                talk to a different one`,
    `  ${bold("/who")}                           the parties and their endpoints`,
    "",
    `  ${bold("/intent")} <text>                 scope this party ${dim("(none to unscope)")}`,
    `  ${bold("/intent add")} "<text>"           publish an intent with no agent behind it`,
    `  ${bold("/intent rm")} <id>                unpublish one`,
    `  ${bold("/intents")}                       everything published`,
    "",
    `  ${bold("/match")}                         who this party's intent pairs with`,
    `  ${bold("/negotiate")} <party> [objective] run an exchange to completion`,
    "",
    `  ${bold("/card")} ${bold("/instructions")} ${bold("/steps")} ${bold("/negotiations")}`,
    `  ${bold("/clear")} ${dim("conversation")} · ${bold("/wire")} ${dim("this party's traffic")} · ${bold("/exit")}`,
    "",
  ].join("\n");
}

// --- odds and ends ---------------------------------------------------

/** Without a terminal there is nowhere to put columns, so lines are read
 * from stdin and everything is printed as it happens. */
async function piped(): Promise<void> {
  for await (const line of console) {
    await handle(line);
    // Runs are detached for the TUI's sake; here we want them finished
    // before the next line is read.
    while (roster.list().some((party) => party.busy)) await Bun.sleep(50);
    for (const party of roster.list()) {
      if (party.lines.length) {
        console.log(party.lines.map((text) => `[${party.name}] ${text}`).join("\n"));
        party.lines.length = 0;
      }
    }
    for (const party of roster.list()) {
      if (!party.wire.length) continue;
      console.log(party.wire.map((text) => `  [${party.name}] ${text}`).join("\n"));
      party.wire.length = 0;
    }
  }
  await shutdown();
}

async function seeds(): Promise<DirectoryEntry[]> {
  if (values["no-seed"]) return [];
  const file = values.seed ?? new URL("./fixtures/intents.json", import.meta.url).pathname;
  try {
    return (await Bun.file(file).json()) as DirectoryEntry[];
  } catch {
    return [];
  }
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

async function shutdown(): Promise<never> {
  if (closing) process.exit(0);
  closing = true;
  await roster.shutdown();
  tui?.close();
  console.log(dim(`${green("·")} bye`));
  process.exit(0);
}
