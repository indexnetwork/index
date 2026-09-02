#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { connect } from "./commands/connect.ts";
import { play } from "./commands/play.ts";
import { serve } from "./commands/serve.ts";
import { sim } from "./commands/sim.ts";
import { requireOption } from "./options.ts";
import { bold, dim, printError } from "./ui.ts";

const HELP = `${bold("index-a2a")} — try out personal agents negotiating on someone's behalf

${bold("USAGE")}
  index-a2a <command> [options]

${bold("COMMANDS")}
  sim       Run both sides locally — two agents negotiate with each other
  play      Negotiate against an agent yourself, typing your own messages
  serve     Run one agent as an A2A server, answering incoming negotiations
  connect   Negotiate against another agent's A2A endpoint over HTTP

${bold("COMMON OPTIONS")}
  --model <id>        OpenRouter model (default: the library's default)
  --fallback <list>   Models to route to when --model is rate-limited or
                      down, in order (default: openai/gpt-5.4-mini;
                      \`none\` disables fallback)
  --actions <list>    Comma-separated action vocabulary
                      (default: propose,refine,accept,decline)
  --terminal <list>   Which actions end the negotiation
                      (default: accept,reject,decline,withdraw)
  --terms <fields>    Ask for structured terms alongside each message, e.g.
                      "hoursPerWeek (number), startDate (YYYY-MM-DD)". Makes
                      acceptance name the offer it binds to, so the agreed
                      terms are verifiable instead of buried in prose.
                      (sim, serve, connect)

${bold("EXAMPLES")}
  ${dim("# watch two personal agents work out a collaboration")}
  index-a2a sim --a Mara  --a-objective "Get a designer to pair on your prototype, about 6 hours a week for 4 weeks; co-creator credit, no pay" \\
                --b Deniz --b-objective "Help on a side project, at most 4 hours a week, not before you're back next Tuesday"

  ${dim("# negotiate against one yourself")}
  index-a2a play --agent Deniz --objective "Help on a side project, at most 4 hours a week, not before next Tuesday" --me Mara

  ${dim("# two processes over HTTP, with bearer auth")}
  index-a2a serve --name Deniz --objective "Help on a side project, at most 4 hours a week" --port 3000 --token s3cret
  index-a2a connect http://localhost:3000 --name Mara \\
                    --objective "Get a designer to pair on your prototype, about 6 hours a week" --token s3cret --expect Deniz

  ${dim("# structured terms, so acceptance binds to a specific offer")}
  index-a2a sim --a Mara --a-objective "..." --b Deniz --b-objective "..." \\
                --terms "hoursPerWeek (number), weeks (number), startDate (YYYY-MM-DD)"

Needs OPENROUTER_API_KEY in the environment (a .env file works too).
`;

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(HELP);
    return;
  }

  switch (command) {
    case "sim": {
      const { values } = parseArgs({
        args: rest,
        options: {
          a: { type: "string" },
          "a-objective": { type: "string" },
          b: { type: "string" },
          "b-objective": { type: "string" },
          actions: { type: "string" },
          terminal: { type: "string" },
          model: { type: "string" },
          fallback: { type: "string" },
          turns: { type: "string" },
          terms: { type: "string" },
        },
      });
      await sim({
        a: values.a ?? "Agent A",
        aObjective: requireOption(values["a-objective"], "--a-objective"),
        b: values.b ?? "Agent B",
        bObjective: requireOption(values["b-objective"], "--b-objective"),
        actions: values.actions,
        terminal: values.terminal,
        model: values.model,
        fallback: values.fallback,
        turns: values.turns,
        terms: values.terms,
      });
      return;
    }

    case "play": {
      const { values } = parseArgs({
        args: rest,
        options: {
          agent: { type: "string" },
          objective: { type: "string" },
          me: { type: "string" },
          actions: { type: "string" },
          terminal: { type: "string" },
          model: { type: "string" },
          fallback: { type: "string" },
        },
      });
      await play({
        agent: values.agent ?? "Agent",
        objective: requireOption(values.objective, "--objective"),
        me: values.me,
        actions: values.actions,
        terminal: values.terminal,
        model: values.model,
        fallback: values.fallback,
      });
      return;
    }

    case "serve": {
      const { values } = parseArgs({
        args: rest,
        options: {
          name: { type: "string" },
          objective: { type: "string" },
          port: { type: "string" },
          actions: { type: "string" },
          terminal: { type: "string" },
          model: { type: "string" },
          fallback: { type: "string" },
          token: { type: "string" },
          terms: { type: "string" },
        },
      });
      await serve({
        name: values.name ?? "Agent",
        objective: requireOption(values.objective, "--objective"),
        port: values.port,
        actions: values.actions,
        terminal: values.terminal,
        model: values.model,
        fallback: values.fallback,
        token: values.token,
        terms: values.terms,
      });
      return;
    }

    case "connect": {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: {
          name: { type: "string" },
          objective: { type: "string" },
          actions: { type: "string" },
          model: { type: "string" },
          fallback: { type: "string" },
          token: { type: "string" },
          turns: { type: "string" },
          expect: { type: "string" },
          terms: { type: "string" },
        },
      });
      await connect({
        url: requireOption(positionals[0], "a target URL"),
        name: values.name ?? "Agent",
        objective: requireOption(values.objective, "--objective"),
        actions: values.actions,
        model: values.model,
        fallback: values.fallback,
        token: values.token,
        turns: values.turns,
        expect: values.expect,
        terms: values.terms,
      });
      return;
    }

    default:
      throw new Error(`unknown command "${command}" — run \`index-a2a help\``);
  }
}

main().catch((error) => {
  printError(error);
  process.exit(1);
});
