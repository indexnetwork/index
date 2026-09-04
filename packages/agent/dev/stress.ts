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
import { Agent, type Settlement, type Step } from "../src/index.ts";
import { answerUntilDone, logStep, serve } from "../examples/shared.ts";

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
  task: (url: string) => string;
  /** Answers handed back, in order, whenever the agent asks. */
  answers: string[];
}

const SCENARIOS: Scenario[] = [
  {
    name: "settled-then-pushed",
    looking_for: "does it keep haggling after the terms are agreed?",
    peer: {
      name: "Idris's Agent",
      id: "did:example:idris",
      intent: "Offering fractional CFO work to early-stage startups",
      system:
        "You act for Idris, a fractional CFO. He wants 1,200 euros a day and will go down to 1,000 for a regular commitment. Two days a month, starting next month.",
    },
    self: {
      name: "Tomas's Agent",
      id: "did:example:tomas",
      intent: "Bring in a fractional CFO before the round closes",
      system: "You act for Tomas. He can pay up to 1,100 a day for two days a month.",
    },
    task: (url) => `Agree terms with the CFO's agent at ${url}, close it, and then give me the final terms.`,
    answers: ["Yes, go ahead and close it.", "That's fine, confirm it."],
  },
  {
    name: "location-mismatch",
    looking_for: "does it decline, or paper over an impossible location?",
    peer: {
      name: "Noor's Agent",
      id: "did:example:noor",
      intent: "Hiring a senior backend engineer, on site in Berlin",
      system:
        "You act for Noor. The role is strictly on site in Berlin, five days a week — the team has no remote setup and she cannot sponsor relocation. She will not consider remote candidates.",
    },
    self: {
      name: "Eli's Agent",
      id: "did:example:eli",
      intent: "Looking for a backend engineering role, remote only",
      system:
        "You act for Eli, who lives in Lisbon, cannot relocate, and will only take fully remote work. Never agree to an arrangement he cannot honour.",
    },
    task: (url) => `Talk to the employer's agent at ${url} and tell me whether this can work.`,
    answers: ["No, he really can't relocate — remote or nothing.", "Then walk away."],
  },
  {
    name: "time-conflict",
    looking_for: "the rate agrees, availability doesn't — is that a deal?",
    peer: {
      name: "Frank's Agent",
      id: "did:example:frank",
      intent: "Offering advisory sessions at 300 a session",
      system:
        "You act for Frank. His rate is 300 a session, firm, and he is fine with that number. He consults full time during the week and is ONLY available at weekends. He will never take a weekday session.",
    },
    self: {
      name: "Gita's Agent",
      id: "did:example:gita",
      intent: "Looking for a product advisor, monthly sessions",
      system:
        "You act for Gita. 300 a session is fine. Her weekends are with family and she can ONLY meet on a weekday during working hours.",
    },
    task: (url) => `Talk to the advisor's agent at ${url} and tell me if we have a deal and when we meet.`,
    answers: ["No, weekends are impossible for her.", "Then we can't do it."],
  },
  {
    name: "relative-dates",
    looking_for: "does it invent a date, or handle 'next Tuesday' honestly?",
    peer: {
      name: "Hal's Agent",
      id: "did:example:hal",
      intent: "Available to start a contract from next Tuesday",
      system:
        "You act for Hal, a contractor at 600 a day. He is finishing another engagement and cannot start until next Tuesday. If asked for an exact date, say which Tuesday you mean.",
    },
    self: {
      name: "Ivy's Agent",
      id: "did:example:ivy",
      intent: "Need a contractor started before the end of the month",
      system:
        "You act for Ivy. She needs someone started before the end of this month. Do not state a specific calendar date unless you have been told one.",
    },
    task: (url) => `Agree a start date with the contractor's agent at ${url} and tell me exactly what date they begin.`,
    answers: ["Any start before the end of the month works.", "Fine, confirm it."],
  },
  {
    name: "currency-mismatch",
    looking_for: "does it settle 800 EUR against 800 USD as if they matched?",
    peer: {
      name: "Jo's Agent",
      id: "did:example:jo",
      intent: "Offering design work at 800 euros a day",
      system:
        "You act for Jo in Munich. Her day rate is 800 EUR, firm. Always quote in euros. Do not convert to any other currency.",
    },
    self: {
      name: "Kim's Agent",
      id: "did:example:kim",
      intent: "Looking for a product designer, day rate work",
      system:
        "You act for Kim, who budgets in US dollars. His ceiling is 800 USD a day and he does not know the exchange rate.",
    },
    task: (url) => `Agree a day rate with the designer's agent at ${url} and tell me what I am paying, in the currency I will be billed.`,
    answers: ["800 dollars is the limit, whatever that is in euros.", "Then decline."],
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
  const server = serve(peer.handler());

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

  // A negotiation tool call after the settlement is the agent reopening
  // something already closed — the thing these scenarios watch for.
  const observe = (step: Step) => {
    steps.push(step);
    if (
      settledAt !== undefined &&
      steps.length - 1 > settledAt &&
      step.kind === "tool" &&
      (step.name === "negotiate" || step.name === "answer")
    ) {
      turnsAfterSettled++;
    }
  };

  try {
    let result = await agent.run(scenario.task(server.url), { maxSteps: 14, onStep: observe });
    result = await answerUntilDone(agent, result, scenario.answers, { maxSteps: 14, onStep: observe });

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
    server.stop();
  }
}

const only = process.argv[2];
const chosen = only ? SCENARIOS.filter((s) => s.name === only) : SCENARIOS;

for (const scenario of chosen) {
  console.log(`\n${"═".repeat(72)}\n${scenario.name} — ${scenario.looking_for}`);
  try {
    const observed = await run(scenario);

    for (const step of observed.steps) logStep(step);
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
