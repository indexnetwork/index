/**
 * An authenticated agent. `inspect()` reads the counterparty's AgentCard —
 * including the security scheme it declares — before negotiating, and
 * `credentials` attaches the token every outbound call needs.
 *
 *   OPENROUTER_API_KEY=... bun run examples/05-authenticated.ts
 */
import { Agent, bearerCredentials, bearerTokenAuth } from "../src/index.ts";
import { logOutcome, logTurn, MAX_TURNS, serve } from "./shared.ts";

const TOKEN = "a-shared-secret";

const seller = new Agent({
  identity: { name: "Idris", id: "did:example:idris", url: "https://idris.example" },
  systemPrompt: "Take on advisory clients at 1,200 a day, ideally two days a month",
  authenticate: bearerTokenAuth(TOKEN),
  // Declaring the scheme is what lets a caller work out how to authenticate;
  // `authenticate` above is what actually enforces it.
  card: {
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
    security: [{ bearerAuth: [] }],
  },
});

const { url, stop } = serve(seller.handler());

const buyer = new Agent({
  identity: { name: "Tomas", id: "did:example:tomas" },
  systemPrompt: "Bring in an advisor, ideally under 1,000 a day",
  credentials: bearerCredentials(TOKEN),
  onTurn: (turn) => logTurn(turn.speaker === "self" ? "Tomas" : "Idris", turn),
});

// The public card is unauthenticated, per the A2A spec.
const card = await buyer.inspect(url);
console.log(`peer: "${card.name}" at ${card.url}`);
console.log(`requires: ${Object.keys(card.securitySchemes ?? {}).join(", ") || "nothing"}\n`);

logOutcome(await buyer.negotiate(url, { maxTurns: MAX_TURNS }));

// Without credentials, the same call is refused before a word is decided.
const anonymous = new Agent({
  identity: { name: "Stranger", id: "did:example:stranger" },
  systemPrompt: "Bring in an advisor for nothing",
});
await anonymous.negotiate(url).catch((error) => console.log(`\n! refused: ${error.message}`));

stop();
