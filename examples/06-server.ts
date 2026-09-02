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
  negotiationTools,
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
import {
  PARTIES,
  type ChatRequest,
  type ChatResponse,
  type IntentRecord,
  type IntentsResponse,
  type ScopeRequest,
  type ScopeResponse,
  type WireEvent,
} from "./06-shared.ts";

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
  -- Every intent a party has ever published, kept around after the agent
  -- moves its scope elsewhere — a history to list and re-scope to, not
  -- just the one currently in force.
  CREATE TABLE IF NOT EXISTS intents (
    id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, statement TEXT NOT NULL, created_at INTEGER NOT NULL
  );
  -- At most one row per agent: which of its own intents (if any) it is
  -- currently scoped to. Separate from "intents" because clearing scope
  -- must not erase the intent itself.
  CREATE TABLE IF NOT EXISTS scope (agent_id TEXT PRIMARY KEY, intent_id TEXT NOT NULL);
`);

// The match layer this server injects as `find_matches`/`create_intent` —
// the same stand-in `cli/console.ts` uses, so an agent published here is
// findable from there too and vice versa.
const directory = new Directory(new URL("./.agents.json", import.meta.url).pathname);

interface IntentRow {
  id: string;
  agent_id: string;
  statement: string;
  created_at: number;
}

function toRecord(row: IntentRow): IntentRecord {
  return { id: row.id, statement: row.statement, createdAt: row.created_at };
}

function listIntents(agentId: string): IntentRecord[] {
  const rows = db
    .query<IntentRow, [string]>("SELECT * FROM intents WHERE agent_id = ? ORDER BY created_at ASC")
    .all(agentId);
  return rows.map(toRecord);
}

function recordIntent(agentId: string, statement: string): IntentRecord {
  const record: IntentRecord = { id: crypto.randomUUID(), statement, createdAt: Date.now() };
  db.run("INSERT INTO intents (id, agent_id, statement, created_at) VALUES (?, ?, ?, ?)", [
    record.id,
    agentId,
    record.statement,
    record.createdAt,
  ]);
  return record;
}

function currentScope(agentId: string): IntentRecord | undefined {
  const row = db
    .query<
      IntentRow,
      [string]
    >("SELECT intents.* FROM scope JOIN intents ON intents.id = scope.intent_id WHERE scope.agent_id = ?")
    .get(agentId);
  return row ? toRecord(row) : undefined;
}

function setScope(agentId: string, intentId: string): void {
  db.run("INSERT OR REPLACE INTO scope (agent_id, intent_id) VALUES (?, ?)", [agentId, intentId]);
}

function clearScope(agentId: string): void {
  db.run("DELETE FROM scope WHERE agent_id = ?", [agentId]);
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

/** `TaskStore` (@indexnetwork/a2a) is a class, not an interface —
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
      const statement = (looking_for || currentScope(party.id)?.statement || "").trim();
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
function createIntentTool(
  party: (typeof PARTIES)[number],
  rescope: (statement: string | undefined) => void,
): Tool<never> {
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

      const record = recordIntent(party.id, text);
      setScope(party.id, record.id);
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
  // Negotiation turns happen inside a single `/chat` call — an agent can
  // open and settle a negotiation in one run of tool calls — so they are
  // buffered here and drained into that call's response, the same events
  // `cli/console.ts` gets straight from `onTurn`/`onSettled` in-process.
  function buildAgent(intentStatement: string | undefined): Agent<never> {
    return new Agent({
      identity: { name: party.name, id: party.id, url: `http://localhost:${party.port}` },
      systemPrompt: party.systemPrompt,
      tools: [
        askUserTool() as Tool<never>,
        ...negotiationTools(),
        ...(intentStatement ? [findMatchesTool(party)] : [createIntentTool(party, rescope)]),
      ],
      ...(intentStatement ? { intent: { statement: intentStatement } } : {}),
      sessions: new SqliteNegotiationStore(db, party.id),
      taskStore: new SqliteTaskStore(db, party.id),
      onTurn: (turn) => {
        wireBuffer.push({
          kind: "turn",
          mine: turn.speaker === "self",
          message: turn.decision.message,
          id: turn.id,
          peer: turn.peer,
        });
      },
      onSettled: (settlement) => {
        const disputed = settlement.outcome === "conflict" || settlement.outcome === "unconfirmed";
        wireBuffer.push({
          kind: "settled",
          outcome: settlement.outcome,
          basis: settlement.basis,
          reason: settlement.reason,
          disputed,
          terms: settlement.terms,
          id: settlement.id,
          peer: settlement.peer,
        });
      },
    });
  }

  function rescope(statement: string | undefined): void {
    agent = buildAgent(statement);
  }

  let wireBuffer: WireEvent[] = [];

  const savedScope = currentScope(party.id);
  let agent = buildAgent(savedScope?.statement);

  if (savedScope) {
    await directory.register({
      id: party.id,
      name: party.name,
      url: `http://localhost:${party.port}`,
      intent: savedScope.statement,
    });
  }

  Bun.serve({
    port: party.port,
    routes: {
      "/chat": {
        POST: async (request: Request): Promise<Response> => {
          const { message } = (await request.json()) as ChatRequest;

          wireBuffer = [];
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
            wire: wireBuffer,
          };
          return Response.json(response);
        },
      },
      // Direct scope control for a host UI — bypasses the model entirely,
      // the same way `cli/console.ts`'s `/intent` command sets `party.intent`
      // directly rather than asking the agent to call `create_intent`.
      "/intents": {
        GET: (): Response => {
          const response: IntentsResponse = { intents: listIntents(party.id), scope: currentScope(party.id) };
          return Response.json(response);
        },
      },
      "/scope": {
        POST: async (request: Request): Promise<Response> => {
          const { intentId } = (await request.json()) as ScopeRequest;
          const record = listIntents(party.id).find((intent) => intent.id === intentId);
          if (!record) {
            return Response.json({ error: `${party.name} has no intent with that id.` }, { status: 404 });
          }

          setScope(party.id, record.id);
          await directory.register({
            id: party.id,
            name: party.name,
            url: `http://localhost:${party.port}`,
            intent: record.statement,
          });
          rescope(record.statement);

          const response: ScopeResponse = { scope: record };
          return Response.json(response);
        },
        DELETE: async (): Promise<Response> => {
          clearScope(party.id);
          await directory.register({
            id: party.id,
            name: party.name,
            url: `http://localhost:${party.port}`,
            intent: "",
          });
          rescope(undefined);

          const response: ScopeResponse = { scope: null };
          return Response.json(response);
        },
      },
    },
    fetch: (request) => agent.handler()(request),
  });

  console.log(`${party.name}: A2A + /chat on http://localhost:${party.port}`);
}

console.log("\nServer up. Run `bun run examples/06-tui.ts` in another terminal to act as one.");
