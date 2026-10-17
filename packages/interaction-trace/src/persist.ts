import type { Sql } from './db.ts';
import type { TraceRecord } from './record.ts';

export async function persistRecord(sql: Sql, record: TraceRecord): Promise<void> {
  const { interaction } = record;
  await sql.begin(async (tx) => {
    await tx`delete from trace.interaction where id = ${interaction.id}`;
    await tx`
      insert into trace.interaction (id, opportunity_id, source, purpose, agent_verdict, turn_count, opened_at, annotator, schema_version)
      values (${interaction.id}, ${interaction.opportunityId}, ${interaction.source}, ${interaction.purpose}, ${interaction.agentVerdict},
        ${interaction.turnCount}, ${interaction.openedAt}, ${interaction.annotator}, ${interaction.schemaVersion})
    `;

    const statementIds: number[] = [];
    for (const statement of record.statements) {
      const rows = await tx<{ id: string }[]>`
        insert into trace.statement (interaction_id, principal, source, kind, quote)
        values (${interaction.id}, ${statement.principal}, ${statement.source}, ${statement.kind}, ${statement.quote})
        returning id
      `;
      statementIds.push(Number(rows[0]!.id));
    }

    for (const row of record.fidelity) {
      await tx`
        insert into trace.fidelity (interaction_id, principal, utterance_quote, stored_intent_quote, agent_claim_quote, added_terms, dropped_terms, narrowed_terms, drift_score)
        values (${interaction.id}, ${row.principal}, ${row.utteranceQuote}, ${row.storedIntentQuote}, ${row.agentClaimQuote},
          ${tx.array(row.addedTerms)}, ${tx.array(row.droppedTerms)}, ${tx.array(row.narrowedTerms)}, ${row.driftScore})
      `;
    }

    for (const act of record.turnActs) {
      await tx`
        insert into trace.turn_act (interaction_id, turn_index, seat, protocol_action, performative, commitment_level, authority_verdict, authority_reason, quote)
        values (${interaction.id}, ${act.turnIndex}, ${act.seat}, ${act.protocolAction}, ${act.performative}, ${act.commitmentLevel},
          ${act.authorityVerdict}, ${act.authorityReason}, ${act.quote})
      `;
    }

    for (const claim of record.claims) {
      const derivedFrom = claim.statementIndex === null ? null : statementIds[claim.statementIndex] ?? null;
      await tx`
        insert into trace.claim (interaction_id, turn_index, seat, derived_from, status, claim, quote)
        values (${interaction.id}, ${claim.turnIndex}, ${claim.seat}, ${derivedFrom}, ${claim.status}, ${claim.claim}, ${claim.quote})
      `;
    }

    for (const delta of record.termDeltas) {
      await tx`
        insert into trace.term_delta (interaction_id, turn_index, seat, term, change, detail)
        values (${interaction.id}, ${delta.turnIndex}, ${delta.seat}, ${delta.term}, ${delta.change}, ${delta.detail})
      `;
    }

    const findingIds: number[] = [];
    for (const finding of record.findings) {
      const rows = await tx<{ id: string }[]>`
        insert into trace.finding (interaction_id, turn_index, layer, kind, owasp_ref, atlas_ref, affected_terms, agent_response, within_authority, effect, quote)
        values (${interaction.id}, ${finding.turnIndex}, ${finding.layer}, ${finding.kind}, ${finding.owaspRef}, ${finding.atlasRef},
          ${finding.affectedTerms}, ${finding.agentResponse}, ${finding.withinAuthority}, ${finding.effect}, ${finding.quote})
        returning id
      `;
      findingIds.push(Number(rows[0]!.id));
    }

    const outcome = record.outcome;
    const causeId = outcome.causeFindingIndex === null ? null : findingIds[outcome.causeFindingIndex] ?? null;
    await tx`
      insert into trace.outcome (interaction_id, agent_verdict, human_outcome, outcome_class, cause_finding_id, rationale, hours_to_first_commit)
      values (${interaction.id}, ${outcome.agentVerdict}, ${outcome.humanOutcome}, ${outcome.outcomeClass}, ${causeId}, ${outcome.rationale}, ${outcome.hoursToFirstCommit})
    `;
  });
}
