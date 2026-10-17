create schema if not exists trace;

create table if not exists trace.interaction (
  id text primary key,
  opportunity_id text not null,
  source text not null check (source in ('real', 'fixture')),
  purpose text,
  agent_verdict text,
  turn_count integer not null default 0,
  opened_at timestamptz,
  annotator text not null,
  annotated_at timestamptz not null default now(),
  schema_version integer not null default 1
);

create table if not exists trace.statement (
  id bigserial primary key,
  interaction_id text not null references trace.interaction(id) on delete cascade,
  principal text not null check (principal in ('A', 'B')),
  source text not null check (source in ('conversation', 'intent', 'profile')),
  kind text not null check (kind in ('goal', 'hard_constraint', 'preference', 'disclosure_boundary', 'authority_grant')),
  quote text not null
);

create table if not exists trace.fidelity (
  interaction_id text not null references trace.interaction(id) on delete cascade,
  principal text not null check (principal in ('A', 'B')),
  utterance_quote text,
  stored_intent_quote text,
  agent_claim_quote text,
  added_terms text[] not null default '{}',
  dropped_terms text[] not null default '{}',
  narrowed_terms text[] not null default '{}',
  drift_score numeric not null check (drift_score between 0 and 1),
  primary key (interaction_id, principal)
);

create table if not exists trace.turn_act (
  interaction_id text not null references trace.interaction(id) on delete cascade,
  turn_index integer not null,
  seat text not null check (seat in ('A', 'B')),
  protocol_action text not null check (protocol_action in ('propose', 'counter', 'accept', 'decline')),
  performative text not null check (performative in ('propose', 'accept-proposal', 'reject-proposal', 'query-if', 'inform', 'refuse')),
  commitment_level text not null check (commitment_level in ('explore', 'tentative', 'conditional', 'binding')),
  authority_verdict text not null check (authority_verdict in ('within', 'exceeded', 'unclear')),
  authority_reason text,
  quote text not null,
  primary key (interaction_id, turn_index)
);

create table if not exists trace.claim (
  id bigserial primary key,
  interaction_id text not null references trace.interaction(id) on delete cascade,
  turn_index integer not null,
  seat text not null check (seat in ('A', 'B')),
  derived_from bigint references trace.statement(id) on delete set null,
  status text not null check (status in ('supported', 'unsupported', 'contradicted', 'out_of_scope')),
  claim text not null,
  quote text not null
);

create table if not exists trace.term_delta (
  interaction_id text not null references trace.interaction(id) on delete cascade,
  turn_index integer not null,
  seat text not null check (seat in ('A', 'B')),
  term text not null,
  change text not null check (change in ('proposed', 'clarified', 'conceded', 'added', 'dropped')),
  detail text
);

create table if not exists trace.finding (
  id bigserial primary key,
  interaction_id text not null references trace.interaction(id) on delete cascade,
  turn_index integer not null,
  layer text not null check (layer in ('intent', 'negotiation', 'outcome', 'authority')),
  kind text not null check (kind in ('selective_misrepresentation', 'out_of_scope_extraction', 'pressure', 'instruction_injection', 'authority_bait')),
  owasp_ref text,
  atlas_ref text,
  affected_terms text,
  agent_response text not null check (agent_response in ('held', 'partial', 'yielded')),
  within_authority boolean not null,
  effect text,
  quote text not null
);

create table if not exists trace.outcome (
  interaction_id text primary key references trace.interaction(id) on delete cascade,
  agent_verdict text not null,
  human_outcome text not null check (human_outcome in ('both_committed', 'one_committed', 'declined', 'expired', 'open', 'not_reached')),
  outcome_class text not null check (outcome_class in ('confirmed_fit', 'assessment_failure', 'missed_opportunity', 'unresolved')),
  cause_finding_id bigint references trace.finding(id) on delete set null,
  rationale text,
  hours_to_first_commit numeric
);

create index if not exists statement_interaction_idx on trace.statement (interaction_id);
create index if not exists finding_interaction_idx on trace.finding (interaction_id);
create index if not exists claim_interaction_idx on trace.claim (interaction_id);
