/**
 * The host process: keeps every agent alive, each with its own sqlite-backed
 * stores and its own port. No UI here — `06-tui.ts` is a separate process
 * (or several, run at once) that drives an agent over HTTP.
 *
 * Every store this package ships (`MemoryNegotiationStore`, the negotiator's
 * `TaskStore`) is in-memory, and `messages` has no store at all — the host
 * is expected to persist and pass them back. This wires all three to a
 * single `bun:sqlite` file, one per agent.
 *
 * Each agent's port serves two things: its A2A surface (AgentCard,
 * `message/send` — for other agents to negotiate with it) and a `/chat`
 * control endpoint (for a host UI to talk to it directly, which is not
 * negotiation and has no A2A equivalent).
 *
 *   OPENROUTER_API_KEY=... bun run examples/06-server.ts
 */
import { Database } from "bun:sqlite";
import {
  Agent,
  askUserTool,
  TaskStore,
  type A2ATask,
  type ModelMessage,
  type NegotiationSession,
  type NegotiationStore,
  type RunResult,
  type Tool,
} from "../src/index.ts";
import { Directory } from "../cli/directory.ts";
import { logStep } from "./shared.ts";
import { PARTIES, type ChatRequest, type ChatResponse } from "./06-shared.ts";

// --- storage: one sqlite file backs every agent, scoped by agent id -----

const db = new Database(new URL("./.sqlite-server.db", import.meta.url).pathname);
db.exec(`
  CREATE TABLE IF NOT EXISTS negotiations (
    agent_id TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updated_at INTEGER NOT NULL,
    PRIMARY KEY (agent_id, id)
  );
  CREATE TABLE IF NOT EXISTS tasks (
    agent_id TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL,
    PRIMARY KEY (agent_id, id)
  );
  CREATE TABLE IF NOT EXISTS messages (agent_id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS intents (agent_id TEXT PRIMARY KEY, statement TEXT NOT NULL);
`);

// The match layer this server injects as `find_matches`/`create_intent` —
// the same stand-in `cli/console.ts` uses, so an agent published here is
// findable from there too and vice versa.
const directory = new Directory(new URL("./.agents.json", import.meta.url).pathname);

function loadIntent(agentId: string): string | undefined {
  const row = db
    .query<{ statement: string }, [string]>("SELECT statement FROM intents WHERE agent_id = ?")
    .get(agentId);
  return row?.statement;
}

function saveIntent(agentId: string, statement: string): void {
  db.run("INSERT OR REPLACE INTO intents (agent_id, statement) VALUES (?, ?)", [agentId, statement]);
}

/** `NegotiationStore` over sqlite, scoped to one agent. Same contract as
 * `MemoryNegotiationStore` (src/core/sessions.ts), backed by a table
 * instead of a `Map`. */
class SqliteNegotiationStore implements NegotiationStore {
  constructor(
    private readonly db: Database,
    private readonly agentId: string,
  ) {}

  get(id: string): NegotiationSession | undefined {
    const row = this.db
      .query<{ data: string }, [string, string]>(
        "SELECT data FROM negotiations WHERE agent_id = ? AND id = ?",
      )
      .get(this.agentId, id);
    return row ? JSON.parse(row.data) : undefined;
  }

  save(session: NegotiationSession): void {
    this.db.run(
      "INSERT OR REPLACE INTO negotiations (agent_id, id, data, updated_at) VALUES (?, ?, ?, ?)",
      [this.agentId, session.id, JSON.stringify(session), Date.now()],
    );
  }

  list(): NegotiationSession[] {
    const rows = this.db
      .query<{ data: string }, [string]>(
        "SELECT data FROM negotiations WHERE agent_id = ? ORDER BY updated_at ASC",
      )
      .all(this.agentId);
    return rows.map((row) => JSON.parse(row.data));
  }

  delete(id: string): void {
    this.db.run("DELETE FROM negotiations WHERE agent_id = ? AND id = ?", [this.agentId, id]);
  }
}

/** `TaskStore` (@indexnetwork/negotiator/a2a) is a class, not an interface —
 * a private field makes it nominal, so a sqlite-backed one has to extend it
 * rather than just match its shape. The inherited in-memory `Map` is simply
 * never touched. */
class SqliteTaskStore extends TaskStore {
  constructor(
    private readonly db: Database,
    private readonly agentId: string,
  ) {
    super();
  }

  override get(taskId: string): A2ATask | undefined {
    const row = this.db
      .query<{ data: string }, [string, string]>("SELECT data FROM tasks WHERE agent_id = ? AND id = ?")
      .get(this.agentId, taskId);
    return row ? JSON.parse(row.data) : undefined;
  }

  override save(task: A2ATask): void {
    this.db.run("INSERT OR REPLACE INTO tasks (agent_id, id, data) VALUES (?, ?, ?)", [
      this.agentId,
      task.id,
      JSON.stringify(task),
    ]);
  }
}

// No store interface exists for chat history — the host just persists
// whatever `RunResult.messages` gives it and passes it back as
// `RunOptions.messages`. Whole-array read/write is the natural fit.
function loadMessages(agentId: string): ModelMessage[] {
  const row = db
    .query<{ data: string }, [string]>("SELECT data FROM messages WHERE agent_id = ?")
    .get(agentId);
  return row ? JSON.parse(row.data) : [];
}

function saveMessages(agentId: string, messages: ModelMessage[]): void {
  db.run("INSERT OR REPLACE INTO messages (agent_id, data) VALUES (?, ?)", [
    agentId,
    JSON.stringify(messages),
  ]);
}

// --- the injected tools: stand in for host-owned Index Network ops ------

/** Everyone else's view of who this party could talk to. Reads the same
 * directory `create_intent` publishes to, so a match is only ever another
 * agent actually running (here, or in `cli/console.ts`) rather than a
 * fixture. */
function findMatchesTool(party: (typeof PARTIES)[number]): Tool<never> {
  const tool: Tool<{ looking_for?: string }> = {
    name: "find_matches",
    description:
      "Find agents whose parties want the other end of what yours wants, matched on intent. Each match carries the A2A url to open a negotiation with. Pass `looking_for` to match on something other than your standing intent.",
    parameters: {
      type: "object",
      properties: { looking_for: { type: "string", description: "What to match on, if not your intent." } },
    },
    run: async ({ looking_for }) => {
      const statement = (looking_for || loadIntent(party.id) || "").trim();
      if (!statement) return "No intent to match on — ask your party what they are looking for.";

      const matches = await directory.matchesFor({ id: party.id, intent: statement });
      if (!matches.length) return `Nothing matched "${statement}".`;

      return matches.map((match) => ({
        name: match.entry.name,
        url: match.entry.url,
        intent: match.entry.intent,
        score: match.score,
        why: match.why,
        status: match.entry.live ? "live" : "offline",
      }));
    },
  };
  return tool as Tool<never>;
}

/** Publishing what the party is after. Scopes the running agent to the
 * intent and republishes to the directory, mirroring `Roster.intentTool`
 * (`cli/roster.ts`) — this server just persists the intent to sqlite
 * instead of keeping it on an in-memory `Party`. Only offered while there
 * is no intent yet — see `buildAgent` below — so there is no existing
 * intent to guard against here; an existing one is the party's to change,
 * not this tool's to overwrite. */
function createIntentTool(party: (typeof PARTIES)[number], rescope: (statement: string) => void): Tool<never> {
  const tool: Tool<{ statement: string }> = {
    name: "create_intent",
    description:
      "Publish what the party you act for is looking for or offering, so other agents can match with them, and scope yourself to it. Use their own words, in one sentence, saying which side they are on — 'selling a road bike for £400', 'looking to hire a photographer in Berlin'. Confirm the exact wording with them using ask_user before calling this: it is published under their name and it is what other parties will match against. Do not invent an intent they have not expressed.",
    parameters: {
      type: "object",
      properties: {
        statement: { type: "string", description: "The intent, in one sentence, as the party would put it." },
      },
      required: ["statement"],
    },
    run: async ({ statement }) => {
      const text = statement.trim();
      if (!text) return "An intent needs a statement. Ask them what they are looking for.";

      saveIntent(party.id, text);
      await directory.register({
        id: party.id,
        name: party.name,
        url: `http://localhost:${party.port}`,
        intent: text,
      });
      rescope(text);

      return {
        published: text,
        note: "Other agents can now match against this. Use find_matches to see who.",
      };
    },
  };
  return tool as Tool<never>;
}

// --- agents kept alive at once, each on its own port ---------------------

for (const party of PARTIES) {
  // `find_matches` only means something once there is an intent to match
  // on — the actively scoped one against everyone else's — so it is
  // offered only with one in place, and `create_intent` only without one:
  // an existing intent is the party's to change, never this tool's to
  // overwrite. Tools are fixed at construction (`Agent.for` reuses
  // `options.tools` unchanged), so the whole agent is rebuilt, not just
  // rescoped, whenever the intent is set.
  function buildAgent(intentStatement: string | undefined): Agent<never> {
    return new Agent({
      identity: { name: party.name, id: party.id, url: `http://localhost:${party.port}` },
      systemPrompt: party.systemPrompt,
      tools: [
        askUserTool() as Tool<never>,
        ...(intentStatement ? [findMatchesTool(party)] : [createIntentTool(party, rescope)]),
      ],
      ...(intentStatement ? { intent: { statement: intentStatement } } : {}),
      sessions: new SqliteNegotiationStore(db, party.id),
      taskStore: new SqliteTaskStore(db, party.id),
    });
  }

  function rescope(statement: string): void {
    agent = buildAgent(statement);
  }

  const savedIntent = loadIntent(party.id);
  let agent = buildAgent(savedIntent);

  if (savedIntent) {
    await directory.register({
      id: party.id,
      name: party.name,
      url: `http://localhost:${party.port}`,
      intent: savedIntent,
    });
  }

  Bun.serve({
    port: party.port,
    routes: {
      "/chat": {
        POST: async (request: Request): Promise<Response> => {
          const { message } = (await request.json()) as ChatRequest;

          const result: RunResult = await agent.run(message, {
            messages: loadMessages(party.id),
            negotiations: new SqliteNegotiationStore(db, party.id).list(),
            onStep: (step) => logStep(step),
          });

          saveMessages(party.id, result.messages);
          for (const session of result.negotiations) {
            new SqliteNegotiationStore(db, party.id).save(session);
          }

          const response: ChatResponse = {
            output: result.output,
            end: result.end,
            pending: result.pending,
            steps: result.steps,
          };
          return Response.json(response);
        },
      },
    },
    fetch: (request) => agent.handler()(request),
  });

  console.log(`${party.name}: A2A + /chat on http://localhost:${party.port}`);
}

console.log("\nServer up. Run `bun run examples/06-tui.ts` in another terminal to act as one.");
