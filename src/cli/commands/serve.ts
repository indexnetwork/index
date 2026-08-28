import { createA2AHandler } from "../../a2a/index.ts";
import { bearerTokenAuth } from "../../a2a/server/auth.ts";
import type { AgentCard } from "../../a2a/wire/types.ts";
import { buildNegotiator, parseActions, parseTerminal } from "../options.ts";
import { dim, green, printTurn } from "../ui.ts";

export interface ServeOptions {
  name: string;
  objective: string;
  port?: string;
  actions?: string;
  terminal?: string;
  model?: string;
  token?: string;
  terms?: string;
}

/**
 * Runs one agent as an A2A server: serves its AgentCard and answers
 * incoming `message/send` calls. Pair with `negotiator connect` in another
 * terminal to watch two independent processes negotiate over HTTP.
 */
export async function serve(options: ServeOptions): Promise<void> {
  const allowedActions = parseActions(options.actions);
  const isTerminal = parseTerminal(options.terminal);
  const port = Number(options.port ?? "3000");
  if (!Number.isInteger(port) || port < 0) {
    throw new Error("--port must be a non-negative integer");
  }

  const agentCard: AgentCard = {
    name: options.name,
    description: options.objective,
    url: `http://localhost:${port}`,
    version: "1.0.0",
    capabilities: {},
    skills: [{ id: "negotiate", name: "Negotiate" }],
    ...(options.token
      ? {
          securitySchemes: { bearerAuth: { type: "http" as const, scheme: "bearer" } },
          security: [{ bearerAuth: [] }],
        }
      : {}),
  };

  const handler = createA2AHandler({
    negotiator: buildNegotiator(options.model),
    party: { name: options.name, objective: options.objective },
    allowedActions,
    agentCard,
    isTerminal,
    terminalState: (action) => (action === "accept" ? "completed" : "rejected"),
    ...(options.token ? { authenticate: bearerTokenAuth(options.token) } : {}),
    // The handler is otherwise silent; wrapping the default decide() call
    // is the natural place to echo each turn as it happens.
    strategy: async (negotiator, state, actions) => {
      const incoming = [...state.history].reverse().find((entry) => entry.role === "incoming");
      if (incoming) printTurn("them", 0, "incoming", incoming.content);

      const decision = await negotiator.decide(state, {
        allowedActions: actions,
        ...(options.terms ? { terms: options.terms } : {}),
      });
      printTurn(options.name, 1, decision.action, decision.message);
      if (decision.terms) console.log(dim(`    terms ${JSON.stringify(decision.terms)}`));
      if (isTerminal(decision.action)) console.log(dim("  (negotiation ended)\n"));
      return decision;
    },
  });

  const server = Bun.serve({ port, fetch: handler });
  const url = server.url.toString().replace(/\/$/, "");

  console.log(`${green("listening")} ${url}`);
  console.log(dim(`agent card: ${url}/.well-known/agent-card.json`));
  console.log(dim(`actions: ${allowedActions.join(", ")}`));
  if (options.token) console.log(dim("auth: bearer token required"));
  console.log(dim("\nwaiting for incoming negotiations — ctrl-c to stop\n"));

  // Keep the process alive until interrupted; Bun.serve doesn't block.
  await new Promise<void>((resolve) => {
    process.on("SIGINT", () => {
      server.stop();
      resolve();
    });
  });
}
