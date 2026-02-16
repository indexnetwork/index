# XMTP Migration Design

**Date**: 2026-02-15
**Status**: Approved
**Approach**: Full XMTP-Native (Approach A)

## Summary

Migrate all chat functionality from Stream Chat (human DMs) and custom PostgreSQL-backed AI chat to XMTP. Every conversation becomes an XMTP group chat with the Index agent as a member. Clean break — no data migration from existing systems.

## Current State

Two separate chat systems:
1. **AI Chat**: Custom SSE streaming via LangGraph, messages in PostgreSQL (`chat_sessions`, `chat_messages`)
2. **Human DMs**: Stream Chat (3rd party), messages in Stream's cloud, backend does token gen + opportunity-triggered system messages

## Target State

One unified XMTP-based messaging system with three conversation types, all group chats.

---

## Identity & Client Architecture

### Agent Identity
- One server-side wallet (`XMTP_AGENT_WALLET_KEY` env var) → one XMTP inbox ID
- Runs via `@xmtp/agent-sdk` as a persistent process
- Member of every conversation — receives and sends messages

### User Identity
- Browser SDK (`@xmtp/browser-sdk`) creates client per user
- Privy embedded wallet provides the Signer (signs XMTP identity)
- Client initialized on login (replaces `StreamChat.getInstance()`)
- Local SQLite database in browser for message history

### Backend Role
- Express server does NOT create XMTP clients for users
- Hosts the agent process with its own XMTP client
- Still handles: auth (Privy), intent processing, opportunity detection, profile generation
- Triggers agent behavior through the agent's XMTP client

---

## Conversation Types

### 1. Home Feed (per user)
- Created automatically on first login
- Members: `[user, agent]`
- Group metadata: `{ appData: { type: 'home_feed' } }`
- Agent sends structured messages: opportunity cards, updates, notifications
- User can reply/interact; primarily agent → user
- One per user, persistent

### 2. AI Chat Sessions (on demand)
- Created when user starts a new conversation ("What are you looking for?")
- Members: `[user, agent]`
- Group metadata: `{ appData: { type: 'ai_chat', title: '...' } }`
- User sends text, agent responds with AI-generated answers
- Token streaming via SSE sideband, final response persisted as XMTP message
- Multiple per user

### 3. Human Chats (on connection)
- Created when opportunity is accepted / connection made
- Members: `[user_a, user_b, agent]`
- Group metadata: `{ appData: { type: 'human_chat', opportunityIds: [...] } }`
- Agent sends intro message, then silent unless @mentioned
- Agent can inject opportunity updates

### Custom Content Types
- `opportunity_card` — rendered as opportunity card UI
- `opportunity_update` — injected updates in human chats
- `agent_response` — AI chat responses (with tool/routing metadata)
- Standard types (text, reaction, reply, attachment) used as-is

### Conversation Discovery
- Frontend queries XMTP conversations filtered by `appData.type`
- Home feed: find the one with `type: 'home_feed'`
- AI chats: list all with `type: 'ai_chat'`, sorted by last message
- Human chats: list all with `type: 'human_chat'`

---

## Message Flows

### AI Chat

```
1. User sends text → XMTP group chat (ai_chat type)
2. Agent SDK receives via stream listener
3. Agent identifies conversation type from appData
4. Triggers LangGraph chat pipeline
5. SIMULTANEOUSLY:
   a. SSE sideband streams tokens to frontend in real-time
   b. LangGraph processes full response
6. When complete:
   a. Agent sends final response as XMTP message
   b. SSE stream sends 'done' event
7. Frontend: SSE tokens are temporary UI, XMTP message is persisted version
```

### Home Feed

```
1. Backend detects new opportunity (via broker system)
2. Agent sends structured XMTP message to user's home_feed group:
   { type: 'opportunity_card', data: { headline, summary, actors, ... } }
3. Frontend receives via XMTP stream, renders as card
4. User taps "Start Chat" → creates human_chat group
5. User taps "Skip" → sends action message, agent marks rejected
```

### Human Chat

```
1. Opportunity accepted → agent creates 3-member group
2. Agent sends intro message (structured content type)
3. Users chat freely through XMTP (E2E encrypted)
4. Agent receives all messages but stays silent
5. If @mentioned, agent processes via LangGraph
6. Backend can inject opportunity_update messages
```

---

## Frontend Architecture

### New Context: XMTPContext (replaces StreamChatContext + AIChatContext)

```typescript
{
  client: XMTPClient,
  isReady: boolean,
  conversations: {
    homeFeed: Conversation,
    aiChats: Conversation[],
    humanChats: Conversation[],
  },
  createAIChat: (message: string) => Conversation,
  sendMessage: (conversationId, content) => void,
  streamTokens: (conversationId, message) => SSEStream,
}
```

### Route Changes
- `/` (home) → `HomeFeed` component rendering XMTP messages from home_feed group + new chat input
- `/d/[id]` → AI chat session, `id` is XMTP conversation ID
- `/u/[id]/chat` → Human chat, loads XMTP conversation
- Sidebar: Lists XMTP conversations grouped by type

### Component Migration

| Current | After |
|---------|-------|
| `StreamChatContext.tsx` | `XMTPContext.tsx` |
| `AIChatContext.tsx` | Merged into XMTPContext or simplified |
| `ChatContent.tsx` | Refactored for XMTP + SSE sideband |
| `ChatView.tsx` | Refactored for XMTP (no Stream SDK) |
| `ChatSidebar.tsx` | Queries XMTP conversations by type |
| `SystemMessageCard.tsx` | Custom content type renderer |
| `ClientWrapper.tsx` | `XMTPProvider` replaces `StreamChatProvider` |

### Dependencies
- Remove: `stream-chat`
- Add: `@xmtp/browser-sdk`

---

## Backend Architecture

### New: XMTP Agent Process

```typescript
// protocol/src/agent/agent.xmtp.ts
const agent = await Agent.createFromEnv();

agent.on('text', async (ctx) => {
  const appData = ctx.conversation.metadata?.appData;

  if (appData?.type === 'ai_chat') {
    const response = await chatService.processAndRespond(ctx);
    await ctx.sendText(response);
  }

  if (appData?.type === 'human_chat' && isMentioned(ctx.message.content)) {
    const response = await chatService.processAndRespond(ctx);
    await ctx.sendText(response);
  }
});

await agent.start();
```

### Controller Changes

ChatController:
- Remove: `POST /chat/token`, `POST /chat/user` (Stream-specific)
- Simplify: `POST /chat/stream` → SSE sideband only (no message persistence)
- Remove: Session CRUD endpoints
- Add: `GET /chat/agent-address` → returns agent's XMTP address

### Service Changes

ChatSessionService simplification:
- Remove PostgreSQL session/message CRUD
- Keep LangGraph pipeline execution
- Chat history loaded from XMTP conversation messages

### Opportunity Flow
- `OpportunityService` → tells agent to create XMTP groups (not Stream channels)
- `opportunity.chat-injection.ts` → agent sends structured XMTP messages

### Removed Backend Code
- `chat.adapter.ts` (Stream Chat adapter)
- `chat.interface.ts` (ChatProvider interface)
- `chat-provider.utils.ts` (channel ID helpers)
- `chat.checkpointer.ts` (PostgresSaver)
- `chat_sessions` / `chat_messages` DB tables (migration to drop)

### New Environment Variables
```bash
XMTP_ENV=dev
XMTP_AGENT_WALLET_KEY=0x...
XMTP_DB_ENCRYPTION_KEY=0x...
```

---

## Migration Phases

1. **Phase 1 — Infrastructure**: XMTP agent process, XMTPContext on frontend, Privy wallet integration
2. **Phase 2 — AI Chat**: Migrate AI chat to XMTP groups + SSE sideband
3. **Phase 3 — Home Feed**: Replace opportunity cards API with agent-pushed XMTP messages
4. **Phase 4 — Human Chat**: Replace Stream Chat DMs with XMTP 3-member groups
5. **Phase 5 — Cleanup**: Remove Stream Chat, drop PostgreSQL chat tables, remove dead code

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| XMTP dev network instability | Feature flag until proven stable |
| Browser SDK local DB not encrypted | Acceptable — E2E encrypted in transit |
| Rate limits (3000 writes/5min) | Sufficient for use case |
| Agent process crash | PM2 with auto-restart, persistent volume |
| SSE + XMTP reconciliation | Temporary SSE tokens, replace with XMTP message |
| Privy wallet availability | Well-supported, already using Privy auth |

## What We Keep
- LangGraph AI pipeline
- Intent/opportunity/broker system
- All non-chat API endpoints
- Privy authentication
- PostgreSQL for everything except chat messages
