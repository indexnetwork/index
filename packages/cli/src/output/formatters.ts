/**
 * Table and card formatters for CLI output.
 *
 * Each formatter handles a specific domain entity: sessions, profiles,
 * intents, opportunities, negotiations, networks, conversations, messages,
 * and the personal agent.
 */

import type { Intent, IntentPreparation, Opportunity, OpportunityDetail, Conversation, ConversationMessage, Negotiation, NegotiationDetail, NegotiationOutcome, NegotiationTurnAction, AgentConversation, SelectedAgent } from "../types";

import { RESET, BOLD, DIM, RED, GREEN, YELLOW, BLUE, CYAN, WHITE, GRAY, AGENT_TEXT, dim, success, wordWrap, confidenceBar, padTo, stripAnsi } from "./base";

// ── Profile card ────────────────────────────────────────────────────

/** User data shape for profile card rendering. */
export interface ProfileData {
  id: string;
  key?: string | null;
  name: string | null;
  intro: string | null;
  avatar: string | null;
  location: string | null;
  socials: Array<{ label: string; value: string }> | null;
  createdAt: string;
  updatedAt: string | null;
}

/**
 * Render a styled profile card and return it as a string.
 * Also prints the card to stdout.
 *
 * @param data - The user profile data.
 * @returns The rendered card string (with ANSI codes).
 */
export function profileCard(data: ProfileData): string {
  const lines: string[] = [];
  const W = 56;
  const border = (ch: string) => `${CYAN}${ch}${RESET}`;
  const hline = `  ${border("+")}${CYAN}${"─".repeat(W)}${RESET}${border("+")}`;

  lines.push("");
  lines.push(hline);

  // Name line
  const displayName = data.name ?? "(unnamed)";
  const nameContent = `${BOLD}${WHITE}${displayName}${RESET}`;
  lines.push(`  ${border("|")} ${nameContent}${padTo(W - 2, stripAnsi(displayName))}${border("|")}`);

  // Intro / bio
  if (data.intro) {
    lines.push(`  ${border("|")}${" ".repeat(W)}${border("|")}`);
    const wrapped = wordWrap(data.intro, W - 4);
    for (const line of wrapped) {
      lines.push(`  ${border("|")}  ${AGENT_TEXT}${line}${RESET}${padTo(W - 2, line)}${border("|")}`);
    }
  }

  // Location
  if (data.location) {
    lines.push(`  ${border("|")}${" ".repeat(W)}${border("|")}`);
    const locLine = `Location: ${data.location}`;
    lines.push(`  ${border("|")}  ${GRAY}${locLine}${RESET}${padTo(W - 2, locLine)}${border("|")}`);
  }

  // Socials
  if (data.socials && data.socials.length > 0) {
    lines.push(`  ${border("|")}${" ".repeat(W)}${border("|")}`);
    for (const { label, value } of data.socials) {
      const socialLine = `${label}: ${value}`;
      lines.push(`  ${border("|")}  ${BLUE}${socialLine}${RESET}${padTo(W - 2, socialLine)}${border("|")}`);
    }
  }

  // Member since
  const since = new Date(data.createdAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const sinceLine = `Member since ${since}`;
  lines.push(`  ${border("|")}${" ".repeat(W)}${border("|")}`);
  lines.push(`  ${border("|")}  ${DIM}${sinceLine}${RESET}${padTo(W - 2, sinceLine)}${border("|")}`);

  lines.push(hline);
  lines.push("");

  const output = lines.join("\n");
  console.log(output);
  return output;
}

// ── Intent output ──────────────────────────────────────────────────

/**
 * Print a table of intents.
 *
 * @param intents - Array of intent objects from the API.
 */
export function intentTable(intents: Intent[]): void {
  if (intents.length === 0) {
    dim("  No intents found.");
    return;
  }

  const idWidth = 8;
  const descWidth = 44;
  const statusWidth = 10;
  const sourceWidth = 16;
  const dateWidth = 20;

  console.log(
    `  ${BOLD}${"ID".padEnd(idWidth)}  ${"Intent".padEnd(descWidth)}  ${"Status".padEnd(statusWidth)}  ${"Source".padEnd(sourceWidth)}  ${"Created".padEnd(dateWidth)}${RESET}`,
  );
  console.log(
    `  ${GRAY}${"-".repeat(idWidth)}  ${"-".repeat(descWidth)}  ${"-".repeat(statusWidth)}  ${"-".repeat(sourceWidth)}  ${"-".repeat(dateWidth)}${RESET}`,
  );

  for (const intent of intents) {
    const shortId = intent.id.slice(0, 8);
    const desc = (intent.summary ?? intent.payload).slice(0, descWidth);
    const status = (intent.status ?? "").padEnd(statusWidth);
    const source = (intent.sourceType ?? "-").padEnd(sourceWidth);
    const date = new Date(intent.createdAt).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

    const sColor = intent.status === "ACTIVE" ? GREEN : GRAY;
    console.log(
      `  ${CYAN}${shortId}${RESET}  ${desc.padEnd(descWidth)}  ${sColor}${status}${RESET}  ${GRAY}${source}${RESET}  ${GRAY}${date}${RESET}`,
    );
  }
}

/**
 * Print the result of preparing a draft intent: either the ready payload with
 * the command that creates it, or the feedback and the questions to answer.
 *
 * @param prepared - Result from POST /api/intents/prepare.
 */
export function intentPreparation(prepared: IntentPreparation): void {
  if (prepared.status === "ready") {
    success("Intent is ready to create.");
    console.log();
    for (const line of wordWrap(prepared.payload, 72)) console.log(`  ${line}`);
    console.log();
    console.log(`  ${BOLD}Create it:${RESET}`);
    console.log(`  index intent create ${shellQuote(prepared.payload)} --receipt ${shellQuote(prepared.preparationReceipt)}`);
    console.log();
    return;
  }

  console.log();
  console.log(`  ${BOLD}${YELLOW}Needs revision${RESET}`);
  for (const line of wordWrap(prepared.feedback, 72)) console.log(`  ${line}`);
  console.log();
  console.log(`  ${BOLD}Answer these:${RESET}`);
  for (const field of prepared.recovery) {
    console.log(`  ${CYAN}*${RESET} ${field.label}`);
    for (const option of field.options ?? []) {
      const description = option.description ? `${GRAY} \u2014 ${option.description}${RESET}` : "";
      console.log(`      ${option.label}${description}`);
    }
    if (field.placeholder) console.log(`      ${GRAY}${field.placeholder}${RESET}`);
  }
  console.log();
  const answerFlags = prepared.recovery.map((field) => `--answer ${shellQuote(`${field.label}=<reply>`)}`);
  console.log(`  ${BOLD}Then run:${RESET}`);
  console.log(`  index intent prepare ${shellQuote(prepared.payload)} ${answerFlags.join(" ")}`);
  console.log();
}

/** Quote a value for a POSIX shell so a printed command can be pasted as-is. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Print a detailed card for a single intent.
 *
 * @param intent - The intent object from the API.
 */
export function intentCard(intent: Intent): void {
  console.log();
  console.log(`  ${BOLD}${CYAN}Intent Details${RESET}`);
  console.log(`  ${GRAY}${"─".repeat(50)}${RESET}`);
  console.log(`  ${BOLD}ID${RESET}            ${GRAY}${intent.id}${RESET}`);
  console.log(`  ${BOLD}Status${RESET}        ${intent.status === "ACTIVE" ? GREEN : GRAY}${intent.status}${RESET}`);

  if (intent.summary) {
    console.log(`  ${BOLD}Summary${RESET}       ${intent.summary}`);
  }

  console.log();
  console.log(`  ${BOLD}Description${RESET}`);
  console.log(`  ${intent.payload}`);

  if (intent.speechActType) {
    console.log();
    console.log(`  ${BOLD}Speech Act${RESET}    ${intent.speechActType}`);
  }
  if (intent.intentMode) {
    console.log(`  ${BOLD}Mode${RESET}          ${intent.intentMode}`);
  }
  if (intent.sourceType) {
    console.log(`  ${BOLD}Source${RESET}        ${intent.sourceType}`);
  }
  if (intent.confidence !== undefined) {
    console.log(`  ${BOLD}Confidence${RESET}    ${confidenceBar(intent.confidence)}`);
  }
  if (intent.semanticEntropy !== undefined) {
    console.log(`  ${BOLD}Entropy${RESET}       ${intent.semanticEntropy.toFixed(2)}`);
  }
  if (intent.isIncognito) {
    console.log(`  ${BOLD}Incognito${RESET}     ${YELLOW}Yes${RESET}`);
  }

  console.log();
  console.log(`  ${BOLD}Created${RESET}       ${GRAY}${new Date(intent.createdAt).toLocaleString()}${RESET}`);
  console.log(`  ${BOLD}Updated${RESET}       ${GRAY}${new Date(intent.updatedAt).toLocaleString()}${RESET}`);
  if (intent.archivedAt) {
    console.log(`  ${BOLD}Archived${RESET}      ${GRAY}${new Date(intent.archivedAt).toLocaleString()}${RESET}`);
  }

  if (intent.networks && intent.networks.length > 0) {
    console.log();
    console.log(`  ${BOLD}Networks${RESET}`);
    for (const idx of intent.networks) {
      const score = idx.relevancyScore !== undefined ? ` (${idx.relevancyScore.toFixed(2)})` : "";
      console.log(`  ${CYAN}*${RESET} ${idx.title}${GRAY}${score}${RESET}`);
    }
  }

  console.log(`  ${GRAY}${"─".repeat(50)}${RESET}`);
  console.log();
}

// ── Opportunity output ──────────────────────────────────────────────

/** Human-readable labels for valency roles with color. */
const ROLE_LABELS: Record<string, { label: string; color: string }> = {
  agent: { label: "Helper", color: GREEN },
  patient: { label: "Seeker", color: YELLOW },
  peer: { label: "Peer", color: CYAN },
};

/**
 * Get a colored role label for an actor's valency role.
 *
 * @param role - Valency role string (agent, patient, peer).
 * @returns Colored label string.
 */
function roleLabel(role?: string): string {
  const entry = role ? ROLE_LABELS[role] : undefined;
  if (!entry) return `${GRAY}Unknown${RESET}`;
  return `${entry.color}${entry.label}${RESET}`;
}

/**
 * Print a table of opportunities.
 *
 * @param opportunities - Array of opportunity objects.
 */
export function opportunityTable(opportunities: Opportunity[]): void {
  if (opportunities.length === 0) {
    dim("  No opportunities found.");
    return;
  }

  const idW = 8;
  const nameW = 20;
  const statusW = 12;
  const headlineW = 48;

  process.stdout.write(
    `  ${BOLD}${"ID".padEnd(idW)}  ${"Counterparty".padEnd(nameW)}  ${"Status".padEnd(statusW)}  Headline${RESET}\n`,
  );
  process.stdout.write(
    `  ${GRAY}${"-".repeat(idW)}  ${"-".repeat(nameW)}  ${"-".repeat(statusW)}  ${"-".repeat(headlineW)}${RESET}\n`,
  );

  for (const opp of opportunities) {
    const shortId = opp.opportunityId.slice(0, idW);
    const name = opp.peer.name.slice(0, nameW);
    const st = opp.status.slice(0, statusW);
    const headline = (opp.headline ?? opp.mainText).slice(0, headlineW);
    process.stdout.write(
      `  ${CYAN}${shortId}${RESET}  ${name.padEnd(nameW)}  ${statusColor(st)}${st.padEnd(statusW)}${RESET}  ${headline}\n`,
    );
  }
}

/**
 * Print a detailed opportunity card from the presented detail shape
 * (GET /api/opportunities/:id).
 *
 * @param opp - Presented opportunity detail for the viewer.
 */
export function opportunityCard(opp: OpportunityDetail): void {
  const width = 58;
  const innerWidth = width - 2;
  const title = opp.headline ?? "Opportunity";

  process.stdout.write(`\n  ${BLUE}+${"─".repeat(width)}+${RESET}\n`);
  cardLine(`${BOLD}${BLUE}${title}${RESET}`);
  process.stdout.write(`  ${BLUE}+${"─".repeat(width)}+${RESET}\n`);

  const st = opp.status ?? "unknown";
  cardLine(`${BOLD}Status:${RESET}  ${statusColor(st)}${st}${RESET}`);
  if (opp.category) cardLine(`${BOLD}Category:${RESET}  ${opp.category}`);
  if (opp.network?.title) cardLine(`${BOLD}Network:${RESET}  ${opp.network.title}`);
  if (opp.confidence != null) cardLine(`${BOLD}Confidence:${RESET}  ${confidenceBar(opp.confidence)}`);
  if (opp.myRole) cardLine(`${BOLD}Your role:${RESET}  ${roleLabel(opp.myRole)}`);

  // The presenter identifies the peer; detail also carries the actor list.
  if (opp.peer?.name) cardLine(`${BOLD}With:${RESET}  ${opp.peer.name}`);
  else if (opp.otherParties && opp.otherParties.length > 0) {
    process.stdout.write(`  ${BLUE}|${RESET}\n`);
    cardLine(`${BOLD}With:${RESET}`);
    for (const p of opp.otherParties) {
      cardLine(`  ${p.name ?? p.id}  ${roleLabel(p.role)}`);
    }
  }

  // Description
  if (opp.mainText) {
    process.stdout.write(`  ${BLUE}|${RESET}\n`);
    cardLine(`${BOLD}Details:${RESET}`);
    for (const line of wordWrap(opp.mainText, innerWidth - 4)) {
      cardLine(`  ${AGENT_TEXT}${line}${RESET}`);
    }
  }

  // Timestamp
  if (opp.createdAt) {
    process.stdout.write(`  ${BLUE}|${RESET}\n`);
    const created = new Date(opp.createdAt).toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    cardLine(`${GRAY}Created: ${created}${RESET}`);
  }

  process.stdout.write(`  ${BLUE}+${"─".repeat(width)}+${RESET}\n\n`);
}

/** Print a line inside a card box. */
function cardLine(content: string): void {
  process.stdout.write(`  ${BLUE}|${RESET} ${content}\n`);
}

/** Get ANSI color for an opportunity status. */
function statusColor(st: string): string {
  switch (st) {
    case "accepted":
      return GREEN;
    case "rejected":
      return RED;
    case "pending":
      return YELLOW;
    case "expired":
      return GRAY;
    default:
      return "";
  }
}

// ── Negotiation output ─────────────────────────────────────────────

/** Colors for each negotiation action. */
const ACTION_COLORS: Record<NegotiationTurnAction, string> = {
  propose: CYAN,
  counter: BLUE,
  accept: GREEN,
  decline: RED,
};

/** Short date and time, e.g. "Sep 2, 02:30 PM". */
function shortDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** The colored outcome; a negotiation that has not settled is "open". */
function outcomeLabel(outcome: NegotiationOutcome | null): string {
  switch (outcome) {
    case "agreed":
      return `${GREEN}agreed${RESET}`;
    case "declined":
      return `${RED}declined${RESET}`;
    case "closed":
      return `${GRAY}closed${RESET}`;
    case null:
      return `${YELLOW}open${RESET}`;
  }
}

/** Whose move it is from the viewer's seat; nobody's once settled. */
function whoseTurn(negotiation: Negotiation): "you" | "them" | "nobody" {
  if (negotiation.awaitingUserId === null) return "nobody";
  return negotiation.awaitingUserId === negotiation.counterparty.userId ? "them" : "you";
}

function counterpartyName(negotiation: Negotiation): string {
  return negotiation.counterparty.name ?? "(unnamed)";
}

/**
 * Print a table of negotiations.
 *
 * @param negotiations - The viewer's negotiations from GET /api/negotiations.
 */
export function negotiationTable(negotiations: Negotiation[]): void {
  if (negotiations.length === 0) {
    dim("  No negotiations found.");
    return;
  }

  const idW = 8;
  const nameW = 22;
  const turnsW = 5;
  const turnW = 10;
  const outcomeW = 8;
  const dateW = 12;

  console.log(
    `  ${BOLD}${"ID".padEnd(idW)}  ${"Counterparty".padEnd(nameW)}  ${"Turns".padEnd(turnsW)}  ${"Whose turn".padEnd(turnW)}  ${"Outcome".padEnd(outcomeW)}  ${"Updated".padEnd(dateW)}${RESET}`,
  );
  console.log(
    `  ${GRAY}${"-".repeat(idW)}  ${"-".repeat(nameW)}  ${"-".repeat(turnsW)}  ${"-".repeat(turnW)}  ${"-".repeat(outcomeW)}  ${"-".repeat(dateW)}${RESET}`,
  );

  for (const negotiation of negotiations) {
    const shortId = negotiation.opportunityId.slice(0, idW);
    const name = counterpartyName(negotiation).slice(0, nameW);
    const turns = String(negotiation.turnCount);
    const turn = whoseTurn(negotiation);
    let turnCell = `${GRAY}${"\u2014".padEnd(turnW)}${RESET}`;
    if (turn === "you") turnCell = `${YELLOW}${BOLD}${"you".padEnd(turnW)}${RESET}`;
    if (turn === "them") turnCell = `${GRAY}${"them".padEnd(turnW)}${RESET}`;
    const outcome = outcomeLabel(negotiation.outcome);
    const date = new Date(negotiation.updatedAt).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

    console.log(
      `  ${CYAN}${shortId}${RESET}  ${name.padEnd(nameW)}  ${turns.padEnd(turnsW)}  ${turnCell}  ${outcome}${padTo(outcomeW, stripAnsi(outcome))}  ${GRAY}${date}${RESET}`,
    );
  }
}

/**
 * Print one negotiation: its state, the turn-by-turn transcript, and what the
 * viewer may do next.
 *
 * @param negotiation - The negotiation from GET /api/opportunities/:id/negotiation.
 */
export function negotiationCard(negotiation: NegotiationDetail): void {
  const name = counterpartyName(negotiation);
  const rule = `  ${GRAY}${"\u2500".repeat(60)}${RESET}`;

  let turnLabel = `${GRAY}\u2014 settled${RESET}`;
  if (whoseTurn(negotiation) === "you") turnLabel = `${YELLOW}${BOLD}you${RESET}`;
  if (whoseTurn(negotiation) === "them") turnLabel = name;

  console.log();
  console.log(`  ${BOLD}${CYAN}Negotiation with ${name}${RESET}`);
  console.log(rule);
  console.log(`  ${BOLD}Opportunity${RESET}   ${GRAY}${negotiation.opportunityId}${RESET}`);
  console.log(`  ${BOLD}Outcome${RESET}       ${outcomeLabel(negotiation.outcome)}`);
  console.log(`  ${BOLD}Turn${RESET}          ${negotiation.turnCount} of ${negotiation.protocol.maxTurns}`);
  console.log(`  ${BOLD}Whose turn${RESET}    ${turnLabel}`);
  const [firstLine, ...moreLines] = wordWrap(negotiation.counterparty.statement, 58);
  console.log(`  ${BOLD}Their intent${RESET}  ${firstLine}`);
  for (const line of moreLines) console.log(`                ${line}`);

  console.log();
  console.log(`  ${BOLD}Transcript${RESET}`);
  if (negotiation.turns.length === 0) console.log(`  ${GRAY}No turns yet.${RESET}`);
  for (const turn of negotiation.turns) {
    const seat = turn.seatUserId === negotiation.counterparty.userId ? name : "You";
    console.log(
      `  ${GRAY}${turn.turnIndex + 1}.${RESET} ${BOLD}${seat}${RESET}  ${ACTION_COLORS[turn.action]}${turn.action}${RESET}  ${GRAY}${shortDateTime(turn.createdAt)}${RESET}`,
    );
    for (const line of wordWrap(turn.message, 66)) console.log(`     ${line}`);
  }

  const { availableActions, blockedReason, messageLimit } = negotiation.protocol;
  console.log();
  if (availableActions.length > 0) {
    const actions = availableActions.map((action) => `${ACTION_COLORS[action]}${action}${RESET}`).join(", ");
    console.log(`  ${BOLD}Available actions:${RESET} ${actions}  ${GRAY}(message up to ${messageLimit} characters)${RESET}`);
  } else {
    console.log(`  ${BOLD}Available actions:${RESET} ${GRAY}none${RESET}`);
  }
  if (blockedReason) console.log(`  ${BOLD}Blocked:${RESET} ${YELLOW}${blockedReason}${RESET}`);
  console.log(rule);
  if (availableActions.length > 0) {
    dim(`  Reply: index negotiation turn ${negotiation.opportunityId.slice(0, 8)} --action <action> --message <text>`);
  }
  console.log();
}

// ── Personal agent output ──────────────────────────────────────────

/**
 * Print the selected external negotiator from GET /api/agents/me.
 *
 * @param selected - The agent holding the negotiation seat and the owner's onboarding state.
 */
export function agentCard(selected: SelectedAgent): void {
  const { agent, onboardingCompletedAt } = selected;
  const rule = `  ${GRAY}${"\u2500".repeat(50)}${RESET}`;

  console.log();
  console.log(`  ${BOLD}${CYAN}${agent.name}${RESET}`);
  console.log(rule);
  console.log(`  ${BOLD}Seat${RESET}          External negotiator (negotiates instead of Index's hosted agent)`);
  console.log(`  ${BOLD}Status${RESET}        ${agent.status === "active" ? GREEN : GRAY}${agent.status}${RESET}`);
  if (agent.description) console.log(`  ${BOLD}Description${RESET}   ${agent.description}`);
  console.log(`  ${BOLD}Last seen${RESET}     ${GRAY}${agent.lastSeenAt ? shortDateTime(agent.lastSeenAt) : "never"}${RESET}`);
  const onboarding = onboardingCompletedAt
    ? `${GREEN}complete${RESET} ${GRAY}(${shortDateTime(onboardingCompletedAt)})${RESET}`
    : `${YELLOW}not complete${RESET}`;
  console.log(`  ${BOLD}Onboarding${RESET}    ${onboarding}`);
  console.log(`  ${BOLD}ID${RESET}            ${GRAY}${agent.id}${RESET}`);
  console.log(rule);
  console.log();
}

/**
 * Print one intent's personal-agent conversation: who answers, the messages,
 * and every question still waiting on the owner with the ID needed to answer it.
 *
 * @param conversation - Result from GET /api/conversations/agent/messages?intentId=.
 */
export function agentConversation(conversation: AgentConversation): void {
  const seat = conversation.agent.status === "hosted" ? "Index's hosted agent" : "your external negotiator";
  const rule = `  ${GRAY}${"\u2500".repeat(60)}${RESET}`;

  console.log();
  console.log(`  ${BOLD}${CYAN}Personal agent${RESET}  ${GRAY}answered by ${seat}${RESET}`);
  console.log(rule);
  if (conversation.messages.length === 0) console.log(`  ${GRAY}No messages yet.${RESET}`);
  for (const message of conversation.messages) {
    const author = message.role === "user" ? `${BOLD}${CYAN}you${RESET}` : `${BOLD}${BLUE}agent${RESET}`;
    const text = message.parts
      .filter((part) => part.kind === "text" && part.text)
      .map((part) => part.text)
      .join("\n");
    console.log(`  ${author}  ${GRAY}${shortDateTime(message.createdAt)}${RESET}`);
    for (const line of wordWrap(text, 70)) console.log(`  ${line}`);
    console.log();
  }

  const { questions } = conversation.agent;
  if (questions.length === 0) {
    console.log(`  ${GRAY}No questions waiting for you.${RESET}`);
    console.log();
    return;
  }
  console.log(`  ${BOLD}${YELLOW}Waiting for your answer (${questions.length})${RESET}`);
  for (const question of questions) {
    const [firstLine, ...moreLines] = wordWrap(question.question, 66);
    console.log(`  ${YELLOW}?${RESET} ${BOLD}${firstLine}${RESET}`);
    for (const line of moreLines) console.log(`    ${BOLD}${line}${RESET}`);
    console.log(`    ${GRAY}Question ID${RESET}  ${CYAN}${question.id}${RESET}`);
    if (question.options?.length) console.log(`    ${GRAY}Options${RESET}      ${question.options.join(" / ")}`);
    if (question.matches.length > 0) {
      const about = question.matches
        .map((match) => `${match.counterparty.name ?? "(unnamed)"} ${GRAY}(${match.opportunityId.slice(0, 8)})${RESET}`)
        .join(", ");
      console.log(`    ${GRAY}About${RESET}        ${about}`);
    }
    console.log();
  }
}

// ── Network output ─────────────────────────────────────────────────

/**
 * Print a table of networks.
 *
 * @param networks - Array of network objects to display.
 */
export function networkTable(
  networks: Array<{
    id: string;
    key?: string | null;
    title: string;
    memberCount?: number;
    role?: string;
    joinPolicy?: string;
    createdAt?: string;
  }>,
): void {
  if (networks.length === 0) {
    dim("  No networks found.");
    return;
  }

  const keyW = 24;
  const titleW = 26;
  const membersW = 8;
  const roleW = 10;
  const policyW = 12;
  const dateW = 18;

  console.log(
    `  ${BOLD}${"Key".padEnd(keyW)}  ${"Title".padEnd(titleW)}  ${"Members".padEnd(membersW)}  ${"Role".padEnd(roleW)}  ${"Join Policy".padEnd(policyW)}  ${"Created".padEnd(dateW)}${RESET}`,
  );
  console.log(
    `  ${GRAY}${"-".repeat(keyW)}  ${"-".repeat(titleW)}  ${"-".repeat(membersW)}  ${"-".repeat(roleW)}  ${"-".repeat(policyW)}  ${"-".repeat(dateW)}${RESET}`,
  );

  for (const n of networks) {
    const key = (n.key ?? n.id.slice(0, 8)).slice(0, keyW);
    const title = n.title.slice(0, titleW);
    const members = String(n.memberCount ?? "-");
    const role = n.role ?? "member";
    const policy = (n.joinPolicy ?? "invite_only").replace("_", " ");
    const date = n.createdAt
      ? new Date(n.createdAt).toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : "-";

    console.log(
      `  ${CYAN}${key.padEnd(keyW)}${RESET}  ${title.padEnd(titleW)}  ${members.padEnd(membersW)}  ${role.padEnd(roleW)}  ${policy.padEnd(policyW)}  ${GRAY}${date}${RESET}`,
    );
  }
}

/**
 * Print a network detail card.
 *
 * @param network - Network object with details.
 */
export function networkCard(network: {
  id: string;
  key?: string | null;
  title: string;
  prompt?: string | null;
  joinPolicy?: string;
  memberCount?: number;
  owner?: { name: string; email: string };
}): void {
  console.log();
  console.log(`  ${BOLD}${network.title}${RESET}`);
  console.log(`  ${GRAY}${"─".repeat(40)}${RESET}`);
  if (network.key) {
    console.log(`  ${GRAY}Key:${RESET}         ${CYAN}${network.key}${RESET}`);
  }
  console.log(`  ${GRAY}ID:${RESET}          ${network.id}`);
  if (network.prompt) {
    console.log(`  ${GRAY}Prompt:${RESET}      ${network.prompt}`);
  }
  console.log(`  ${GRAY}Join Policy:${RESET} ${(network.joinPolicy ?? "invite_only").replace("_", " ")}`);
  console.log(`  ${GRAY}Members:${RESET}     ${network.memberCount ?? "-"}`);
  if (network.owner) {
    console.log(`  ${GRAY}Owner:${RESET}       ${network.owner.name} (${network.owner.email})`);
  }
  console.log();
}

/**
 * Print a table of network members.
 *
 * @param members - Array of member objects.
 */
export function memberTable(
  members: Array<{
    name?: string | null;
    email?: string | null;
    /** Legacy nested shape — kept for backward compatibility. */
    user?: { name: string; email: string };
    permissions: string[];
    createdAt?: string;
  }>,
): void {
  if (members.length === 0) {
    dim("  No members found.");
    return;
  }

  const nameW = 24;
  const emailW = 30;
  const roleW = 10;
  const dateW = 18;

  console.log(
    `  ${BOLD}${"Name".padEnd(nameW)}  ${"Email".padEnd(emailW)}  ${"Role".padEnd(roleW)}  ${"Joined".padEnd(dateW)}${RESET}`,
  );
  console.log(
    `  ${GRAY}${"-".repeat(nameW)}  ${"-".repeat(emailW)}  ${"-".repeat(roleW)}  ${"-".repeat(dateW)}${RESET}`,
  );

  for (const m of members) {
    const name = (m.name ?? m.user?.name ?? "(unnamed)").slice(0, nameW);
    const email = (m.email ?? m.user?.email ?? "").slice(0, emailW);
    const role = m.permissions.includes("owner")
      ? "owner"
      : m.permissions.includes("admin")
        ? "admin"
        : "member";
    const date = m.createdAt
      ? new Date(m.createdAt).toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : "-";

    console.log(
      `  ${name.padEnd(nameW)}  ${email.padEnd(emailW)}  ${role.padEnd(roleW)}  ${GRAY}${date}${RESET}`,
    );
  }
}

// ── Conversation output ───────────────────────────────────────────

/** Resolve a participant's display name with legacy-shape fallbacks. */
function participantName(p: Conversation["participants"][number]): string {
  return p.name ?? p.user?.name ?? p.participantId;
}

/**
 * Print a table of conversations.
 *
 * @param conversations - Array of conversation objects from the API.
 */
export function conversationTable(conversations: Conversation[]): void {
  if (conversations.length === 0) {
    dim("  No conversations found.");
    return;
  }

  const idWidth = 8;
  const participantsWidth = 46;
  const dateWidth = 20;

  console.log(
    `  ${BOLD}${"ID".padEnd(idWidth)}  ${"Participants".padEnd(participantsWidth)}  ${"Created".padEnd(dateWidth)}${RESET}`,
  );
  console.log(
    `  ${GRAY}${"-".repeat(idWidth)}  ${"-".repeat(participantsWidth)}  ${"-".repeat(dateWidth)}${RESET}`,
  );

  for (const c of conversations) {
    const shortId = c.id.slice(0, 8);
    const names = c.participants
      .map(participantName)
      .join(", ")
      .slice(0, participantsWidth);
    const date = new Date(c.createdAt).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

    console.log(
      `  ${CYAN}${shortId}${RESET}  ${names.padEnd(participantsWidth)}  ${GRAY}${date}${RESET}`,
    );
  }
}

/**
 * Print a summary card for a conversation (used after DM get-or-create).
 *
 * @param conversation - The conversation object from the API.
 */
export function conversationCard(conversation: Conversation): void {
  console.log();
  console.log(`  ${BOLD}${CYAN}Conversation${RESET}`);
  console.log(`  ${GRAY}${"─".repeat(40)}${RESET}`);
  console.log(`  ${BOLD}ID${RESET}            ${GRAY}${conversation.id}${RESET}`);

  if (conversation.participants.length > 0) {
    const names = conversation.participants
      .map(participantName)
      .join(", ");
    console.log(`  ${BOLD}Participants${RESET}  ${names}`);
  }

  const date = new Date(conversation.createdAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  console.log(`  ${BOLD}Created${RESET}       ${GRAY}${date}${RESET}`);
  console.log(`  ${GRAY}${"─".repeat(40)}${RESET}`);
  console.log();
}

/**
 * Print a list of messages in a conversation.
 *
 * @param messages - Array of message objects from the API.
 */
export function messageList(messages: ConversationMessage[]): void {
  if (messages.length === 0) {
    dim("  No messages found.");
    return;
  }

  for (const msg of messages) {
    const sender = msg.senderId ?? msg.role;
    const time = new Date(msg.createdAt).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
    const date = new Date(msg.createdAt).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
    const textParts = msg.parts
      .filter((p) => p.kind === "text" && p.text)
      .map((p) => p.text)
      .join("");

    console.log(`  ${CYAN}${sender}${RESET}  ${GRAY}${date} ${time}${RESET}`);
    console.log(`  ${textParts}`);
    console.log();
  }
}
