---
trigger: "Retire the 'viewed' status from opportunity lifecycle"
type: refactor
branch: refactor/retire-viewed-status
created: 2026-03-27
version-bump: patch
---

## Related Files

### Protocol (schema + enum)
- protocol/src/schemas/database.schema.ts (opportunityStatusEnum definition)

### Protocol (adapter layer)
- protocol/src/adapters/database.adapter.ts (status union types in multiple methods)
- protocol/src/adapters/tests/database.adapter.spec.ts

### Protocol (interfaces)
- protocol/src/lib/protocol/interfaces/database.interface.ts

### Protocol (services)
- protocol/src/services/opportunity.service.ts (status filter options)
- protocol/src/services/tests/opportunity.service.updateStatus.spec.ts

### Protocol (controllers)
- protocol/src/controllers/opportunity.controller.ts (status validation, allowed list)
- protocol/src/controllers/tests/opportunity.controller.spec.ts

### Protocol (support/lib)
- protocol/src/lib/protocol/support/opportunity.discover.ts
- protocol/src/lib/protocol/support/opportunity.enricher.ts
- protocol/src/lib/protocol/support/opportunity.utils.ts
- protocol/src/lib/protocol/support/tests/opportunity.enricher.spec.ts
- protocol/src/lib/protocol/support/tests/opportunity.utils.spec.ts
- protocol/src/lib/protocol/tools/profile.tools.ts
- protocol/src/lib/protocol/tools/tests/chat.tools.spec.ts

### Frontend
- frontend/src/services/opportunities.ts (OpportunityStatus type, query options)
- frontend/src/components/chat/OpportunityCardInChat.tsx (ACTIONABLE_STATUSES set)

### Docs
- docs/domain/opportunities.md (lifecycle table)

## Relevant Docs
- docs/domain/opportunities.md
- docs/domain/negotiation.md

## Scope
Remove `viewed` from the opportunity status enum and all references across the codebase. The `viewed` status is a read-receipt concept that doesn't belong in the lifecycle state machine — it can be tracked separately (e.g., as a timestamp or flag) if needed in the future.

Changes required:
1. **Migration**: Remove `viewed` from `opportunityStatusEnum` in schema, generate and apply a Drizzle migration
2. **Protocol types**: Remove `viewed` from all status union types across adapters, interfaces, services, controllers, and support files (~17 files)
3. **Frontend types**: Remove `viewed` from `OpportunityStatus`, `ACTIONABLE_STATUSES`, and query option types (2 files)
4. **Tests**: Update all test files that reference `viewed` status
5. **Docs**: Update the lifecycle table in `docs/domain/opportunities.md` to reflect 6 states instead of 7
6. **Data migration**: Any existing rows with status `viewed` should be migrated to `pending` in the SQL migration
