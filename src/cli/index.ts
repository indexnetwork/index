#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { connect } from "./commands/connect.ts";
import { play } from "./commands/play.ts";
import { serve } from "./commands/serve.ts";
import { sim } from "./commands/sim.ts";
import { requireOption } from "./options.ts";
import { bold, dim, printError } from "./ui.ts";

const HELP = `${bold("negotiator")} — try out LLM-backed negotiation agents

${bold("USAGE")}
  negotiator <command> [options]

${bold("COMMANDS")}
  sim       Run both sides locally — two agents negotiate with each other
  play      Negotiate against an agent yourself, typing your own messages
  serve     Run one agent as an A2A server, answering incoming negotiations
  connect   Negotiate against another agent's A2A endpoint over HTTP

${bold("COMMON OPTIONS")}
  --model <id>        OpenRouter model (default: the library's default)
  --actions <list>    Comma-separated action vocabulary
                      (default: propose,counter,accept,reject)
  --terminal <list>   Which actions end the negotiation
                      (default: accept,reject,decline,withdraw)
  --terms <fields>    Ask for structured terms alongside each message, e.g.
                      "amount (number, USD), pickupDay (day of week)". Makes
                      acceptance name the offer it binds to, so the agreed
                      terms are verifiable instead of buried in prose.
                      (sim, serve, connect)

${bold("EXAMPLES")}
  ${dim("# watch two agents haggle")}
  negotiator sim --a Buyer --a-objective "Buy a bike under $400" \\
                 --b Seller --b-objective "Sell the bike above $450"

  ${dim("# negotiate against an agent yourself")}
  negotiator play --agent Seller --objective "Sell the bike above $450"

  ${dim("# two processes over HTTP, with bearer auth")}
  negotiator serve --name Seller --objective "Sell above $450" --port 3000 --token s3cret
  negotiator connect http://localhost:3000 --name Buyer \\
                     --objective "Buy under $400" --token s3cret

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
          turns: { type: "string" },
          terms: { type: "string" },
        },
      });
      await sim({
        a: values.a ?? "Buyer",
        aObjective: requireOption(values["a-objective"], "--a-objective"),
        b: values.b ?? "Seller",
        bObjective: requireOption(values["b-objective"], "--b-objective"),
        actions: values.actions,
        terminal: values.terminal,
        model: values.model,
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
        },
      });
      await play({
        agent: values.agent ?? "Agent",
        objective: requireOption(values.objective, "--objective"),
        me: values.me,
        actions: values.actions,
        terminal: values.terminal,
        model: values.model,
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
        token: values.token,
        turns: values.turns,
        expect: values.expect,
        terms: values.terms,
      });
      return;
    }

    default:
      throw new Error(`unknown command "${command}" — run \`negotiator help\``);
  }
}

main().catch((error) => {
  printError(error);
  process.exit(1);
});
