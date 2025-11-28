# Frontend-Protocol Connections Documentation

This document maps all connections between frontend services and protocol API routes, including endpoints, request/response types, and shared domain models.

**Analysis Date:** November 26, 2025  
**Frontend Services Analyzed:** 7  
**Protocol Routes Analyzed:** 15  
**Total Connections Identified:** 58

---

## Table of Contents

1. [Admin Service](#1-admin-service)
2. [Connections Service](#2-connections-service)
3. [Indexes Service](#3-indexes-service)
4. [Integrations Service](#4-integrations-service)
5. [Links Service](#5-links-service)
6. [LMSR Service](#6-lmsr-service)
7. [Synthesis Service](#7-synthesis-service)
8. [Shared Type Definitions](#shared-type-definitions)
9. [Type Mismatches & Issues](#type-mismatches--issues)

---

## 1. Admin Service

**Frontend File:** [`frontend/src/services/admin.ts`](frontend/src/services/admin.ts:1)  
**Protocol File:** [`protocol/src/routes/admin.ts`](protocol/src/routes/admin.ts:1)

### 1.1 Get Pending Connections

**Frontend Method:** [`getPendingConnections(indexId: string)`](frontend/src/services/admin.ts:4)  
**Protocol Endpoint:** `GET /admin/:indexId/pending-connections`  
**Protocol Handler:** [`Line 12-128`](protocol/src/routes/admin.ts:12)

**Request:**
- Path Parameter: `indexId` (UUID)

**Response Type (Frontend):**
```typescript
{
  connections: Array<{
    id: string;
    initiator: {
      id: string;
      name: string;
      avatar: string | null;
    };
    receiver: {
      id: string;
      name: string;
      avatar: string | null;
    };
    createdAt: string;
  }>;
}
```

**Response Type (Protocol):**
```typescript
{
  connections: Array<{
    id: string;
    initiator: { id: string; name: string; avatar: string };
    receiver: { id: string; name: string; avatar: string };
    createdAt: Date;
  }>;
}
```

### 1.2 Approve Connection

**Frontend Method:** [`approveConnection(indexId: string, initiatorUserId: string, receiverUserId: string)`](frontend/src/services/admin.ts:24)  
**Protocol Endpoint:** `POST /admin/:indexId/approve-connection`  
**Protocol Handler:** [`Line 132-211`](protocol/src/routes/admin.ts:132)

**Request:**
- Path Parameter: `indexId` (UUID)
- Body: `{ initiatorUserId: string, receiverUserId: string }`

**Response Type (Frontend & Protocol):**
```typescript
{
  message: string;
  event: {
    id: string;
    initiatorUserId: string;
    receiverUserId: string;
    eventType: string;
    createdAt: string;
  };
}
```

### 1.3 Deny Connection

**Frontend Method:** [`denyConnection(indexId: string, initiatorUserId: string, receiverUserId: string)`](frontend/src/services/admin.ts:41)  
**Protocol Endpoint:** `POST /admin/:indexId/deny-connection`  
**Protocol Handler:** [`Line 215-294`](protocol/src/routes/admin.ts:215)

**Request:**
- Path Parameter: `indexId` (UUID)
- Body: `{ initiatorUserId: string, receiverUserId: string }`

**Response Type:** Same as Approve Connection

### 1.4 Get Pending Count

**Frontend Method:** [`getPendingCount(indexId: string)`](frontend/src/services/admin.ts:58)  
**Protocol Endpoint:** `GET /admin/:indexId/pending-count`  
**Protocol Handler:** [`Line 298-382`](protocol/src/routes/admin.ts:298)

**Request:**
- Path Parameter: `indexId` (UUID)

**Response Type (Frontend & Protocol):**
```typescript
{
  count: number;
}
```

---

## 2. Connections Service

**Frontend File:** [`frontend/src/services/connections.ts`](frontend/src/services/connections.ts:1)  
**Protocol File:** [`protocol/src/routes/connections.ts`](protocol/src/routes/connections.ts:1)

### 2.1 Get Connections by User

**Frontend Method:** [`getConnectionsByUser(type: 'inbox' | 'pending' | 'history', indexIds?: string[])`](frontend/src/services/connections.ts:9)  
**Protocol Endpoint:** `POST /connections/by-user`  
**Protocol Handler:** [`Line 14-148`](protocol/src/routes/connections.ts:14)

**Request:**
```typescript
{
  type: 'inbox' | 'pending' | 'history';
  indexIds?: string[];
}
```

**Response Type (Frontend - defined in types.ts):**
```typescript
// ConnectionsByUserResponse
{
  connections: Array<{
    user: {
      id: string;
      name: string;
      avatar: string | null;
    };
    status: string;
    isInitiator: boolean;
    lastUpdated: string;
  }>;
}
```

### 2.2 Connection Actions

**Frontend Methods:**
- [`requestConnection(targetUserId: string)`](frontend/src/services/connections.ts:22)
- [`skipConnection(targetUserId: string)`](frontend/src/services/connections.ts:29)
- [`acceptConnection(targetUserId: string)`](frontend/src/services/connections.ts:36)
- [`declineConnection(targetUserId: string)`](frontend/src/services/connections.ts:43)
- [`cancelConnection(targetUserId: string)`](frontend/src/services/connections.ts:50)

**Protocol Endpoint:** `POST /connections/actions`  
**Protocol Handler:** [`Line 152-277`](protocol/src/routes/connections.ts:152)

**Request:**
```typescript
{
  targetUserId: string;
  action: 'REQUEST' | 'SKIP' | 'CANCEL' | 'ACCEPT' | 'DECLINE';
}
```

**Response Type (Frontend - defined in types.ts):**
```typescript
// ConnectionEvent
{
  event: {
    id: string;
    initiatorUserId: string;
    receiverUserId: string;
    eventType: string;
    createdAt: string;
  };
}
```

---

## 3. Indexes Service

**Frontend File:** [`frontend/src/services/indexes.ts`](frontend/src/services/indexes.ts:1)  
**Protocol File:** [`protocol/src/routes/indexes.ts`](protocol/src/routes/indexes.ts:1)

### 3.1 Get Indexes

**Frontend Method:** [`getIndexes(page: number, limit: number)`](frontend/src/services/indexes.ts:34)  
**Protocol Endpoint:** `GET /indexes?page=&limit=`  
**Protocol Handler:** [`Line 134-253`](protocol/src/routes/indexes.ts:134)

**Response Type (Frontend - uses PaginatedResponse):**
```typescript
PaginatedResponse<Index>
```

### 3.2 Discover Public Indexes

**Frontend Method:** [`discoverPublicIndexes(page: number, limit: number)`](frontend/src/services/indexes.ts:40)  
**Protocol Endpoint:** `GET /indexes/discover/public?page=&limit=`  
**Protocol Handler:** [`Line 29-130`](protocol/src/routes/indexes.ts:29)

**Response Type:**
```typescript
PaginatedResponse<Index & { isMember?: boolean }>
```

### 3.3 Get Index

**Frontend Method:** [`getIndex(id: string)`](frontend/src/services/indexes.ts:46)  
**Protocol Endpoint:** `GET /indexes/:id`  
**Protocol Handler:** [`Line 306-392`](protocol/src/routes/indexes.ts:306)

**Response Type:**
```typescript
{
  index: Index;
}
```

### 3.4 Get Index by Share Code

**Frontend Method:** [`getIndexByShareCode(code: string)`](frontend/src/services/indexes.ts:55)  
**Protocol Endpoint:** `GET /indexes/share/:code`  
**Protocol Handler:** [`Line 1281-1339`](protocol/src/routes/indexes.ts:1281)

### 3.5 Get Public Index by ID

**Frontend Method:** [`getPublicIndexById(id: string)`](frontend/src/services/indexes.ts:64)  
**Protocol Endpoint:** `GET /indexes/public/:id`  
**Protocol Handler:** [`Line 1222-1277`](protocol/src/routes/indexes.ts:1222)

### 3.6 Create Index

**Frontend Method:** [`createIndex(data: CreateIndexRequest)`](frontend/src/services/indexes.ts:73)  
**Protocol Endpoint:** `POST /indexes`  
**Protocol Handler:** [`Line 396-475`](protocol/src/routes/indexes.ts:396)

**Request Type:**
```typescript
CreateIndexRequest {
  title: string;
  prompt?: string;
  joinPolicy?: 'anyone' | 'invite_only';
}
```

### 3.7 Update Index

**Frontend Method:** [`updateIndex(id: string, data: UpdateIndexRequest)`](frontend/src/services/indexes.ts:82)  
**Protocol Endpoint:** `PUT /indexes/:id`  
**Protocol Handler:** [`Line 479-569`](protocol/src/routes/indexes.ts:479)

**Request Type:**
```typescript
UpdateIndexRequest {
  title?: string;
  prompt?: string;
  permissions?: {
    joinPolicy?: 'anyone' | 'invite_only';
    allowGuestVibeCheck?: boolean;
  };
}
```

### 3.8 Delete Index

**Frontend Method:** [`deleteIndex(id: string)`](frontend/src/services/indexes.ts:91)  
**Protocol Endpoint:** `DELETE /indexes/:id`  
**Protocol Handler:** [`Line 574-602`](protocol/src/routes/indexes.ts:574)

### 3.9 Member Management

**Frontend Methods:**
- [`addMember(indexId: string, userId: string, permissions: string[])`](frontend/src/services/indexes.ts:97)
- [`removeMember(indexId: string, userId: string)`](frontend/src/services/indexes.ts:109)
- [`updateMemberPermissions(indexId: string, userId: string, permissions: string[])`](frontend/src/services/indexes.ts:114)
- [`getMembers(indexId: string, searchQuery?: string)`](frontend/src/services/indexes.ts:125)

**Protocol Endpoints:**
- `POST /indexes/:id/members` [`Line 606-707`](protocol/src/routes/indexes.ts:606)
- `DELETE /indexes/:id/members/:userId` [`Line 711-756`](protocol/src/routes/indexes.ts:711)
- `PATCH /indexes/:id/members/:userId` [`Line 801-901`](protocol/src/routes/indexes.ts:801)
- `GET /indexes/:id/members` [`Line 1068-1113`](protocol/src/routes/indexes.ts:1068)

**Member Type:**
```typescript
{
  id: string;
  name: string;
  email: string;
  avatar?: string;
  permissions: string[];
  createdAt?: string;
  updatedAt?: string;
}
```

### 3.10 Permissions & Access

**Frontend Methods:**
- [`updatePermissions(indexId: string, permissions)`](frontend/src/services/indexes.ts:137)
- [`regenerateInvitationLink(indexId: string)`](frontend/src/services/indexes.ts:146)
- [`searchUsers(query: string, indexId?: string)`](frontend/src/services/indexes.ts:156)
- [`joinIndex(indexId: string)`](frontend/src/services/indexes.ts:166)
- [`acceptInvitation(code: string)`](frontend/src/services/indexes.ts:181)

**Protocol Endpoints:**
- `PATCH /indexes/:id/permissions` [`Line 905-993`](protocol/src/routes/indexes.ts:905)
- `PATCH /indexes/:id/regenerate-invitation` [`Line 997-1064`](protocol/src/routes/indexes.ts:997)
- `GET /indexes/search-users` [`Line 257-302`](protocol/src/routes/indexes.ts:257)
- `POST /indexes/:id/join` [`Line 1343-1434`](protocol/src/routes/indexes.ts:1343)
- `POST /indexes/invitation/:code/accept` [`Line 1439-1550`](protocol/src/routes/indexes.ts:1439)

### 3.11 Member Intents

**Frontend Methods:**
- [`getMemberIntents(indexId: string)`](frontend/src/services/indexes.ts:197)
- [`removeMemberIntent(indexId: string, intentId: string)`](frontend/src/services/indexes.ts:223)

**Protocol Endpoints:**
- `GET /indexes/:id/member-intents` [`Line 1726-1764`](protocol/src/routes/indexes.ts:1726)
- `DELETE /indexes/:id/member-intents/:intentId` [`Line 1913-1962`](protocol/src/routes/indexes.ts:1913)

---

## 4. Integrations Service

**Frontend File:** [`frontend/src/services/integrations.ts`](frontend/src/services/integrations.ts:1)  
**Protocol File:** [`protocol/src/routes/integrations.ts`](protocol/src/routes/integrations.ts:1)

### 4.1 Get Integrations

**Frontend Method:** [`getIntegrations(indexId?: string)`](frontend/src/services/integrations.ts:67)  
**Protocol Endpoint:** `GET /integrations?indexId=`  
**Protocol Handler:** [`Line 30-108`](protocol/src/routes/integrations.ts:30)

**Response Type:**
```typescript
{
  integrations: IntegrationResponse[];
  availableTypes: AvailableIntegrationType[];
}

// IntegrationResponse
{
  id: string;
  type: string;
  name: string;
  connected: boolean;
  connectedAt?: string | null;
  lastSyncAt?: string | null;
  indexId?: string | null;
  status?: string;
}

// AvailableIntegrationType
{
  type: string;
  name: string;
  toolkit: string;
}
```

### 4.2 Connect Integration

**Frontend Method:** [`connectIntegration(integrationType: string, data: ConnectIntegrationRequest)`](frontend/src/services/integrations.ts:79)  
**Protocol Endpoint:** `POST /integrations/connect/:integrationType`  
**Protocol Handler:** [`Line 112-246`](protocol/src/routes/integrations.ts:112)

**Request Type:**
```typescript
ConnectIntegrationRequest {
  indexId?: string;
  enableUserAttribution?: boolean;
}
```

**Response Type:**
```typescript
ConnectIntegrationResponse {
  redirectUrl: string;
  integrationId: string;
}
```

### 4.3 Integration Status

**Frontend Method:** [`getIntegrationStatus(integrationId: string)`](frontend/src/services/integrations.ts:87)  
**Protocol Endpoint:** `GET /integrations/:integrationId/status`  
**Protocol Handler:** [`Line 250-342`](protocol/src/routes/integrations.ts:250)

**Response Type:**
```typescript
IntegrationStatusResponse {
  status: 'pending' | 'connected';
  connectedAt?: string;
}
```

### 4.4 Disconnect Integration

**Frontend Method:** [`disconnectIntegration(integrationId: string)`](frontend/src/services/integrations.ts:92)  
**Protocol Endpoint:** `DELETE /integrations/:integrationId`  
**Protocol Handler:** [`Line 346-413`](protocol/src/routes/integrations.ts:346)

### 4.5 Directory Sync

**Frontend Methods:**
- [`getDirectorySources(integrationId: string)`](frontend/src/services/integrations.ts:97)
- [`getDirectorySourceSchema(integrationId: string, sourceId: string, subSourceId?: string)`](frontend/src/services/integrations.ts:101)
- [`getDirectoryConfig(integrationId: string)`](frontend/src/services/integrations.ts:106)
- [`saveDirectoryConfig(integrationId: string, config)`](frontend/src/services/integrations.ts:110)
- [`syncDirectory(integrationId: string)`](frontend/src/services/integrations.ts:114)

**Protocol Endpoints:**
- `GET /integrations/:integrationId/directory/sources` [`Line 419-475`](protocol/src/routes/integrations.ts:419)
- `GET /integrations/:integrationId/directory/sources/:sourceId/schema` [`Line 479-539`](protocol/src/routes/integrations.ts:479)
- `GET /integrations/:integrationId/directory/config` [`Line 543-582`](protocol/src/routes/integrations.ts:543)
- `POST /integrations/:integrationId/directory/config` [`Line 586-655`](protocol/src/routes/integrations.ts:586)
- `POST /integrations/:integrationId/directory/sync` [`Line 659-727`](protocol/src/routes/integrations.ts:659)

**Directory Sync Types:**
```typescript
DirectorySyncConfig {
  enabled: boolean;
  source: {
    id: string;
    name: string;
    subId?: string;
    subName?: string;
  };
  columnMappings: {
    email: string;
    name?: string;
    intro?: string;
    location?: string;
    twitter?: string;
    linkedin?: string;
    github?: string;
    website?: string;
  };
  lastSyncAt?: string;
  lastSyncStatus?: 'success' | 'error' | 'partial';
  lastSyncError?: string;
  memberCount?: number;
}
```

---

## 5. Links Service

**Frontend File:** [`frontend/src/services/links.ts`](frontend/src/services/links.ts:1)  
**Protocol File:** [`protocol/src/routes/links.ts`](protocol/src/routes/links.ts:1)

### 5.1 Get Links

**Frontend Method:** [`getLinks()`](frontend/src/services/links.ts:24)  
**Protocol Endpoint:** `GET /links`  
**Protocol Handler:** [`Line 65-74`](protocol/src/routes/links.ts:65)

**Response Type:**
```typescript
{
  links: LinkRecord[];
}

// LinkRecord
{
  id: string;
  url: string;
  createdAt?: string;
  lastSyncAt?: string | null;
  lastStatus?: string | null;
  lastError?: string | null;
  contentUrl?: string;
}
```

### 5.2 Create Link

**Frontend Method:** [`createLink(url: string)`](frontend/src/services/links.ts:30)  
**Protocol Endpoint:** `POST /links`  
**Protocol Handler:** [`Line 78-103`](protocol/src/routes/links.ts:78)

**Request:**
```typescript
{
  url: string;
}
```

**Response Type:**
```typescript
{
  link: LinkRecord;
}
```

### 5.3 Delete Link

**Frontend Method:** [`deleteLink(linkId: string)`](frontend/src/services/links.ts:36)  
**Protocol Endpoint:** `DELETE /links/:linkId`  
**Protocol Handler:** [`Line 107-119`](protocol/src/routes/links.ts:107)

### 5.4 Get Link Content

**Frontend Method:** [`getLinkContent(linkId: string)`](frontend/src/services/links.ts:41)  
**Protocol Endpoint:** `GET /links/:linkId/content`  
**Protocol Handler:** [`Line 122-141`](protocol/src/routes/links.ts:122)

**Response Type:**
```typescript
LinkContentResponse {
  content?: string;
  pending?: boolean;
  url?: string;
  lastStatus?: string | null;
  lastSyncAt?: string | null;
}
```

---

## 6. LMSR Service

**Frontend File:** [`frontend/src/services/lmsr.ts`](frontend/src/services/lmsr.ts:1)  
**Protocol File:** None (Frontend-only simulation)

This service implements client-side LMSR (Logarithmic Market Scoring Rule) market calculations for the simulation/demo feature. It does not make any API calls to the protocol.

**Key Types:**
```typescript
MarketState {
  intentPairId: string;
  q: number;
  price: number;
  liquidity: number;
  volume: number;
  yesShares: number;
  noShares: number;
}

MarketAction {
  type: 'BUY' | 'SELL';
  amount: number;
  agentId: string;
  confidence: number;
  outcome: 'YES' | 'NO';
}

Agent {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  target: string[];
  budget: number;
  stakedAmount?: number;
  position?: 'YES' | 'NO';
  stakedIn?: string;
  triggers?: Array<{
    type: string;
    condition: (result: SearchResult) => boolean;
  }>;
  audience?: string[];
}
```

---

## 7. Synthesis Service

**Frontend File:** [`frontend/src/services/synthesis.ts`](frontend/src/services/synthesis.ts:1)  
**Protocol File:** [`protocol/src/routes/synthesis.ts`](protocol/src/routes/synthesis.ts:1)

### 7.1 Generate VibeCheck

**Frontend Method:** [`generateVibeCheck(request: SynthesisRequest)`](frontend/src/services/synthesis.ts:23)  
**Protocol Endpoint:** `POST /synthesis/vibecheck`  
**Protocol Handler:** [`Line 14-79`](protocol/src/routes/synthesis.ts:14)

**Request Type:**
```typescript
SynthesisRequest {
  targetUserId: string;
  initiatorId?: string;
  intentIds?: string[];
  indexIds?: string[];
  options?: {
    characterLimit?: number;
    [key: string]: unknown;
  };
}
```

**Response Type:**
```typescript
SynthesisResponse {
  synthesis: string;
  targetUserId: string;
  contextUserId: string;
  connectingStakes: number;
}
```

---

## Shared Type Definitions

### Core Domain Models

#### Index
**Defined in:** [`frontend/src/lib/types.ts`](frontend/src/lib/types.ts:1)

```typescript
Index {
  id: string;
  title: string;
  prompt?: string | null;
  permissions?: {
    joinPolicy?: 'anyone' | 'invite_only';
    invitationLink?: { code: string } | null;
    allowGuestVibeCheck?: boolean;
    requireApproval?: boolean;
  };
  createdAt: string;
  updatedAt: string;
  user?: {
    id: string;
    name: string;
    avatar?: string | null;
  };
  _count?: {
    members: number;
    files?: number;
  };
}
```

#### ConnectionEvent
**Defined in:** [`frontend/src/lib/types.ts`](frontend/src/lib/types.ts:1)

```typescript
ConnectionEvent {
  id: string;
  initiatorUserId: string;
  receiverUserId: string;
  eventType: 'REQUEST' | 'ACCEPT' | 'DECLINE' | 'SKIP' | 'CANCEL' | 'OWNER_APPROVE' | 'OWNER_DENY';
  createdAt: string;
}
```

#### PaginatedResponse
**Defined in:** [`frontend/src/lib/types.ts`](frontend/src/lib/types.ts:1)

```typescript
PaginatedResponse<T> {
  [data]: T[];
  pagination: {
    current: number;
    total: number;
    count: number;
    totalCount: number;
  };
}
```

#### APIResponse
**Defined in:** [`frontend/src/lib/types.ts`](frontend/src/lib/types.ts:1)

```typescript
APIResponse<T> {
  [key: string]: T | unknown;
}
```

### Request Types

#### CreateIndexRequest
```typescript
{
  title: string;
  prompt?: string;
  joinPolicy?: 'anyone' | 'invite_only';
}
```

#### UpdateIndexRequest
```typescript
{
  title?: string;
  prompt?: string;
  permissions?: {
    joinPolicy?: 'anyone' | 'invite_only';
    allowGuestVibeCheck?: boolean;
  };
}
```

---

## Type Mismatches & Issues

### 1. Date vs String Inconsistency

**Issue:** Protocol returns `Date` objects for timestamps, but frontend expects `string`.

**Affected Fields:**
- `createdAt`, `updatedAt`, `archivedAt`, `connectedAt`, `lastSyncAt`

**Example:**
- **Protocol:** [`admin.ts:118`](protocol/src/routes/admin.ts:118) returns `createdAt: event.createdAt` (Date)
- **Frontend:** [`admin.ts:18`](frontend/src/services/admin.ts:18) expects `createdAt: string`

**Recommendation:** Use JSON serialization which automatically converts Date to ISO string, or explicitly convert dates in protocol responses.

### 2. Member Type Mismatch

**Issue:** Frontend `Member` interface includes `email` field, but protocol routes don't always return it.

**Frontend Definition:** [`indexes.ts:15`](frontend/src/services/indexes.ts:15)
```typescript
interface Member {
  id: string;
  name: string;
  email: string; // ⚠️ Not always returned by protocol
  avatar?: string;
  permissions: string[];
}
```

**Protocol:** [`indexes.ts:1095-1106`](protocol/src/routes/indexes.ts:1095) returns members without email field.

**Recommendation:** Make `email` optional in frontend or ensure protocol always includes it.

### 3. Avatar Field Nullability

**Issue:** Inconsistent handling of `avatar` field - sometimes `string | null`, sometimes `string`.

**Frontend:** Uses `avatar: string | null` in some places but `avatar?: string` in others  
**Protocol:** Returns `avatar: string` from database but can be null

**Recommendation:** Standardize to `avatar?: string | null` across both layers.

### 4. ConnectionsByUserResponse Type

**Issue:** Frontend defines this type in `types.ts` but uses inline types in service methods.

**Frontend:** [`connections.ts:3`](frontend/src/services/connections.ts:3) imports type but also uses inline type at [`Line 9-18`](frontend/src/services/connections.ts:9)

**Recommendation:** Use the imported type consistently.

### 5. Pagination Response Structure

**Issue:** Some endpoints return data under `indexes`, others under generic keys.

**Examples:**
- `GET /indexes` returns `{ indexes: [...], pagination: {...} }`
- `GET /intents` returns `{ intents: [...], pagination: {...} }`

**Frontend:** Uses generic `PaginatedResponse<T>` which expects data under array key

**Recommendation:** Standardize pagination response structure across all endpoints.

### 6. Integration Config Type

**Issue:** `DirectorySyncConfig` is defined in protocol schema but also redefined in frontend.

**Protocol:** [`protocol/src/routes/integrations.ts:17`](protocol/src/routes/integrations.ts:17) imports from schema  
**Frontend:** [`integrations.ts:35`](frontend/src/services/integrations.ts:35) defines inline

**Recommendation:** Share type definitions between frontend and protocol layers.

---

## Summary Statistics

### Endpoints by Service

| Service | Endpoints | Protocol Routes |
|---------|-----------|----------------|
| Admin | 4 | 4 |
| Connections | 6 | 2 |
| Indexes | 22 | 22 |
| Integrations | 9 | 9 |
| Links | 4 | 4 |
| LMSR | 0 | 0 |
| Synthesis | 1 | 1 |
| **Total** | **46** | **42** |

### Type Definitions

- **Shared Domain Models:** 8 (Index, ConnectionEvent, Member, IntegrationResponse, etc.)
- **Request Types:** 6 (CreateIndexRequest, UpdateIndexRequest, SynthesisRequest, etc.)
- **Response Types:** 4 (PaginatedResponse, APIResponse, ConnectionsByUserResponse, etc.)
- **Frontend-Only Types:** 4 (LMSR market types)
- **Type Mismatches Identified:** 6

### Files Analyzed

**Frontend Services (7):**
1. [`admin.ts`](frontend/src/services/admin.ts:1) - 69 lines
2. [`connections.ts`](frontend/src/services/connections.ts:1) - 61 lines
3. [`indexes.ts`](frontend/src/services/indexes.ts:1) - 263 lines
4. [`integrations.ts`](frontend/src/services/integrations.ts:1) - 123 lines
5. [`links.ts`](frontend/src/services/links.ts:1) - 50 lines
6. [`lmsr.ts`](frontend/src/services/lmsr.ts:1) - 417 lines
7. [`synthesis.ts`](frontend/src/services/synthesis.ts:1) - 32 lines

**Protocol Routes (15):**
1. [`admin.ts`](protocol/src/routes/admin.ts:1) - 386 lines
2. [`agents.ts`](protocol/src/routes/agents.ts:1) - 205 lines (not used by frontend services)
3. [`auth.ts`](protocol/src/routes/auth.ts:1) - 160 lines (used by auth context)
4. [`connections.ts`](protocol/src/routes/connections.ts:1) - 331 lines
5. [`discover.ts`](protocol/src/routes/discover.ts:1) - 395 lines (used by discovery form)
6. [`files.ts`](protocol/src/routes/files.ts:1) - 262 lines (used directly, no service wrapper)
7. [`indexes.ts`](protocol/src/routes/indexes.ts:1) - 1965 lines
8. [`integrations.ts`](protocol/src/routes/integrations.ts:1) - 730 lines
9. [`intents.ts`](protocol/src/routes/intents.ts:1) - 701 lines (used directly, no service wrapper)
10. [`links.ts`](protocol/src/routes/links.ts:1) - 143 lines
11. [`queue.ts`](protocol/src/routes/queue.ts:1) - 112 lines (used for queue status)
12. [`sync.ts`](protocol/src/routes/sync.ts:1) - 29 lines (used for manual sync)
13. [`synthesis.ts`](protocol/src/routes/synthesis.ts:1) - 81 lines
14. [`upload.ts`](protocol/src/routes/upload.ts:1) - 48 lines (avatar uploads)
15. [`users.ts`](protocol/src/routes/users.ts:1) - 145 lines (user profile management)

---

## Recommendations

### 1. Type Safety Improvements

Create a shared type package between frontend and protocol:
- Extract common types to `@shared/types` package
- Use TypeScript's type generation from protocol to frontend
- Implement runtime type validation with libraries like Zod

### 2. API Response Standardization

Standardize all API responses to follow consistent structure:
```typescript
{
  data: T;
  pagination?: PaginationInfo;
  meta?: ResponseMeta;
}
```

### 3. Date Serialization

Implement consistent date handling:
- Protocol: Use `.toISOString()` for all dates before returning
- Frontend: Parse ISO strings to Date objects when needed
- Consider using a date library like `date-fns` for consistency

### 4. Documentation

- Add JSDoc comments to all service methods
- Include request/response examples
- Document error responses
- Create OpenAPI/Swagger specification

### 5. Testing

- Add integration tests for each service-route connection
- Implement contract testing to catch type mismatches
- Add E2E tests for critical user flows

---

**Document Version:** 1.0  
**Last Updated:** November 26, 2025