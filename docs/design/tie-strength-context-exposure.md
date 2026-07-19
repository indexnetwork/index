---
title: "Tie-Strength Context Exposure"
type: design
tags: [privacy, contacts, exposure, introducer, premises, measurement]
created: 2026-07-19
updated: 2026-07-19
---

# Tie-Strength Context Exposure

IND-429 is a **design-only** specification. It does not describe current tie-strength enforcement and does not authorize runtime or schema changes by itself. The first implementation horizon ends at trusted signal capture, conservative shadow classification, a default-off introducer-ranking experiment, and an owner-only advisory exposure preview. Read-side context gating remains a separately approved, data-blocked research phase.

## Executive decision

Index should first learn whether it can capture a small amount of trustworthy relationship evidence without turning contacts into a surveillance system. Version 1 therefore:

1. adds nullable, owner-scoped contact-origin and interaction-recency fields to directed contact memberships;
2. writes them only at trusted server boundaries and conservatively backfills durable evidence;
3. computes a preliminary, explainable signal band in shadow mode without claiming to measure relationship strength;
4. evaluates that signal for introducer ordering before any ranking change is enabled; and
5. adds a post-assignment, advisory estimate of a premise's potential audience.

Version 1 does **not** pause premise creation, request confirmation, expose member identities, or restrict reads. A pre-assignment confirmation gate and SOCPRI-style read policy both require later explicit decisions.

## Theory, motivation, and evidentiary limit

The canonical internal theory report connects three ideas in Chapter 9:

- Granovetter motivates the structural value of weak ties and bridging relationships.
- Mondal & Ur motivate reasoning about a person's expected exposure set rather than treating an access-control list as a complete privacy model.
- SOCPRI motivates separating a context-free/default profile from contextual profiles governed by contextual norms.

The report proposes these as enhancements rather than implemented facts ([Theoretical Foundations, Chapter 9](../../packages/protocol/src/docs/Theoretical%20Foundations%20of%20the%20Index%20Network%20Protocol.md), especially lines 250–276 and 363–367). The academic backlog correspondingly marks tie-strength-gated exposure as “design doc first” and data-blocked ([Academic Grounding Enhancement Backlog, item 7](../../packages/protocol/src/docs/Academic%20Grounding%20Enhancement%20Backlog.md), lines 84–92).

Scientific restraint is essential. An acquisition source and one recency timestamp do not measure Granovetter's full tie-strength dimensions: interaction frequency, closeness, relationship duration, or social distance. They cannot establish that a relationship is a “strong tie,” and the absence of recent activity cannot establish that a relationship is weak. The preliminary bands in this design are operational signal-coverage labels only. They are not psychological, sociological, or authorization claims.

## Current-state grounding

The design is grounded at base commit `85af583363d16f4c97ac7be60f970d72cc16e840`.

| Area | Current behavior | Live grounding |
| --- | --- | --- |
| Contact edge | A contact is a `network_members` row with `permissions=['contact']` in the owner's personal network. The composite key is `(networkId,userId)`; the owner is recovered through `personal_networks`. There is no contact source or pairwise recency. | `services/api/src/schemas/database.schema.ts:793-813` |
| Public contact shape | The protocol and API service both define `ContactInput` as name/email only. This public shape must remain unchanged. | `packages/protocol/src/shared/interfaces/contact.interface.ts:2-5`; `services/api/src/services/contact.service.ts:60-63` |
| Contact persistence | Single and bulk upserts insert contact memberships; duplicate behavior and restoration are persistence concerns, but neither path receives trusted origin or recency. Removal currently hard-deletes the membership. | `services/api/src/adapters/contact.database.adapter.ts:137-224,299-309` |
| Integrations | `IntegrationService` knows the Gmail/Slack toolkit and then passes only `{name,email}` to personal-contact import. Gmail fetch combines `connections` and `otherContacts` without preserving the group. | `services/api/src/services/integration.service.ts:97-119,314-414` |
| CSV surfaces | The current web CSV flow imports experiment-network members, not personal-network contact edges. Generic MCP/chat `import_contacts` accepts a list but cannot prove that the list came from a CSV file. The CLI supports single add and Gmail import, not list/CSV contact import. | `apps/web/src/components/settings/AccessTab.tsx:310-346`; `services/api/src/controllers/network-experiment.controller.ts:297-326`; `packages/protocol/src/contact/contact.tools.ts:19-53`; `packages/cli/src/contact.command.ts:10-13,42-89` |
| Acceptance/start chat | REST acceptance and `startChat` create reciprocal contacts best-effort after the product action. The accepting side may restore; the counterpart side honors an opt-out. The already-accepted `startChat` branch resolves the DM but does not upsert contacts. | `services/api/src/services/opportunity.service.ts:593-735,828-875,940-995` |
| Other acceptance surface | Protocol `update_opportunity` follows a graph path that stamps acceptance and creates a DM but does not share the REST service's contact side effects. That graph is composed through MCP/Hermes, the REST tool API, and in-process chat—not only MCP. Surface convergence is required before capture can be considered complete. | `packages/protocol/src/opportunity/opportunity.tools.ts`; `packages/protocol/src/opportunity/opportunity.graph.ts:3638-3727`; `services/api/src/controllers/tool.controller.ts:1-34`; `services/api/src/services/tool.service.ts:260-282` |
| Connect links | Connect-link `connect`/`send_direct` routes call `startChat`; links do not independently create a contact or record click/redemption recency. | `services/api/src/controllers/connect-link.controller.ts:92-140`; `services/api/src/schemas/database.schema.ts:122-145` |
| Conversation evidence | A DM has a canonical `dmPair`; messages have server-created `createdAt`, `senderId`, and `role`. `lastMessageAt` is also advanced by agent/system messages, so it is not by itself proof of a human pair event. Ghost merge can rewrite participants/senders without recomputing `dmPair`, so backfill must validate pair consistency. | `services/api/src/schemas/conversation.schema.ts:33-68,107-130`; `services/api/src/adapters/conversation.database.adapter.ts:377-497`; `services/api/src/adapters/enrichment.database.adapter.ts:397-422` |
| Opportunity evidence | Opportunities have mutable `updatedAt`, no dedicated accepted timestamp, and actor JSON may contain `actedAt`. Explicit accept paths stamp the acting actor. `updatedAt` alone is only an approximation and must not be presented as acceptance time. | `services/api/src/schemas/database.schema.ts:415-461`; `services/api/src/adapters/opportunity.database.adapter.ts:903-940` |
| Introducer | `ContactWithIntents` contains intent freshness/count only. The adapter orders by the contact's maximum active-intent `updatedAt`; this is not owner↔contact interaction freshness. | `packages/protocol/src/opportunity/opportunity.introducer.ts:23-41,68-89`; `services/api/src/adapters/chat.database.adapter.ts:3278-3325` |
| Premise assignment | Assignment is automatic. The centralized default threshold is `0.7`; `create_premise` returns an assigned-index count and message, not a preview or confirmation. | `packages/protocol/src/shared/assignment/network-assignment.policy.ts:5-6,75-100`; `packages/protocol/src/premise/premise.tools.ts:67-90` |
| Exposure | Opportunity discovery searches assigned premises and per-network contexts inside network scope; the global context row is excluded from context-to-intent discovery. However, premise-similarity and context-to-intent queries do not currently share one canonical reachability predicate and diverge on filters such as active-user handling. Current assignment-scoped matching permits ghosts; contact tooling explicitly says a created ghost participates in opportunity matching before joining. A non-ghost preview count is therefore a separate recipient-eligibility rule, not semantic parity with discovery. Direct read surfaces are also different: `read_premises(userId)` delegates a user-ID read without a discovery-network predicate, while single-user context/profile tooling can use contact-derived shared scope. There is no uniform per-tie read gate. | `services/api/src/adapters/opportunity.database.adapter.ts:1284-1430`; `packages/protocol/src/opportunity/opportunity.graph.ts:420-438,1188-1269`; `packages/protocol/src/contact/contact.tools.ts:14-31`; `packages/protocol/src/premise/premise.tools.ts:113-123`; `services/api/src/adapters/database.adapter.ts:220-258`; `packages/protocol/src/enrichment/enrichment.tools.ts:415-449` |
| Counting precedent | `getNetworkMemberCount` counts undeleted membership rows and includes the author; it is not the preview query needed here. | `services/api/src/adapters/chat.database.adapter.ts:1860-1863` |
| Privacy threshold precedent | Frame-drift monitoring defaults its minimum cohort to five, hard-clamps it to `[2,100]`, suppresses sub-threshold output, and emits aggregate suppression diagnostics. | `services/api/src/lib/frame-drift.config.ts:3-8,19-29,53-82`; [Frame-Drift Monitoring](frame-drift-monitoring.md) |

The duplicate REST/service/protocol/composition paths are part of the design risk: adding columns at one adapter is insufficient if another acceptance or tool path bypasses it. Lifecycle writes are also distributed across `ContactDatabaseAdapter`, `ChatDatabaseAdapter`, ghost unsubscribe/non-human cleanup, ghost merge, and account deletion (`services/api/src/adapters/contact.database.adapter.ts:137-221,299-309`; `services/api/src/adapters/chat.database.adapter.ts:2676-2698,2857-2950,3148-3215`; `services/api/src/adapters/enrichment.database.adapter.ts:240-259,342-422`; `services/api/src/services/user.service.ts:124-128`). Phase A must cover all of them before capture ships.

## Privacy model

### Directional, owner-scoped edges

A contact edge is directional:

```text
owner A's personal network ──contact membership──> user B
```

If B also has A as a contact, that is an independent row in B's personal network. The rows may have different acquisition sources, interaction timestamps, deletion states, and signal bands. No read, backfill, classifier, ranking, or preview may infer symmetry merely because the reciprocal row exists.

The owner is the only principal allowed to read their edge's private signal fields. The contact, another network member, a network-scoped agent, and another owner must not receive them. Reciprocal writes at an accepted opportunity are two separately authorized edge operations, not one shared relationship record.

### Purpose limitation and least data

The v1 fields may be used only for:

- capture-quality and coverage measurement;
- the preliminary classifier in shadow;
- a separately flagged introducer-ranking experiment; and
- deletion/erasure operations.

They must not be used for advertising, public social graphs, member recommendations, profile display, trust or safety scores, opportunity eligibility, or read authorization. They must not be returned from public REST, MCP, CLI, Hermes, or frontend contact payloads. Existing serializers should remain unchanged and contract tests should fail on accidental exposure.

### Threat model

| Threat | Required defense |
| --- | --- |
| A caller spoofs a desirable source or recent interaction | Keep source/recency out of `ContactInput`; derive internal context at authenticated server/tool composition boundaries; ignore/reject similarly named payload fields. |
| Reciprocal membership is treated as proof of mutual closeness | Query and classify one owner edge at a time; never copy signals from the reverse edge. |
| Contact activity becomes pairwise surveillance | Store one monotonic timestamp, not events or counts; prohibit raw histories and pair-level telemetry; restrict reads to owner-scoped internals. |
| Small audience counts reveal membership | Suppress previews below the configured minimum and bucket larger counts; never include identities or exact small values. |
| Stale or sparse evidence is called “strong” | Use non-authorizing preliminary bands with explicit reason codes and version; retain `unknown`; do not implement read gating. |
| A ghost contact is treated as an active reader or its signals leak during merge | Ghost edges may hold source data, but ghosts are excluded from preview. Claim-in-place preserves the same owner edge; merge-to-existing follows the collision rules below and clears the source ghost in one transaction. |
| Unilateral activity is mistaken for mutual engagement | A DM is a pair-event recency signal only; its direction is validated and it never implies reply, closeness, or reciprocal engagement. The band remains non-authorizing. |
| Deleted contacts remain analytically visible | Clear source, recency, and detail fields on removal; preserve only the minimal reasoned opt-out tombstone; exclude tombstones and deleted endpoint users from classification and metrics. |
| Account erasure races a capture/repair job | Lock/mark the user and clear inbound/outbound signals atomically; every writer re-checks both endpoint users; invalidate caches and queued repairs. |
| Logs or metrics reconstruct a pair | Never emit both user IDs, contact email, network ID plus owner ID, exact timestamps, or low-cardinality cross-dimensions. Use stable owner-count cohorts and prevent repeated differencing across exports. |

## V1 data model

Storage remains on `network_members`; no contact-events table or metadata-only representation is introduced in v1.

### Canonical schema values and generated SQL

```ts
// Illustrative schema-layer declaration; this tuple is the single source of truth.
import { pgEnum } from 'drizzle-orm/pg-core';

export const contactSourceValues = [
  'manual',
  'csv_import',
  'integration_import',
  'opportunity_acceptance',
  'conversation_started',
] as const;

export type ContactSource = (typeof contactSourceValues)[number];
export const contactSourceEnum = pgEnum('contact_source', contactSourceValues);
```

The schema/API layer owns and exports the canonical tuple and derived `ContactSource` type. The Drizzle enum consumes the same tuple, and the generated migration creates the PostgreSQL `contact_source` enum plus nullable `network_members.contact_source`, `last_interaction_at timestamptz`, and `contact_signal_details jsonb` columns. Implementations must not redeclare an independent TypeScript union or second values array that can drift from the database enum.

All three columns are nullable. They are meaningful only when the row is an active contact membership in a personal network. Existing rows, non-contact memberships, owner memberships, and evidence-free contacts remain SQL `NULL`, meaning unknown—not “weak,” “old,” or “untrusted.”

`contact_source` records the trusted acquisition origin of the **current active edge**. It is not an arbitrary client label and not the surface of the latest interaction.

### Source taxonomy

| Source | Trusted meaning |
| --- | --- |
| `manual` | A direct add or generic contact-list import reached a trusted add/import tool or controller. This does not imply that the contact was typed one at a time. |
| `csv_import` | Reserved for a separately approved server or trusted in-process parser that actually parses/attests a personal-contact CSV import. No such contact-edge writer exists in A3: the current experiment-network CSV flow creates network members, not personal contacts, and a generic public `import_contacts` array is `manual`. The value must remain unwritten until a trusted personal-contact CSV boundary and composition-root test are approved. |
| `integration_import` | The API integration service fetched contacts from a supported provider. Toolkit/group belongs in allowlisted details, not in the enum. |
| `opportunity_acceptance` | The edge was created or restored through explicit `updateOpportunityStatus('accepted')` semantics. Its recency timestamp is the persisted accepting actor's `actedAt`, not generic opportunity `updatedAt`. |
| `conversation_started` | The edge was created or restored because the user invoked the new `startChat` transition. Although that path also stamps acceptance, this source records the acquisition boundary the user chose; it produces one `conversation_started` touch, not a duplicate acceptance touch. The already-accepted branch creates/restores no edge and performs no recency touch because it persists no new action timestamp. |

SQL `NULL` is the only legacy/unknown source. The taxonomy is intentionally small; new enum values require a migration and privacy review.

### Allowlisted details

```ts
// Illustrative internal types; not public API contracts.
type TrustedClientSurface = 'web' | 'api' | 'mcp' | 'internal';
type NonIntegrationContactSource = Exclude<ContactSource, 'integration_import'>;

type ContactAcquisitionDetailsV1 =
  | {
      source: NonIntegrationContactSource;
      clientSurface?: TrustedClientSurface;
    }
  | {
      source: 'integration_import';
      toolkit: 'gmail';
      gmailGroup?: 'connections' | 'other_contacts';
      clientSurface?: TrustedClientSurface;
    }
  | {
      source: 'integration_import';
      toolkit: 'slack';
      clientSurface?: TrustedClientSurface;
    };

type ContactSignalDetailsV1 = {
  schemaVersion: 1;
  acquisition?: ContactAcquisitionDetailsV1;
  recency?: {
    basis:
      | 'dm_message'
      | 'opportunity_acceptance'
      | 'conversation_started'
      | 'backfill_dm_message'
      | 'backfill_opportunity_actor_action';
    backfilled: boolean;
  };
};
```

The details writer constructs a fresh object from an allowlist; it never spreads caller/provider metadata. The acquisition union is discriminated by `source` and then `toolkit`, and the writer verifies that its `source` matches the typed `contact_source` column. Gmail alone may carry `gmailGroup`; a Slack-plus-Gmail-group object cannot parse as v1. `clientSurface` is optional and means only the server route/transport it directly observed: session web route, non-web API route, MCP transport, or internal service call. CLI and Hermes cannot be distinguished after they forward through a public REST/MCP composition and therefore are never stored as surfaces. Headers, wrapper names, agent-provided metadata, and payload fields cannot attest a surface.

Each retained detail has a narrow purpose: toolkit/group audits whether trusted origin capture is complete, and recency basis lets the classifier distinguish eligible durable evidence. If a detail is not consumed by those audits or classification, the writer omits it. Edge details share the edge lifecycle and are cleared on removal/erasure; no separate long-lived copy is allowed.

Forbidden data includes filenames, free text, contact or message content, email addresses, provider IDs, workspace/account IDs, raw interaction history, interaction counts, IP/user-agent values, inferred relationship labels, and caller-supplied timestamps. Gmail grouping can be retained only if provider parsing preserves whether an item came from `connections` or `otherContacts`; current concatenation must be refactored before that detail is written.

### Edge lifecycle and conflict semantics

1. **Initial insert:** with capture disabled, preserve current membership behavior and leave signal columns null. With capture enabled, atomically set source and allowlisted acquisition details from the trusted origin; recency remains null unless the same trusted action also qualifies as an interaction.
2. **Ordinary duplicate upsert:** do not overwrite source or acquisition details, including a legacy null source. A repeated import is not evidence of original acquisition. Monotonic recency touching is a separate operation.
3. **Reasoned tombstone:** removal soft-deletes the edge and atomically nulls `contact_source`, `last_interaction_at`, and `contact_signal_details`. The pre-existing `network_members.metadata` may retain only an allowlisted `contactTombstone:{version:1,reason}` object, where reason is `owner_removed` or `contact_opt_out`; it contains no pair evidence or free text. This is not metadata-only signal storage—the signal columns remain typed and cleared.
4. **Owner removal and re-add:** `owner_removed` belongs to the owner of that personal-network edge. A later deliberate add/accept/start-chat action by that same owner may restore it and records the restoration origin. The contact or another owner cannot clear it.
5. **Contact opt-out:** `contact_opt_out` represents an explicit action by the contact subject (including ghost unsubscribe). An ordinary add/import by an owner cannot restore or delete it. Only an explicit action by the opted-out subject that semantically revokes the opt-out may restore it. Existing `clearReverseOptOut*` behavior must become reason-aware; it must never hard-delete another owner's tombstone merely because a reciprocal add occurred.
6. **Restore:** after the authority check, clear the tombstone object, keep old signal fields null, and write the restoration source/details as the current active-edge origin. Legacy soft-deleted rows without a reason fail closed as `contact_opt_out` until migrated or explicitly resolved.
7. **Permission/network lifecycle:** changing away from `contact`, deleting the personal network, or otherwise invalidating the edge clears all signal fields. Non-contact rows must not retain them.
8. **Ghost claim/merge:** claim-in-place keeps the same user ID and owner edges. For merge-to-existing-user, process every owner edge transactionally: an existing target tombstone wins; an existing active target edge and its signals win; if no target edge exists, the membership may be re-keyed but all source/recency/details are cleared to unknown. Every source-ghost signal is cleared before the ghost is deleted. No `GREATEST` merge combines two identities' recency.
9. **Account erasure:** one transaction locks/marks the user, clears every inbound and outbound edge signal/tombstone as policy requires, invalidates edge-derived cache keys, and performs user erasure. Capture, repair, classifier, and ranking paths re-check both endpoint users are active under the same write/read boundary. A failed transaction rolls back and retries; queued repair jobs become no-ops after erasure.

A row-local database check should prevent populated signal fields on non-contact or soft-deleted rows. A row-local check cannot prove that `networkId` is personal, so the shared persistence transaction must join `personal_networks`, lock the edge, and enforce that condition. Migration tests cover both layers; the invariant is not optional.

## Trusted capture boundary

`ContactInput` remains `{name,email}`. Public callers cannot submit `contactSource`, `lastInteractionAt`, signal details, or a recency basis.

### Internal shapes

```ts
type TrustedContactOrigin =
  | { source: 'manual'; surface?: TrustedClientSurface }
  | { source: 'csv_import'; surface: TrustedClientSurface }
  | {
      source: 'integration_import';
      toolkit: 'gmail';
      gmailGroup?: 'connections' | 'other_contacts';
      surface?: TrustedClientSurface;
    }
  | {
      source: 'integration_import';
      toolkit: 'slack';
      surface?: TrustedClientSurface;
    }
  | { source: 'opportunity_acceptance'; surface?: TrustedClientSurface }
  | { source: 'conversation_started'; surface?: TrustedClientSurface };

type ContactInteractionBasis =
  | 'dm_message'
  | 'opportunity_acceptance'
  | 'conversation_started'
  | 'backfill_dm_message'
  | 'backfill_opportunity_actor_action';

interface ContactEdgePersistence {
  upsertContactEdge(
    ownerUserId: string,
    contactUserId: string,
    origin: TrustedContactOrigin,
    options: { restore: boolean },
  ): Promise<'created' | 'restored' | 'existing' | 'opted_out'>;

  upsertContactEdgesBulk(
    ownerUserId: string,
    edges: ReadonlyArray<{
      contactUserId: string;
      origin: TrustedContactOrigin;
    }>,
    options: { restore: boolean },
  ): Promise<ReadonlyArray<'created' | 'restored' | 'existing' | 'opted_out'>>;

  touchContactInteraction(
    userA: string,
    userB: string,
    at: Date,
    basis: ContactInteractionBasis,
  ): Promise<{ aToB: 'updated' | 'missing'; bToA: 'updated' | 'missing' }>;
}
```

This is an API-side persistence boundary, not a protocol-layer dependency. `ContactService`, `OpportunityService`, message persistence, integration composition, and MCP composition should depend on the same adapter contract or SQL helper. Services must not import one another; the centralization belongs in an adapter/shared persistence primitive wired through existing service interfaces.

For direct add, `upsertContactEdge` is the product persistence operation. While `CONTACT_SIGNAL_CAPTURE_ENABLED` is false, existing membership behavior remains unchanged and signal columns stay null. When capture is enabled, the directed membership insert/restore, trusted `contact_source`, and allowlisted acquisition details commit atomically in one transaction; provenance is not appended after reporting the edge successful.

Bulk import preserves a different existing contract. Input resolution and deduplication happen before membership persistence and may report invalid or deduplicated inputs as `skipped`. The surviving edge set, including each edge's trusted origin/details when capture is enabled, is then written by one `upsertContactEdgesBulk` batched operation/transaction. That database persistence unit succeeds or fails as a batch: a successful batch leaves every successfully created/restored edge with its required origin/details, while a failed batch rolls back and throws before any `ImportResult.imported` count is returned. On commit, `ImportResult` retains its current API meaning: `imported` is the number of deduplicated surviving inputs processed by the batch, `details` is the retained resolution/dedup detail set, and `skipped` is the resolution-plus-dedup skip count; `imported` is not redefined as newly inserted/restored edge count. Mixed internal `created`/`restored`/`existing`/`opted_out` statuses are tested for correct provenance and lifecycle behavior without being converted into per-item database success or new skip semantics. V1 must not invent per-item database persistence or partial-success semantics; such a change requires separate product and persistence approval. Post-commit enrichment, secondary recency, reverse-edge/contact, and acceptance/chat side effects retain their own current awaited or best-effort behavior where already defined, but they are not evidence that the primary import batch persisted per item. Reciprocal acceptance/chat directions remain separate edge writes and may fail independently.

Event-specific internal wrappers (`touchFromPersistedMessage`, `touchFromAcceptedOpportunity`, `touchFromNewStartChatTransition`) first derive and validate the two users, timestamp, role/action, and basis from the durable row or just-committed server action. They are the only production callers of `touchContactInteraction`; controllers, protocol tools, and public composition deps never receive the raw pair/timestamp method. This retains the locked shared boundary while preventing an internal caller from treating arbitrary IDs or request timestamps as evidence.

`touchContactInteraction`:

- updates only already-existing, active contact edges in either direction and re-checks that both endpoint users are active;
- treats the event as pair recency that may be unilateral; updating both existing directed edges does not assert reply, mutual engagement, symmetry of membership, or closeness;
- never creates a contact from a message alone;
- uses `GREATEST(existing, at)` so retries and out-of-order jobs are monotonic;
- updates the recency basis when the candidate timestamp wins; when timestamps are equal, the fixed priority below determines the stored basis;
- accepts `at` only from a trusted server-persisted event or the deterministic backfill, never from request payloads; and
- is best-effort and failure-isolated from message send, opportunity acceptance, or chat start.

For equal timestamps, the complete priority order is `dm_message` > `opportunity_acceptance` > `conversation_started` > `backfill_dm_message` > `backfill_opportunity_actor_action`. The higher-priority basis wins. This order exists only to make provenance stable and retries/idempotent; it is not an empirical ranking of tie strength, interaction quality, or evidentiary value. Tests cover every adjacent pair and all retry directions.

Opportunity acceptance and the new `startChat` transition are exceptions to “touch does not create”: after their product action commits, their existing side-effect flow may create/restore both directional edges under current opt-out semantics, atomically including each new/restored edge's origin/details, then touch both edges with the qualifying persisted server-action time. If that secondary contact persistence fails, the accepted opportunity/chat remains successful and emits an aggregate failure diagnostic for repair.

The already-accepted `startChat` branch only gets/returns or unhides the existing DM and persists no new chat-open action timestamp. It therefore does **not** touch recency and does not create/restore an edge. Only a future explicitly persisted chat-open action, with its own server timestamp and reviewed semantics, could qualify that branch.

### Surface mapping

| Boundary | Origin write | Recency touch |
| --- | --- | --- |
| REST/web direct add | `manual` | none |
| MCP `add_contact` | `manual` | none |
| Generic MCP/chat `import_contacts` list | `manual`; Hermes forwarding is observed only as MCP | none |
| CLI | direct add is `manual`; Gmail command reaches integration import; no current list/CSV command | none |
| Future separately approved trusted CSV parser for personal contacts | `csv_import`; remains unwritten in A3 | none |
| Gmail/Slack integration fetch | `integration_import` plus allowlisted toolkit/group | none |
| Explicit `updateOpportunityStatus('accepted')`, across REST and every protocol graph composition | create/restore as `opportunity_acceptance` | persisted accepting actor `actedAt`, both existing/new directional edges |
| New `startChat` transition | create/restore as `conversation_started`, even though the path also stamps acceptance | one server action time tied to the transition; both existing/new directional edges |
| Already-accepted `startChat` | none | none; current branch persists no new action timestamp. A future durable chat-open event would require separate review before it could qualify. |
| Persisted human DM message | no edge creation/source change | persisted `messages.createdAt` only when `role='user'`, sender is a user participant, and `dmPair` agrees; existing edges only |
| Connect-link click/redemption alone | none | none; no durable click timestamp exists |

Capture is incomplete until REST, the REST tool API, in-process chat, MCP/Hermes forwarding, CLI's actual add/Gmail commands, and graph-based opportunity acceptance converge on these semantics. Tests exercise each composition root because they do not all share today's service side effects. Wrapper identity alone is not trusted evidence: an arbitrary MCP client can call a public tool.

## Deterministic migration and backfill

### Migration order

1. Add the Drizzle enum/schema export and nullable columns without defaults; generate/rename the migration, update `_journal.json` and snapshot metadata, and verify a second generation reports no schema changes. Do not rewrite existing rows.
2. Apply the database migration before deploying any code that selects or writes the new columns. V1 does not rely on runtime column feature detection.
3. Deploy compatible readers and trusted writers with capture disabled; all-null legacy data must remain valid.
4. Enable capture for internal/dev traffic, then production cohorts.
5. Run the idempotent backfill in bounded primary-key batches with dry-run counts and restart checkpoints.
6. Enable shadow classification only after capture and backfill diagnostics reconcile.

No source value is backfilled merely because a current edge appears in a provider roster or an accepted opportunity exists: neither proves the edge's original acquisition. Existing `contact_source` generally remains null.

### Trustworthy recency derivation

For each owner/contact pair that has an existing active directed contact edge, derive the maximum of:

1. **Human DM message:** `messages.createdAt` only where `role='user'`, the conversation has exactly two relevant user participants, `senderId` is one of them, `dmPair` decodes to the same two IDs, and the pair matches the owner/contact IDs. Agent/task/system messages are ineligible. A stale/mismatched `dmPair` after ghost merge is skipped and counted for repair; backfill does not guess the pair. Do not use `conversations.lastMessageAt` because agent/system messages can advance it.
2. **Explicit opportunity action:** require an accepted opportunity with exactly two distinct eligible non-introducer participant users. One must be the `acceptedBy` user and that same actor must carry a parseable `actors[].actedAt`; the other is the unique counterpart. An eligible participant has a valid actor user ID, an active/non-deleted user row, and an unambiguous non-introducer role; the two IDs must be distinct. Apply that pair event only to currently existing directional contact edges between those two users. Skip and aggregate-count—without IDs—zero, one, or more than two eligible participants; duplicate/malformed actors; `acceptedBy` mismatches; introducer fallback; or any ambiguous counterpart set. Backfill must never copy the live service/presenter convention of choosing the first non-introducer actor.

Do not use `opportunities.updatedAt` as an acceptance timestamp; it is mutable and only an approximation. Do not infer an interaction from an empty DM's `createdAt`, because the current schema does not prove whether creation represented explicit human action or automatic setup. Do not backfill clicks: connect links persist no click/redemption time.

The backfill computes one winning `(timestamp,basis)` per edge using the same fixed basis priority as live touching. It writes when the timestamp is newer, or when it is equal and the candidate basis has higher fixed priority than the stored basis, and produces the same result on every rerun. Invalid/future timestamps are skipped and counted. Rows deleted or changed away from contact during a batch are not updated. Transaction predicates must re-check active contact membership at write time.

## Preliminary classifier

### Contract

The classifier is pure TypeScript, deterministic, versioned, explainable, and does not call an LLM or database.

```ts
type PreliminaryTieBand = 'unknown' | 'candidate_weak' | 'recently_active';

type TieReasonCode =
  | 'no_trusted_signal'
  | 'known_acquisition_origin'
  | 'recent_trusted_interaction'
  | 'stale_trusted_interaction'
  | 'invalid_future_interaction'
  | 'malformed_signal_details'
  | 'unsupported_signal_version';

type PreliminaryTieClassification = {
  classifierVersion: 'contact-signal-v1';
  band: PreliminaryTieBand;
  reasons: TieReasonCode[];
  asOf: string;
};

type ParsedContactSignalDetails =
  | { status: 'absent' }
  | { status: 'valid'; value: ContactSignalDetailsV1 }
  | { status: 'malformed' }
  | { status: 'unsupported_version' };

parseContactSignalDetails(
  raw: unknown,
  source: ContactSource | null,
): ParsedContactSignalDetails;

classifyContactSignal(input: {
  source: ContactSource | null;
  lastInteractionAt: Date | null;
  details: unknown;
  asOf: Date;
}): PreliminaryTieClassification;
```

`asOf` is caller-supplied by trusted application code so tests, shadow comparisons, and retries do not depend on wall-clock reads inside the function. `parseContactSignalDetails` is also pure: `null`/`undefined` is `absent`; a non-object or object missing `schemaVersion` is `malformed`; an object with a present `schemaVersion !== 1` is `unsupported_version` without interpreting the remaining fields or retaining/logging the raw version value; and a version-1 object with an invalid discriminated union, impossible Slack/Gmail-group combination, or acquisition source that conflicts with the typed `source` column is `malformed`. The classifier never casts raw JSON directly to v1.

### Version 1 rules

The operational “recent” window is a versioned constant of 90 days. It is a provisional product-analysis window, not an empirical definition of tie strength.

1. Parse `details: unknown` before evaluating recency. `malformed` adds `malformed_signal_details`; `unsupported_version` adds `unsupported_signal_version`. These states are distinct and mutually exclusive.
2. A `lastInteractionAt` after `asOf` adds `invalid_future_interaction` and is never qualifying recency, regardless of details.
3. Only `valid` details with an allowlisted recency basis can validate `lastInteractionAt`. A non-future trusted DM-message or explicit opportunity-action basis within 90 days yields `recently_active`; older valid recency yields `candidate_weak` with `stale_trusted_interaction`.
4. `conversation_started` is a qualifying explicit opportunity action and remains source-independent: valid recent details plus its persisted transition timestamp yield `recently_active` even when `contact_source` is null.
5. `absent`, `malformed`, or `unsupported_version` details cannot validate the timestamp. If `source` is known, the result is source-only `candidate_weak` with `known_acquisition_origin` plus any parse/future reasons. If `source` is null, the result is `unknown` with the parse/future reasons plus `no_trusted_signal`.
6. When more than one reason applies, emit this fixed order: `malformed_signal_details` or `unsupported_signal_version`, then `invalid_future_interaction`, then exactly one evidence outcome (`recent_trusted_interaction`, `stale_trusted_interaction`, `known_acquisition_origin`, or `no_trusted_signal`).
7. Deleted/non-contact rows are not classifier inputs at all.

The following table makes valid-but-unusable combinations total. “Fallback” means `candidate_weak` + `known_acquisition_origin` when `source` is known, otherwise `unknown` + `no_trusted_signal`. A future timestamp prepends `invalid_future_interaction` to that fallback; it never qualifies recency.

| Parsed details | Recency object | Timestamp state | Result |
| --- | --- | --- | --- |
| `valid` | allowlisted basis | non-future, age ≤90 days | `recently_active` + `recent_trusted_interaction` (source-independent) |
| `valid` | allowlisted basis | non-future, age >90 days | `candidate_weak` + `stale_trusted_interaction` (source-independent) |
| `valid` | allowlisted basis | absent | fallback; the basis alone is not an event |
| `valid` | allowlisted basis | future | `invalid_future_interaction` + fallback |
| `valid` | absent | absent or non-future value | fallback; an unbound timestamp is ignored |
| `valid` | absent | future | `invalid_future_interaction` + fallback |
| `absent` | unavailable | absent or non-future value | fallback; an unvalidated timestamp is ignored |
| `absent` | unavailable | future | `invalid_future_interaction` + fallback |
| `malformed` | unavailable | any | `malformed_signal_details`, then future reason if applicable, then fallback outcome |
| `unsupported_version` | unavailable | any | `unsupported_signal_version`, then future reason if applicable, then fallback outcome |

`candidate_weak` means “a sparse contact signal that may be useful for a weak-tie routing hypothesis.” It does not mean the relationship is objectively weak or structurally bridging. `recently_active` is shorthand for “a trusted pair event was recorded recently”; the event may be unilateral and does not mean mutual engagement, reachability, strength, or closeness. No band can authorize, deny, broaden, or narrow a read.

The classification is computed, not persisted. Persisting it would create stale derived state, complicate deletion, and obscure which classifier version produced a label. Callers may cache only with a key containing edge identity, classifier version, normalized input fingerprint, and `asOf` bucket; v1 should prefer no cache until query cost is measured.

## Data flow

```mermaid
sequenceDiagram
    autonumber
    actor Owner
    participant Boundary as Trusted API/tool boundary
    participant Product as Product action
    participant Edge as ContactEdgePersistence
    participant DB as PostgreSQL
    participant Shadow as Shadow classifier/evaluator
    participant Intro as Introducer selection
    participant Premise as Premise graph
    participant Preview as Exposure preview

    Owner->>Boundary: add/import/accept/start chat/send DM
    Boundary->>Boundary: validate action; derive trusted context

    alt Direct add/import
        Boundary->>Boundary: resolve/deduplicate import; record skipped inputs
        Boundary->>Edge: single add or surviving import batch + trusted origins
        Edge->>DB: atomically persist one edge or the whole batch with source/details
        DB-->>Edge: persistence unit committed or rolled back
        Edge-->>Boundary: success only after commit; failed batch returns no imported count
        Boundary-->>Owner: skipped-input report + committed add/batch result
    else Message / acceptance / new startChat action
        Boundary->>Product: action without caller signal fields
        Product->>DB: commit primary product action + server evidence
        DB-->>Product: durable row/timestamp
        Product-->>Owner: primary action succeeds independently
        Product->>Edge: secondary edge side effect and/or touch (best effort)
        Edge->>DB: atomic edge+origin if created; GREATEST recency
        Edge-->>Product: updated/missing/isolated failure
    end
    Note over Product,Edge: Already-accepted startChat persists no event and skips recency capture

    Shadow->>DB: owner-scoped nullable signals
    Shadow->>Shadow: classify(source, recency, asOf, version)
    Shadow-->>Shadow: aggregate coverage/rank-delta metrics only

    opt Default-off ranking experiment
        Intro->>DB: current intent-freshness candidates + private signals
        Intro->>Intro: reviewed versioned ordering policy
        Intro-->>DB: enqueue same introducer jobs as current path
    end

    Owner->>Premise: create_premise
    Premise->>DB: persist + automatic network assignment (unchanged)
    DB-->>Premise: assigned networks
    Premise->>Preview: canonical discovery scope + preview-only non-ghost/Owner exclusions
    Preview-->>Owner: network names + suppressed/bucketed human-recipient estimate
    Note over Premise,Preview: No graph pause, confirmation, or read gate in v1
```

## Introducer integration: measurement before ranking

The natural integration point is `ContactWithIntents` and `getContactsWithIntentFreshness`, but the disabled path must preserve current semantics exactly: the same query, limit, ordering by active-intent freshness, handling of null freshness, selected contacts, and enqueued jobs. The flag check must occur before any alternate query or reorder.

### Shadow evaluation

`CONTACT_TIE_SHADOW_ENABLED === 'true'` computes, without changing selection. The live query currently applies `LIMIT 5`, so shadow cannot meaningfully compare top-five policies by merely reordering those five. A separate shadow-only query loads a deterministic intent-freshness-ordered superset, with `INTRODUCER_TIE_SHADOW_CANDIDATE_LIMIT` defaulting to 50 and hard-clamped to `[5,100]`; it has an index/query-plan budget and never feeds jobs. With shadow disabled, this query is not executed and the exact current limited query remains authoritative.

Shadow reports observational feasibility, not the counterfactual effect of a ranking that was never served:

- signal coverage: `unknown` versus classified, aggregated without pair IDs;
- top-five overlap/Jaccard and rank-displacement histograms between current output and candidate policies over the bounded superset;
- owner-level concentration/diversity changes in privacy-thresholded aggregates;
- candidate-pool truncation and missing-signal rates;
- queue completion, opportunity creation, owner approval, and eventual acceptance by experiment cohort, not by pair; and
- classifier-version and `asOf` policy used.

Shadow code must not log candidate identities, contact sources tied to owners, exact interaction timestamps, or per-owner rank lists. Cohorts below the analytics privacy minimum are suppressed.

### Ranking flag

`INTRODUCER_TIE_RANKING_ENABLED === 'true'` is default-off and independently requires shadow mode's validated classifier version. It must be a strict literal; every other value is disabled. Enabled ranking uses a reviewed, versioned lexicographic policy and preserves current intent freshness as the within-band tie-breaker. It must not invent a weighted “tie score.”

Which band receives priority is deliberately **not** selected by theory alone. `candidate_weak`-first is only a sparse-signal routing hypothesis inspired by weak-tie theory; it does not measure structural bridging. `recently_active`-first is only a pair-recency hypothesis; it does not establish delivery or reply likelihood. Phase C chooses one pre-registered policy only after shadow feasibility evidence, records that choice in an implementation ADR/ticket, and evaluates causal product impact through a limited controlled experiment. Unknown contacts remain eligible unless evidence supports a separate exclusion decision.

Minimum evidence to authorize a limited experiment—not general rollout—is:

- at least 30 consecutive days of shadow observation;
- at least 1,000 eligible maintenance cycles across at least 100 distinct owners;
- at least 80% non-unknown signal coverage in the evaluated candidate pool;
- stable results under at least two reasonable recency windows (for example 30/90/180-day sensitivity analysis, without changing v1 labels);
- a pre-registered ordering and candidate-pool policy;
- no privacy/security finding and no material queue/reliability regression; and
- human review of confidence intervals for downstream owner approval/acceptance, diversity, and unknown-contact displacement.

These are operational sufficiency floors, not scientific validation. If the population cannot meet them, ranking remains off. Broad rollout requires a separate decision after the limited experiment.

## Advisory post-assignment exposure preview

### Semantics

After automatic premise assignment completes, `create_premise` may enrich its owner-only result with an advisory preview. Assignment, threshold `0.7`, persistence, and graph completion remain unchanged. Preview failure never rolls back the premise or assignment.

The preview estimates a **potential active-human recipient audience** for each assigned network at query time. It is neither the complete discovery candidate count—current discovery can include ghosts—nor an upper bound on every current direct/tool/admin read, because those surfaces do not all apply the discovery network predicate. It is not a statement that anybody read, received, matched, or will discover the premise, and it is not causal reach. The UI label must say “potential network audience,” never “people who can read this.”

```ts
// Illustrative owner-only response extension.
type PremiseExposurePreviewBase = {
  networkId: string;
  networkName: string;
  notice: 'Potential network audience, not actual exposure';
};

type PremiseExposurePreview = PremiseExposurePreviewBase & (
  | {
      status: 'estimated';
      audience: {
        bucket: '2-4' | '5-9' | '10-24' | '25-49' | '50+';
        basis: 'active_distinct_non_ghost_recipients_excluding_author';
      };
    }
  | {
      status: 'suppressed' | 'unavailable';
      audience?: never;
    }
);

type CreatePremiseExposureExtension = {
  // Present only when preview is enabled; one item per assigned network.
  exposurePreviews?: ReadonlyArray<PremiseExposurePreview>;
};
```

When preview is disabled, `create_premise` omits `exposurePreviews` for compatibility. When enabled, it returns exactly one item per assigned network: `estimated` requires a bucket, while `suppressed` and `unavailable` cannot serialize one.

Two explicit predicate layers prevent preview privacy rules from silently narrowing discovery:

1. **Canonical assignment-scoped discovery reachability.** Phase D1 inventories premise-similarity, context-to-intent, HyDE, and other assignment-scoped discovery queries; reconciles divergent active-network, active-membership, deleted-user, personal-network, and caller/agent-scope behavior; and migrates them to one tested policy surface. Explicit policy parameters may preserve stricter path-specific semantics. Per-query parity is required, including current ghost participation: the canonical discovery scope does not add `isGhost = false`. Permissions remain permission-agnostic only if reconciliation proves that current behavior. Changing whether ghosts participate in discovery is a separate product/privacy/security decision outside IND-429.
2. **Preview-recipient eligibility.** Starting only from users reachable under that canonical discovery scope, the preview additionally requires `users.deletedAt IS NULL`, `users.isGhost = false`, and `userId != premiseAuthorId`. These are intentional owner-facing active-human audience rules, not claims that discovery applies identical ghost or author filters.

No single canonical discovery predicate exists today. D1 must prove semantic parity and migrate assignment-scoped discovery before preview code uses that policy; any other widening or narrowing requires separate product plus privacy/security approval. Preview then uses `COUNT(DISTINCT userId)` over its stricter recipient-eligibility layer, not `getNetworkMemberCount`, which counts membership rows and includes the author. The query returns no member identities. The direct-read inventory remains separately documented because this estimate cannot bound inconsistent tool/admin reads. Preview implementation and rollout are blocked until D1's canonicalization is complete.

### Suppression and configuration

```dotenv
PREMISE_EXPOSURE_PREVIEW_ENABLED=false
PREMISE_EXPOSURE_PREVIEW_MIN_MEMBERS=5
```

The separately named minimum defaults to five and is hard-clamped to `[2,100]`, following the locked frame-drift-style threshold decision. When the count is below the minimum, return `status:'suppressed'` with no exact count, lower bound, or narrower bucket. Suppression is a normal privacy outcome, not an error. At or above the threshold, return one of `2–4`, `5–9`, `10–24`, `25–49`, or `50+`; the `2–4` bucket is reachable only when an operator explicitly lowers the minimum below five. If the configured minimum falls inside a bucket, values below the minimum still suppress and the bucket reveals only that the value is both at least the minimum and within the published range. If the minimum is above a bucket boundary, omit impossible lower buckets.

The preview is computed once from the post-assignment snapshot and returned only on that create result; v1 adds no refresh/count endpoint. Rate limits on premise creation and bucket width reduce probing, while tests model add/remove and sybil boundary attacks. Repeated requests must not produce exact deltas in logs or telemetry.

Only the premise owner receives previews, and only for networks already returned by their completed assignment. Public contact/network/member APIs, MCP list tools, other members, opportunity candidates, and analytics exports do not receive them. Network names are already owner-visible; member names are never returned.

A future pre-assignment gate could show the same estimate before persistence and request confirmation. That would change graph control flow, timeout semantics, tool UX, and failure behavior, so it is a later explicit product/design decision and not a v1 extension of this preview.

## Failure semantics and repair

| Failure | V1 behavior |
| --- | --- |
| Schema is absent or incompatible during deployment | Migration-first rollout prevents schema-dependent readers/writers from deploying before the migration. Capture remains disabled until migration and all compatible instances are complete. A mismatch is a deployment/startup failure to roll back or repair, never silently handled by runtime column feature detection. |
| Direct add or bulk membership/provenance write fails | With capture disabled, existing membership behavior is unchanged and signals remain null. With capture enabled, a single add rolls back its edge+origin/details together. Import resolution/dedup may already have classified inputs as skipped, but the surviving edge set and all required origins/details commit or roll back in one existing batched persistence unit. A failed batch throws before returning an imported count; it never reports per-item database success or a successful edge missing provenance. |
| Secondary contact edge/origin side effect fails after committed acceptance/new startChat | The opportunity/chat remains committed; the directional edge+origin write is atomic if retried, and aggregate diagnostics support idempotent repair without inventing provenance. |
| Recency touch fails after message/accept/new startChat | The product action remains committed; later qualifying interaction or conservative backfill may repair recency. Already-accepted `startChat` performs no touch. |
| One directional edge is missing | Update the existing direction only; do not create the missing edge except in existing acceptance/startChat creation flows. |
| Duplicate/out-of-order touch | `GREATEST` keeps the newest trusted timestamp; equal timestamps use the fixed `dm_message` > `opportunity_acceptance` > `conversation_started` > `backfill_dm_message` > `backfill_opportunity_actor_action` provenance order. |
| Tombstone authority is ambiguous/legacy | Fail closed to `contact_opt_out`; do not restore until an authorized action or migration resolves it. |
| Ghost merge collides with an existing edge | Target tombstone/active edge wins; clear source-ghost signals; never merge recency. |
| Account erasure races capture/repair | Transactional active-user predicates make the writer roll back/no-op; invalidate queued repair and caches. |
| Classifier receives malformed/future data | Fail closed to `unknown` or source-only `candidate_weak`; emit aggregate invalid-input count. |
| Shadow evaluator fails | Current introducer selection and queueing continue unchanged. |
| Ranking code fails while flag is on | Fall back to the exact current intent-freshness path and emit an aggregate fallback counter. |
| Preview query fails | When preview is enabled, return the successful premise result with that assigned network's preview item set to `unavailable` and no audience bucket; never fail or undo assignment. Field omission is reserved for preview-disabled compatibility. |
| Preview cohort is too small | Return `suppressed`; do not log the exact count. |
| Backfill batch fails | Roll back that batch, retain checkpoint before it, retry idempotently. |

Repair jobs must use the same trusted derivation rules as the original writer. No operator endpoint may accept arbitrary source or timestamp values.

## Observability without relationship leakage

Allowed operational metrics are global or privacy-thresholded aggregates such as:

- capture attempts/results by trusted boundary and coarse outcome (`created`, `restored`, `existing`, `opted_out`, `failed`);
- touch attempts and number of directions updated (`0`, `1`, `2`) by basis;
- backfill scanned/eligible/updated/skipped-invalid/skipped-deleted counts;
- classifier version and aggregate band coverage;
- introducer shadow overlap and displacement histograms;
- ranking fallback counts; and
- preview estimated/suppressed/unavailable counts by bucket, without network or owner labels.

Forbidden metric/log dimensions include user IDs, emails, contact IDs, raw network IDs, exact timestamps, source+owner combinations, pair hashes, per-owner candidate lists, message/opportunity IDs joined to bands, and any low-cardinality slice that enables pair reconstruction. Hashing a pair does not make it anonymous.

Signal analytics use distinct owners—not events or edges—as the privacy unit, stable weekly cohorts, coarse predeclared dimensions, and a fixed release cadence. Arbitrary date/window/version cross-slicing and repeated differencing queries are prohibited. Raw operational aggregates are access-controlled and retained for at most 30 days unless an approved incident hold applies.

Signal-specific logs do not share a request/trace identifier with pair-bearing application logs. A tightly restricted security incident store may correlate them transiently under audited access, but ordinary observability cannot. Analytics exports apply the same default-five, hard-clamped `[2,100]` cohort suppression concept as the preview/frame-drift precedent. Absence of a metric means unobserved/unknown, not proof that no interaction occurred.

## North-star read-side model (not approved for implementation)

A future SOCPRI-inspired model could distinguish:

- a **default** representation containing context-free, deliberately shareable identity material; and
- **contextual** representations/premises whose transmission depends on the active context, recipient class, information type, and user policy.

Mondal & Ur's exposure-control framing would make the relevant question “is the predicted recipient set consistent with the user's expected exposure?” rather than “is this person in a network?” Tie evidence might be one input to that policy, but never the sole authorization fact.

This is not current behavior. Today, network assignment and active membership govern premise/context discovery. The global `user_context` is already excluded from context-to-intent discovery, but that implementation detail does not constitute a SOCPRI default profile or read policy.

Before any read gate is designed for approval, all of the following are hard prerequisites:

1. richer, validated evidence beyond source plus one recency timestamp, including a user correction/override path;
2. explicit policy semantics for information types, default versus contextual content, recipient classes, transmission principles, and precedence;
3. a complete read-path coverage inventory, including premise search, HyDE search, context-to-intent retrieval, opportunity evaluation/presentation, profile/contact tools, feeds/digests, queues, caches, and administrative/debug paths;
4. false-negative and false-positive analysis, especially harm from blocking legitimate bridging ties or exposing sensitive context;
5. owner UX for preview, explanation, correction, appeal, and emergency rollback;
6. migration/versioning rules for existing assignments, cached presentations, contexts, and policy changes;
7. adversarial privacy/security review and performance tests; and
8. a separate design approval and implementation ticket.

Until then, no classifier band may filter source premises, candidates, contexts, opportunities, or member reads.

## Feature flags and rollout

| Flag/config | Default | Purpose |
| --- | --- | --- |
| `CONTACT_SIGNAL_CAPTURE_ENABLED` | `false` | Enables trusted origin/recency writes after additive migration. |
| `CONTACT_TIE_SHADOW_ENABLED` | `false` | Computes non-authorizing bands and aggregate ranking comparisons. |
| `INTRODUCER_TIE_SHADOW_CANDIDATE_LIMIT` | `50` | Shadow-only superset cap, hard-clamped to `[5,100]`; never changes live selection. |
| `INTRODUCER_TIE_RANKING_ENABLED` | `false` | Enables only the evidence-approved, versioned ranking experiment. |
| `PREMISE_EXPOSURE_PREVIEW_ENABLED` | `false` | Adds the owner-only post-assignment preview. |
| `PREMISE_EXPOSURE_PREVIEW_MIN_MEMBERS` | `5` | Privacy threshold, hard-clamped to `[2,100]`. |

Boolean flags use exact literal `true`; unset, mixed-case, or any other value means disabled. Capture, shadow, ranking, and preview are independent. Ranking may require shadow infrastructure, but enabling capture must not implicitly enable any consumer.

The existing `CONTACTS_ENABLED` gate remains authoritative for ordinary contact add/import tool availability. `CONTACT_SIGNAL_CAPTURE_ENABLED` only annotates contact writes that the product already permits; it never enables a disabled add/import surface. When false, permitted membership writes retain current behavior with null signal fields. When true, origin/details are atomic with one directed single-add edge and, for import, across the surviving edge set in the existing batched persistence operation; reciprocal acceptance/chat directions remain independent. Existing acceptance/startChat contact side effects currently bypass `CONTACTS_ENABLED`; v1 preserves that product behavior unless a separate ticket changes it, while still gating their signal annotation. The flag matrix is tested in REST, MCP, REST tool, and in-process chat composition roots, including the current `ToolService` dependency wiring.

Rollout proceeds additive migration → dark deploy → trusted capture cohort → backfill → shadow observation → separately approved limited ranking experiment. Preview is independent of tie capture, but remains blocked until D1 reconciles and migrates all assignment-scoped discovery queries to the canonical reachability predicate and D2's privacy query is verified. Rollback disables consumers first, then capture. Nullable columns remain for compatibility; rollback does not rewrite or expose data. A privacy incident additionally triggers signal-field erasure and cache invalidation. Read behavior is unchanged throughout v1, so no read-gate rollback is needed.

## Test strategy for follow-up implementation

### Schema and persistence

- migration applies on empty and populated databases and leaves legacy/non-contact rows null;
- constraints reject signals on deleted/non-contact rows;
- insert, duplicate, reasoned tombstone, authorized restore, permission/network change, and erasure obey lifecycle semantics;
- `owner_removed`, `contact_opt_out`, legacy tombstones, and `clearReverseOptOut*` follow the authority matrix;
- claim-in-place and merge-to-existing fixtures cover absent, active, and tombstoned target edges and clear source-ghost signals;
- account erasure is atomic against concurrent touch/repair and invalidates derived caches/jobs;
- reciprocal rows retain independent values;
- monotonic touches handle retry, out-of-order, one missing direction, and all five equal-time bases using the fixed priority order;
- callers cannot inject source/details/timestamps through REST or MCP payloads.

### Surface coverage

Create integration tests for REST add, MCP/chat generic import, Gmail and Slack import, `updateOpportunityStatus`, new and already-accepted `startChat`, human DM message, protocol graph acceptance through MCP/Hermes, REST tool API and in-process chat, CLI single-add/Gmail forwarding, connect-link routing, ghost unsubscribe/non-human cleanup, ghost merge, and account deletion. Each test asserts both the primary product result and exact signal side effect—or deliberate absence. Direct-add fixtures prove edge+origin/details atomicity. Bulk-import fixtures distinguish resolution/dedup skips from database persistence: a successful batch gives every created/restored surviving edge its trusted origin/details, while an injected batch failure rolls back the whole surviving edge set and returns no false imported count. Committed mixed-status fixtures preserve the existing `ImportResult` mapping (`imported`/`details` from the deduplicated retained set and `skipped` from resolution/dedup) while independently asserting lifecycle/provenance status. They do not assert per-item database partial success. Already-accepted `startChat` proves no edge or recency write because no durable action timestamp exists. The surface and flag matrices above are the acceptance oracle.

### Backfill and classifier

- fixture DMs require `role='user'`, sender membership, exactly two relevant user participants, and consistent `dmPair`; agent/system and stale post-merge pairs are skipped;
- accepted opportunities require exactly two distinct active non-introducer participant users, with `acceptedBy` matching the actor carrying parseable `actedAt`; zero/one/>2, duplicate/malformed, introducer-fallback, and ambiguous sets are skipped and aggregate-counted;
- batches are deterministic, restartable, and idempotent under concurrent deletion; equal timestamps select/update the higher-priority basis using the same five-value order as live touching;
- classifier parser/table tests cover absent details, malformed JSON/shape, unsupported versions, impossible Slack+Gmail-group data, source mismatch, source-only evidence, valid source-null `conversation_started`, recent, boundary-at-90-days, stale, future, combined reason precedence, and explicit `asOf`;
- property tests assert determinism and that moving `asOf` forward cannot turn stale evidence into recent evidence.

### Introducer

- with both flags off, query parameters, ordering, selected IDs, and enqueued job payloads match current golden fixtures byte-for-byte/semantically exactly;
- shadow failure cannot alter current output;
- enabled policy is deterministic and uses current freshness as its documented tie-breaker;
- unknown contacts are handled according to the approved experiment policy;
- telemetry contains no pair identifiers or raw timestamps.

### Preview and privacy

- D1 inventories divergent premise-similarity, context-to-intent, HyDE, and other assignment-scoped predicates, then migrates them to one tested canonical discovery-reachability policy before preview code exists, preserving current ghost participation;
- the separately tested preview-recipient predicate builds on canonical discovery scope, then counts active distinct non-ghost users and excludes the author; these extra filters are not asserted as discovery parity and the count does not depend on `getNetworkMemberCount`;
- counts below every configured/clamped threshold suppress normally;
- `2–4` is reachable only below the default minimum; boundary buckets and high thresholds reveal no impossible lower bucket;
- one-shot response and rate-limit tests cover repeated add/remove and sybil probing;
- only the owner receives network names and bucketed results; no member identity or exact small count is serialized;
- query failure leaves premise creation and assignment successful;
- public API/MCP snapshots prove source, recency, details, bands, and reasons are absent.

### Future gate

No read-gating test should be added in phases A–D because no read gate is approved. Phase E begins with a read-surface inventory and threat-model tests, not enforcement code.

## Phased implementation tickets

### A1 — Add nullable schema and shared persistence primitives

**Depends on:** this design approval.

**Scope:** one canonical schema-layer `contactSourceValues` tuple; Drizzle enum/columns/migration; derived internal `ContactSource` and trusted-origin/detail types; centralized API-side single/bulk upsert and touch primitives; no capture consumers enabled.

**Acceptance criteria:** the TypeScript type and Drizzle enum derive from the same exported tuple with no duplicate values list; migration is additive and migration-first; public `ContactInput` and serializers are unchanged; row-local and personal-network invariants are tested; monotonic writes and ordinary duplicate provenance pass; package versions are bumped only for packages actually touched.

### A2 — Converge contact lifecycle and tombstone semantics

**Depends on:** A1.

**Scope:** both contact/chat adapter implementations, reasoned tombstones, reason-aware `clearReverseOptOut*`, unsubscribe/non-human cleanup, network lifecycle, ghost claim/merge, account erasure, and cache/job invalidation.

**Acceptance criteria:** the authority/collision matrix is transactionally tested; restoration records a new trusted origin; no action by one owner clears another owner's opt-out; ghost merge never combines identity recency; erasure cannot race a touch; all invalid edges have null signals.

### A3 — Wire trusted acquisition origins

**Depends on:** A2.

**Scope:** REST/manual, MCP/chat generic import, Gmail/Slack import with preserved toolkit/group, actual CLI forwarding semantics, and experiment-network CSV non-contact documentation.

**Acceptance criteria:** every acquisition boundary has a composition-root test; capture-off preserves current membership writes with null signals; capture-on makes a single directed add and origin/details atomic, while each import's surviving post-resolution/dedup edge set plus all trusted origins/details succeeds or fails in one existing batched persistence operation; skipped-input reporting remains distinct from database success; committed mixed outcomes preserve the existing `ImportResult` mapping while lifecycle/provenance statuses are verified independently; a failed batch returns no false imported count; no per-item database persistence semantics are introduced; generic arrays never claim CSV and `csv_import` remains unwritten until a separately approved trusted personal-contact CSV parser/test exists; Gmail/Slack origin unions reject impossible combinations; CLI/Hermes are not falsely attested as surfaces; no caller field/header/metadata can spoof origin or details; existing `CONTACTS_ENABLED` availability is unchanged.

### A4 — Wire trusted interaction capture and acceptance parity

**Depends on:** A2.

**Scope:** event-specific wrappers for user-role DM messages, REST acceptance, the new `startChat` transition, and protocol graph acceptance through MCP/Hermes, REST tool, and in-process chat; explicit no-op treatment for already-accepted `startChat`.

**Acceptance criteria:** each already-committed message/opportunity/chat product action remains failure-isolated from secondary capture; source/basis/timestamp are derived from durable evidence; new `startChat` uses its qualifying persisted transition and remains source-independent for classification; already-accepted `startChat` performs no edge or recency write because it persists no action timestamp; graph acceptance no longer bypasses contact semantics; one event does not double-touch; missing reverse edges are not fabricated by DM; connect-link clicks remain no-op unless they reach a qualifying action.

### A5 — Run conservative recency backfill

**Depends on:** A1/A2; run after A4 deploy so live writes win monotonically.

**Scope:** dry-run/reporting CLI, bounded idempotent batches, validated user-role DM messages and accepted-actor evidence only, checkpoints and repair diagnostics.

**Acceptance criteria:** rerun produces zero additional changes; mismatched `dmPair` rows are skipped/counted; opportunity evidence requires exactly two distinct eligible non-introducer participants and matching `acceptedBy`/`actedAt`, with every ambiguous actor shape skipped/count-only; no first-actor fallback, `opportunities.updatedAt`, `conversations.lastMessageAt`, empty-DM creation, or link click is mislabeled as interaction; concurrent deletion/merge/erasure is safe; production execution follows the project's safe backfill workflow.

### B1 — Implement pure classifier and privacy-safe shadow coverage

**Depends on:** A3, A4, and A5 diagnostics.

**Scope:** `contact-signal-v1`, reason codes, explicit `asOf`, aggregate coverage/sensitivity reports; no persistence and no behavioral effect.

**Acceptance criteria:** the raw `unknown` parser and classifier table/property tests pass; malformed versus unsupported details have distinct deterministic reasons; combined parse/future/source outcomes follow fixed precedence; valid recent `conversation_started` remains source-independent; output never leaves owner-scoped internals; malformed data fails conservatively; shadow reports meet telemetry suppression rules.

### B2 — Shadow introducer candidate policies

**Depends on:** B1.

**Scope:** run the bounded shadow-only superset query, compute candidate ordering deltas while the current limited selection remains authoritative, and gather minimum-evidence metrics.

**Acceptance criteria:** shadow off executes the exact current `LIMIT 5` path; shadow on never feeds jobs; query-plan/latency budget and `[5,100]` cap hold; no pair-level logs; 30-day/volume/coverage gate is reportable; a recommended or rejected policy is documented with sensitivity analysis.

### C — Default-off introducer ranking experiment

**Depends on:** B2 meeting the stated evidence floor and separate experiment approval.

**Scope:** strict-literal ranking flag; one pre-registered versioned lexicographic policy; fallback to current ordering.

**Acceptance criteria:** disabled path is unchanged; enabled path is deterministic; unknown handling and candidate-pool bounds are documented; reliability/privacy guardrails pass; rollback is one flag flip.

### D1 — Specify and implement the preview estimate query

**Depends on:** this design approval; can proceed in parallel with B.

**Scope:** inventory discovery versus direct/tool reads and every assignment-scoped discovery query; reconcile premise-similarity/context-to-intent/HyDE filter differences; define and migrate those queries to one canonical discovery-reachability policy without changing current ghost participation; then define the stricter preview-recipient predicate and implement its active-distinct-non-ghost, author-excluding count, network-type/scope semantics, separately named minimum config, and suppression/buckets.

**Acceptance criteria:** all assignment-scoped discovery queries use the same tested policy surface—with explicit parameters where required to preserve stricter path semantics—for active network, active membership, deleted-user handling, personal-network semantics, and caller/agent scope; per-query semantic parity is proven and no `isGhost = false` narrowing is introduced into discovery; changing ghost participation is rejected from IND-429 pending separate product/privacy/security approval; preview remains blocked until migration completes, then its separately tested recipient predicate adds non-ghost and author exclusions without claiming those filters are discovery parity; any other widening/narrowing is rejected from D1; the estimate is explicitly not claimed to equal the full discovery pool or bound all direct reads; `COUNT(DISTINCT)` and all threshold/bucket boundaries are tested; no identity leaves the adapter.

### D2 — Add owner-only post-assignment preview

**Depends on:** D1.

**Scope:** optional `create_premise.exposurePreviews` array after completed assignment; one discriminated item per assigned network; one-shot preview snapshot and owner-facing copy.

**Acceptance criteria:** no graph pause or confirmation; the count starts from canonical discovery scope but excludes the author and ghosts as preview-only active-human recipient rules; `estimated` requires a bucket and `suppressed`/`unavailable` forbid one; enabled query failure returns an `unavailable` item while flag-off omits the optional array; member identities and exact small counts never appear; repeated-probe tests pass; query failures do not fail premise creation; UI copy says potential network audience, not actual readers/exposure or the complete discovery candidate pool.

### E — Read-side gating research and design

**Depends on:** sustained captured-data validation, user-correction research, phases B/C findings, complete read inventory, and separate approval.

**Scope:** policy semantics and UX research only at first; no enforcement code.

**Acceptance criteria:** all north-star prerequisites are answered; false-positive/negative and appeal paths are reviewed; migration/cache/versioning plan exists; security/privacy approval explicitly authorizes any subsequent implementation.

## Alternatives rejected

| Alternative | Why rejected for v1 |
| --- | --- |
| Store everything in `network_members.metadata` | Hides ownership/type semantics, encourages unallowlisted payloads, and makes migrations/constraints/querying ambiguous. Typed nullable columns plus a narrow details object are more auditable. |
| Create a contact-events or tie table | Adds history, retention, and surveillance risk before the sparse signals prove useful. The locked v1 model needs one directional edge state only. |
| Extend public `ContactInput` with source/timestamp | Lets external clients spoof provenance and recency and forces protocol/public package changes for private server evidence. |
| Infer reciprocal/symmetric ties | Violates owner scope and opt-out semantics; reciprocal rows are independent. |
| Use intent freshness as relationship recency | It measures the contact's own intent activity, not interaction with the owner. |
| Use conversation `lastMessageAt` or opportunity `updatedAt` in backfill | Both can reflect unrelated/system updates and overstate evidence. |
| Persist a numeric tie score or LLM label | Creates false precision, unexplained coefficients, stale derived state, and a tempting authorization primitive. |
| Enable ranking immediately | Sparse unknown data and unmeasured displacement could degrade introducer diversity/reachability. |
| Preview exact member counts or identities | Creates membership inference and pair disclosure; buckets and suppression meet the advisory goal with less leakage. |
| Pause `create_premise` for confirmation | Changes graph/tool UX and failure semantics before advisory comprehension is measured. It is a later decision. |
| Implement read-side gating now | Current evidence cannot justify it, and the read surface/policy/appeal prerequisites are unresolved. |

## Explicit non-goals

- claiming or persisting “strong tie” status;
- recording message contents, interaction frequency, social distance, duration, or closeness;
- creating contacts from ordinary messages or connect-link clicks;
- exposing source, recency, band, or reason codes publicly;
- changing network assignment threshold or network membership semantics;
- changing opportunity eligibility or negotiation behavior;
- per-tie read filtering in phases A–D;
- a pre-assignment confirmation gate in v1; or
- updating `CLAUDE.md` to describe unimplemented behavior.

## Open questions

Only evidence-dependent choices remain open:

1. After shadow measurement, should the limited introducer experiment test `candidate_weak`-first bridging, `recently_active`-first reachability, or reject tie-informed ranking entirely?
2. Within the shadow safety cap `[5,100]`, what production candidate-pool bound preserves current maintenance cost while giving a flagged ranking policy enough contacts to reorder? Phase B must measure the distribution and query plan before Phase C chooses it.

The storage model, trusted recency boundary, post-assignment advisory preview, and deferral of read-side gating are locked decisions, not open questions.

## Documentation and verification note

This document is the deliverable; it intentionally changes no runtime, schema, API, queue, or package code. The root README curates only the architecture overview and protocol deep dive rather than every focused design page, so no root index update is required by current convention. Implementation tickets must update domain/spec documentation when behavior actually ships.
