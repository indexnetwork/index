/**
 * Every store this package ships is in-memory: `MemoryNegotiationStore`,
 * `MemoryMessageStore`, and the A2A `TaskStore`. The agent itself holds no
 * state, so a host that wants to survive a restart — or run more than one
 * process — implements the three interfaces over something shared. This
 * wires all of them to one `bun:sqlite` file.
 *
 * The demo is one agent, "restarted" mid-conversation: a fresh `Agent` is
 * built over the same file with no `messages` passed, and picks the
 * conversation up from the `history` store — including a negotiation a
 * counterparty opened with the previous instance.
 *
 *   OPENROUTER_API_KEY=... bun run examples/06-persistence.ts
 */
import { Database } from "bun:sqlite";
import { Agent, askUserTool, negotiationTools, TaskStore, type A2ATask, type MessageStore, type ModelMessage, type NegotiationSession, type NegotiationStore, type Tool } from "../src/index.ts";
import { answerUntilDone, logStep, serve } from "./shared.ts";

const db = new Database(new URL("./.persistence.db", import.meta.url).pathname);
db.exec(`
  CREATE TABLE IF NOT EXISTS negotiations (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, data TEXT NOT NULL);
`);

/** `NegotiationStore` over sqlite. Same contract as `MemoryNegotiationStore`
 * (src/core/sessions.ts), backed by a table instead of a `Map`. `list()`
 * must end with whatever moved most recently, hence `updated_at`. */
class SqliteNegotiationStore implements NegotiationStore {
  constructor(private readonly db: Database) {}

  get(id: string): NegotiationSession | undefined {
    const row = this.db.query<{ data: string }, [string]>("SELECT data FROM negotiations WHERE id = ?").get(id);
    return row ? JSON.parse(row.data) : undefined;
  }

  save(session: NegotiationSession): void {
    this.db.run("INSERT OR REPLACE INTO negotiations (id, data, updated_at) VALUES (?, ?, ?)", [
      session.id,
      JSON.stringify(session),
      Date.now(),
    ]);
  }

  list(): NegotiationSession[] {
    return this.db
      .query<{ data: string }, []>("SELECT data FROM negotiations ORDER BY updated_at ASC")
      .all()
      .map((row) => JSON.parse(row.data));
  }

  // Optional in the interface, but without it a negotiation parked before
  // its first turn keeps its provisional `local:` row beside the real one.
  delete(id: string): void {
    this.db.run("DELETE FROM negotiations WHERE id = ?", [id]);
  }
}

/** `TaskStore` (@indexnetwork/a2a) is a class, not an interface —
 * a private field makes it nominal, so a sqlite-backed one has to extend it
 * rather than just match its shape. The inherited in-memory `Map` is simply
 * never touched. */
class SqliteTaskStore extends TaskStore {
  constructor(private readonly db: Database) {
    super();
  }

  override get(taskId: string): A2ATask | undefined {
    const row = this.db.query<{ data: string }, [string]>("SELECT data FROM tasks WHERE id = ?").get(taskId);
    return row ? JSON.parse(row.data) : undefined;
  }

  override save(task: A2ATask): void {
    this.db.run("INSERT OR REPLACE INTO tasks (id, data) VALUES (?, ?)", [task.id, JSON.stringify(task)]);
  }
}

/** `MessageStore` over sqlite: the whole transcript as one row. With this
 * set, the host no longer threads `messages` through `run()` — every run
 * reads the store when `messages` is omitted and saves back to it. */
class SqliteMessageStore implements MessageStore {
  constructor(private readonly db: Database) {}

  list(): ModelMessage[] {
    const row = this.db.query<{ data: string }, [string]>("SELECT data FROM messages WHERE id = ?").get("agent");
    return row ? JSON.parse(row.data) : [];
  }

  save(messages: ModelMessage[]): void {
    this.db.run("INSERT OR REPLACE INTO messages (id, data) VALUES (?, ?)", ["agent", JSON.stringify(messages)]);
  }
}

/** A fresh `Agent` over the same file. Nothing carries over in memory. */
function build(): Agent {
  return new Agent({
    identity: { name: "Tomas's Agent", id: "did:example:tomas" },
    systemPrompt:
      "You act for Tomas. Before committing him to anything with a number attached — a day rate, a budget, a start date — you must ask him first, with the ask_user tool rather than in your reply. Never assume a figure he has not given you.",
    tools: [askUserTool() as Tool<never>, ...negotiationTools()],
    sessions: new SqliteNegotiationStore(db),
    taskStore: new SqliteTaskStore(db),
    history: new SqliteMessageStore(db),
  });
}

let agent = build();
const { url, stop } = serve(agent.handler());

// A counterparty dials in first, so the tasks and negotiations tables hold
// something the *next* instance never saw happen.
const advisor = new Agent({
  identity: { name: "Idris's Agent", id: "did:example:idris" },
  systemPrompt: "You act for Idris, a fractional CFO at 1,200 a day, two days a month. Propose that and see what they say.",
});
await advisor.negotiate(url, { maxTurns: 2 });

let result = await agent.run(
  "Idris's agent has been in touch about fractional CFO work. What did they propose, and should we take it?",
  { onStep: logStep },
);

// --- restart --------------------------------------------------------------
// The first instance is gone. The answer goes to a new one over the same
// file, with no `messages` passed: the history store supplies them, and the
// negotiation Idris opened is still on the record.
agent = build();
result = await answerUntilDone(agent, result, ["Up to 1,000 a day is fine, yes."], { onStep: logStep });

console.log(`\n— ${result.end} after ${result.steps.length} steps`);
console.log(`\n${agent.instructions().split("\n\n").find((part) => part.startsWith("Negotiations you are party to")) ?? "(no negotiations on record)"}`);

const count = (table: string) => db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n ?? 0;
console.log(`\nrows: negotiations=${count("negotiations")} tasks=${count("tasks")} messages=${count("messages")}`);

stop();
