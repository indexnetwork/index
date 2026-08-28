/**
 * The parties this console is driving.
 *
 * A test console is mostly about the *set* of agents: adding one, giving
 * it an intent, watching it find another. So the roster owns everything
 * per-party — the agent, its transcript, its port, its colour — and the
 * screen and the commands both read from here.
 */
import {
  Agent,
  defaultTools,
  type ModelMessage,
  type NegotiationSession,
  type PendingQuestion,
  type Step,
  type Tool,
} from "../src/index.ts";
import { accent, dim, red } from "./format.ts";
import type { Directory } from "./directory.ts";

export interface PartyOptions {
  name: string;
  id?: string;
  intent?: string;
  systemPrompt?: string;
  model?: string;
  port?: number;
}

/** One party, its agent, and everything the console keeps about it. */
export interface Party {
  name: string;
  id: string;
  intent?: string;
  systemPrompt: string;
  agent: Agent;
  /** Colour used for this party everywhere it appears. */
  paint: (text: string) => string;
  url: string;
  stop: () => void;
  /** This party's own conversation, as rendered lines. */
  lines: string[];
  /** A2A traffic as *this* party saw it — both sides of every exchange it
   * took part in, and the verdict it reached. Per-party, because that is
   * what a host actually sees, and because two parties disagreeing about
   * one negotiation is only visible if each keeps its own account. */
  wire: string[];
  /** What travels between runs. */
  messages: ModelMessage[];
  negotiations: NegotiationSession[];
  pending?: PendingQuestion;
  steps: Step[];
  /** Set while a run is in flight, so several parties can think at once. */
  busy?: { label: string; since: number; controller: AbortController };
}

export interface RosterOptions {
  directory: Directory;
  model?: string;
  /** First port to try; each party takes the next free one. */
  basePort: number;
  /** Notified whenever anything visible changes. */
  onChange: () => void;
  /** Anything that lands on a party's wire. */
  onWire: (party: Party) => void;
  /** A settlement that went against the party — worth saying in its
   * conversation as well as on its wire. */
  onDisputed: (party: Party, line: string) => void;
  onRetry: (party: Party, attempt: number, reason: string) => void;
}

const DEFAULT_PROMPT = (name: string) =>
  [
    `You are a personal agent acting for ${name}. You talk with them directly, and you can negotiate with other agents on their behalf.`,
    "Ask them about anything you have not been told — a budget, a date, a preference, approval to commit — rather than inventing it. One question at a time.",
    "When they describe something they want or are offering and it is not already your intent, offer to publish it as one so other agents can find them — check the wording with them first, then use create_intent.",
    "Keep your replies short and plain.",
  ].join(" ");

export class Roster {
  private readonly parties: Party[] = [];

  constructor(private readonly options: RosterOptions) {}

  list(): Party[] {
    return [...this.parties];
  }

  get(name: string): Party | undefined {
    const wanted = name.toLowerCase();
    return (
      this.parties.find((party) => party.name.toLowerCase() === wanted) ??
      // Convenient for typing: "al" finds "Alice" while it's unambiguous.
      this.parties.find((party) => party.name.toLowerCase().startsWith(wanted))
    );
  }

  async add(options: PartyOptions): Promise<Party> {
    if (this.get(options.name)) throw new Error(`There is already an agent called "${options.name}".`);

    const index = this.parties.length;
    const paint = accent(index);
    const id = options.id ?? `local:${options.name.toLowerCase().replace(/\s+/g, "-")}`;
    const systemPrompt = options.systemPrompt ?? DEFAULT_PROMPT(options.name);

    const party: Party = {
      name: options.name,
      id,
      intent: options.intent,
      systemPrompt,
      paint,
      url: "",
      stop: () => {},
      lines: [],
      wire: [],
      messages: [],
      negotiations: [],
      steps: [],
      agent: undefined as unknown as Agent,
    };

    const agent = new Agent({
      identity: { name: options.name, id, description: `A test party in the agent console.` },
      systemPrompt,
      // Discovery, as a host injects it. Without this an agent has no way
      // to find anyone and can only ask its party for a URL.
      tools: [...defaultTools(), this.matchTool(party), this.intentTool(party)],
      ...(options.intent ? { intent: { statement: options.intent } } : {}),
      model: this.options.model,
      onTurn: (turn) => {
        // Both halves, from this party's side: what it said and what came
        // back. The counterparty keeps its own account of the same
        // exchange, and the two are worth comparing.
        const mine = turn.speaker === "self";
        party.wire.push(
          `${dim(mine ? "→" : "←")} ${mine ? party.paint("me") : dim("them")}  ${turn.decision.message}`,
        );
        this.options.onWire(party);
      },
      onSettled: (settlement) => {
        const disputed = settlement.outcome === "conflict" || settlement.outcome === "unconfirmed";
        const terms = settlement.terms ? ` ${JSON.stringify(settlement.terms)}` : "";
        const line = `${settlement.outcome} (${settlement.basis})${terms} — ${settlement.reason}`;
        party.wire.push(disputed ? red(`  ⚠ ${line}`) : dim(`  ⚖ ${line}`));
        this.options.onWire(party);
        if (disputed) this.options.onDisputed(party, line);
      },
      onRetry: (attempt, reason) => this.options.onRetry(party, attempt, reason),
    });

    party.agent = agent;

    const server = Bun.serve({ port: options.port ?? 0, fetch: agent.handler() });
    party.url = server.url.toString();
    party.stop = () => server.stop(true);

    this.parties.push(party);
    await this.publish(party);
    this.options.onChange();
    return party;
  }

  async remove(name: string): Promise<Party | undefined> {
    const party = this.get(name);
    if (!party) return undefined;

    party.busy?.controller.abort();
    party.stop();
    await this.options.directory.deregister(party.id).catch(() => {});
    this.parties.splice(this.parties.indexOf(party), 1);
    this.options.onChange();
    return party;
  }

  /** Rescopes a party. The identity and the record are untouched — the
   * intent narrows what it's working on, not who it is. */
  async rescope(party: Party, intent?: string): Promise<void> {
    party.intent = intent;
    party.agent = intent ? party.agent.for(intent) : party.agent;
    await this.publish(party);
    this.options.onChange();
  }

  /**
   * Publishing what the party is after.
   *
   * The agent doesn't own intents — a real host has its own notion of what
   * one is and where it lives. This publishes to the same directory
   * `find_matches` reads, and scopes the agent to it, so saying what you
   * want and being findable for it are one step.
   */
  private intentTool(party: Party): Tool<never> {
    const tool: Tool<{ statement: string }> = {
      name: "create_intent",
      description:
        "Publish what the party you act for is looking for or offering, so other agents can match with them, and scope yourself to it. Use their own words, in one sentence, saying which side they are on — 'selling a road bike for £400', 'looking to hire a photographer in Berlin'. Confirm the exact wording with them using ask_user before calling this: it is published under their name and it is what other parties will match against. Do not invent an intent they have not expressed.",
      parameters: {
        type: "object",
        properties: {
          statement: {
            type: "string",
            description: "The intent, in one sentence, as the party would put it.",
          },
        },
        required: ["statement"],
      },
      run: async ({ statement }) => {
        const text = statement.trim();
        if (!text) return "An intent needs a statement. Ask them what they are looking for.";

        const previous = party.intent;
        await this.rescope(party, text);

        return {
          published: text,
          replaced: previous ?? null,
          note: "Other agents can now match against this. Use find_matches to see who.",
        };
      },
    };
    return tool as Tool<never>;
  }

  /**
   * The party's view of who else is out there.
   *
   * Stands in for whatever the real host injects — an Index Network call,
   * a directory lookup. The agent only ever sees "here is who you could
   * talk to, and where", which is the shape that matters.
   */
  private matchTool(party: Party): Tool<never> {
    const tool: Tool<{ looking_for?: string }> = {
      name: "find_matches",
      description:
        "Find agents whose parties want the other end of what yours wants, matched on intent. Each match carries the A2A url to open a negotiation with. Pass `looking_for` to match on something other than your standing intent.",
      parameters: {
        type: "object",
        properties: {
          looking_for: { type: "string", description: "What to match on, if not your intent." },
        },
      },
      run: async ({ looking_for }) => {
        const statement = (looking_for || party.intent || "").trim();
        if (!statement) return "No intent to match on — ask your party what they are looking for.";

        const matches = await this.options.directory.matchesFor({ id: party.id, intent: statement });
        if (!matches.length) return `Nothing matched "${statement}".`;

        return matches.map((match) => ({
          name: match.entry.name,
          url: match.entry.url,
          intent: match.entry.intent,
          score: match.score,
          why: match.why,
          // A published intent isn't a running agent. Seeded ones have
          // nobody behind them, and saying so keeps the model from
          // negotiating with a dead port.
          status: match.entry.live ? "live" : "offline",
        }));
      },
    };
    return tool as Tool<never>;
  }

  /** Publishes a party's intent, so the others can match on it. */
  async publish(party: Party): Promise<void> {
    await this.options.directory.register({
      id: party.id,
      name: party.name,
      url: party.url,
      intent: party.intent ?? "",
    });
  }

  async shutdown(): Promise<void> {
    for (const party of this.parties) {
      party.busy?.controller.abort();
      party.stop();
      await this.options.directory.deregister(party.id).catch(() => {});
    }
  }
}
