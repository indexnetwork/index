# Index-to-Network Rename Cleanup

## Scope

Rename all domain-concept "index" (community/group entity) to "network". This covers identifiers, type names, method names, variable names, tool names, route paths, comments, and docs.

### Explicitly kept as-is

- `IntentIndexer` / `IntentIndexerOutput` (verb sense: scoring intents)
- `IndexNegotiator` (class name stays)
- `IndexEmbedder` / `IndexEmbedderOptions` (product-level naming)
- `index.ts` barrel files
- Package names (`@indexnetwork/*`)
- Project name "Index Network"
- Generic programming "index" (array index, DB index, `tabIndex`, etc.)

### Corrections from verification

- **`indexContext` in negotiation files IS renamed** to `networkContext` — it holds `{ networkId, prompt }` (community scope), not related to the `IndexNegotiator` class name
- **`indexPrompt` is a Drizzle select alias**, not a DB column (actual column is `networks.prompt`) — safe to rename to `networkPrompt` without migration
- **`graphs.index` key** refers to the network CRUD graph (`NetworkGraphFactory`), not IntentIndexer — renamed to `graphs.network`
- **`graphs.intentIndex` key** refers to the intent-to-network junction graph — renamed to `graphs.intentNetwork`
- **Two API response keys still use `index`**: `POST /networks/invitation/:code/accept` returns `{ index }` and `PUT /networks/:id/key` returns `{ index }` — both must change to `{ network }`
- **Debug endpoint** `GET /debug/home` returns top-level key `indexes` — must change to `networks`

## Execution Strategy

This is a large mechanical rename (~200+ references across ~80 files). Execute layer-by-layer, bottom-up, so downstream consumers compile after each layer:

1. **Protocol interfaces/types first** (everything depends on these)
2. **Protocol tools/graphs** (use the new types)
3. **Backend adapters** (implement the interfaces)
4. **Backend services/controllers/queues**
5. **Frontend services/contexts/components**
6. **CLI**
7. **Tests** (update to match new names)
8. **Docs**

Within each layer, use parallel subagents for independent files.

## Layer 1: Protocol types (`packages/protocol/src/shared/interfaces/database.interface.ts`)

The single densest file. Key renames:

- **Types:** `OwnedIndex` -> `OwnedNetwork`, `IndexMemberDetails` -> `NetworkMemberDetails`, `IndexedIntentDetails` -> `NetworkIntentDetails`, `UpdateIndexSettingsData` -> `UpdateNetworkSettingsData`
- **Fields:** `indexPrompt` -> `networkPrompt`
- **Methods:** `getUserIndexIds` -> `getUserNetworkIds`, `getOwnedIndexes` -> `getOwnedNetworks`, `getPublicIndexesNotJoined` -> `getPublicNetworksNotJoined`, `isIndexOwner` -> `isNetworkOwner`, `getIntentsInIndex` -> `getIntentsInNetwork`, `getIntentsInIndexForMember` -> `getIntentsInNetworkForMember`, `isIntentAssignedToIndex` -> `isIntentAssignedToNetwork`, `getIntentIndexScores` -> `getIntentNetworkScores`, `unassignIntentFromIndex` -> `unassignIntentFromNetwork`, `updateIndexSettings` -> `updateNetworkSettings`, `removeMemberFromIndex` -> `removeMemberFromNetwork`, `getMembersFromUserIndexes` -> `getMembersFromUserNetworks`, `getPersonalIndexesForContact` -> `getPersonalNetworksForContact`
- **Params:** `indexNameOrId` -> `networkNameOrId`, `indexScope` -> `networkScope`
- **Error codes** in `packages/protocol/src/shared/agent/tool.helpers.ts`: `INDEX_NOT_FOUND` -> `NETWORK_NOT_FOUND`, `INDEX_MEMBERSHIP_REQUIRED` -> `NETWORK_MEMBERSHIP_REQUIRED`

## Layer 2: Protocol tools and graphs

- `packages/protocol/src/network/network.tools.ts`: Variables `readIndexes` -> `readNetworks`, `readIndexMemberships` -> `readNetworkMemberships`, `scopedToIndex` -> `scopedToNetwork`, `callerInIndex` -> `callerInNetwork`, `sharedIndexes` -> `sharedNetworks`; trace names `"index"` -> `"network"`; all description strings
- `packages/protocol/src/intent/intent.tools.ts`: Tool names `create_intent_index` -> `create_intent_network`, `read_intent_indexes` -> `read_intent_networks`, `delete_intent_index` -> `delete_intent_network`; variables `createIntentIndex` -> `createIntentNetwork`, etc.
- `packages/protocol/src/shared/agent/tool.helpers.ts`: `scopedIndex` -> `scopedNetwork`, `indexName` -> `networkName`, `resolveIndexNames` -> `resolveNetworkNames`, `graphs.index` -> `graphs.network`, `graphs.intentIndex` -> `graphs.intentNetwork`
- `packages/protocol/src/shared/agent/tool.factory.ts`: `graphs: { index: networkGraph, intentIndex: intentNetworkGraph }` -> `graphs: { network: networkGraph, intentNetwork: intentNetworkGraph }`
- `packages/protocol/src/chat/chat.state.ts`: `IndexSubgraphResult` -> `NetworkSubgraphResult`, field `index?` -> `network?`
- `packages/protocol/src/negotiation/negotiation.state.ts`: `indexContext` -> `networkContext` (holds `{ networkId, prompt }`)
- `packages/protocol/src/negotiation/negotiation.graph.ts`: `indexContext` -> `networkContext`, `indexContextOverrides` -> `networkContextOverrides`
- `packages/protocol/src/negotiation/negotiation.agent.ts`: `indexContext` -> `networkContext` in `NegotiationAgentInput`
- `packages/protocol/src/network/network.state.ts`: Comments only (already uses `networkId`)
- `packages/protocol/src/network/network.graph.ts`: `createdIndexId` -> `createdNetworkId`, comments
- `packages/protocol/src/chat/chat.prompt.ts` and `packages/protocol/src/chat/chat.prompt.modules.ts`: LLM prompt text: "indexes" -> "networks", tool references
- `packages/protocol/src/opportunity/opportunity.graph.ts`: `indexId` vars -> `networkId`, `indexIdForActors` -> `networkIdForActors`, `indexIdFilter` -> `networkIdFilter`, `isIndexOwner` -> `isNetworkOwner`
- `packages/protocol/src/opportunity/opportunity.introducer.ts`: `personalIndexId` -> `personalNetworkId`, `indexIds` -> `networkIds`
- `packages/protocol/src/mcp/mcp.server.ts`: Description text
- `packages/protocol/src/index.ts`: Export names for renamed types

## Layer 3: Backend adapters

- `backend/src/adapters/database.adapter.ts`: ~50+ method/param/local renames matching the interface changes. Key ones: `getPersonalIndexId` -> `getPersonalNetworkId`, `getUserIndexIds` -> `getUserNetworkIds`, `getPublicIndexesNotJoined` -> `getPublicNetworksNotJoined`, `updateIndexSettings` -> `updateNetworkSettings`, `updateIndexKey` -> `updateNetworkKey`, `isIndexOwner` -> `isNetworkOwner`, `removeMemberFromIndex` -> `removeMemberFromNetwork`, all `personalIndexId` -> `personalNetworkId`, all `userIndexIds` -> `userNetworkIds`
- `backend/src/adapters/contact.database.adapter.ts`: Same `personalIndex*` -> `personalNetwork*` pattern
- `backend/src/adapters/queue.adapter.ts`: `IndexIntentJobData` -> `NetworkIntentJobData`
- `backend/src/schemas/database.schema.ts`: `indexesKeyUnique` -> `networksKeyUnique` (NOTE: the DB constraint name `'indexes_key_unique'` string stays as-is for safety — only rename the TS property)

## Layer 4: Backend services, controllers, queues

- `backend/src/services/network.service.ts`: `excludeIndexId` -> `excludeNetworkId`, `resolveIndexId` -> `resolveNetworkId`, return keys `{ index: ... }` -> `{ network: ... }` (including `updateKey` and `acceptInvitation` response shapes)
- `backend/src/controllers/debug.controller.ts`: JSON response keys `indexes` -> `networks`, `indexAssignments` -> `networkAssignments`, variables
- `backend/src/services/debug.service.ts`: Comments
- `backend/src/services/integration.service.ts`, `backend/src/controllers/integration.controller.ts`: Comments
- `backend/src/services/tool.service.ts`: Graph registry key `index:` -> `network:`, `intentIndex:` -> `intentNetwork:`
- `backend/src/controllers/mcp.handler.ts`: Same graph registry keys
- `backend/src/queues/intent.queue.ts`: `userIndexIds` -> `userNetworkIds`, `indexContexts` -> `networkContexts`
- `backend/src/queues/negotiation-timeout.queue.ts`: `indexContext` -> `networkContext`
- `backend/src/queues/negotiation-claim-timeout.queue.ts`: Same pattern
- `backend/src/services/negotiation.service.ts`: `indexContext` -> `networkContext`
- `backend/src/services/negotiation-polling.service.ts`: `indexContext` -> `networkContext`
- `backend/src/cli/db-seed.ts`: `ownerIndex` -> `ownerNetwork`, `_indexesCreated` -> `_networksCreated`

## Layer 5: Frontend

**File renames:**

- `IndexAvatar.tsx` -> `NetworkAvatar.tsx`
- `IndexesContext.tsx` -> `NetworksContext.tsx`
- `IndexFilterContext.tsx` -> `NetworkFilterContext.tsx`
- `CreateIndexModal.tsx` -> `CreateNetworkModal.tsx`
- `IndexSelectorModal.tsx` -> `NetworkSelectorModal.tsx`
- `app/index/[indexId]/page.tsx` -> `app/network/[networkId]/page.tsx`

**Code changes:**

- `frontend/src/routes.tsx`: `/index/:indexId` -> `/network/:networkId`
- `frontend/src/services/networks.ts`: `createIndexesService` -> `createNetworksService`, `getSharedIndexes` -> `getSharedNetworks`, `joinIndex` -> `joinNetwork`, etc.
- `frontend/src/services/v2/networks.service.ts`: `createIndexesServiceV2` -> `createNetworksServiceV2`, `getIndexes` -> `getNetworks`, `useIndexesV2` -> `useNetworksV2`
- `frontend/src/contexts/APIContext.tsx`: Service factory name
- `frontend/src/contexts/AuthContext.tsx`: Public path `'/index/'` -> `'/network/'`
- `frontend/src/components/ClientWrapper.tsx`: `startsWith('/index/')` -> `startsWith('/network/')`
- All components importing `IndexAvatar`, `IndexesContext`, `IndexFilterContext`, modals: update import paths
- `NetworkSettingsPanel.tsx`, `Sidebar.tsx`, `ChatContent.tsx`, `NetworksPanel.tsx`, `ToolCallsDisplay.tsx`, etc.: variable/function names

## Layer 6: CLI

- `packages/cli/src/api.client.ts`: All `/api/indexes` -> `/api/networks`, response keys `indexes` -> `networks`, `index` -> `network`, query param `indexId` -> `networkId`
- `packages/cli/src/network.command.ts`: Check for stale references
- CLI tests: Update mocked URLs and assertions

## Layer 7: Tests

Update all test files to match renamed methods, types, variables, and API paths. Key files:

- `backend/src/adapters/tests/*.spec.ts`
- `backend/src/controllers/tests/*.spec.ts`
- `backend/src/services/tests/*.spec.ts`
- `backend/tests/*.spec.ts`
- `packages/protocol/src/*/tests/*.spec.ts`
- `frontend/tests/routes.test.tsx`

## Layer 8: Docs

- `docs/domain/indexes.md`: Full rewrite to "networks" terminology (consider renaming file to `networks.md`)
- `docs/specs/user-index-keys.md`: API paths and terminology
- `docs/specs/cli-network.md`: API paths
- `docs/design/protocol-deep-dive.md`: Tool names, graph descriptions
- `README.md`: Link text
- `CLAUDE.md`: Terminology alignment (after all code changes)

## Risk notes

- **DB constraint name** `'indexes_key_unique'`: Changing the string requires a DB migration. Keep the DB-level string as-is, only rename the TypeScript property.
- **API response keys**: Most network controller endpoints already return `{ network }` / `{ networks }`, but invitation-accept and key-update still return `{ index }`. Debug home returns `indexes`. All three must be fixed.
- **Frontend route change** `/index/` -> `/network/`: Add a redirect for old URLs if this is a public-facing route.
- **LLM tool names** (`create_intent_index` etc.): Renaming accepted as risk. In-flight sessions with stored tool calls using old names may break. Update all prompt references in Layer 2.
- **`indexPrompt`**: Safe to rename — it's a Drizzle select alias, not a DB column (`networks.prompt` is the actual column). No migration needed.
