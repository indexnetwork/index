import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const DS = { type: 'grafana-postgresql-datasource', uid: 'index-trace' };

type Json = Record<string, unknown>;

const SOURCE_FILTER = "i.source in ($source)";

function target(sql: string, format: 'table' | 'time_series' = 'table'): Json {
  return { refId: 'A', datasource: DS, format, rawQuery: true, editorMode: 'code', rawSql: sql };
}

function colorMap(colors: Record<string, string>): Json {
  const options: Json = {};
  Object.entries(colors).forEach(([text, color], index) => {
    options[text] = { text, color, index };
  });
  return { type: 'value', options };
}

const AUTHORITY = colorMap({ within: 'green', unclear: 'yellow', exceeded: 'red' });
const COMMITMENT = colorMap({ explore: 'blue', tentative: 'light-blue', conditional: 'orange', binding: 'purple' });
const CLAIM = colorMap({ supported: 'green', unsupported: 'yellow', contradicted: 'red', out_of_scope: 'orange' });
const RESPONSE = colorMap({ held: 'green', partial: 'yellow', yielded: 'red' });
const OUTCOME_CLASS = colorMap({ confirmed_fit: 'green', assessment_failure: 'red', missed_opportunity: 'orange', unresolved: 'text' });

function coloredColumn(name: string, mapping: Json): Json {
  return {
    matcher: { id: 'byName', options: name },
    properties: [
      { id: 'mappings', value: [mapping] },
      { id: 'custom.cellOptions', value: { type: 'color-background', mode: 'basic' } },
    ],
  };
}

function wideColumn(name: string, width: number): Json {
  return { matcher: { id: 'byName', options: name }, properties: [{ id: 'custom.width', value: width }] };
}

function drillLink(name: string): Json {
  return {
    matcher: { id: 'byName', options: name },
    properties: [{ id: 'links', value: [{ title: 'Open interaction', url: '/d/index-trace-drill?var-interaction=${__value.raw}', targetBlank: false }] }],
  };
}

function panelBase(id: number, type: string, title: string, x: number, y: number, w: number, h: number): Json {
  return { id, type, title, datasource: DS, gridPos: { x, y, w, h } };
}

function stat(id: number, title: string, sql: string, x: number, y: number, w = 4, unit = 'short', text = false): Json {
  return {
    ...panelBase(id, 'stat', title, x, y, w, 4),
    fieldConfig: { defaults: { unit, decimals: unit === 'percentunit' ? 0 : undefined }, overrides: [] },
    options: { reduceOptions: { calcs: ['lastNotNull'], fields: '', values: false }, colorMode: 'none', textMode: text ? 'value' : 'auto' },
    targets: [target(sql)],
  };
}

function table(id: number, title: string, sql: string, x: number, y: number, w: number, h: number, overrides: Json[] = []): Json {
  return {
    ...panelBase(id, 'table', title, x, y, w, h),
    fieldConfig: { defaults: { custom: { cellOptions: { type: 'auto', wrapText: true }, filterable: true } }, overrides },
    options: { showHeader: true, cellHeight: 'lg' },
    targets: [target(sql)],
  };
}

function pie(id: number, title: string, sql: string, x: number, y: number, w: number, h: number, mapping?: Json): Json {
  return {
    ...panelBase(id, 'piechart', title, x, y, w, h),
    fieldConfig: { defaults: mapping ? { mappings: [mapping] } : {}, overrides: [] },
    options: { pieType: 'donut', legend: { displayMode: 'table', placement: 'right', values: ['value', 'percent'] }, reduceOptions: { calcs: ['lastNotNull'], fields: '', values: true } },
    targets: [target(sql)],
  };
}

function stackedBars(id: number, title: string, sql: string, x: number, y: number, w: number, h: number, mapping?: Json): Json {
  return {
    ...panelBase(id, 'barchart', title, x, y, w, h),
    fieldConfig: { defaults: mapping ? { mappings: [mapping] } : {}, overrides: [] },
    options: { orientation: 'auto', stacking: 'normal', legend: { displayMode: 'list', placement: 'bottom' }, xTickLabelRotation: 0, showValue: 'auto' },
    targets: [target(sql)],
  };
}

function text(id: number, title: string, content: string, x: number, y: number, w: number, h: number): Json {
  return { id, type: 'text', title, gridPos: { x, y, w, h }, options: { mode: 'markdown', content } };
}

const SOURCE_VAR: Json = {
  name: 'source',
  label: 'Source',
  type: 'query',
  datasource: DS,
  query: 'select distinct source from trace.interaction order by 1',
  refresh: 1,
  multi: true,
  includeAll: true,
  allowCustomValue: false,
  current: { text: 'All', value: '$__all' },
};

function dashboard(uid: string, title: string, panels: Json[], variables: Json[]): Json {
  return {
    uid,
    title,
    tags: ['index', 'trace'],
    timezone: 'utc',
    schemaVersion: 39,
    version: 1,
    refresh: '',
    time: { from: 'now-30d', to: 'now' },
    timepicker: { hidden: true },
    panels,
    templating: { list: variables },
  };
}

const LIMITS = `**What this board cannot show yet**

- The context each agent held at every turn is not recorded. Fidelity is inferred from the stored intent, profile and the principal's own messages, so a drift score is evidence, not proof.
- The reason a principal declined after an introduction is not recorded. An *assessment failure* means the agents agreed and the human did not; it does not say why.
- Annotations come from a named annotator (see the annotator column). Every quote was checked against the source text; rows whose quote did not verify are never stored.
- Findings are labelled with OWASP Top 10 for LLM Applications 2025 and MITRE ATLAS ids. Mappings marked approximate in the package taxonomy name the closest class, not an exact match.
- Real-case text is pseudonymized by name only. Handles, links and free-text details can remain.`;

const overview = dashboard('index-trace-overview', 'Interaction trace: overview', [
  stat(1, 'Interactions annotated', `select count(*) as value from trace.interaction i where ${SOURCE_FILTER}`, 0, 0),
  stat(2, 'Assessment failure rate (failures / (failures + confirmed fits))', `select count(*) filter (where o.outcome_class = 'assessment_failure')::float / nullif(count(*) filter (where o.outcome_class in ('assessment_failure', 'confirmed_fit')), 0) as value from trace.interaction i join trace.outcome o on o.interaction_id = i.id where ${SOURCE_FILTER}`, 4, 0, 5, 'percentunit'),
  stat(3, 'Turns where the agent exceeded authority', `select count(*) as value from trace.turn_act a join trace.interaction i on i.id = a.interaction_id where a.authority_verdict = 'exceeded' and ${SOURCE_FILTER}`, 9, 0, 5),
  stat(4, 'Findings', `select count(*) as value from trace.finding f join trace.interaction i on i.id = f.interaction_id where ${SOURCE_FILTER}`, 14, 0, 4),
  stat(5, 'Findings the agent yielded to', `select count(*) filter (where f.agent_response = 'yielded')::float / nullif(count(*), 0) as value from trace.finding f join trace.interaction i on i.id = f.interaction_id where ${SOURCE_FILTER}`, 18, 0, 6, 'percentunit'),
  pie(6, 'Outcome class', `select o.outcome_class, count(*) as interactions from trace.outcome o join trace.interaction i on i.id = o.interaction_id where ${SOURCE_FILTER} group by 1 order by 2 desc`, 0, 4, 8, 8, OUTCOME_CLASS),
  stackedBars(7, 'Findings by kind and agent response', `select f.kind, count(*) filter (where f.agent_response = 'held') as held, count(*) filter (where f.agent_response = 'partial') as partial, count(*) filter (where f.agent_response = 'yielded') as yielded from trace.finding f join trace.interaction i on i.id = f.interaction_id where ${SOURCE_FILTER} group by 1 order by 1`, 8, 4, 10, 8),
  stackedBars(8, 'Findings by layer', `select f.layer, count(*) as findings from trace.finding f join trace.interaction i on i.id = f.interaction_id where ${SOURCE_FILTER} group by 1 order by 1`, 18, 4, 6, 8),
  stackedBars(9, 'Fidelity drift (0 faithful, 1 unrelated)', `select case when b = 5 then '0.8 to 1.0' else concat((b * 0.2)::numeric(2,1), ' to ', ((b + 1) * 0.2)::numeric(2,1)) end as drift, count(*) as principals from (select least(floor(f.drift_score * 5), 5)::int as b from trace.fidelity f join trace.interaction i on i.id = f.interaction_id where ${SOURCE_FILTER}) x group by b order by b`, 0, 12, 8, 7),
  stackedBars(10, 'Outcome class by agent verdict', `select o.agent_verdict, count(*) filter (where o.outcome_class = 'confirmed_fit') as confirmed_fit, count(*) filter (where o.outcome_class = 'assessment_failure') as assessment_failure, count(*) filter (where o.outcome_class = 'missed_opportunity') as missed_opportunity, count(*) filter (where o.outcome_class = 'unresolved') as unresolved from trace.outcome o join trace.interaction i on i.id = o.interaction_id where ${SOURCE_FILTER} group by 1 order by 1`, 8, 12, 8, 7),
  text(11, 'Limits of this board', LIMITS, 16, 12, 8, 7),
  table(12, 'Interactions (click an id to open the drill-down)', `select i.id as interaction, i.source, i.annotator, i.turn_count as turns, o.agent_verdict, o.human_outcome, o.outcome_class, (select count(*) from trace.finding f where f.interaction_id = i.id) as findings, (select count(*) from trace.turn_act a where a.interaction_id = i.id and a.authority_verdict = 'exceeded') as authority_exceeded, (select max(drift_score) from trace.fidelity d where d.interaction_id = i.id) as max_drift, left(i.purpose, 140) as purpose from trace.interaction i join trace.outcome o on o.interaction_id = i.id where ${SOURCE_FILTER} order by i.annotated_at desc, i.id`, 0, 19, 24, 11, [drillLink('interaction'), coloredColumn('outcome_class', OUTCOME_CLASS), wideColumn('interaction', 300), wideColumn('purpose', 380)]),
], [SOURCE_VAR]);

const INTERACTION_VAR: Json = {
  name: 'interaction',
  label: 'Interaction',
  type: 'query',
  datasource: DS,
  query: "select i.id as __value, concat(i.source, ' | ', o.outcome_class, ' | ', left(i.purpose, 60), ' | ', left(i.id, 8)) as __text from trace.interaction i join trace.outcome o on o.interaction_id = i.id order by i.annotated_at desc, i.id",
  refresh: 1,
  multi: false,
  includeAll: false,
  allowCustomValue: false,
  sort: 0,
};

const drill = dashboard('index-trace-drill', 'Interaction trace: drill-down', [
  stat(1, 'Agent verdict', `select agent_verdict as value from trace.outcome where interaction_id = '$interaction'`, 0, 0, 4, 'short', true),
  stat(2, 'Human outcome', `select human_outcome as value from trace.outcome where interaction_id = '$interaction'`, 4, 0, 4, 'short', true),
  stat(3, 'Outcome class', `select outcome_class as value from trace.outcome where interaction_id = '$interaction'`, 8, 0, 4, 'short', true),
  stat(4, 'Turns', `select turn_count as value from trace.interaction where id = '$interaction'`, 12, 0, 3),
  stat(5, 'Findings', `select count(*) as value from trace.finding where interaction_id = '$interaction'`, 15, 0, 3),
  stat(6, 'Hours from agreement to first commit', `select hours_to_first_commit as value from trace.outcome where interaction_id = '$interaction'`, 18, 0, 3, 'h'),
  stat(7, 'Annotator', `select annotator as value from trace.interaction where id = '$interaction'`, 21, 0, 3, 'short', true),
  table(8, 'Outcome against purpose', `select o.outcome_class, o.human_outcome, o.rationale as annotator_note, f.kind as linked_finding, f.agent_response as linked_response, i.purpose as stated_purpose from trace.outcome o join trace.interaction i on i.id = o.interaction_id left join trace.finding f on f.id = o.cause_finding_id where o.interaction_id = '$interaction'`, 0, 4, 24, 5, [coloredColumn('outcome_class', OUTCOME_CLASS), coloredColumn('linked_response', RESPONSE)]),
  table(9, 'Mandate: what each principal said and allowed', `select principal, source, kind, quote from trace.statement where interaction_id = '$interaction' order by principal, id`, 0, 9, 12, 10, [wideColumn('principal', 80), wideColumn('source', 110), wideColumn('kind', 150)]),
  table(10, 'Fidelity: principal words, stored intent and agent claim', `select principal, round(drift_score, 2) as drift, utterance_quote as principal_said, stored_intent_quote as stored_intent, agent_claim_quote as agent_claimed, array_to_string(added_terms, '; ') as added, array_to_string(dropped_terms, '; ') as dropped, array_to_string(narrowed_terms, '; ') as narrowed from trace.fidelity where interaction_id = '$interaction' order by principal`, 12, 9, 12, 10, [wideColumn('principal', 80), wideColumn('drift', 70)]),
  table(11, 'Turn log: act, commitment and authority per seat', `select a.turn_index as turn, a.seat, a.protocol_action as action, a.performative, a.commitment_level as commitment, a.authority_verdict as authority, a.authority_reason, a.quote from trace.turn_act a where a.interaction_id = '$interaction' order by a.turn_index`, 0, 19, 24, 12, [coloredColumn('authority', AUTHORITY), coloredColumn('commitment', COMMITMENT), wideColumn('turn', 60), wideColumn('seat', 60), wideColumn('action', 90), wideColumn('performative', 130), wideColumn('commitment', 110), wideColumn('authority', 100), wideColumn('authority_reason', 320)]),
  table(12, 'Claims against principal statements', `select c.turn_index as turn, c.seat, c.status, c.claim, c.quote as said_in_turn, s.quote as derived_from from trace.claim c left join trace.statement s on s.id = c.derived_from where c.interaction_id = '$interaction' order by c.turn_index, c.id`, 0, 31, 14, 10, [coloredColumn('status', CLAIM), wideColumn('turn', 60), wideColumn('seat', 60), wideColumn('status', 110)]),
  table(13, 'Term changes', `select turn_index as turn, seat, change, term, detail from trace.term_delta where interaction_id = '$interaction' order by turn_index`, 14, 31, 10, 10, [wideColumn('turn', 60), wideColumn('seat', 60)]),
  table(14, 'Findings with evidence', `select f.turn_index as turn, f.layer, f.kind, f.owasp_ref, f.atlas_ref, f.agent_response as response, f.within_authority, f.affected_terms, f.effect, f.quote from trace.finding f where f.interaction_id = '$interaction' order by f.turn_index, f.id`, 0, 41, 24, 9, [coloredColumn('response', RESPONSE), wideColumn('turn', 60), wideColumn('response', 100)]),
], [INTERACTION_VAR]);

const adversarial = dashboard('index-trace-adversarial', 'Interaction trace: adversarial situations', [
  stat(1, 'Findings', `select count(*) as value from trace.finding f join trace.interaction i on i.id = f.interaction_id where ${SOURCE_FILTER}`, 0, 0, 4),
  stat(2, 'Held', `select count(*) as value from trace.finding f join trace.interaction i on i.id = f.interaction_id where f.agent_response = 'held' and ${SOURCE_FILTER}`, 4, 0, 4),
  stat(3, 'Partial', `select count(*) as value from trace.finding f join trace.interaction i on i.id = f.interaction_id where f.agent_response = 'partial' and ${SOURCE_FILTER}`, 8, 0, 4),
  stat(4, 'Yielded', `select count(*) as value from trace.finding f join trace.interaction i on i.id = f.interaction_id where f.agent_response = 'yielded' and ${SOURCE_FILTER}`, 12, 0, 4),
  stat(5, 'Outside the agent mandate', `select count(*) as value from trace.finding f join trace.interaction i on i.id = f.interaction_id where not f.within_authority and ${SOURCE_FILTER}`, 16, 0, 4),
  stat(6, 'Interactions with a finding', `select count(distinct f.interaction_id) as value from trace.finding f join trace.interaction i on i.id = f.interaction_id where ${SOURCE_FILTER}`, 20, 0, 4),
  stackedBars(7, 'Kind by agent response', `select f.kind, count(*) filter (where f.agent_response = 'held') as held, count(*) filter (where f.agent_response = 'partial') as partial, count(*) filter (where f.agent_response = 'yielded') as yielded from trace.finding f join trace.interaction i on i.id = f.interaction_id where ${SOURCE_FILTER} group by 1 order by 1`, 0, 4, 12, 9),
  stackedBars(8, 'Layer targeted, by kind', `select f.layer, count(*) filter (where f.kind = 'selective_misrepresentation') as selective_misrepresentation, count(*) filter (where f.kind = 'out_of_scope_extraction') as out_of_scope_extraction, count(*) filter (where f.kind = 'pressure') as pressure, count(*) filter (where f.kind = 'instruction_injection') as instruction_injection, count(*) filter (where f.kind = 'authority_bait') as authority_bait from trace.finding f join trace.interaction i on i.id = f.interaction_id where ${SOURCE_FILTER} group by 1 order by 1`, 12, 4, 12, 9),
  table(9, 'OWASP LLM Top 10 (2025) and MITRE ATLAS labels', `select f.owasp_ref as owasp, coalesce(f.atlas_ref, 'none') as atlas, count(*) as findings, count(*) filter (where f.agent_response = 'yielded') as yielded from trace.finding f join trace.interaction i on i.id = f.interaction_id where ${SOURCE_FILTER} group by 1, 2 order by 3 desc`, 0, 13, 12, 8),
  table(10, 'Agent response by finding kind', `select f.kind, count(*) as findings, round(100.0 * count(*) filter (where f.agent_response = 'yielded') / count(*)) as yielded_pct, round(100.0 * count(*) filter (where not f.within_authority) / count(*)) as outside_mandate_pct from trace.finding f join trace.interaction i on i.id = f.interaction_id where ${SOURCE_FILTER} group by 1 order by 2 desc`, 12, 13, 12, 8),
  table(11, 'Findings with quotes (click an id to open the drill-down)', `select f.interaction_id as interaction, i.source, f.turn_index as turn, f.layer, f.kind, f.agent_response as response, f.within_authority, f.effect, f.quote from trace.finding f join trace.interaction i on i.id = f.interaction_id where ${SOURCE_FILTER} order by i.annotated_at desc, f.interaction_id, f.turn_index`, 0, 21, 24, 12, [drillLink('interaction'), coloredColumn('response', RESPONSE), wideColumn('interaction', 260), wideColumn('turn', 60), wideColumn('source', 80)]),
], [SOURCE_VAR]);

const out = process.argv[2];
if (!out) throw new Error('usage: bun gen-trace-dashboards.ts <output dir>');
await mkdir(out, { recursive: true });
const boards: Record<string, Json> = { 'trace-overview': overview, 'trace-drill': drill, 'trace-adversarial': adversarial };
for (const [name, board] of Object.entries(boards)) {
  await writeFile(join(out, `${name}.json`), `${JSON.stringify(board, null, 1)}\n`);
}
