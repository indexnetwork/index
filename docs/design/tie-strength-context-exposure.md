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
| Opportunity evidence | Opportunities have mutable `updatedAt`, no dedicated accepted timestamp, and actor JSON may contain `actedAt`. Explicit accept paths stamp the acting actor. `updatedAt` alone is only an approximation and must not be presented as acceptance time. The locked stamp currently preserves an existing actor `actedAt` but still updates the row, so concurrent same-actor callers can both reach post-commit side effects. | `services/api/src/schemas/database.schema.ts:415-461`; `services/api/src/adapters/opportunity.database.adapter.ts:903-940` |
| Existing action outbox | `updateOpportunityStatus` and new `startChat` already pass an optional Lens B `AtomicOutcomeOutbox` into the actor-action transaction. Its independent `result.inserted` bit gates post-commit outcome mining. Contact capture must compose with—not replace or overload—this payload and trigger. | `services/api/src/adapters/opportunity.database.adapter.ts:18-60,145-163,903-940`; `services/api/src/services/opportunity.service.ts:649-695,923-966` |
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
| Small audience counts reveal membership | Suppress previews below the configured minimum, suppress threshold-singleton bucket intersections, bucket larger counts, and reserve releases in the durable owner/network ledger before counting. This constrains same-owner probing; cross-owner/Sybil inference remains a documented residual risk, not a solved claim. |
| Stale or sparse evidence is called “strong” | Use non-authorizing preliminary bands with explicit reason codes and version; retain `unknown`; do not implement read gating. |
| A ghost contact is treated as an active reader or its signals leak during merge | Ghost edges may hold source data, but ghosts are excluded from preview. Claim-in-place preserves the same owner edge; merge-to-existing follows the collision rules below and clears the source ghost in one transaction. |
| Unilateral activity is mistaken for mutual engagement | A DM is a pair-event recency signal only; its direction is validated and it never implies reply, closeness, or reciprocal engagement. The band remains non-authorizing. |
| Deleted contacts remain analytically visible | Clear source, recency, and detail fields on removal; preserve only the minimal reasoned opt-out tombstone; exclude tombstones and deleted endpoint users from classification and metrics. |
| Account erasure races a capture/repair job | Lock/mark the user and clear inbound/outbound signals atomically; every writer re-checks both endpoint users; invalidate caches and queued repairs. |
| Logs or metrics reconstruct a pair | Remove the existing import-dedup log's `ownerId`, contact email, `matchedWith`, and per-item scores before capture can be enabled. Route import/capture telemetry only through a dedicated privacy-aggregate sink that cannot inherit request, trace, span, user, session, or pair context; never use the generic logger/Sentry path for these events. Permit only allowlisted aggregate counts and coarse preset/outcome labels. Request-path preview telemetry must never contain an audience bucket, exact count, network, owner, reservation, premise, or pair field because low-volume application logs can still enable time correlation. Use stable owner-count cohorts and prevent repeated differencing across exports. |

## V1 data model

Signal storage remains on `network_members`; no contact-event history or metadata-only signal representation is introduced in v1.

### Private operational state—not tie/event analytics

V1 also requires three narrowly scoped, migration-first operational stores. None is a public/read API, classifier input, relationship-history source, or analytics corpus:

1. **`contact_action_repair_obligations` (A4):** one idempotent row per winning capture-on actor action. It stores `actionKey`, `opportunityId`, explicit `actorUserId` and `counterpartUserId`, action/source/basis, persisted action time, independent directional dispositions, bounded attempt/expiry state, and timestamps. It is access-controlled, excluded from ordinary logs/exports/classification, deleted after both directions are successful/terminal or on account erasure, and never stores message/contact content. Its repair/cleanup processor is migration-installed and capture-independent: turning capture off admits no new row but cannot strand a row already committed while capture was on.
2. **`contact_privacy_aggregate_counters` (A3):** coarse time bucket, allowlisted event/boundary/outcome dimensions, and an atomic count only. It contains no owner/contact/network/opportunity/message/request/trace/span/session identifiers or pair hashes. A detached exporter may read these aggregate rows; bounded cleanup follows the 30-day operational retention.
3. **Preview privacy ledger (D2):** database-backed `premise_preview_owner_reservations(ownerUserId,reservedAt,expiresAt)` rows provide the exact rolling-24-hour count, while `premise_preview_network_releases(ownerUserId,networkId,reservationId,lastReservedAt,expiresAt,consumedAt)` stores only cooldown plus single-use state. `reservationId` is a random private UUID returned only to the adapter caller; `consumedAt` is null until the one authorized count attempt. Neither is serialized or logged. The ledger stores no audience count, bucket, member identity, premise content, or contact signal. Expiry indexes support cleanup bounded by the configured windows; account erasure deletes both row kinds.

All three use dedicated adapters and tables, not `network_members.metadata`, the generic `RedisCacheAdapter`, or fail-open transport limiters. Their migrations must land before any dependent flag can enable. Database/storage failure fails closed according to the contracts below.

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

type ContactRecencyDetailsV1 =
  | {
      basis: 'dm_message' | 'opportunity_acceptance' | 'conversation_started';
      backfilled: false;
    }
  | {
      basis: 'backfill_dm_message' | 'backfill_opportunity_actor_action';
      backfilled: true;
    };

type ContactSignalDetailsV1 = {
  schemaVersion: 1;
  acquisition?: ContactAcquisitionDetailsV1;
  recency?: ContactRecencyDetailsV1;
};
```

The details writer constructs a fresh object from an allowlist; it never spreads caller/provider metadata. The acquisition union is discriminated by `source` and then `toolkit`, and the writer verifies that its `source` matches the typed `contact_source` column. Gmail alone may carry `gmailGroup`; a Slack-plus-Gmail-group object cannot parse as v1. `clientSurface` is optional and means only the server route/transport it directly observed: session web route, non-web API route, MCP transport, or internal service call. CLI and Hermes cannot be distinguished after they forward through a public REST/MCP composition and therefore are never stored as surfaces. Headers, wrapper names, agent-provided metadata, and payload fields cannot attest a surface.

Each retained detail has a narrow purpose: toolkit/group audits whether trusted origin capture is complete, and recency basis lets the classifier distinguish eligible durable evidence. If a detail is not consumed by those audits or classification, the writer omits it. Edge details share the edge lifecycle and are cleared on removal/erasure; no separate long-lived copy is allowed.

Forbidden data includes filenames, free text, contact or message content, email addresses, provider IDs, workspace/account IDs, raw interaction history, interaction counts, IP/user-agent values, inferred relationship labels, and caller-supplied timestamps. Gmail grouping can be retained only if provider parsing preserves whether an item came from `connections` or `otherContacts`; current concatenation must be refactored before that detail is written.

### Edge lifecycle and conflict semantics

Before the first capture activation, dark-deployed schema/code retains the current hard-delete and reverse-opt-out behavior while capture is off. Enabling capture switches all listed lifecycle paths together and permanently activates reason-aware tombstone protection for that deployment. After any reasoned tombstone exists, disabling capture stops admitting signal/obligation work from new product actions but lets already-committed obligations finish or expire under their original authority; it **does not** restore hard-delete/clear-reverse behavior that could erase `contact_opt_out`. Tombstone protection is monotonic unless a separately approved rollback migration resolves every protected row first. Capture-off product actor transitions, Lens B behavior, side-effect scheduling, and failure isolation remain exact; only reason-aware lifecycle protection plus bounded cleanup of pre-existing obligations survive rollback. No mixed-mode edge may retain signals under legacy deletion semantics.

1. **Initial insert:** with capture disabled, preserve current membership behavior and leave signal columns null. With capture enabled, atomically set source and allowlisted acquisition details from the trusted origin; recency remains null unless the same trusted action also qualifies as an interaction.
2. **Ordinary duplicate upsert:** do not overwrite source or acquisition details, including a legacy null source. A repeated import is not evidence of original acquisition. Monotonic recency touching is a separate operation.
3. **Reasoned tombstone:** removal soft-deletes the edge and atomically nulls `contact_source`, `last_interaction_at`, and `contact_signal_details`. The pre-existing `network_members.metadata` may retain only an allowlisted `contactTombstone:{version:1,reason,tombstonedAt}` object, where reason is `owner_removed` or `contact_opt_out` and `tombstonedAt` is a finite database-server timestamp written by the removal transaction. It exists only to prevent an older delayed repair from undoing a newer owner choice; it is excluded from classification, analytics, logs, exports, and public reads, and is cleared on authorized restore/erasure. It contains no free text or additional event history. This is not metadata-only signal storage—the signal columns remain typed and cleared.
4. **Owner removal and re-add:** `owner_removed` belongs to the owner of that personal-network edge. A later deliberate add/accept/start-chat action by that same owner may restore it and records the restoration origin. A live/repair action may restore only when its trusted server action time is strictly later than `tombstonedAt`; an equal, missing, invalid, or newer tombstone timestamp fails closed as no-longer-authorized. The contact or another owner cannot clear it.
5. **Contact opt-out:** `contact_opt_out` represents an explicit action by the contact subject (including ghost unsubscribe). An ordinary add/import by an owner cannot restore or delete it. Only an explicit action by the opted-out subject that semantically revokes the opt-out may restore it. Existing `clearReverseOptOut*` behavior must become reason-aware; it must never hard-delete another owner's tombstone merely because a reciprocal add occurred.
6. **Restore:** after the authority check, clear the tombstone object, keep old signal fields null, and write the restoration source/details as the current active-edge origin. Legacy soft-deleted rows without a reason fail closed as `contact_opt_out` until migrated or explicitly resolved.
7. **Permission/network lifecycle:** changing away from `contact`, deleting the personal network, or otherwise invalidating the edge clears all signal fields. Non-contact rows must not retain them.
8. **Ghost claim/merge:** claim-in-place keeps the same user ID and owner edges. For merge-to-existing-user, process every owner edge transactionally: an existing target tombstone wins; an existing active target edge and its signals win; if no target edge exists, the membership may be re-keyed but all source/recency/details are cleared to unknown. Every source-ghost signal is cleared before the ghost is deleted. No `GREATEST` merge combines two identities' recency.
9. **Account erasure:** one transaction acquires the same owner advisory lock used by preview reservation and count execution, locks/marks the user, clears every inbound and outbound edge signal/tombstone, deletes contact obligations where the user is `actorUserId` or `counterpartUserId`, deletes owner privacy-ledger rows, invalidates edge-derived cache keys, and performs user erasure. Capture, repair, classifier, ranking, preview-reservation, and preview-count paths re-check active principals under the same boundary. A failed transaction rolls back and retries; queued repair jobs become no-ops after erasure. Aggregate counter rows contain no user key and need no per-user rewrite.

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

type ContactEdgeUpsertOutcome =
  | 'created'
  | 'restored'
  | 'existing'
  | 'owner_removed'
  | 'contact_opt_out'
  | 'inactive_endpoint';

type ContactTouchDirectionOutcome =
  | 'updated'
  | 'unchanged'
  | 'missing'
  | 'inactive_endpoint'
  | 'invalid_details'
  | 'unsupported_details_version';

type ContactRepairDirectionDisposition =
  | 'pending'
  | 'complete'
  | 'terminal_owner_removed'
  | 'terminal_contact_opt_out'
  | 'terminal_inactive_endpoint'
  | 'terminal_edge_no_longer_authorized'
  | 'terminal_invalid_details'
  | 'terminal_unsupported_details_version'
  | 'retryable_transient'
  | 'terminal_expired';

type ContactWriteAuthority =
  | { kind: 'live_capture'; actionAt: Date }
  | {
      kind: 'committed_repair';
      actionAt: Date;
      actionKey: string;
    };

interface ContactEdgePersistence {
  upsertContactEdge(
    ownerUserId: string,
    contactUserId: string,
    origin: TrustedContactOrigin,
    options: { restore: boolean; authority: ContactWriteAuthority },
  ): Promise<ContactEdgeUpsertOutcome>;

  upsertContactEdgesBulk(
    ownerUserId: string,
    edges: ReadonlyArray<{
      contactUserId: string;
      origin: TrustedContactOrigin;
    }>,
    options: { restore: boolean; authority: ContactWriteAuthority },
  ): Promise<ReadonlyArray<ContactEdgeUpsertOutcome>>;

  touchContactInteraction(
    userA: string,
    userB: string,
    at: Date,
    basis: ContactInteractionBasis,
  ): Promise<{
    aToB: ContactTouchDirectionOutcome;
    bToA: ContactTouchDirectionOutcome;
  }>;
}
```

This is an API-side persistence boundary, not a protocol-layer dependency. `ContactService`, `OpportunityService`, message persistence, integration composition, and MCP composition should depend on the same adapter contract or SQL helper. Services must not import one another; the centralization belongs in an adapter/shared persistence primitive wired through existing service interfaces. Both authority variants require a finite server-persisted `actionAt`. `committed_repair` additionally locks and validates the private obligation by `actionKey`; it is the only authority allowed to finish a pre-existing obligation while capture is off and cannot be constructed by controllers/tools. `live_capture` obeys the current capture flag and cannot masquerade as repair.

For direct add, `upsertContactEdge` is the product persistence operation. While `CONTACT_SIGNAL_CAPTURE_ENABLED` is false, existing membership behavior remains unchanged and signal columns stay null. When capture is enabled, the directed membership insert/restore, trusted `contact_source`, and allowlisted acquisition details commit atomically in one transaction; provenance is not appended after reporting the edge successful. Outcomes preserve tombstone reason rather than collapsing authority: `restore:true` may restore an `owner_removed` tombstone belonging to that edge owner only when the trusted action is later than `tombstonedAt`, but returns `contact_opt_out` without mutation for a subject opt-out; `restore:false` restores neither and returns the actual `owner_removed` or `contact_opt_out` reason. A legacy unreasoned tombstone is parsed and returned as `contact_opt_out`. The same exhaustive outcome semantics apply to every item in the bulk persistence result.

The `restore` policy is fixed by boundary:

| Boundary | `restore` | Rationale |
| --- | --- | --- |
| Deliberate REST/web or MCP single `add_contact` by the edge owner | `true` | This is an explicit current owner re-add; it may supersede only an older `owner_removed`. |
| Generic list import, Gmail import, Slack import, or future CSV import | `false` | Automated/bulk evidence must not silently reverse an owner's removal; a future parser may opt in only with separately approved per-item deliberate-re-add evidence. |
| Winning acceptance/new-`startChat`, actor → counterpart | `true` | The authenticated actor deliberately creates/restores their own directed edge, subject to tombstone-time and opt-out authority. |
| Winning acceptance/new-`startChat`, counterpart → actor | `false` | The actor cannot restore a choice owned by the counterpart. |
| DM message touch | no edge upsert | Message recency never creates/restores contacts. |

Bulk import preserves a different existing contract. Input resolution and deduplication happen before membership persistence and may report invalid or deduplicated inputs as `skipped`. The surviving edge set, including each edge's trusted origin/details when capture is enabled, is then written by one `upsertContactEdgesBulk` batched operation/transaction. That database persistence unit succeeds or fails as a batch: a successful batch leaves every successfully created/restored edge with its required origin/details, while a failed batch rolls back and throws before any `ImportResult.imported` count is returned. On commit, `ImportResult` retains its current API meaning: `imported` is the number of deduplicated surviving inputs processed by the batch, `details` is the retained resolution/dedup detail set, and `skipped` is the resolution-plus-dedup skip count; `imported` is not redefined as newly inserted/restored edge count. Mixed internal `created`/`restored`/`existing`/`owner_removed`/`contact_opt_out`/`inactive_endpoint` statuses are tested for correct provenance and lifecycle behavior without being converted into per-item database success or new skip semantics. V1 must not invent per-item database persistence or partial-success semantics; such a change requires separate product and persistence approval. Post-commit enrichment, secondary recency, reverse-edge/contact, and acceptance/chat side effects retain their own current awaited or best-effort behavior where already defined, but they are not evidence that the primary import batch persisted per item. Reciprocal acceptance/chat directions remain separate edge writes and may fail independently.

Event-specific internal wrappers (`touchFromPersistedMessage`, `touchFromAcceptedOpportunity`, `touchFromNewStartChatTransition`) first derive and validate the two users, timestamp, role/action, and basis from the durable row or just-committed server action. They are the only production callers of `touchContactInteraction`; controllers, protocol tools, and public composition deps never receive the raw pair/timestamp method. This retains the locked shared boundary while preventing an internal caller from treating arbitrary IDs or request timestamps as evidence.

`touchContactInteraction`:

- updates only already-existing, active contact edges in either direction and re-checks that both endpoint users are active inside the write transaction; if either endpoint fails that shared precheck, it mutates neither direction and returns `{aToB:'inactive_endpoint',bToA:'inactive_endpoint'}`;
- treats the event as pair recency that may be unilateral; after the shared endpoint precheck succeeds, updating both existing directed edges does not assert reply, mutual engagement, symmetry of membership, or closeness;
- never creates a contact from a message alone;
- uses `GREATEST(existing, at)` so retries and out-of-order jobs are monotonic;
- updates the recency basis when the candidate timestamp wins; when timestamps are equal, the fixed priority below determines the stored basis;
- validates `Number.isFinite(at.getTime())` before opening the write transaction and throws `RangeError` without mutating either direction when invalid;
- accepts finite `at` only from a trusted server-persisted event or the deterministic backfill, never from request payloads; and
- is best-effort and failure-isolated from message send, opportunity acceptance, or chat start.

Before changing either `last_interaction_at` or `contact_signal_details`, the writer first performs the shared active-endpoint precheck, then parses each current raw details value with the same strict allowlist parser used by classification. After that shared precheck succeeds, each directed edge transitions independently; a malformed forward edge does not authorize overwriting it and does not prevent a valid reverse edge from updating. If the precheck fails, both directional outcomes are `inactive_endpoint` and no parse/write occurs. A database-level failure still rolls back the transaction. The transition matrix is exhaustive:

| Current details state | Write transition | Direction outcome |
| --- | --- | --- |
| SQL `NULL`/absent | Construct a fresh `{schemaVersion:1,recency:{basis,backfilled}}` object from trusted inputs. Do not invent `acquisition`; leave the typed `contact_source` column unchanged. Apply the candidate timestamp. | `updated` when the candidate wins; otherwise `unchanged` |
| Valid v1 | Reconstruct a fresh object from the parsed allowlist, preserving valid acquisition fields semantically exactly; never spread raw JSON. Update only `recency` when the candidate timestamp wins or an equal timestamp wins by fixed basis priority. A losing candidate performs no rewrite. | `updated` or `unchanged` |
| Malformed | Fail closed: do not rewrite details and do not advance `last_interaction_at`. Emit only an aggregate invalid-details result for diagnostics/repair. | `invalid_details` |
| Unsupported/future `schemaVersion` | Forward compatibility wins: do not overwrite, downgrade, inspect remaining fields, or advance `last_interaction_at`. Emit only an aggregate unsupported-version result. | `unsupported_details_version` |

For equal timestamps, the complete priority order is `dm_message` > `opportunity_acceptance` > `conversation_started` > `backfill_dm_message` > `backfill_opportunity_actor_action`. An absent incumbent recency basis is lower priority than every allowlisted basis, so an equal-time candidate can safely bind previously unbound SQL-null or valid-v1 details; malformed/unsupported states remain blocked before comparison. The higher-priority basis wins. This order exists only to make provenance stable and retries/idempotent; it is not an empirical ranking of tie strength, interaction quality, or evidentiary value. Reapplying any transition is idempotent: an already-winning timestamp/basis returns `unchanged` and does not reserialize details. Tests cover every adjacent pair, both absent-incumbent cases, all retry directions, and all four details states.

### Actor-action transaction and repair contract

Opportunity acceptance and the new `startChat` transition are exceptions to “touch does not create,” but all new obligation behavior is capture-gated.

- **Capture off:** when `CONTACT_SIGNAL_CAPTURE_ENABLED !== 'true'`, callers pass no new contact-repair descriptor, admit no new obligation/token, and perform no new immediate capture. The locked opportunity transition and optional Lens B outcome outbox run with their exact existing behavior, and current best-effort contact side effects retain their existing failure behavior. Capture-off never acquires the new rollback-on-contact-obligation-insert semantics. The migration-installed repair/cleanup processor remains registered independently of the flag solely to drain or expire obligations committed while capture was on; a fresh dark deploy has zero such rows and therefore performs no work or product change.
- **Capture on:** before building a descriptor, require exactly two distinct active, non-deleted, non-introducer participant users; one is the authenticated actor and the other is the unique counterpart. Never use `resolveCounterpart`'s first-actor/any-actor fallback for trusted capture. Ambiguous, duplicate, missing, inactive, or introducer-involving shapes make contact capture ineligible: the product/Lens B action may proceed, but no contact descriptor/token/legacy contact side effect runs and only a detached aggregate `ineligible_participants` outcome is emitted. For an eligible pair, the caller supplies `actorUserId`, `counterpartUserId`, action source/basis, and no timestamp. Under the existing opportunity row lock, revalidate exact participants, the surface-specific pre-action status matrix below, requested accepted action, and actor state. A winner atomically persists the server action time plus a private durable actor marker `acceptedAction:{version:1,via:'update_status'|'start_chat'|'legacy_accepted'}` in the existing actor JSON; new actions may write only `update_status|start_chat`. The marker remains after the obligation is deleted and never enters public presentation. The deterministic contact idempotency key is `(opportunityId,actorUserId,acceptedAction.version)`. Only an actor whose `actedAt` and `acceptedAction` are both absent and whose matrix row permits a new action wins this transition. A prior generic send/other action has `actedAt` without `acceptedAction` and therefore conflicts rather than masquerading as an acceptance duplicate. Different actors can win independently only where the matrix explicitly permits them.
- **Independent atomic obligations:** evolve the locked transition to accept an envelope with two independent optional members: the existing Lens B `AtomicOutcomeOutbox` and the new contact-repair descriptor. Do not add contact fields to, replace, or reinterpret the Lens B event. In one transaction, preserve each obligation's own idempotency key and mutable `result.inserted` bit. A required revalidation/insert error for either obligation rolls back the actor action and both obligations; an idempotent conflict sets only that obligation's bit false. After commit, Lens B's existing `result.inserted` still exclusively triggers its current shadow-mining callback, while only the contact winner token permits immediate contact work. Neither post-commit trigger substitutes for the other.

The row-lock revalidation uses this exact status × surface policy; no implementation-time widening is allowed:

| Surface | Locked status/actor state | Result and contact obligation |
| --- | --- | --- |
| REST or protocol-graph `updateOpportunityStatus('accepted')` | `latent`, `draft`, `negotiating`, `pending`, or `stalled`; acting actor's `actedAt` and `acceptedAction` are absent | Win the accepted transition, persist that actor's action time/marker, and insert exactly one contact obligation when capture is on. |
| REST or protocol-graph `updateOpportunityStatus('accepted')` | `accepted`; a **different** acting actor has absent `actedAt` and `acceptedAction` | Admit that actor's independent accepted action/marker and exactly one obligation; this is the only new action allowed from `accepted`. |
| REST or protocol-graph `updateOpportunityStatus('accepted')` | `accepted`; the same actor already has matching `actedAt` plus `acceptedAction.version=1` | Preserve the current idempotent accepted response even if another actor accepted later; insert no obligation and return no contact token. |
| REST or protocol-graph `updateOpportunityStatus('accepted')` | `accepted`; the same actor has neither marker nor `actedAt`, or any candidate actor has a non-null `actedAt` without a compatible accepted marker | Conflict; do not mutate status/action state and insert no obligation. |
| REST or protocol-graph `updateOpportunityStatus('accepted')` | `rejected` or `expired` | Terminal conflict; insert no obligation. |
| `startChat` | `latent`, `draft`, or `pending`; acting actor's `actedAt` and `acceptedAction` are absent | Win the existing new-start-chat transition, persist the `start_chat` marker, and insert exactly one `conversation_started` obligation when capture is on. |
| `startChat` | `accepted` | Keep the exact current get/unhide-DM branch; no actor-action mutation, recency touch, edge restore, or obligation. |
| `startChat` | `negotiating`, `stalled`, `rejected`, or `expired`, or an allowed-status actor already has incompatible non-null `actedAt` | Not a new start-chat transition; return the surface's existing conflict/error behavior and insert no obligation. |

Same-actor duplicates therefore retain the explicit idempotent/conflict behavior above without another obligation, using the durable per-actor accepted marker rather than mutable singular `acceptedBy`. Before capture can enable, an idempotent migration marks only unambiguous legacy rows where status is `accepted`, `acceptedBy` names exactly one actor on the opportunity, and that actor has a finite parseable `actedAt`; it writes `via:'legacy_accepted'` without creating an obligation, edge, or recency event. Ambiguous/malformed historical rows remain unmarked and fail closed to conflict rather than inventing acceptance evidence; A5 may independently backfill existing-edge recency under its stricter evidence rules. Two different actors racing REST/graph acceptance serialize under the same opportunity lock: after the first changes the row to `accepted`, only the second actor with both marker and `actedAt` absent can take the accepted-row matrix branch and create its independent obligation.

This capture-on matrix intentionally tightens today's status-unchecked REST acceptance for `rejected|expired`: it prevents terminal-row resurrection while capture-off preserves exact current behavior. Acceptance from `negotiating` also supersedes that negotiation attempt. Every negotiation finalizer and generic action writer must use the same locked transition primitive, re-read status/actor marker, and refuse to overwrite `accepted`; a finalizer admitted before acceptance completes first, while one admitted afterward becomes a no-op/conflict. This status/actor CAS prevents the live negotiation graph's later `pending|rejected|stalled` write from overwriting a concurrent accepted winner.

The lock-held winner rule selects one canonical source for `updateOpportunityStatus`/`startChat` races: whichever eligible same-actor acceptance first persists `actedAt` plus its accepted marker owns the contact origin and action time. The losing same-actor path cannot overwrite it. The same lock-held status/action revalidation prevents generic `sendNode`/other acted-at writers from racing an acceptance into a committed accepted state without a contact obligation. Legitimate different-actor actions remain independent. Ordinary duplicate-edge rules still preserve the first valid acquisition already stored on each owner edge.

The contact obligation is explicitly directional. Replay processes actor → counterpart with the actor's authorized `restore:true` semantics, then counterpart → actor with `restore:false`. Actor → counterpart may restore only that actor-owner's `owner_removed` tombstone and returns `contact_opt_out` for a subject opt-out. Counterpart → actor restores neither tombstone type and returns the actual `owner_removed` or `contact_opt_out` reason; legacy unreasoned tombstones return `contact_opt_out`. Both directions use the winning action's trusted source/basis/time, but each edge keeps independent authority and state. Account erasure and access controls match either named endpoint.

### Repair disposition matrix

The worker persists one disposition per direction and uses the same edge/touch primitives as the immediate path:

| Edge result | Touch result | Persisted disposition | Worker action |
| --- | --- | --- | --- |
| `created`, `restored`, or `existing` | `updated` or `unchanged` | `complete` | Acquisition lifecycle rules and recency are satisfied; do not retry. |
| `owner_removed` | not attempted | `terminal_owner_removed` **or** `terminal_edge_no_longer_authorized` | With `restore:false`, preserve the tombstone and persist `terminal_owner_removed`. With `restore:true`, restore only when `tombstonedAt < actionAt`; a missing/equal/newer tombstone time represents a later or unverifiable owner choice and persists `terminal_edge_no_longer_authorized`. |
| `contact_opt_out` | not attempted | `terminal_contact_opt_out` | Preserve the subject opt-out (including legacy unreasoned fail-closed tombstones) and do not retry. |
| `inactive_endpoint` | not attempted | `terminal_inactive_endpoint` | Erasure/deactivation-terminal: write no edge/signal and do not retry. |
| `created`, `restored`, or `existing` | `inactive_endpoint` | `terminal_inactive_endpoint` | The touch transaction's shared endpoint recheck failed; it mutated neither direction. Mark every unfinished direction from that pair attempt terminal and do not route this through `missing`. |
| `created`, `restored`, or `existing` | `missing` | `retryable_transient` **or** `terminal_edge_no_longer_authorized` after recheck | Re-lock/recheck active endpoints, winning action, edge existence, and directional restore authority. Retry only while authorized/expected. |
| `created`, `restored`, or `existing` | `invalid_details` | `terminal_invalid_details` | Preserve details/timestamp, emit aggregate `invalid_details`, and do not blindly retry. |
| `created`, `restored`, or `existing` | `unsupported_details_version` | `terminal_unsupported_details_version` | Preserve details/timestamp, emit aggregate `unsupported_details_version`, and do not downgrade/retry with v1. |
| any operation | transient database/storage exception | `retryable_transient` | Preserve prior final direction state and retry unfinished work under the exact `contact-repair-v1` attempt/backoff/deadline policy while endpoints/action remain valid. |
| unfinished at bounded expiry | n/a | `terminal_expired` | Stop retrying and emit only a coarse detached aggregate expiry diagnostic. |

A direction already successful or terminal is never rerun when its counterpart retries. Complete/delete the obligation only after **both** directions have a documented successful or terminal disposition. The versioned `contact-repair-v1` policy expires each obligation at the earlier of seven days after `actionAt` or 12 attempted runs per unfinished direction; retry delay starts at 60 seconds, doubles, and is capped at one hour, while an hourly cleanup scan terminalizes overdue rows and deletes fully final rows. These are implementation constants, not caller-controlled values; changing them requires a reviewed version bump. Boundary tests cover attempts 1/12/13, delays 60s/1h, the seven-day instant, and hourly cleanup lag.

The processor is not gated by capture: after rollback it validates `committed_repair` authority against the locked obligation, drains already-committed work under the stored winning action and original directional authority, or sets every unfinished direction to `terminal_expired` at the bounded deadline/attempt limit. It emits only detached coarse result/expiry aggregates and deletes completed/fully terminal rows; capture-off never admits a replacement row. Account erasure immediately deletes any row naming either endpoint under the shared lock rather than waiting for expiry. No log, metric, or public response contains the pair, action key, or per-direction row identity.

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
  | 'invalid_interaction_timestamp'
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

export declare function parseContactSignalDetails(
  raw: unknown,
  source: ContactSource | null,
): ParsedContactSignalDetails;

export declare function classifyContactSignal(input: {
  source: ContactSource | null;
  lastInteractionAt: Date | null;
  details: unknown;
  asOf: Date;
}): PreliminaryTieClassification;
```

`asOf` is caller-supplied by trusted application code so tests, shadow comparisons, and retries do not depend on wall-clock reads inside the function. The classifier first requires `Number.isFinite(asOf.getTime())`; an invalid `asOf` throws `RangeError` as a trusted-programmer error before parsing or producing any classification. `parseContactSignalDetails` is also pure: `null`/`undefined` is `absent`; a non-object, an object missing `schemaVersion`, or a present version that is not a positive finite integer is `malformed`; a positive integer `schemaVersion !== 1` is `unsupported_version` without interpreting the remaining fields or retaining/logging the raw version value; and a version-1 object with an invalid discriminated union, impossible Slack/Gmail-group combination, or acquisition source that conflicts with the typed `source` column is `malformed`. The classifier never casts raw JSON directly to v1. The touch writer consumes this parsed result rather than maintaining a permissive second parser, so malformed/future details preserved by a blocked touch continue to classify conservatively instead of being silently normalized.

### Version 1 rules

The operational “recent” window is a versioned constant of 90 days. It is a provisional product-analysis window, not an empirical definition of tie strength.

1. Validate finite `asOf`; invalid input throws before classification.
2. Parse `details: unknown` before evaluating recency. `malformed` adds `malformed_signal_details`; `unsupported_version` adds `unsupported_signal_version`. These states are distinct and mutually exclusive.
3. A non-null `lastInteractionAt` with non-finite `getTime()` adds `invalid_interaction_timestamp` and can provide only fallback evidence; it is never recent, stale, or future trusted evidence.
4. A finite `lastInteractionAt` after `asOf` adds `invalid_future_interaction` and is never qualifying recency, regardless of details.
5. Only `valid` details with an allowlisted recency basis can validate a finite `lastInteractionAt`. A non-future trusted DM-message or explicit opportunity-action basis within 90 days yields `recently_active`; older valid recency yields `candidate_weak` with `stale_trusted_interaction`.
6. `conversation_started` is a qualifying explicit opportunity action and remains source-independent: valid recent details plus its persisted transition timestamp yield `recently_active` even when `contact_source` is null.
7. `absent`, `malformed`, or `unsupported_version` details cannot validate the timestamp. If `source` is known, the result is source-only `candidate_weak` with `known_acquisition_origin` plus any parse/timestamp reasons. If `source` is null, the result is `unknown` with those reasons plus `no_trusted_signal`.
8. When more than one reason applies, emit this fixed order: `malformed_signal_details` or `unsupported_signal_version`, then `invalid_interaction_timestamp`, then `invalid_future_interaction`, then exactly one evidence outcome (`recent_trusted_interaction`, `stale_trusted_interaction`, `known_acquisition_origin`, or `no_trusted_signal`). Invalid and future timestamp reasons are mutually exclusive.
9. Deleted/non-contact rows are not classifier inputs at all.

The following table makes valid-but-unusable combinations total. “Fallback” means `candidate_weak` + `known_acquisition_origin` when `source` is known, otherwise `unknown` + `no_trusted_signal`. A finite future timestamp prepends `invalid_future_interaction`; a non-finite Date prepends `invalid_interaction_timestamp`; neither qualifies recency.

| Parsed details | Recency object | Timestamp state | Result |
| --- | --- | --- | --- |
| any | any | non-null invalid Date | parse reason if malformed/unsupported, then `invalid_interaction_timestamp`, then fallback |
| `valid` | allowlisted basis | finite non-future, age ≤90 days | `recently_active` + `recent_trusted_interaction` (source-independent) |
| `valid` | allowlisted basis | finite non-future, age >90 days | `candidate_weak` + `stale_trusted_interaction` (source-independent) |
| `valid` | allowlisted basis | absent | fallback; the basis alone is not an event |
| `valid` | allowlisted basis | finite future | `invalid_future_interaction` + fallback |
| `valid` | absent | absent or finite non-future value | fallback; an unbound timestamp is ignored |
| `valid` | absent | finite future | `invalid_future_interaction` + fallback |
| `absent` | unavailable | absent or finite non-future value | fallback; an unvalidated timestamp is ignored |
| `absent` | unavailable | finite future | `invalid_future_interaction` + fallback |
| `malformed` | unavailable | absent or finite | `malformed_signal_details`, then future reason if applicable, then fallback outcome |
| `unsupported_version` | unavailable | absent or finite | `unsupported_signal_version`, then future reason if applicable, then fallback outcome |

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
    participant Outcome as Existing Lens B miner
    participant Shadow as Shadow classifier/evaluator
    participant Intro as Introducer selection
    participant Premise as Premise graph
    participant Preview as Exposure preview

    Owner->>Boundary: add/import/accept/start chat/send DM
    Boundary->>Boundary: validate action; derive trusted context

    alt Direct add/import
        Boundary->>Boundary: resolve/deduplicate import; record skipped inputs
        Boundary->>Edge: single add or surviving import batch
        alt Capture enabled
            Edge->>DB: atomically persist edge/batch + trusted source/details
        else Capture disabled
            Edge->>DB: legacy membership persistence; signal columns remain null
        end
        DB-->>Edge: selected persistence unit committed or rolled back
        Edge-->>Boundary: success only after commit; failed batch returns no imported count
        Boundary-->>Owner: skipped-input report + committed add/batch result
    else Persisted human message
        Boundary->>Product: message without caller signal fields
        Product->>DB: commit message + finite server timestamp
        opt Capture enabled
            Product->>Edge: touch existing directions only
            Edge->>DB: guarded monotonic recency
            Edge-->>Product: directional outcomes or DB failure
        end
    else Acceptance / new startChat
        Boundary->>Product: action + optional existing Lens B descriptor
        Product->>DB: lock actor; run existing transition; CAS contact winner only when capture on
        opt Lens B descriptor present
            DB->>DB: revalidate/insert Lens B obligation; set its inserted bit
        end
        opt Capture-on eligible contact winner
            DB->>DB: insert directional contact obligation; set its inserted bit/token
        end
        DB-->>Product: opportunity + independent optional result bits/token
        opt Lens B inserted
            Product->>Outcome: existing post-commit mining trigger
        end
        opt Capture-on contact winner token
            Product->>Edge: immediate directional edge/touch work
            Edge->>DB: actor restore=true; reverse restore=false; persist dispositions
            Edge-->>Product: updated/unchanged/missing/invalid_details/unsupported_details_version or DB failure
        end
    end
    Note over Product,Edge: Capture off admits no new contact obligation/token; cleanup still drains or expires prior rows; already-accepted startChat remains no-op

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
    Premise->>Preview: per assignment, resolve name + privacy-safe count independently
    Preview-->>Owner: one item/network; name optional only for unavailable name failure
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
  notice: 'Potential network audience, not actual exposure';
};

type PremiseExposurePreview =
  | (PremiseExposurePreviewBase & {
      status: 'estimated';
      networkName: string;
      audience: {
        bucket: '2-4' | '5-9' | '10-24' | '25-49' | '50+';
        basis: 'active_distinct_non_ghost_recipients_excluding_author';
      };
    })
  | (PremiseExposurePreviewBase & {
      status: 'suppressed';
      networkName: string;
      audience?: never;
    })
  | (PremiseExposurePreviewBase & {
      status: 'unavailable';
      networkName?: string;
      audience?: never;
    });

type CreatePremiseExposureExtension = {
  // Present only when preview is enabled; one item per assigned network.
  exposurePreviews?: ReadonlyArray<PremiseExposurePreview>;
};
```

When preview is disabled, `create_premise` omits `exposurePreviews` for compatibility. When enabled, the assignment result's `{networkId,relevancyScore}` entries drive isolated name-and-count resolution per network, and exactly one preview item is returned for every assignment. `estimated` requires an owner-visible `networkName` and bucket; `suppressed` requires the name and forbids a bucket; `unavailable` forbids a bucket and may omit `networkName` only when name resolution itself failed. A count failure after successful name lookup returns `unavailable` with the real owner-visible name. A name failure returns `unavailable` with `networkId` and notice only—never a placeholder name or member identity. Failure for one network cannot remove or downgrade another network's item.

Two explicit predicate layers prevent preview privacy rules from silently narrowing discovery:

1. **Canonical assignment-scoped discovery reachability.** Phase D1 inventories premise-similarity, context-to-intent, HyDE, and other assignment-scoped discovery queries; reconciles divergent active-network, active-membership, deleted-user, personal-network, and caller/agent-scope behavior; and migrates them to one tested policy surface. Explicit policy parameters may preserve stricter path-specific semantics. Per-query parity is required, including current ghost participation: the canonical discovery scope does not add `isGhost = false`. Permissions remain permission-agnostic only if reconciliation proves that current behavior. Changing whether ghosts participate in discovery is a separate product/privacy/security decision outside IND-429. The named `purpose:'preview'` variant is exactly the `UNION` of distinct users reachable by any canonical assignment-scoped discovery path for that assignment and owner/agent scope; it estimates the potential audience across those paths without claiming every user is actually queried.
2. **Preview-recipient eligibility.** Starting only from that named union variant, the preview additionally requires `users.deletedAt IS NULL`, `users.isGhost = false`, and `userId != premiseAuthorId`. These are intentional owner-facing active-human audience rules, not claims that discovery applies identical ghost or author filters.

No single canonical discovery predicate exists today. D1 must prove semantic parity and migrate assignment-scoped discovery before preview code uses that policy; any other widening or narrowing requires separate product plus privacy/security approval. Preview then uses `COUNT(DISTINCT userId)` over its stricter recipient-eligibility layer, not `getNetworkMemberCount`, which counts membership rows and includes the author. The query returns no member identities. The direct-read inventory remains separately documented because this estimate cannot bound inconsistent tool/admin reads. Preview implementation and rollout are blocked until D1's canonicalization is complete.

### Suppression and configuration

```dotenv
PREMISE_EXPOSURE_PREVIEW_ENABLED=false
PREMISE_EXPOSURE_PREVIEW_MIN_MEMBERS=5
PREMISE_EXPOSURE_PREVIEW_OWNER_DAILY_LIMIT=10
PREMISE_EXPOSURE_PREVIEW_NETWORK_COOLDOWN_DAYS=7
```

The separately named minimum defaults to five and is hard-clamped to `[2,100]`, following the locked frame-drift-style threshold decision. Let `M` be the clamped minimum and let the fixed integer buckets be `[2,4]`, `[5,9]`, `[10,24]`, `[25,49]`, and `[50,∞)`. If the count is below `M`, return `status:'suppressed'` with no exact count, lower bound, or narrower bucket. Otherwise select the fixed bucket containing the count and intersect that bucket with `[M,∞)`. Emit the bucket label only when the intersection contains at least two possible integer counts. An empty intersection is impossible for an eligible count; a singleton intersection returns `suppressed` rather than revealing the exact value. Therefore `M=4/9/24/49` suppresses counts `4/9/24/49` respectively, while the next count enters the next fixed bucket; `50+` remains safe because its intersection is unbounded for every allowed `M`. The `2–4` bucket is reachable only when the surviving intersection has at least two values, such as `M=2` or `M=3`. Suppression is a normal privacy outcome, not an error, and neither responses nor telemetry reveal the exact suppressed count.

The preview is computed once from the post-assignment snapshot and returned only on that create result; v1 adds no refresh/count endpoint. A dedicated database-backed `PremisePreviewPrivacyLedger` adapter—not the generic cache—must atomically reserve privacy releases before any count query. In the reservation transaction it acquires an owner-scoped advisory lock, takes a user-row lock incompatible with erasure, validates the active owner, locks/updates the rolling-24-hour owner budget, and locks/upserts one owner/network cooldown row per assigned network with a fresh `reservationId` and null `consumedAt`. It returns an internal exact token `{ownerUserId,networkId,reservationId,expiresAt}` for each successful network and never exposes that token outside the adapter. All API instances and REST, MCP, and in-process composition roots share this path.

A reservation commit alone does not authorize an unlocked or repeated count. For each reserved network, the adapter opens a count transaction that reacquires the same owner advisory lock, locks/rechecks the active owner row, locks the owner/network release row, and requires exact matching unexpired `reservationId` plus `consumedAt IS NULL`. It sets `consumedAt` and executes the privacy-thresholded canonical-scope count **before releasing those locks**. The count statement runs inside a savepoint: if it fails, roll back only that savepoint, commit the consumed marker, and return `unavailable`, so failure cannot refund a probe. If the owner or exact reservation is absent, replaced, expired, or already consumed, return `unavailable` and run no count. A crash/transaction failure before top-level commit releases neither a result nor a consumed marker; a retry is safe because no release occurred. Account erasure acquires the same advisory lock before deleting the user and ledger rows, so serialization is deterministic: erasure either waits until a properly ledgered single-use count completes, or wins first and causes the later count recheck to fail closed. Concurrent multi-network counts for one owner serialize through that lock; they do not weaken each network's exact-token/single-use check.

The owner request limit defaults to ten per rolling 24 hours and is hard-clamped to `[1,100]`. Each owner/network can reserve at most one fresh count per seven-day cooldown, hard-clamped to `[1,30]` days. Once the count transaction commits `consumedAt`, the reservation remains consumed even if count, name lookup, serialization, response delivery, or an internal retry fails; retries cannot turn downstream failures into extra probes. A daily-budget denial marks every assignment unavailable; a cooldown denial marks only that network unavailable. Reservation or count-transaction storage failure fails closed to unavailable; savepoint handling preserves consumption on count failure without returning a count. Isolated owner-visible network-name lookup may still populate each unavailable item; omission remains limited to name-lookup failure. Premise creation and assignment still succeed.

The generic `RedisCacheAdapter` is forbidden for this gate because `get` converts storage/parse errors into cache misses, and transport rate limiters are fail-open/transport-specific. Ledger rows are private, never logged/exported/public, and deleted on account erasure. Expiry cleanup groups rows by owner and acquires the same owner advisory lock before deleting expired owner/network state, so it cannot invalidate an exact reservation during an in-lock count; cleanup remains bounded by the maximum configured windows. The cooldown prevents the **same owner** from walking a bucket boundary through repeated add/remove reads in one release window; tests assert no second count query occurs. It does not prevent coordinated cross-owner/Sybil probing of a shared network. That remains an explicit residual risk requiring a separately reviewed network-level privacy budget before any stronger claim. Long-horizon releases likewise remain aggregate-inference risk rather than differential privacy, so v1 uses a fixed cadence and never exposes exact deltas, ledger keys, or suppressed counts in logs/telemetry.

Only the premise owner receives previews, and only for networks already returned by their completed assignment. Public contact/network/member APIs, MCP list tools, other members, opportunity candidates, and analytics exports do not receive them. Network names are already owner-visible; member names are never returned.

A future pre-assignment gate could show the same estimate before persistence and request confirmation. That would change graph control flow, timeout semantics, tool UX, and failure behavior, so it is a later explicit product/design decision and not a v1 extension of this preview.

## Failure semantics and repair

| Failure | V1 behavior |
| --- | --- |
| Schema is absent or incompatible during deployment | Migration-first rollout prevents schema-dependent readers/writers from deploying before the migration. Capture remains disabled until migration and all compatible instances are complete. A mismatch is a deployment/startup failure to roll back or repair, never silently handled by runtime column feature detection. |
| Direct add or bulk membership/provenance write fails | With capture disabled, existing membership behavior is unchanged and signals remain null. With capture enabled, a single add rolls back its edge+origin/details together. Import resolution/dedup may already have classified inputs as skipped, but the surviving edge set and all required origins/details commit or roll back in one existing batched persistence unit. A failed batch throws before returning an imported count; it never reports per-item database success or a successful edge missing provenance. |
| Capture is off during acceptance/new `startChat` | Admit no new contact descriptor/obligation/token and perform no new immediate capture. Preserve the exact existing actor transition, optional Lens B obligation/result bit/mining trigger, and best-effort contact failure behavior. The capture-independent processor still drains or expires rows committed before rollback. |
| Capture-on participant set is ambiguous/inactive/introducer-involving | Proceed only with independently valid product/Lens B behavior; create no trusted contact descriptor/obligation/token and suppress legacy contact fallback. Emit detached aggregate `ineligible_participants`. |
| Capture-on generic send/other action wins the actor `actedAt` race before acceptance | Lock-held acceptance revalidation returns conflict and does not commit accepted state or contact obligation; retry/reload product state. |
| Capture-on winning action's contact or Lens B obligation insert/revalidation fails | Roll back the actor action and both independent optional obligations atomically. An idempotent conflict sets only its own `result.inserted=false`; it is not an insert failure. |
| Secondary contact edge/origin side effect fails after a capture-on winning action | The opportunity/chat remains committed because its directional private repair obligation is durable; apply the disposition matrix and retry only transient/race-authorized work. Logs/metrics remain detached aggregates. |
| Recency touch receives non-finite trusted `at` | Throw `RangeError` before opening the write transaction; mutate neither direction and emit only the detached coarse programmer-error aggregate. |
| Recency touch database operation fails after acceptance/new `startChat` | The product action remains committed; its durable obligation records `retryable_transient` and retries under the bounded repair policy. Already-accepted `startChat` performs no touch. |
| Recency touch database operation fails after a message | Message send remains committed and has no pair-bearing obligation; only a later qualifying interaction or conservative backfill may repair recency. |
| Recency touch sees malformed details | Return `invalid_details` for that direction; preserve details and `last_interaction_at` byte-for-byte/semantically unchanged; emit only aggregate diagnostics. Automated retry remains a no-op until an audited repair can reconstruct a complete allowlisted object without guessing acquisition. |
| Recency touch sees an unsupported/future details version | Return `unsupported_details_version`; do not inspect, overwrite, downgrade, or advance recency. The v1 obligation terminalizes and is deleted after both directions finish; a future compatible writer may process a new qualifying event but must not resurrect the deleted v1 obligation. Forward compatibility takes precedence over capture. |
| Contact edge writer or touch sees either endpoint inactive | Edge upsert returns `inactive_endpoint` and writes no edge/signal. Touch returns `inactive_endpoint` for both directions and mutates neither. Both map directly to `terminal_inactive_endpoint`, never to `missing` retry. |
| One directional edge is missing | Return `missing` for that direction; do not create the edge except in existing acceptance/startChat creation flows. |
| Duplicate/out-of-order touch | `GREATEST` keeps the newest trusted timestamp; equal timestamps use the fixed `dm_message` > `opportunity_acceptance` > `conversation_started` > `backfill_dm_message` > `backfill_opportunity_actor_action` provenance order. |
| Tombstone authority is ambiguous/legacy | Fail closed to `contact_opt_out`; do not restore until an authorized action or migration resolves it. |
| Ghost merge collides with an existing edge | Target tombstone/active edge wins; clear source-ghost signals; never merge recency. |
| Account erasure races capture/repair/preview reservation or count | Every path acquires/reacquires the shared owner advisory lock and active-user lock. Erasure serializes after an in-lock count or deletes owner+ledger first so the later exact-reservation recheck returns `unavailable` without counting; it deletes obligations and privacy-ledger rows naming the user, invalidates queued repair/caches, and exposes no historical release record. |
| Classifier receives invalid `asOf` | Throw `RangeError` before classification; this is a trusted-programmer error, not an `unknown` band. |
| Classifier receives non-finite `lastInteractionAt` | Add deterministic `invalid_interaction_timestamp` and use only fallback evidence; never classify it as recent/stale trusted interaction. |
| Classifier receives malformed/future details | Fail closed to `unknown` or source-only `candidate_weak`; emit detached aggregate invalid-input count. |
| Pair-bearing legacy import/capture log or generic logger call is detected | Keep `CONTACT_SIGNAL_CAPTURE_ENABLED=false`; fail A3 until static/transport contracts prove the dedicated sink emits only allowlisted context-free production envelopes. A `NODE_ENV=test`-disabled Sentry assertion is insufficient. |
| Privacy-aggregate sink/export fails | Drop or retry only through its bounded aggregate path; never attach active context or fall back to generic logging. Product behavior remains unchanged and absence is unobserved/unknown. |
| Shadow evaluator fails | Current introducer selection and queueing continue unchanged. |
| Ranking code fails while flag is on | Fall back to the exact current intent-freshness path and emit an aggregate fallback counter. |
| Preview privacy-ledger reservation denies or fails | Under the owner advisory lock, atomically reserve the owner request and eligible owner/network cooldowns. Denied networks or any reservation transaction/storage failure return `unavailable` and perform no affected count query. A committed reservation stays consumed after downstream failure. The premise/assignments remain successful; never use the fail-open generic cache or transport limiter as fallback. |
| Preview owner/exact reservation disappears, expires, or was already consumed before count | The per-network count transaction reacquires the owner advisory lock, locks/rechecks the active owner and exact unexpired `reservationId`, requires `consumedAt IS NULL`, returns `unavailable` on any mismatch, and performs no count. It never treats an earlier reservation commit as reusable authority. |
| Preview name or count query fails | Resolve each assigned network independently. The thresholded count executes inside the exact-reservation/owner-locked transaction; downstream name/serialization failure does not refund the reservation. Return one `unavailable` item with `networkId`, notice, no audience bucket, and the real `networkName` only if name lookup succeeded; never invent a placeholder or fail/undo assignment. Other network items continue. Whole-field omission is reserved for preview-disabled compatibility. |
| Preview cohort is below threshold or threshold intersection is a singleton | Return `suppressed`; do not serialize or log the exact count. |
| Backfill batch fails | Roll back that batch, retain checkpoint before it, retry idempotently. |

Contact-obligation workers must use the lock-held winning action, directional authority, exhaustive disposition matrix, and strict details parser above. They persist per-direction progress so a completed/terminal direction is never replayed merely because its counterpart retries. Malformed details are never auto-normalized: a separate audited repair may replace them only when it can reconstruct the complete allowlisted state from independent trusted records without guessing or dropping acquisition. Unsupported/future details are not v1 retry candidates and remain untouched until compatible code is deployed. No operator endpoint may accept arbitrary pair, source, details, timestamp, winner token, or disposition values.

## Observability without relationship leakage

The current `ContactService.importContacts` dedup log is a pre-capture blocker: it records `ownerId` alongside each removed contact's `email`, `matchedWith`, and scores. A3 removes pair-bearing fields from the initial/import-completed/dedup log family and prohibits import/capture telemetry from calling the generic logger. The production `emitSentryLog` path is disabled under `NODE_ENV=test` and may inherit an active SDK request/span scope in production, so an ordinary log-capture test cannot prove trace detachment.

A3 therefore adds a dedicated `ContactPrivacyAggregateSink`. Request-path code submits only a closed, typed event name plus allowlisted coarse dimensions and integer increment; the sink accepts no context object, enters an explicitly context-cleared/non-instrumented execution boundary, and atomically increments `contact_privacy_aggregate_counters` through an injected dedicated counter-store adapter. The counter write itself must not create/inherit a request span or breadcrumbs. A detached exporter runs outside request handling, reads only aggregate rows, and sends a context-free envelope through an injected `PrivacyAggregateTransport`. The production transport must create/send that envelope without active request, trace, span, user, session, or pair scope; it cannot call `emitSentryLog`, `setSpanAttributes`, or a request-scoped Sentry hub. On sink/export failure, drop/retry the aggregate through its bounded operational path—never fall back to the generic logger.

```ts
// Illustrative closed telemetry seam; no index signature or arbitrary metadata.
declare const positiveSafeIntegerBrand: unique symbol;
type PositiveSafeInteger = number & { readonly [positiveSafeIntegerBrand]: true };
export declare function toPositiveSafeInteger(value: number): PositiveSafeInteger;

type RatioBucket = '0-.24' | '.25-.49' | '.50-.74' | '.75-1';
type CountBucket = '0' | '1' | '2-4' | '5+';

type ContactPrivacyAggregate =
  | {
      event: 'import_dedup';
      boundary: 'generic_import' | 'integration';
      outcome: 'kept' | 'removed' | 'failed';
      increment: PositiveSafeInteger;
    }
  | {
      event: 'capture_result';
      boundary: 'manual' | 'generic_import' | 'integration';
      outcome: ContactEdgeUpsertOutcome | 'failed';
      increment: PositiveSafeInteger;
    }
  | {
      event: 'capture_result';
      boundary: 'acceptance' | 'start_chat';
      outcome: ContactEdgeUpsertOutcome | 'ineligible_participants' | 'failed';
      increment: PositiveSafeInteger;
    }
  | {
      event: 'touch_result';
      boundary: 'acceptance';
      outcome: ContactTouchDirectionOutcome | 'invalid_timestamp' | 'transient_failure';
      basis: 'opportunity_acceptance';
      increment: PositiveSafeInteger;
    }
  | {
      event: 'touch_result';
      boundary: 'start_chat';
      outcome: ContactTouchDirectionOutcome | 'invalid_timestamp' | 'transient_failure';
      basis: 'conversation_started';
      increment: PositiveSafeInteger;
    }
  | {
      event: 'touch_result';
      boundary: 'message';
      outcome: ContactTouchDirectionOutcome | 'invalid_timestamp' | 'transient_failure';
      basis: 'dm_message';
      increment: PositiveSafeInteger;
    }
  | {
      event: 'repair_result';
      boundary: 'repair';
      outcome: ContactRepairDirectionDisposition;
      basis: ContactInteractionBasis;
      increment: PositiveSafeInteger;
    }
  | {
      event: 'backfill_result';
      boundary: 'maintenance';
      outcome: 'scanned' | 'eligible' | 'updated' | 'skipped_invalid' | 'skipped_deleted';
      increment: PositiveSafeInteger;
    }
  | {
      event: 'classifier_coverage';
      boundary: 'weekly_thresholded_job';
      classifierVersion: 'contact-signal-v1';
      outcome: 'unknown' | 'candidate_weak' | 'recently_active' | 'invalid_input';
      cohort: 'privacy_threshold_met';
      increment: PositiveSafeInteger;
    }
  | {
      event: 'shadow_ratio';
      boundary: 'weekly_thresholded_job';
      metric: 'top_five_jaccard' | 'source_concentration' | 'network_diversity' | 'truncation_rate' | 'missing_signal_rate';
      bucket: RatioBucket;
      cohort: 'privacy_threshold_met';
      increment: PositiveSafeInteger;
    }
  | {
      event: 'shadow_displacement';
      boundary: 'weekly_thresholded_job';
      bucket: CountBucket;
      cohort: 'privacy_threshold_met';
      increment: PositiveSafeInteger;
    }
  | {
      event: 'shadow_downstream';
      boundary: 'weekly_thresholded_job';
      metric: 'queue_completion' | 'opportunity_creation' | 'owner_approval' | 'eventual_acceptance';
      outcome: 'observed' | 'not_observed';
      cohort: 'privacy_threshold_met';
      increment: PositiveSafeInteger;
    }
  | {
      event: 'shadow_policy';
      boundary: 'weekly_thresholded_job';
      classifierVersion: 'contact-signal-v1';
      asOfPolicy: 'fixed_weekly';
      candidateLimitBucket: '5-24' | '25-49' | '50-100';
      cohort: 'privacy_threshold_met';
      increment: PositiveSafeInteger;
    }
  | {
      event: 'shadow_gate';
      boundary: 'weekly_thresholded_job';
      outcome: 'met' | 'not_met';
      eligibleCycles: '0-999' | '1000+';
      distinctOwners: '0-99' | '100+';
      cohort: 'privacy_threshold_met';
      increment: PositiveSafeInteger;
    }
  | {
      event: 'ranking_fallback';
      boundary: 'introducer';
      outcome: 'fallback';
      increment: PositiveSafeInteger;
    }
  | {
      event: 'preview_result';
      boundary: 'premise_create';
      outcome: 'estimated';
      reason: 'released';
      increment: PositiveSafeInteger;
    }
  | {
      event: 'preview_result';
      boundary: 'premise_create';
      outcome: 'suppressed';
      reason: 'privacy_threshold';
      increment: PositiveSafeInteger;
    }
  | {
      event: 'preview_result';
      boundary: 'premise_create';
      outcome: 'unavailable';
      reason:
        | 'budget_denied'
        | 'cooldown_active'
        | 'owner_inactive'
        | 'reservation_invalid'
        | 'name_lookup_failed'
        | 'count_failed'
        | 'ledger_failure';
      increment: PositiveSafeInteger;
    };

interface PrivacyAggregateCounterStore {
  increment(envelope: ContactPrivacyAggregate): Promise<void>;
}

interface PrivacyAggregateTransport {
  emit(envelope: ContactPrivacyAggregate): Promise<void>;
}
```

`toPositiveSafeInteger` is the sole constructor for increments and rejects non-finite, non-integer, non-positive, or unsafe values before storage/export; writers cannot cast arbitrary numbers. The concrete production `DetachedPrivacyAggregateTransport` owns the real serializer/context reset and accepts only an injectable low-level backend sender; callers cannot substitute a request-scoped logger. Tests instantiate this concrete production class with a fake backend while fake request/span/user/session context is active. Static forbidden-key assertions cover every import/capture call site and envelope variant. Compile-time negative fixtures reject cross-products such as manual/ineligible-participants, message/opportunity-acceptance, or start-chat/DM basis. Counter-store and concrete-transport contract tests assert neither stored dimensions nor emitted bytes inherit active context and only allowlisted keys/values exist. Tests do **not** claim coverage by observing the `NODE_ENV=test`-disabled Sentry path. `CONTACT_SIGNAL_CAPTURE_ENABLED` remains false until this production-equivalent gate passes.

Allowed operational metrics are global or privacy-thresholded aggregates such as:

- capture attempts/results by trusted boundary and coarse outcome (`created`, `restored`, `existing`, `owner_removed`, `contact_opt_out`, `inactive_endpoint`, `ineligible_participants`, `failed`);
- touch direction outcomes (`updated`, `unchanged`, `missing`, `inactive_endpoint`, `invalid_details`, `unsupported_details_version`, `invalid_timestamp`) by allowlisted basis, without pair or owner dimensions;
- backfill scanned/eligible/updated/skipped-invalid/skipped-deleted counts;
- classifier version and aggregate band coverage;
- thresholded introducer shadow coverage, Jaccard, displacement, concentration/diversity, truncation/missing-signal, downstream outcome, policy, and evidence-gate buckets represented by the closed `shadow_*` variants;
- ranking fallback counts; and
- preview outcome totals with only the closed non-sensitive reason codes above.

Request-path preview telemetry never carries an audience bucket—even for `estimated`—or an exact count, network, owner, reservation token/time, premise, assignment, pair, request, trace, or span dimension. A context-detached event can still be time-correlated with existing user-bearing application logs in a low-volume window, so detachment alone is not sufficient. If aggregate bucket distribution is ever needed, it requires a separately reviewed scheduled job with coarse release windows and a strict distinct-owner threshold; that future job is not part of D2 or its request path.

The request-path privacy sink produces **global counters only** and cannot establish distinct-owner cohorts because it never receives owner identity. Classifier coverage, shadow displacement, and other owner-cohort reports come from a separate scheduled restricted database query over source rows: it groups by predeclared coarse dimensions, applies the distinct-owner minimum **before** writing a `classifier_coverage` or closed `shadow_*` aggregate counter, persists no per-owner intermediate/export row, and then uses the same detached exporter. This path is read-only with respect to contact signals and has its own threshold-before-export tests.

Forbidden metric/log dimensions include user IDs, emails, contact IDs, raw network IDs, exact timestamps, source+owner combinations, pair hashes, per-owner candidate lists, message/opportunity IDs joined to bands, and any low-cardinality slice that enables pair reconstruction. Hashing a pair does not make it anonymous.

Signal analytics use distinct owners—not events or edges—as the privacy unit, stable weekly cohorts, coarse predeclared dimensions, and a fixed release cadence. Arbitrary date/window/version cross-slicing and repeated differencing queries are prohibited. Raw operational aggregates are access-controlled and retained for at most 30 days unless an approved incident hold applies.

Signal-specific and contact-import telemetry exists only as detached aggregate-counter/export envelopes and therefore has no request/trace identifier to share with pair-bearing application logs. A tightly restricted security incident store may correlate a separate incident record transiently under audited access, but ordinary observability cannot. Analytics exports apply the same default-five, hard-clamped `[2,100]` cohort suppression concept as the preview/frame-drift precedent. Absence of a metric means unobserved/unknown, not proof that no interaction occurred.

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
| `PREMISE_EXPOSURE_PREVIEW_OWNER_DAILY_LIMIT` | `10` | Database-ledger per-owner reservations over rolling 24 hours, hard-clamped to `[1,100]`; not a cache/transport limiter. |
| `PREMISE_EXPOSURE_PREVIEW_NETWORK_COOLDOWN_DAYS` | `7` | Database-ledger fresh-count reservation per owner/network, hard-clamped to `[1,30]` days; repeat creates return `unavailable` without re-counting. |

Boolean flags use exact literal `true`; unset, mixed-case, or any other value means disabled. Capture, shadow, ranking, and preview are independent. Ranking may require shadow infrastructure, but enabling capture must not implicitly enable any consumer.

The existing `CONTACTS_ENABLED` gate remains authoritative for ordinary contact add/import tool availability. `CONTACT_SIGNAL_CAPTURE_ENABLED` only annotates contact writes that the product already permits; it never enables a disabled add/import surface. Before first activation, false preserves permitted membership writes with null signal fields. In every false state, acceptance/new-`startChat` performs no new contact winner CAS result, repair-obligation insert, rollback-on-contact-insert failure, or immediate capture; the locked transition, Lens B behavior, side-effect scheduling, and failure isolation remain exact. The migration-installed repair/cleanup processor is deliberately not gated by capture and may only process obligations already committed while capture was true, applying their stored original authority or bounded expiry and deleting final rows. A fresh dark deploy has zero obligations and therefore no repair work or product change. After prior activation, reason-aware tombstone protection remains enabled as a second monotonic privacy exception and may change only through an approved rollback migration. When true, origin/details are atomic with one directed single-add edge and, for import, across the surviving edge set; only a lock-held winning actor action creates the composed contact obligation/token. Reciprocal acceptance/chat directions remain independent and authority-asymmetric. Existing acceptance/startChat contact side effects currently bypass `CONTACTS_ENABLED`; v1 preserves that product behavior unless a separate ticket changes it. The capture-on/off × Lens-B-present/absent × existing-obligation-present/absent matrix is tested in REST, MCP, REST tool, and in-process chat composition roots, including current `ToolService` wiring.

Tie rollout proceeds additive signal/outbox/aggregate-counter migrations → dark deploy with the capture-independent repair/cleanup processor registered → idempotent unambiguous legacy accepted-marker migration/report → detached privacy-sink and pair-safe import/dedup verification → trusted capture cohort → backfill → shadow observation → separately approved limited ranking experiment. A4 depends on both A2 and A3: no A4 capture-on rollout may precede the accepted-marker migration report, production-equivalent sink, closed telemetry tests, and pair-log removal delivered by A3. `CONTACT_SIGNAL_CAPTURE_ENABLED` remains false everywhere until those gates pass. Preview is independent of tie capture, but remains disabled until D1 canonicalization, A3's detached sink/counter infrastructure, and the D2 database privacy-ledger migration, multi-instance reservation/count-lock tests, and cleanup/erasure interleaving tests pass. Deploy compatible ledger readers/writers before `PREMISE_EXPOSURE_PREVIEW_ENABLED=true`; no runtime cache fallback or column/table detection is allowed.

Operational rollback disables ranking/shadow consumers first, then flips capture off to stop new descriptors, obligations, and immediate capture. It **does not unregister the repair/cleanup processor**: that path drains already-committed obligations under their stored winning action/directional authority, or marks unfinished directions `terminal_expired` at the bounded deadline, emits only detached aggregates, and deletes final rows. Operators verify the obligation table reaches zero; account erasure may delete matching rows immediately at any point. Fresh dark deploy has zero rows, so the registered processor is a no-op. Rollback also leaves reason-aware tombstone protection active; reverting that monotonic guard requires a separate migration that explicitly preserves/resolves every `contact_opt_out`. Nullable signal columns remain for compatibility; ordinary rollback does not rewrite or expose data. A privacy incident additionally triggers signal-field erasure and cache invalidation. Read behavior is unchanged throughout v1, so no read-gate rollback is needed.

## Test strategy for follow-up implementation

### Schema and persistence

- migration applies on empty and populated databases and leaves legacy/non-contact rows null;
- constraints reject signals on deleted/non-contact rows;
- insert, duplicate, reasoned tombstone, authorized restore, permission/network change, and erasure obey lifecycle semantics; finite server-written `tombstonedAt` is private/lifecycle-only, and older/equal/newer/missing/invalid action-boundary comparisons fail or restore exactly as specified;
- populated-database migration and persistence fixtures keep `owner_removed` distinct from `contact_opt_out`, map legacy unreasoned tombstones fail-closed to `contact_opt_out`, and prove `clearReverseOptOut*`, direct adds, and bulk outcomes follow the authority matrix without generic opt-out collapse;
- claim-in-place and merge-to-existing fixtures cover absent, active, and tombstoned target edges and clear source-ghost signals;
- account erasure is atomic against concurrent touch/repair/preview reservation/count/cleanup, deletes repair obligations and privacy-ledger rows naming the user, and invalidates derived caches/jobs;
- capture-off actor transitions remain byte-for-byte/semantically equivalent and admit no new contact descriptor/obligation/token/immediate work, including when Lens B is present; pre-existing obligations still drain or expire through the capture-independent processor and cannot persist beyond their deadline;
- before capture-on, the idempotent legacy-marker migration writes `legacy_accepted` only for exact acceptedBy/actor/finite-actedAt matches, reports ambiguous rows without pair-bearing logs, and creates no obligation/edge/touch; capture-on edge-creating actions then atomically persist the per-actor accepted marker and compose the existing Lens B and contact descriptors as independent same-transaction obligations with independent idempotency/result bits; either required insert failure rolls back all, while each post-commit trigger follows only its own bit/token; marker-based duplicates remain idempotent after obligation deletion and after a different actor later accepts;
- the row-lock CAS applies every status × surface row above: REST/graph acceptance wins from `latent|draft|negotiating|pending|stalled`, admits only a different actor with absent `actedAt`/marker from `accepted`, preserves marker-proven same-actor accepted idempotency, and rejects `rejected|expired`; `startChat` wins only from `latent|draft|pending`, keeps accepted as no-touch get/unhide, and rejects `negotiating|stalled|rejected|expired`; updateStatus/updateStatus, startChat/startChat, updateStatus/startChat, sendNode/startChat, sendNode/updateStatus, negotiation-finalizer/acceptance, and different-actor accepted races produce no duplicate, status regression, or obligation-less action, while ambiguous/non-exact participant sets never build a descriptor or run legacy contact fallback under capture-on;
- repair fixtures use explicit actor/counterpart fields and assert actor→counterpart `restore:true` restores only a strictly older owner tombstone, a same/newer/unverifiable owner removal becomes `terminal_edge_no_longer_authorized`, counterpart→actor `restore:false` restores neither, both directions preserve/report `contact_opt_out`, legacy unreasoned tombstones fail closed as `contact_opt_out`, and every edge×touch result maps to the matching persisted disposition with per-direction progress, exact `contact-repair-v1` attempt/backoff/TTL boundaries, two-direction completion, rollback drain, cleanup, and erasure;
- reciprocal rows retain independent values;
- monotonic touches handle retry, out-of-order, one missing direction, all five equal-time bases, and absent-incumbent-basis equal timestamps using the fixed priority order; non-finite `at` throws before either direction mutates, while either inactive endpoint returns two `inactive_endpoint` outcomes and mutates neither direction;
- the touch transition matrix covers SQL-null, valid-v1, malformed, and unsupported/future details independently in both directions; retries are idempotent, valid acquisition survives reconstruction, malformed/future bytes are not overwritten, and raw JSON is never spread;
- callers cannot inject source/details/timestamps through REST or MCP payloads.

### Surface coverage

Create integration tests for REST add, MCP/chat generic import, Gmail and Slack import, `updateOpportunityStatus`, new and already-accepted `startChat`, human DM message, protocol graph acceptance through MCP/Hermes, REST tool API and in-process chat, CLI single-add/Gmail forwarding, connect-link routing, ghost unsubscribe/non-human cleanup, ghost merge, and account deletion. Each test asserts both the primary product result and exact signal side effect—or deliberate absence. Static forbidden-key checks plus `ContactPrivacyAggregateSink` contract tests use the real concrete production transport with an injectable low-level fake backend and the production counter-store seam under a fake active context, proving stored dimensions/emitted bytes contain only closed fields with no owner ID, email, matched contact, pair hash, per-item score, request/trace/span/user/session context, or arbitrary metadata. Tests explicitly do not rely on the `NODE_ENV=test`-disabled generic Sentry path. Separate scheduled-query fixtures prove owner cohorts are thresholded before aggregate-row insertion and no per-owner intermediate/export row persists. Compile-time/exhaustive runtime fixtures reject touch/repair cross-products, unknown dimensions, and non-positive/fractional/non-finite/unsafe increments, and prove every B2 report/gate maps to one closed variant; capture-on cannot run until these gates pass. Direct-add fixtures prove edge+origin/details atomicity and exhaustively assert `created|restored|existing|owner_removed|contact_opt_out|inactive_endpoint`. Bulk-import fixtures distinguish resolution/dedup skips from database persistence: a successful batch gives every created/restored surviving edge its trusted origin/details, while an injected batch failure rolls back the whole surviving edge set and returns no false imported count. Committed mixed-status fixtures cover that same exhaustive outcome union, preserve the existing `ImportResult` mapping (`imported`/`details` from the deduplicated retained set and `skipped` from resolution/dedup), and independently assert lifecycle/provenance status. They do not assert per-item database partial success. Already-accepted `startChat` proves no edge or recency write because no durable action timestamp exists. The surface and flag matrices above are the acceptance oracle.

### Backfill and classifier

- fixture DMs require `role='user'`, sender membership, exactly two relevant user participants, and consistent `dmPair`; agent/system and stale post-merge pairs are skipped;
- accepted opportunities require exactly two distinct active non-introducer participant users, with `acceptedBy` matching the actor carrying parseable `actedAt`; zero/one/>2, duplicate/malformed, introducer-fallback, and ambiguous sets are skipped and aggregate-counted;
- batches are deterministic, restartable, and idempotent under concurrent deletion; equal timestamps select/update the higher-priority basis using the same five-value order as live touching;
- classifier parser/table tests cover absent details, malformed JSON/shape, missing/wrong-type/non-integer/non-positive `schemaVersion`, unsupported positive integer versions, impossible Slack+Gmail-group data, source mismatch, source-only evidence, valid source-null `conversation_started`, recent, boundary-at-90-days, stale, finite future, non-finite `lastInteractionAt`, combined reason precedence, and explicit finite `asOf`;
- invalid `asOf` deterministically throws `RangeError` before output; invalid `lastInteractionAt` yields `invalid_interaction_timestamp` plus fallback and never stale/recent evidence;
- property tests use valid Dates, assert determinism and reason order, and prove moving finite `asOf` forward cannot turn stale evidence into recent evidence.

### Introducer

- with both flags off, query parameters, ordering, selected IDs, and enqueued job payloads match current golden fixtures byte-for-byte/semantically exactly;
- shadow failure cannot alter current output;
- enabled policy is deterministic and uses current freshness as its documented tie-breaker;
- unknown contacts are handled according to the approved experiment policy;
- telemetry contains no pair identifiers or raw timestamps.

### Preview and privacy

- D1 inventories divergent premise-similarity, context-to-intent, HyDE, and other assignment-scoped predicates, then migrates them to one tested canonical discovery-reachability policy before preview code exists, preserving current ghost participation;
- the separately tested `purpose:'preview'` canonical variant unions distinct users reachable by every assignment-scoped path for the assignment/owner scope, then the preview-recipient predicate counts active distinct non-ghost users and excludes the author; path-specific fixtures prove the union exactly before these extra filters, which are not asserted as discovery parity, and the count does not depend on `getNetworkMemberCount`;
- counts below every configured/clamped threshold suppress normally; eligible finite buckets emit only when their intersection with `[minimum,∞)` contains at least two integers;
- boundary fixtures for minimum `4/9/24/49` suppress the singleton count, the next count uses the next fixed bucket, and `50+` stays unbounded; no exact small count is inferable;
- dedicated database privacy-ledger tests cover owner advisory plus erasure-incompatible user-row locking, atomic rolling-budget plus multi-network cooldown reservations, and a per-network count transaction that reacquires the same owner lock, rechecks the active owner, locks/verifies the exact unexpired single-use `reservationId`, sets `consumedAt`, and counts before unlock; explicit interleavings cover reserve→erase→count (unavailable/zero count), count→erase (erasure waits), exact-token replay after success and after every downstream failure (unavailable/zero second count), count-savepoint failure with committed consumption, concurrent multi-network counts, concurrent/multi-instance callers, cleanup/expiry before count, transaction/storage failure before commit, clamping, and mixed eligible/denied networks across REST, MCP, and in-process roots;
- tests prove the fail-open generic `RedisCacheAdapter` and transport limiters are never called, ledger cleanup is bounded by configured windows, account erasure deletes owner/network state, and no count/bucket/member data reaches the ledger/logs/exports; request-path telemetry forbidden-key fixtures reject bucket, exact-count, network, owner, reservation, premise, assignment, pair, request, trace, and span fields for every preview outcome;
- repeated same-owner add/remove changes inside the cooldown never trigger a second same-network count or expose a boundary transition; cross-owner/Sybil and long-horizon aggregate inference are explicit residual risks, not claimed prevented or differentially private;
- enabled output contains exactly one item per assigned network under isolated name/count failures; estimated/suppressed require the real owner-visible name, unavailable may omit it only on name failure, and no placeholder/member identity is serialized;
- per-network query failure leaves premise creation, assignment, and other preview items successful; field omission occurs only when preview is disabled;
- public API/MCP snapshots prove source, recency, details, bands, and reasons are absent.

### Future gate

No read-gating test should be added in phases A–D because no read gate is approved. Phase E begins with a read-surface inventory and threat-model tests, not enforcement code.

## Phased implementation tickets

### A1 — Add nullable schema and shared persistence primitives

**Depends on:** this design approval.

**Scope:** one canonical schema-layer `contactSourceValues` tuple; Drizzle enum/columns/migration; derived internal `ContactSource`, discriminated recency-detail, trusted-origin, and live/committed-repair authority types; centralized API-side single/bulk upsert and touch primitives; no capture consumers enabled.

**Acceptance criteria:** the TypeScript type and Drizzle enum derive from the same exported tuple with no duplicate values list; migration is additive and migration-first; public `ContactInput` and serializers are unchanged; row-local and personal-network invariants are tested; edge upserts exhaustively distinguish `owner_removed`, `contact_opt_out`, and `inactive_endpoint` rather than returning a generic opt-out/false success, with legacy unreasoned tombstones migrating or parsing fail-closed as `contact_opt_out`; every boundary uses the fixed restore matrix and only a locked finite `committed_repair` authority can finish prior work while capture is off; live/backfill recency detail variants reject contradictory `basis/backfilled` pairs; the directional touch outcome union includes `inactive_endpoint`, and its shared endpoint precheck plus four-state detail transition matrix pass, including no mutation to either direction when an endpoint is inactive, absent-incumbent equal-time precedence, idempotency, forward-compatible no-write behavior, and pre-transaction rejection of non-finite `at`; monotonic writes and ordinary duplicate provenance pass; package versions are bumped only for packages actually touched.

### A2 — Converge contact lifecycle and tombstone semantics

**Depends on:** A1.

**Scope:** dual-mode contact/chat adapter implementations; pre-activation capture-off legacy hard-delete/reverse-opt-out behavior; capture-on reasoned tombstones and monotonic reason-aware `clearReverseOptOut*` protection that survives later capture disablement; unsubscribe/non-human cleanup, network lifecycle, ghost claim/merge, account erasure, and cache/job invalidation.

**Acceptance criteria:** pre-activation flag-off fixtures preserve existing hard-delete, reverse-opt-out, product-result, and failure semantics with null signals; flag-on activates the authority/collision matrix atomically across all lifecycle paths; owner removal and subject opt-out remain distinct through direct/bulk outcomes and every migration fixture, with finite server-owned `tombstonedAt` excluded from analytics/public surfaces; `restore:true` restores only the actor-owner's strictly older `owner_removed`, a same/newer/unverifiable removal fails no-longer-authorized, `restore:false` restores neither, and legacy unreasoned tombstones fail closed as `contact_opt_out`; post-activation flag-off stops admitting new signal/obligation work but cannot erase reasoned tombstones, and reverting that guard requires a tested explicit rollback migration; restoration records a new trusted origin; no action by one owner clears another owner's opt-out; ghost merge never combines identity recency; erasure cannot race a touch; all invalid edges have null signals; mixed-mode rows are impossible.

### A3 — Wire trusted acquisition origins

**Depends on:** A2.

**Scope:** REST/manual, MCP/chat generic import, Gmail/Slack import with preserved toolkit/group, actual CLI forwarding semantics, experiment-network CSV non-contact documentation, removal of pair-bearing import/dedup logs, a database-aggregate-backed `ContactPrivacyAggregateSink` with detached production transport, and a separate scheduled threshold-before-export owner-cohort aggregation path before capture rollout.

**Acceptance criteria:** every acquisition boundary has a composition-root test and the fixed restore matrix is exhaustive: deliberate single add `true`, all generic/Gmail/Slack/future-CSV bulk imports `false`; capture-off preserves current membership writes with null signals; capture-on makes a single directed add and origin/details atomic, while each import's surviving post-resolution/dedup edge set plus all trusted origins/details succeeds or fails in one existing batched persistence operation; skipped-input reporting remains distinct from database success; committed mixed outcomes preserve the existing `ImportResult` mapping while lifecycle/provenance statuses are verified independently; a failed batch returns no false imported count; no per-item database persistence semantics are introduced; generic arrays never claim CSV and `csv_import` remains unwritten until a separately approved trusted personal-contact CSV parser/test exists; Gmail/Slack origin unions reject impossible combinations; CLI/Hermes are not falsely attested as surfaces; no caller field/header/metadata can spoof origin or details; import/dedup/capture code emits only through the dedicated privacy-aggregate sink; static forbidden-key checks and tests of the concrete production transport (with injected low-level fake backend) plus counter-store begin under fake active context and prove neither stored dimensions nor emitted bytes inherit request/trace/span/user/session/pair context or arbitrary metadata; discriminated variants reject every invalid event/boundary/basis/outcome cross-product and all increments use the positive-safe-integer constructor; generic `emitSentryLog`/request-span paths are forbidden and their `NODE_ENV=test` behavior is not treated as evidence; request-path counters are global only, while owner-cohort classifier/shadow rows are written solely by the restricted scheduled query after thresholding; capture remains disabled until those gates pass; existing `CONTACTS_ENABLED` availability is unchanged.

### A4 — Wire trusted interaction capture and acceptance parity

**Depends on:** A2 + A3. No capture-on rollout may precede A3's production-equivalent detached sink and forbidden-key tests.

**Scope:** event-specific wrappers for user-role DM messages, REST acceptance, the new `startChat` transition, and protocol graph acceptance through MCP/Hermes, REST tool, and in-process chat; pre-enable unambiguous legacy accepted-marker migration/report; capture-on-only contact obligations composed alongside the existing Lens B outbox under the row lock; private durable per-actor accepted marker; exact status × surface and negotiation-finalizer CAS policy; same-actor winner CAS and side-effect token; capture-independent directional repair/cleanup processor with explicit committed-obligation authority and versioned bounds; explicit no-op treatment for already-accepted `startChat`.

**Acceptance criteria:** capture-off admits no new contact descriptor/obligation/token/immediate capture and preserves exact existing transition, Lens B result/mining, and best-effort contact behavior, while only locked `committed_repair` authority lets the always-registered processor drain or expire previously committed obligations and a fresh dark deploy remains a zero-row no-op; the pre-enable migration marks only exact legacy acceptedBy/actor/finite-actedAt matches as `legacy_accepted`, is idempotent, creates no contact work, and leaves ambiguous rows fail-closed; capture-on atomically persists `actedAt` plus the private accepted marker and follows every exact status × surface matrix row, including REST/graph allowed states, capture-on terminal-state tightening, marker-proven same-actor idempotency/conflict after other actors or obligation deletion, different-actor accepted admission, and `startChat`'s narrower transition/no-touch sets; updateStatus/updateStatus, startChat/startChat, updateStatus/startChat, sendNode/startChat, sendNode/updateStatus, negotiation-finalizer/acceptance, and different-actor accepted races prove no duplicate, status regression, or obligation-less accepted contact work and correct coexistence with Lens B's independent payload/idempotency/result bit/post-commit trigger; required insert failure rolls back action/marker plus both obligations; trusted descriptors require exactly two distinct active non-introducer participants and never use first/introducer fallback, while ineligible shapes suppress contact side effects without blocking the independent product/Lens B action; obligation rows name `actorUserId`/`counterpartUserId`, replay `restore:true`/`false` respectively, compare owner tombstone/action times, distinguish `terminal_owner_removed` from `terminal_contact_opt_out` and later-owner-choice terminalization, map touch `inactive_endpoint` directly to `terminal_inactive_endpoint`, and pass the exhaustive edge×touch disposition matrix plus exact 7-day/12-attempt/60-second-to-1-hour/hourly-cleanup boundaries without early completion, infinite expected-no-op retry, or post-rollback retention past expiry; each already-committed product action remains failure-isolated from secondary work; source/basis/time are durable and finite; malformed/future details remain unchanged and terminal obligations are not resurrected; new `startChat` remains source-independent for classification; already-accepted `startChat` writes nothing; graph acceptance converges; missing DM reverse edges are not fabricated; connect-link clicks remain no-op.

### A5 — Run conservative recency backfill

**Depends on:** A4; production execution begins only after A4 deployment verification so live writes win monotonically.

**Scope:** dry-run/reporting CLI, bounded idempotent batches, validated user-role DM messages and accepted-actor evidence only, checkpoints and repair diagnostics.

**Acceptance criteria:** rerun produces zero additional changes; mismatched `dmPair` rows are skipped/counted; opportunity evidence requires exactly two distinct eligible non-introducer participants and matching `acceptedBy`/`actedAt`, with every ambiguous actor shape skipped/count-only; no first-actor fallback, `opportunities.updatedAt`, `conversations.lastMessageAt`, empty-DM creation, or link click is mislabeled as interaction; concurrent deletion/merge/erasure is safe; production execution follows the project's safe backfill workflow.

### B1 — Implement pure classifier and privacy-safe shadow coverage

**Depends on:** A3, A4, and A5 diagnostics.

**Scope:** `contact-signal-v1`, reason codes, explicit `asOf`, aggregate coverage/sensitivity reports; no persistence and no behavioral effect.

**Acceptance criteria:** the raw `unknown` parser and total classifier table/property tests pass; invalid `asOf` throws before output; non-finite `lastInteractionAt` yields ordered `invalid_interaction_timestamp` fallback and never stale/recent evidence; malformed versus unsupported details remain distinct; combined parse/invalid/future/source outcomes follow fixed precedence; valid recent `conversation_started` remains source-independent; output never leaves owner-scoped internals; malformed data fails conservatively; shadow reports meet telemetry suppression rules.

### B2 — Shadow introducer candidate policies

**Depends on:** B1.

**Scope:** run the bounded shadow-only superset query, compute candidate ordering deltas while the current limited selection remains authoritative, and gather minimum-evidence metrics.

**Acceptance criteria:** shadow off executes the exact current `LIMIT 5` path; shadow on never feeds jobs; query-plan/latency budget and `[5,100]` cap hold; no pair-level logs; every required report maps to a closed thresholded aggregate variant: coverage/classifier version, Jaccard, displacement, concentration/diversity, truncation/missing-signal rates, downstream queue/opportunity/owner-approval/acceptance outcomes, fixed `asOf` policy/candidate-limit bucket, and the `1000+` eligible-cycle/`100+` distinct-owner gate; 30-day/volume/coverage evidence is reportable; a recommended or rejected policy is documented with sensitivity analysis.

### C — Default-off introducer ranking experiment

**Depends on:** B2 meeting the stated evidence floor and separate experiment approval.

**Scope:** strict-literal ranking flag; one pre-registered versioned lexicographic policy; fallback to current ordering.

**Acceptance criteria:** disabled path is unchanged; enabled path is deterministic; unknown handling and candidate-pool bounds are documented; reliability/privacy guardrails pass; rollback is one flag flip.

### D1 — Specify and implement the preview estimate query

**Depends on:** this design approval; can proceed in parallel with B.

**Scope:** inventory discovery versus direct/tool reads and every assignment-scoped discovery query; reconcile premise-similarity/context-to-intent/HyDE filter differences; define and migrate those queries to one canonical discovery-reachability policy without changing current ghost participation; define `purpose:'preview'` as the distinct-user union of every path variant for the exact assignment/owner scope; then define the stricter preview-recipient predicate and implement its active-distinct-non-ghost, author-excluding count, network-type/scope semantics, separately named minimum config, and suppression/buckets.

**Acceptance criteria:** all assignment-scoped discovery queries use the same tested policy surface—with explicit parameters where required to preserve stricter path semantics—for active network, active membership, deleted-user handling, personal-network semantics, and caller/agent scope; per-query semantic parity is proven and no `isGhost = false` narrowing is introduced into discovery; the named preview variant exactly unions every canonical path variant before `COUNT(DISTINCT)`, with fixtures for users reachable through only one path; changing ghost participation is rejected from IND-429 pending separate product/privacy/security approval; preview remains blocked until migration completes, then its separately tested recipient predicate adds non-ghost and author exclusions without claiming those filters are discovery parity; any other widening/narrowing is rejected from D1; the estimate is explicitly not claimed to equal the complete discovery candidate pool or bound all direct reads; all threshold/bucket boundaries are tested; no identity leaves the adapter.

### D2 — Add owner-only post-assignment preview

**Depends on:** D1 + A3's detached privacy-sink/counter infrastructure; tie capture itself may remain off.

**Scope:** optional `create_premise.exposurePreviews` array after completed assignment; migration-first dedicated database privacy-release ledger/adapter; owner-locked atomic rolling-budget plus owner/network cooldown reservation shared across REST/MCP/in-process roots; exact-token, owner-locked per-network count transactions; one discriminated item per `{networkId,relevancyScore}` assignment; isolated name/count resolution; singleton-safe emission; cleanup/erasure; bucket-free request-path telemetry; one-shot owner-facing copy.

**Acceptance criteria:** no graph pause or confirmation; the database ledger reserves owner budget and each network cooldown atomically under an owner advisory lock plus erasure-incompatible user-row lock across all instances, then every network count transaction reacquires that same owner lock, locks/rechecks the active owner, requires the exact committed unexpired `reservationId` with `consumedAt IS NULL`, sets `consumedAt`, and executes the thresholded count before unlock; a savepoint commits consumption even when the count fails, while a top-level pre-commit failure releases no result; absent/expired/replaced/consumed owner or reservation returns unavailable with zero count; reserve→erase→count, count→erase, exact-token replay, count-failure, concurrent multi-network count, cleanup/expiry, and multi-instance interleavings prove erasure either follows a properly ledgered single-use count or prevents it; committed reservations remain consumed after downstream failure; transaction/storage failure fails closed without failing premise creation; generic fail-open cache/transport limiters are not used; rows contain only minimal release/single-use times/state, expire within configured windows, erase with the owner, and never enter logs/exports; request-path detached telemetry contains only closed preview outcome/reason codes and never an audience bucket, exact count, network, owner, reservation, premise, assignment, pair, request, trace, or span dimension, and any future scheduled bucket-distribution job requires separate review; the count starts from the named union discovery variant but excludes the author and ghosts as preview-only active-human recipient rules; `estimated` requires a real owner-visible name and a privacy-safe response bucket whose threshold intersection contains at least two integers, `suppressed` requires the name and forbids a response bucket, and `unavailable` always includes `networkId`/notice but may omit the name only when name lookup failed; exactly one item returns per assignment when enabled, failures are isolated, no placeholder name is invented, and flag-off alone omits the optional array; minimum `4/9/24/49` singleton boundaries suppress, `50+` remains unbounded, same-owner repeated differencing tests pass, and cross-owner/Sybil inference remains explicitly out of scope pending a separately reviewed network-level budget; member identities and exact small counts never appear; query failures do not fail premise creation; UI copy says potential network audience, not actual readers/exposure or the complete discovery candidate pool.

### E — Read-side gating research and design

**Depends on:** sustained captured-data validation, user-correction research, phases B/C findings, complete read inventory, and separate approval.

**Scope:** policy semantics and UX research only at first; no enforcement code.

**Acceptance criteria:** all north-star prerequisites are answered; false-positive/negative and appeal paths are reviewed; migration/cache/versioning plan exists; security/privacy approval explicitly authorizes any subsequent implementation.

## Alternatives rejected

| Alternative | Why rejected for v1 |
| --- | --- |
| Store everything in `network_members.metadata` | Hides ownership/type semantics, encourages unallowlisted payloads, and makes migrations/constraints/querying ambiguous. Typed nullable columns plus a narrow details object are more auditable. |
| Create a contact-events or tie table | Adds history, retention, and surveillance risk before the sparse signals prove useful. The locked v1 model needs one directional edge state only; bounded repair/privacy operational rows are delivery/rate state, not relationship history. |
| Overload the existing Lens B outcome outbox | Couples unrelated payloads, idempotency, result bits, and post-commit triggers. The transition composes two independent optional obligations instead. |
| Use generic Redis/cache or transport limiting for preview privacy | Cache reads fail open on errors and transport limits do not cover all composition roots or provide atomic multi-instance cooldown reservations. The dedicated database ledger is required. |
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
