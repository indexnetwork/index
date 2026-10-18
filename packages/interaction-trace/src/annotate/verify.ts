import { SCHEMA_VERSION } from '../schema.ts';
import type { ActsOutput, FidelityOutput, FindingsOutput, MandateOutput, Seat, TraceInput } from '../schema.ts';
import type { ClaimRow, DroppedAnnotation, FidelityRow, FindingRow, StatementRow, TermDeltaRow, TraceRecord, TurnActRow } from '../record.ts';
import { buildSources, deriveOutcomeClass, normalizeForMatch, quoteInText } from '../sources.ts';
import type { Source } from '../sources.ts';
import { taxonomyFor } from '../taxonomy.ts';

export interface LayerOutputs {
  annotator: string;
  mandate: MandateOutput;
  fidelity: FidelityOutput;
  acts: ActsOutput;
  findings: FindingsOutput;
}

const DEFAULT_PERFORMATIVE: Record<string, string> = {
  propose: 'propose',
  counter: 'propose',
  accept: 'accept-proposal',
  decline: 'reject-proposal',
};

const DEFAULT_COMMITMENT: Record<string, string> = {
  propose: 'tentative',
  counter: 'tentative',
  accept: 'binding',
  decline: 'explore',
};

const COUNTER_PERFORMATIVES = new Set(['propose', 'query-if', 'inform', 'refuse']);

function findIn(sources: Source[], quote: string, predicate: (source: Source) => boolean): Source | null {
  return sources.find((source) => predicate(source) && quoteInText(quote, source.text)) ?? null;
}

function overlaps(a: string, b: string): boolean {
  const left = normalizeForMatch(a);
  const right = normalizeForMatch(b);
  return left.length >= 4 && right.length >= 4 && (left.includes(right) || right.includes(left));
}

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 240 ? `${flat.slice(0, 237)}...` : flat;
}

export function verifyAnnotations(trace: TraceInput, outputs: LayerOutputs): TraceRecord {
  const sources = buildSources(trace);
  const dropped: DroppedAnnotation[] = [];
  const drop = (layer: string, reason: string, quote: string | null) => dropped.push({ layer, reason, quote });
  const turnByIndex = new Map(trace.turns.map((turn) => [turn.index, turn]));
  const principalSource = (seat: Seat) => (source: Source) => source.seat === seat && source.kind !== 'turn' && source.kind !== 'agent_note';
  const emitted = {
    mandate: outputs.mandate.statements.length,
    fidelity: outputs.fidelity.fidelity.length,
    acts: outputs.acts.acts.length,
    claims: outputs.acts.claims.length,
    termDeltas: outputs.acts.termDeltas.length,
    findings: outputs.findings.findings.length,
  };

  const statements: StatementRow[] = [];
  const seenStatements = new Set<string>();
  for (const item of outputs.mandate.statements) {
    const hit = findIn(sources, item.quote, (source) => source.seat === item.principal && source.kind === item.source);
    if (!hit) {
      drop('mandate', `quote not found in ${item.source} of principal ${item.principal}`, item.quote);
      continue;
    }
    const key = `${item.principal}|${item.kind}|${normalizeForMatch(item.quote)}`;
    if (seenStatements.has(key)) continue;
    seenStatements.add(key);
    statements.push({ principal: item.principal, source: item.source, kind: item.kind, quote: item.quote });
  }

  const fidelity: FidelityRow[] = [];
  const seenFidelity = new Set<Seat>();
  for (const item of outputs.fidelity.fidelity) {
    if (seenFidelity.has(item.principal)) {
      drop('fidelity', `duplicate fidelity row for principal ${item.principal}`, null);
      continue;
    }
    const quotes = [item.utteranceQuote, item.storedIntentQuote, item.agentClaimQuote];
    if (quotes.every((quote) => quote === null)) {
      drop('fidelity', 'no evidence quote', null);
      continue;
    }
    const checks: [string | null, (source: Source) => boolean, string][] = [
      [item.utteranceQuote, (source) => source.seat === item.principal && (source.kind === 'conversation' || source.kind === 'intent' || source.kind === 'profile'), 'utterance'],
      [item.storedIntentQuote, (source) => source.seat === item.principal && source.kind === 'intent', 'stored intent'],
      [item.agentClaimQuote, (source) => source.seat === item.principal && (source.kind === 'turn' || source.kind === 'agent_note'), 'agent claim'],
    ];
    const failed = checks.find(([quote, predicate]) => quote !== null && !findIn(sources, quote, predicate));
    if (failed) {
      drop('fidelity', `${failed[2]} quote not found for principal ${item.principal}`, failed[0]);
      continue;
    }
    seenFidelity.add(item.principal);
    fidelity.push({
      principal: item.principal,
      utteranceQuote: item.utteranceQuote,
      storedIntentQuote: item.storedIntentQuote,
      agentClaimQuote: item.agentClaimQuote,
      addedTerms: item.addedTerms,
      droppedTerms: item.droppedTerms,
      narrowedTerms: item.narrowedTerms,
      driftScore: item.driftScore,
    });
  }

  const annotatedActs = new Map<number, ActsOutput['acts'][number]>();
  for (const act of outputs.acts.acts) {
    const turn = turnByIndex.get(act.turnIndex);
    if (!turn) {
      drop('acts', `turn ${act.turnIndex} does not exist`, act.quote);
      continue;
    }
    if (!quoteInText(act.quote, turn.message)) {
      drop('acts', `quote not found in turn ${act.turnIndex}`, act.quote);
      continue;
    }
    if (annotatedActs.has(act.turnIndex)) {
      drop('acts', `duplicate act for turn ${act.turnIndex}`, act.quote);
      continue;
    }
    annotatedActs.set(act.turnIndex, act);
  }
  const turnActs: TurnActRow[] = trace.turns.map((turn) => {
    const act = annotatedActs.get(turn.index);
    const defaultPerformative = DEFAULT_PERFORMATIVE[turn.action] ?? 'propose';
    if (!act) {
      return {
        turnIndex: turn.index,
        seat: turn.seat,
        protocolAction: turn.action,
        performative: defaultPerformative,
        commitmentLevel: DEFAULT_COMMITMENT[turn.action] ?? 'tentative',
        authorityVerdict: 'unclear',
        authorityReason: 'not annotated',
        quote: excerpt(turn.message),
        annotated: false,
      };
    }
    let performative = defaultPerformative;
    if (act.performative && act.performative !== defaultPerformative) {
      if (turn.action === 'counter' && COUNTER_PERFORMATIVES.has(act.performative)) performative = act.performative;
      else drop('acts', `performative ${act.performative} not allowed for protocol action ${turn.action}`, act.quote);
    }
    return {
      turnIndex: turn.index,
      seat: turn.seat,
      protocolAction: turn.action,
      performative,
      commitmentLevel: act.commitmentLevel,
      authorityVerdict: act.authorityVerdict,
      authorityReason: act.authorityReason,
      quote: act.quote,
      annotated: true,
    };
  });

  const claims: ClaimRow[] = [];
  for (const item of outputs.acts.claims) {
    const turn = turnByIndex.get(item.turnIndex);
    if (!turn) {
      drop('claims', `turn ${item.turnIndex} does not exist`, item.quote);
      continue;
    }
    if (!quoteInText(item.quote, turn.message)) {
      drop('claims', `quote not found in turn ${item.turnIndex}`, item.quote);
      continue;
    }
    let statementIndex: number | null = null;
    if (item.status === 'supported') {
      if (!item.derivedFromQuote || !findIn(sources, item.derivedFromQuote, principalSource(turn.seat))) {
        drop('claims', 'supported claim has no verifiable principal source', item.derivedFromQuote);
        continue;
      }
      const derivedFrom = item.derivedFromQuote;
      const index = statements.findIndex((statement) => statement.principal === turn.seat && overlaps(statement.quote, derivedFrom));
      if (index < 0) {
        drop('claims', 'supported claim does not match any verified mandate statement', item.derivedFromQuote);
        continue;
      }
      statementIndex = index;
    }
    claims.push({ turnIndex: item.turnIndex, seat: turn.seat, statementIndex, status: item.status, claim: item.claim, quote: item.quote });
  }

  const termDeltas: TermDeltaRow[] = [];
  for (const item of outputs.acts.termDeltas) {
    const turn = turnByIndex.get(item.turnIndex);
    if (!turn) {
      drop('termDeltas', `turn ${item.turnIndex} does not exist`, null);
      continue;
    }
    const retrospective = item.change === 'dropped' || item.change === 'conceded';
    const grounded = retrospective
      ? findIn(sources, item.term, (source) => source.seat === turn.seat || (source.kind === 'turn' && (source.turnIndex ?? 0) <= item.turnIndex)) !== null
      : quoteInText(item.term, turn.message);
    if (!grounded) {
      drop('termDeltas', retrospective ? `${item.change} term not found in earlier turns or principal ${turn.seat} sources` : `term not found in turn ${item.turnIndex}`, item.term);
      continue;
    }
    termDeltas.push({ turnIndex: item.turnIndex, seat: turn.seat, term: item.term, change: item.change, detail: item.detail });
  }

  const findings: FindingRow[] = [];
  for (const item of outputs.findings.findings) {
    const turn = turnByIndex.get(item.turnIndex);
    if (!turn) {
      drop('findings', `turn ${item.turnIndex} does not exist`, item.quote);
      continue;
    }
    if (!quoteInText(item.quote, turn.message)) {
      drop('findings', `quote not found in turn ${item.turnIndex}`, item.quote);
      continue;
    }
    const ref = taxonomyFor(item.kind);
    findings.push({
      turnIndex: item.turnIndex,
      layer: item.layer,
      kind: item.kind,
      owaspRef: ref.owasp,
      atlasRef: ref.atlas,
      affectedTerms: item.affectedTerms,
      agentResponse: item.agentResponse,
      withinAuthority: item.withinAuthority,
      effect: item.effect,
      quote: item.quote,
    });
  }

  const missedQuote = outputs.findings.missedOpportunityQuote;
  let missedEvidence = false;
  if (missedQuote) {
    missedEvidence = trace.turns.some((turn) => quoteInText(missedQuote, turn.message));
    if (!missedEvidence) drop('outcome', 'missed-opportunity quote not found in any turn', missedQuote);
    else if (trace.agentVerdict === 'agreed' || trace.agentVerdict === 'open') {
      missedEvidence = false;
      drop('outcome', 'missed-opportunity applies only when the agents declined or closed', missedQuote);
    }
  }

  const causeIndex = findings.findIndex((finding) => finding.agentResponse !== 'held' && !finding.withinAuthority);
  const fallbackIndex = findings.findIndex((finding) => finding.agentResponse === 'yielded');
  const outcomeClass = deriveOutcomeClass(trace.agentVerdict, trace.humanOutcome, missedEvidence);

  return {
    interaction: {
      id: trace.interactionId,
      opportunityId: trace.opportunityId,
      source: trace.source,
      purpose: excerpt(trace.purpose),
      agentVerdict: trace.agentVerdict,
      turnCount: trace.turns.length,
      openedAt: trace.openedAt,
      annotator: outputs.annotator,
      schemaVersion: SCHEMA_VERSION,
    },
    statements,
    fidelity,
    turnActs,
    claims,
    termDeltas,
    findings,
    outcome: {
      agentVerdict: trace.agentVerdict,
      humanOutcome: trace.humanOutcome,
      outcomeClass,
      causeFindingIndex: outcomeClass === 'confirmed_fit' || outcomeClass === 'unresolved' ? null : (causeIndex >= 0 ? causeIndex : (fallbackIndex >= 0 ? fallbackIndex : null)),
      rationale: outputs.findings.outcomeRationale,
      hoursToFirstCommit: trace.hoursToFirstCommit,
    },
    dropped,
    emitted,
  };
}
