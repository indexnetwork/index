import { hmacId, hmacIdOrNull, redactText, uniqueTerms, type IdKind } from './anonymize';

export interface RawUser {
  id: string;
  name: string;
  email: string;
  key: string | null;
  intro: string | null;
  onboarding: unknown;
  createdAt: Date;
  deletedAt: Date | null;
}

export interface RawSocial {
  userId: string;
  value: string;
}

export interface RawIntent {
  id: string;
  userId: string;
  payload: string;
  summary: string | null;
  status: string | null;
  isIncognito: boolean;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

export interface RawOpportunityActor {
  userId?: string;
  intent?: string;
  role?: string;
  actedAt?: string;
  approved?: boolean;
  networkId?: string;
}

export interface RawOpportunity {
  id: string;
  detection: { source?: string; triggeredBy?: string };
  actors: RawOpportunityActor[];
  interpretation: { category?: string; reasoning?: string; confidence?: number };
  context: { networkId?: string };
  confidence: string | number;
  status: string;
  acceptedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
}

export interface RawNegotiationTask {
  id: string;
  conversationId: string;
  state: string;
  createdAt: Date;
  metadata: {
    opportunityId?: string;
    sourceUserId?: string;
    candidateUserId?: string;
    networkId?: string;
  };
}

export interface RawNegotiationMessage {
  taskId: string;
  senderId: string;
  parts: unknown;
  createdAt: Date;
  id: string;
}

export interface RawArtifact {
  taskId: string;
  name: string | null;
  parts: unknown;
}

export interface IdentifierSource {
  users: RawUser[];
  socials: RawSocial[];
  telegramChatIds: string[];
}

function unix(date: Date | null | undefined): number | null {
  if (!date) return null;
  return date.getTime() / 1000;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function collectOnboardingStrings(onboarding: unknown): string[] {
  const record = asRecord(onboarding);
  const seeds = record?.profileSeeds;
  if (!Array.isArray(seeds)) return [];
  const out: string[] = [];
  for (const seed of seeds) {
    const row = asRecord(seed);
    if (!row) continue;
    if (typeof row.name === 'string') out.push(row.name);
    if (typeof row.bio === 'string') out.push(row.bio);
    const socials = row.socials;
    if (Array.isArray(socials)) {
      for (const social of socials) {
        const item = asRecord(social);
        if (typeof item?.value === 'string') out.push(item.value);
      }
    }
  }
  return out;
}

export function buildDictionary(source: IdentifierSource): string[] {
  const values: Array<string | null | undefined> = [];
  for (const user of source.users) {
    values.push(user.name, user.email, user.key, user.intro);
    values.push(...collectOnboardingStrings(user.onboarding));
  }
  for (const social of source.socials) values.push(social.value);
  values.push(...source.telegramChatIds);
  return uniqueTerms(values);
}

export function extractTurn(parts: unknown): { verb: string | null; text: string } {
  const list = Array.isArray(parts) ? parts : [];
  for (const part of list) {
    const row = asRecord(part);
    const data = asRecord(row?.data) ?? (row?.kind === undefined ? row : null);
    if (!data) continue;
    const verb = stringField(data.verb) ?? stringField(data.action);
    const message = stringField(data.message);
    const reasoning = stringField(data.reasoning) ?? stringField(asRecord(data.assessment)?.reasoning);
    const reason = stringField(data.reason);
    const text = [message, reasoning].filter(Boolean).join('\n') || (verb === 'pause' && reason ? `pause:${reason}` : '');
    if (verb || text) return { verb: verb ?? null, text };
  }
  return { verb: null, text: '' };
}

function speakerUserId(senderId: string): string | null {
  if (senderId.startsWith('agent:')) return senderId.slice('agent:'.length) || null;
  return senderId || null;
}

function artifactOutcome(parts: unknown): { hasOpportunity?: boolean; reason?: string } {
  const list = Array.isArray(parts) ? parts : [];
  for (const part of list) {
    const data = asRecord(asRecord(part)?.data);
    if (!data) continue;
    return {
      hasOpportunity: typeof data.hasOpportunity === 'boolean' ? data.hasOpportunity : undefined,
      reason: stringField(data.reason) ?? undefined,
    };
  }
  return {};
}

export function transformUsers(secret: string, users: RawUser[]) {
  return users.map((user) => ({
    user_id: hmacId(secret, 'user', user.id),
    created_at: unix(user.createdAt),
    deleted: user.deletedAt != null,
  }));
}

export function transformIntents(secret: string, intents: RawIntent[], terms: string[]) {
  return intents.map((intent) => ({
    intent_id: hmacId(secret, 'intent', intent.id),
    user_id: hmacId(secret, 'user', intent.userId),
    payload: redactText(intent.payload, terms),
    summary: redactText(intent.summary, terms),
    status: intent.status,
    is_incognito: intent.isIncognito,
    created_at: unix(intent.createdAt),
    updated_at: unix(intent.updatedAt),
    archived_at: unix(intent.archivedAt),
  }));
}

export function transformOpportunities(secret: string, opportunities: RawOpportunity[], terms: string[]) {
  return opportunities.map((opportunity) => ({
    opportunity_id: hmacId(secret, 'opp', opportunity.id),
    status: opportunity.status,
    confidence: Number(opportunity.confidence),
    created_at: unix(opportunity.createdAt),
    updated_at: unix(opportunity.updatedAt),
    expires_at: unix(opportunity.expiresAt),
    accepted_by: hmacIdOrNull(secret, 'user', opportunity.acceptedBy),
    detection_source: opportunity.detection?.source ?? null,
    triggered_by_intent_id: hmacIdOrNull(secret, 'intent', opportunity.detection?.triggeredBy),
    network_id: hmacIdOrNull(secret, 'network', opportunity.context?.networkId),
    actors: (opportunity.actors ?? []).map((actor) => ({
      user_id: hmacIdOrNull(secret, 'user', actor.userId),
      intent_id: hmacIdOrNull(secret, 'intent', actor.intent),
      role: actor.role ?? null,
      acted_at: actor.actedAt ?? null,
      approved: actor.approved ?? null,
    })),
    category: opportunity.interpretation?.category ?? null,
    reasoning: redactText(opportunity.interpretation?.reasoning, terms),
  }));
}

export function transformNegotiations(
  secret: string,
  tasks: RawNegotiationTask[],
  messages: RawNegotiationMessage[],
  artifacts: RawArtifact[],
  terms: string[],
) {
  const messagesByTask = new Map<string, RawNegotiationMessage[]>();
  for (const message of messages) {
    const list = messagesByTask.get(message.taskId) ?? [];
    list.push(message);
    messagesByTask.set(message.taskId, list);
  }
  const artifactsByTask = new Map<string, RawArtifact>();
  for (const artifact of artifacts) {
    if (artifact.name === 'negotiation-outcome') artifactsByTask.set(artifact.taskId, artifact);
  }

  return tasks.map((task) => {
    const thread = (messagesByTask.get(task.id) ?? [])
      .slice()
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
    const outcome = artifactOutcome(artifactsByTask.get(task.id)?.parts);
    return {
      conversation_id: hmacId(secret, 'session', task.conversationId),
      opportunity_id: hmacIdOrNull(secret, 'opp', task.metadata.opportunityId),
      source_user_id: hmacIdOrNull(secret, 'user', task.metadata.sourceUserId),
      candidate_user_id: hmacIdOrNull(secret, 'user', task.metadata.candidateUserId),
      started_at: unix(task.createdAt),
      task_state: task.state,
      outcome_has_opportunity: outcome.hasOpportunity ?? null,
      outcome_reason: outcome.reason ?? null,
      messages: thread.map((message, seq) => {
        const turn = extractTurn(message.parts);
        const speaker = speakerUserId(message.senderId);
        return {
          seq,
          timestamp: unix(message.createdAt),
          role: 'agent' as const,
          speaker_user_id: hmacIdOrNull(secret, 'user', speaker),
          verb: turn.verb,
          text: redactText(turn.text, terms) ?? '',
        };
      }),
    };
  });
}

export function countBy<T>(rows: T[], key: (row: T) => string | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const value = key(row) ?? 'unknown';
    out[value] = (out[value] ?? 0) + 1;
  }
  return out;
}

export function buildMetrics(input: {
  networkTitle: string;
  networkIdKind: IdKind;
  networkRawId: string;
  secret: string;
  users: ReturnType<typeof transformUsers>;
  intents: ReturnType<typeof transformIntents>;
  opportunities: ReturnType<typeof transformOpportunities>;
  negotiations: ReturnType<typeof transformNegotiations>;
}) {
  const pauseCounts: Record<string, number> = {};
  let continueTurns = 0;
  for (const negotiation of input.negotiations) {
    for (const message of negotiation.messages) {
      if (message.verb === 'pause') {
        const reason = message.text.startsWith('pause:') ? message.text.slice('pause:'.length) : 'pause';
        pauseCounts[reason] = (pauseCounts[reason] ?? 0) + 1;
      } else if (message.verb) {
        continueTurns += 1;
      }
    }
  }
  return {
    network_title: input.networkTitle,
    network_id: hmacId(input.secret, input.networkIdKind, input.networkRawId),
    exported_at: new Date().toISOString(),
    users: input.users.length,
    intents: input.intents.length,
    opportunities: input.opportunities.length,
    opportunities_by_status: countBy(input.opportunities, (row) => row.status),
    opportunities_with_actor_action: input.opportunities.filter((row) => row.actors.some((actor) => actor.acted_at)).length,
    negotiations: input.negotiations.length,
    negotiations_by_task_state: countBy(input.negotiations, (row) => row.task_state),
    negotiations_screened_out: input.negotiations.filter((row) => row.outcome_reason === 'screened_out').length,
    negotiations_with_opportunity: input.negotiations.filter((row) => row.outcome_has_opportunity === true).length,
    negotiation_continue_turns: continueTurns,
    negotiation_pauses_by_reason: pauseCounts,
  };
}

export function renderDatasetCard(metrics: ReturnType<typeof buildMetrics>): string {
  return `# Index matching export (Edge Esmeralda)

This private dataset contains privacy-reduced Index Network matching records for the Edge Esmeralda program: users, intents, opportunities, and agent-to-agent negotiation transcripts.

It is intended for authorized research on matching and negotiation behavior. It is not intended for identity inference, contact discovery, profiling of individuals, or attempts to reverse anonymization.

## Files

- \`users.jsonl\` — pseudonymous user ids and timestamps only
- \`intents.jsonl\` — privacy-reduced intent text
- \`opportunities.jsonl\` — match records with status, actors, and privacy-reduced reasoning
- \`negotiations.jsonl\` — one agent-to-agent thread per row (Hugging Face conversation envelope plus Index ids)
- \`metrics.json\` — aggregate counts

## Identifiers

Tenant/user/conversation identifiers are stable HMAC-SHA256 pseudonyms generated for this dump (\`user_\`, \`intent_\`, \`opp_\`, \`session_\`, \`network_\`). Raw platform identifiers are not included.

This HMAC namespace is **not** the Hermes conversation namespace used by \`jshph/agentvillage-sanitized-conversations-edge-esmeralda-2026\`. Do not join \`user_*\` to that dataset's \`tenant_*\` values.

## Privacy processing

Deterministic reduction only: known-identifier dictionary (names, emails, handles, keys, bios, Telegram chat ids), regex redaction of email/URL/handle/phone/credential shapes, and UUID stripping. Negotiation briefs and pause payloads are dropped. Embeddings, contact fields, and human chat transcripts are not exported.

No claim of complete anonymization is made. Unusual semantic context can remain quasi-identifying. Timestamps are retained for ordering and may contribute to reidentification risk when combined with outside information.

## Access

Restricted-use research only. Do not identify or contact participants, link pseudonyms to external identities, publish message-level examples without an additional privacy review, or redistribute identifiable material.

## Counts

- Users: ${metrics.users}
- Intents: ${metrics.intents}
- Opportunities: ${metrics.opportunities}
- Negotiations: ${metrics.negotiations}
- Opportunities by status: ${JSON.stringify(metrics.opportunities_by_status)}
- Negotiations by task state: ${JSON.stringify(metrics.negotiations_by_task_state)}
- Screened out: ${metrics.negotiations_screened_out}
- Matches accepted (opportunity status accepted): ${metrics.opportunities_by_status.accepted ?? 0}
- Matches rejected (opportunity status rejected): ${metrics.opportunities_by_status.rejected ?? 0}
`;
}
