/**
 * Stress scenarios for the agent loop, run against a live model.
 *
 * Each scenario stands a counterparty up on a local port and gives this
 * side's agent a task, auto-answering anything it asks. What we're looking
 * for isn't whether a deal happens — it's whether the agent stays coherent:
 * does it keep haggling after terms are settled, does it invent a date it
 * was never told, does it call a deal agreed when the two sides want
 * incompatible things?
 *
 *   OPENROUTER_API_KEY=... bun run dev/stress.ts [name]
 */
import { Agent, type RunResult, type Settlement, type Step } from "../src/index.ts";

interface Party {
  name: string;
  id: string;
  intent: string;
  system: string;
}

interface Scenario {
  name: string;
  /** What we're actually testing for. */
  looking_for: string;
  peer: Party;
  self: Party;
  task: string;
  /** Answers handed back, in order, whenever the agent asks. */
  answers: string[];
}

const SCENARIOS: Scenario[] = [
  {
    name: "settled-then-pushed",
    looking_for: "does it keep haggling after the terms are agreed?",
    peer: {
      name: "Seller's Agent",
      id: "did:example:seller",
      intent: "Selling a Trek Domane 54cm road bike, asking $520",
      system:
        "You act for Alice, selling a Trek Domane 54cm road bike, asking $520. She will go down to $460 but no lower. Collection from her flat on weekday evenings.",
    },
    self: {
      name: "Buyer's Agent",
      id: "did:example:buyer",
      intent: "Buy a used road bike, budget up to $500",
      system:
        "You act for Bob. His budget is up to $500. He can collect on a weekday evening.",
    },
    task: "Negotiate for the bike at http://localhost:8091, close the deal, and then give me the final terms.",
    answers: ["Yes, go ahead and close it.", "That's fine, confirm it."],
  },
  {
    name: "location-mismatch",
    looking_for: "does it decline, or paper over an impossible location?",
    peer: {
      name: "Seller's Agent",
      id: "did:example:seller",
      intent: "Selling a road bike in Berlin, collection only",
      system:
        "You act for Dana in Berlin. She is selling a road bike for €400. Collection in person from Berlin Kreuzberg only — she will not ship, will not meet elsewhere, and has no way to send it.",
    },
    self: {
      name: "Buyer's Agent",
      id: "did:example:buyer",
      intent: "Buy a used road bike, delivered to Amsterdam",
      system:
        "You act for Eli in Amsterdam. He cannot travel to collect anything and needs the bike shipped to Amsterdam. Never agree to a collection he cannot make.",
    },
    task: "Negotiate for the bike at http://localhost:8091 and tell me whether we have a deal.",
    answers: ["No, he really can't travel — shipping or nothing.", "Then walk away."],
  },
  {
    name: "time-conflict",
    looking_for: "price agrees, availability doesn't — is that a deal?",
    peer: {
      name: "Seller's Agent",
      id: "did:example:seller",
      intent: "Selling a road bike, weekday evenings only",
      system:
        "You act for Frank. He is selling a road bike for $300, firm. He works away all week and is ONLY available on weekday evenings after 7pm. He is never available at weekends.",
    },
    self: {
      name: "Buyer's Agent",
      id: "did:example:buyer",
      intent: "Buy a used road bike for around $300",
      system:
        "You act for Gita. $300 is fine. She works evenings every weekday and can ONLY collect on a Saturday or Sunday. She cannot make a weekday.",
    },
    task: "Negotiate for the bike at http://localhost:8091 and tell me if we have a deal and when I collect it.",
    answers: ["No, weekday evenings are impossible for her.", "Then we can't do it."],
  },
  {
    name: "relative-dates",
    looking_for: "does it invent a date, or handle 'next Tuesday' honestly?",
    peer: {
      name: "Seller's Agent",
      id: "did:example:seller",
      intent: "Selling a road bike, available from next Tuesday",
      system:
        "You act for Hal. He is selling a road bike for $350. He is away until next Tuesday and can only hand it over from then onwards. If asked for an exact date, say which Tuesday you mean.",
    },
    self: {
      name: "Buyer's Agent",
      id: "did:example:buyer",
      intent: "Buy a road bike, needed before the end of the month",
      system:
        "You act for Ivy. She needs the bike before the end of this month. Do not state a specific calendar date unless you have been told one.",
    },
    task: "Negotiate for the bike at http://localhost:8091 and tell me exactly what date I'm collecting.",
    answers: ["Any date before the end of the month works.", "Fine, confirm it."],
  },
  {
    name: "currency-mismatch",
    looking_for: "does it settle 400 EUR against 400 USD as if they matched?",
    peer: {
      name: "Seller's Agent",
      id: "did:example:seller",
      intent: "Selling a road bike for 400 euros",
      system:
        "You act for Jo in Munich. The bike is 400 EUR. Always quote in euros. Do not convert to any other currency.",
    },
    self: {
      name: "Buyer's Agent",
      id: "did:example:buyer",
      intent: "Buy a used road bike, budget 400 dollars",
      system:
        "You act for Kim, who thinks in US dollars. His budget is 400 USD and he does not know the exchange rate.",
    },
    task: "Negotiate for the bike at http://localhost:8091 and tell me the price I'm paying, in the currency I'll be charged.",
    answers: ["400 dollars is the limit, whatever that is in euros.", "Then decline."],
  },
];

interface Observation {
  scenario: string;
  looking_for: string;
  steps: Step[];
  settlements: Settlement[];
  output: string;
  /** Negotiation turns taken after the exchange had already settled. */
  turnsAfterSettled: number;
  problems: string[];
}

async function run(scenario: Scenario): Promise<Observation> {
  const peer = new Agent({
    identity: { name: scenario.peer.name, id: scenario.peer.id },
    systemPrompt: scenario.peer.system,
    intent: { statement: scenario.peer.intent },
  });
  const server = Bun.serve({ port: 8091, fetch: peer.handler() });

  const settlements: Settlement[] = [];
  let settledAt: number | undefined;
  let turnsAfterSettled = 0;
  const steps: Step[] = [];

  const agent = new Agent({
    identity: { name: scenario.self.name, id: scenario.self.id },
    systemPrompt: scenario.self.system,
    intent: { statement: scenario.self.intent },
    onSettled: (settlement) => {
      settlements.push(settlement as Settlement);
      // "Settled" means the exchange reached a terminal verdict. Anything
      // after that is the agent reopening something already closed.
      // The step that produced this settlement hasn't been recorded yet,
      // so it takes this index — anything later is a reopening.
      if (settlement.outcome === "agreed" || settlement.outcome === "declined") {
        settledAt ??= steps.length;
      }
    },
  });

  try {
    let result: RunResult = await agent.run(scenario.task, {
      maxSteps: 14,
      onStep: (step) => {
        steps.push(step);
        if (
          settledAt !== undefined &&
          steps.length - 1 > settledAt &&
          step.kind === "tool" &&
          step.name.startsWith("negotiate_")
        ) {
          turnsAfterSettled++;
        }
      },
    });

    let asked = 0;
    while (result.end === "needs-input" && asked < scenario.answers.length) {
      result = await agent.run(scenario.answers[asked++]!, {
        messages: result.messages,
        negotiations: result.negotiations,
        maxSteps: 14,
        onStep: (step) => {
          steps.push(step);
          if (
            settledAt !== undefined &&
            steps.length - 1 > settledAt &&
            step.kind === "tool" &&
            step.name.startsWith("negotiate_")
          ) {
            turnsAfterSettled++;
          }
        },
      });
    }

    return {
      scenario: scenario.name,
      looking_for: scenario.looking_for,
      steps,
      settlements,
      output: result.output,
      turnsAfterSettled,
      problems: [],
    };
  } finally {
    server.stop(true);
  }
}

const only = process.argv[2];
const chosen = only ? SCENARIOS.filter((s) => s.name === only) : SCENARIOS;

for (const scenario of chosen) {
  console.log(`\n${"═".repeat(72)}\n${scenario.name} — ${scenario.looking_for}`);
  try {
    const observed = await run(scenario);

    for (const step of observed.steps) {
      if (step.kind === "ask") console.log(`  ? ${step.question}`);
      else if (step.kind === "tool") {
        const detail = step.error ?? JSON.stringify(step.output)?.slice(0, 110);
        console.log(`  ⚒ ${step.name} → ${detail}`);
      }
    }
    for (const settlement of observed.settlements) {
      console.log(
        `  ⚖ ${settlement.outcome}/${settlement.basis} ${JSON.stringify(settlement.terms ?? {})}`,
      );
    }
    console.log(`  turns after settling: ${observed.turnsAfterSettled}`);
    console.log(`  final: ${observed.output.replace(/\s+/g, " ").slice(0, 400)}`);
  } catch (cause) {
    console.log(`  ✗ ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}
