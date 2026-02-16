# XMTP Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace Stream Chat and custom PostgreSQL-backed AI chat with XMTP group chats, unifying all messaging through one E2E encrypted protocol with the Index agent as a member of every conversation.

**Architecture:** Server-side XMTP agent (`@xmtp/agent-sdk`) handles message reception and AI responses. Frontend uses `@xmtp/browser-sdk` with Privy embedded wallet signing. SSE sideband for real-time AI token streaming. Three conversation types (home_feed, ai_chat, human_chat) differentiated by XMTP group metadata `appData.type`.

**Tech Stack:** `@xmtp/agent-sdk` (backend), `@xmtp/browser-sdk` (frontend), Privy embedded wallets (signing), LangGraph (AI pipeline, unchanged), SSE (token streaming sideband)

**Branch:** `feat/xmtp-migration` (use git worktree for isolation)

---

## Phase 1: Infrastructure

### Task 1: Create Feature Branch and Install Dependencies

**Files:**
- Modify: `protocol/package.json`
- Modify: `frontend/package.json`

**Step 1: Create feature branch**

```bash
git checkout -b feat/xmtp-migration
```

**Step 2: Install backend XMTP dependency**

```bash
cd protocol
bun add @xmtp/agent-sdk
```

**Step 3: Install frontend XMTP dependency**

```bash
cd frontend
bun add @xmtp/browser-sdk
```

**Step 4: Verify installation**

```bash
cd protocol && bun run lint
cd ../frontend && bun run lint
```

**Step 5: Commit**

```bash
git add protocol/package.json protocol/bun.lockb frontend/package.json frontend/bun.lockb
git commit -m "feat: add XMTP SDK dependencies for migration"
```

---

### Task 2: Enable Privy Embedded Wallets

**Files:**
- Modify: `frontend/src/contexts/AuthContext.tsx` (line ~186, `loginMethods` config)

**Context:** Currently Privy is configured with `loginMethods: ['email', 'google']` only. XMTP requires an Ethereum signer. Privy's embedded wallet feature auto-creates a wallet for every user, providing the signing capability without requiring users to manage keys.

**Step 1: Update Privy config to enable embedded wallets**

In `frontend/src/contexts/AuthContext.tsx`, find the `PrivyProvider` config object and add `embeddedWallets` configuration:

```typescript
// In the PrivyProvider config:
embeddedWallets: {
  createOnLogin: 'all-users',
},
```

This ensures every user (email, Google, etc.) gets an embedded wallet on login that can sign XMTP identity messages.

**Step 2: Verify the app still builds**

```bash
cd frontend && bun run build
```

**Step 3: Commit**

```bash
git add frontend/src/contexts/AuthContext.tsx
git commit -m "feat: enable Privy embedded wallets for XMTP signing"
```

---

### Task 3: Set Up XMTP Agent Process (Backend)

**Files:**
- Create: `protocol/src/agent/xmtp.agent.ts`
- Create: `protocol/src/agent/xmtp.types.ts`
- Modify: `protocol/src/main.ts` (add agent startup)

**Context:** The XMTP agent is a persistent process that listens for messages across all conversations. It runs alongside the Express server. It needs its own wallet (env var) and a persistent local database.

**Step 1: Create agent types file**

Create `protocol/src/agent/xmtp.types.ts`:

```typescript
export const CONVERSATION_TYPES = {
  HOME_FEED: 'home_feed',
  AI_CHAT: 'ai_chat',
  HUMAN_CHAT: 'human_chat',
} as const;

export type ConversationType = typeof CONVERSATION_TYPES[keyof typeof CONVERSATION_TYPES];

export interface ConversationAppData {
  type: ConversationType;
  title?: string;
  opportunityIds?: string[];
}
```

**Step 2: Create the XMTP agent module**

Create `protocol/src/agent/xmtp.agent.ts`:

```typescript
import { Agent } from '@xmtp/agent-sdk';
import { CONVERSATION_TYPES, type ConversationAppData } from './xmtp.types';

let agentInstance: Agent | null = null;

export async function startXMTPAgent(): Promise<Agent> {
  if (agentInstance) return agentInstance;

  const agent = await Agent.createFromEnv({
    dbPath: (inboxId) =>
      `${process.env.XMTP_DB_PATH ?? '.'}/${process.env.XMTP_ENV ?? 'dev'}-${inboxId.slice(0, 8)}.db3`,
  });

  // Log agent address on start
  agent.on('start', () => {
    console.log(`[XMTP Agent] Started. Address: ${agent.address}`);
  });

  // Handle text messages based on conversation type
  agent.on('text', async (ctx) => {
    try {
      // Skip messages from self to avoid loops
      const senderAddress = await ctx.getSenderAddress();
      if (senderAddress === ctx.getClientAddress()) return;

      const appData = getAppData(ctx.conversation);
      if (!appData) return;

      switch (appData.type) {
        case CONVERSATION_TYPES.AI_CHAT:
          // AI chat processing will be wired in Phase 2
          console.log(`[XMTP Agent] AI chat message in ${ctx.conversation.id}`);
          break;

        case CONVERSATION_TYPES.HOME_FEED:
          // Home feed replies will be handled in Phase 3
          console.log(`[XMTP Agent] Home feed message in ${ctx.conversation.id}`);
          break;

        case CONVERSATION_TYPES.HUMAN_CHAT:
          // Human chat @mentions will be handled in Phase 4
          console.log(`[XMTP Agent] Human chat message in ${ctx.conversation.id}`);
          break;
      }
    } catch (error) {
      console.error('[XMTP Agent] Error handling message:', error);
    }
  });

  agent.on('group', async (ctx) => {
    console.log(`[XMTP Agent] Added to group: ${ctx.conversation.id}`);
  });

  agent.on('unhandledError', (error) => {
    console.error('[XMTP Agent] Unhandled error:', error);
  });

  await agent.start();
  agentInstance = agent;
  return agent;
}

export function getXMTPAgent(): Agent | null {
  return agentInstance;
}

export function getAgentAddress(): string | null {
  return agentInstance?.address ?? null;
}

function getAppData(conversation: any): ConversationAppData | null {
  try {
    const metadata = conversation.metadata;
    if (!metadata?.appData) return null;
    return typeof metadata.appData === 'string'
      ? JSON.parse(metadata.appData)
      : metadata.appData;
  } catch {
    return null;
  }
}
```

**Step 3: Add environment variables**

Add to `protocol/env.example`:

```bash
# XMTP Agent
XMTP_ENV=dev
XMTP_WALLET_KEY=0x...          # Agent's private key (64 hex chars with 0x prefix)
XMTP_DB_ENCRYPTION_KEY=0x...   # 32-byte encryption key (64 hex chars with 0x prefix)
XMTP_DB_PATH=.                 # Path for agent's local database files
```

**Step 4: Wire agent startup into main.ts**

In `protocol/src/main.ts`, add after the server starts:

```typescript
import { startXMTPAgent } from './agent/xmtp.agent';

// After Bun.serve(...):
startXMTPAgent().catch((error) => {
  console.error('[XMTP Agent] Failed to start:', error);
});
```

**Step 5: Add agent-address endpoint to ChatController**

In `protocol/src/controllers/chat.controller.ts`, add a new route:

```typescript
import { getAgentAddress } from '../agent/xmtp.agent';

// Inside ChatController class:
@Get('/agent-address')
async getAgentAddress(req: Request) {
  const address = getAgentAddress();
  if (!address) {
    return Response.json({ error: 'Agent not ready' }, { status: 503 });
  }
  return Response.json({ address });
}
```

**Step 6: Verify protocol builds**

```bash
cd protocol && bun run lint
```

**Step 7: Commit**

```bash
git add protocol/src/agent/ protocol/src/main.ts protocol/src/controllers/chat.controller.ts protocol/env.example
git commit -m "feat: add XMTP agent process with conversation type routing"
```

---

### Task 4: Create XMTPContext (Frontend)

**Files:**
- Create: `frontend/src/contexts/XMTPContext.tsx`
- Create: `frontend/src/lib/xmtp.ts`

**Context:** This context replaces both `StreamChatContext` and parts of `AIChatContext`. It manages the XMTP client lifecycle using Privy's embedded wallet for signing. It provides conversation listing, message streaming, and the SSE sideband for AI token streaming.

**Step 1: Create XMTP utility file**

Create `frontend/src/lib/xmtp.ts`:

```typescript
import { Client, type Signer, IdentifierKind } from '@xmtp/browser-sdk';

export const CONVERSATION_TYPES = {
  HOME_FEED: 'home_feed',
  AI_CHAT: 'ai_chat',
  HUMAN_CHAT: 'human_chat',
} as const;

export type ConversationType = typeof CONVERSATION_TYPES[keyof typeof CONVERSATION_TYPES];

export interface ConversationAppData {
  type: ConversationType;
  title?: string;
  opportunityIds?: string[];
}

const XMTP_ENV = (process.env.NEXT_PUBLIC_XMTP_ENV as 'dev' | 'production' | 'local') || 'dev';

export function createXMTPSigner(walletProvider: any): Signer {
  return {
    type: 'EOA' as const,
    getIdentifier: () => ({
      identifier: walletProvider.address,
      identifierKind: IdentifierKind.Ethereum,
    }),
    signMessage: async (message: string) => {
      const signature = await walletProvider.request({
        method: 'personal_sign',
        params: [message, walletProvider.address],
      });
      // Convert hex string to Uint8Array
      const hex = signature.startsWith('0x') ? signature.slice(2) : signature;
      const bytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
      }
      return bytes;
    },
  };
}

export async function createXMTPClient(signer: Signer): Promise<Client> {
  const client = await Client.create(signer, {
    env: XMTP_ENV,
  });
  return client;
}

export function getAppData(conversation: any): ConversationAppData | null {
  try {
    const metadata = conversation.metadata;
    if (!metadata?.appData) return null;
    return typeof metadata.appData === 'string'
      ? JSON.parse(metadata.appData)
      : metadata.appData;
  } catch {
    return null;
  }
}
```

**Step 2: Create XMTPContext**

Create `frontend/src/contexts/XMTPContext.tsx`:

```typescript
'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { Client, type Conversation } from '@xmtp/browser-sdk';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { useAuthContext } from './AuthContext';
import { createXMTPSigner, createXMTPClient, getAppData, CONVERSATION_TYPES, type ConversationAppData } from '@/lib/xmtp';

const NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL || '';

interface XMTPMessage {
  id: string;
  content: string;
  senderInboxId: string;
  senderAddress?: string;
  sentAt: Date;
  contentType?: string;
}

interface XMTPContextType {
  client: Client | null;
  isReady: boolean;
  agentAddress: string | null;
  // Conversation management
  conversations: Conversation[];
  homeFeed: Conversation | null;
  aiChats: Conversation[];
  humanChats: Conversation[];
  // Actions
  createAIChat: (agentInboxId: string) => Promise<Conversation>;
  createHumanChat: (otherUserInboxId: string, agentInboxId: string) => Promise<Conversation>;
  getOrCreateHomeFeed: (agentInboxId: string) => Promise<Conversation>;
  refreshConversations: () => Promise<void>;
  // SSE sideband for AI streaming
  streamAIResponse: (conversationId: string, message: string, fileIds?: string[], indexId?: string) => Promise<ReadableStream>;
}

const XMTPContext = createContext<XMTPContextType | null>(null);

export function XMTPProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user } = useAuthContext();
  const { getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  const [client, setClient] = useState<Client | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [agentAddress, setAgentAddress] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const clientRef = useRef<Client | null>(null);

  // Fetch agent address
  useEffect(() => {
    if (!isAuthenticated) return;
    const fetchAgentAddress = async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch(`${NEXT_PUBLIC_API_URL}/chat/agent-address`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setAgentAddress(data.address);
        }
      } catch (error) {
        console.error('[XMTP] Failed to fetch agent address:', error);
      }
    };
    fetchAgentAddress();
  }, [isAuthenticated, getAccessToken]);

  // Initialize XMTP client with Privy embedded wallet
  useEffect(() => {
    if (!isAuthenticated || !wallets.length) return;

    const init = async () => {
      try {
        // Find the embedded wallet from Privy
        const embeddedWallet = wallets.find(w => w.walletClientType === 'privy');
        if (!embeddedWallet) {
          console.warn('[XMTP] No Privy embedded wallet found');
          return;
        }

        const provider = await embeddedWallet.getEthereumProvider();
        const signer = createXMTPSigner(provider);
        const xmtpClient = await createXMTPClient(signer);

        clientRef.current = xmtpClient;
        setClient(xmtpClient);
        setIsReady(true);
        console.log('[XMTP] Client initialized');
      } catch (error) {
        console.error('[XMTP] Failed to initialize:', error);
      }
    };

    init();

    return () => {
      // Cleanup on unmount
      clientRef.current = null;
      setClient(null);
      setIsReady(false);
    };
  }, [isAuthenticated, wallets]);

  // Load conversations
  const refreshConversations = useCallback(async () => {
    if (!client) return;
    try {
      await client.conversations.syncAll();
      const convos = await client.conversations.list();
      setConversations(convos);
    } catch (error) {
      console.error('[XMTP] Failed to load conversations:', error);
    }
  }, [client]);

  useEffect(() => {
    if (isReady) refreshConversations();
  }, [isReady, refreshConversations]);

  // Derived conversation lists
  const homeFeed = conversations.find(c => getAppData(c)?.type === CONVERSATION_TYPES.HOME_FEED) ?? null;
  const aiChats = conversations.filter(c => getAppData(c)?.type === CONVERSATION_TYPES.AI_CHAT);
  const humanChats = conversations.filter(c => getAppData(c)?.type === CONVERSATION_TYPES.HUMAN_CHAT);

  // Create a new AI chat group
  const createAIChat = useCallback(async (agentInboxId: string): Promise<Conversation> => {
    if (!client) throw new Error('XMTP client not ready');
    const group = await client.conversations.createGroup(
      [agentInboxId],
      {
        name: 'New conversation',
        description: '',
        appData: JSON.stringify({ type: CONVERSATION_TYPES.AI_CHAT }),
      }
    );
    await refreshConversations();
    return group;
  }, [client, refreshConversations]);

  // Create a human chat group (user + other user + agent)
  const createHumanChat = useCallback(async (otherUserInboxId: string, agentInboxId: string): Promise<Conversation> => {
    if (!client) throw new Error('XMTP client not ready');
    const group = await client.conversations.createGroup(
      [otherUserInboxId, agentInboxId],
      {
        name: '',
        description: '',
        appData: JSON.stringify({ type: CONVERSATION_TYPES.HUMAN_CHAT }),
      }
    );
    await refreshConversations();
    return group;
  }, [client, refreshConversations]);

  // Get or create the user's home feed
  const getOrCreateHomeFeed = useCallback(async (agentInboxId: string): Promise<Conversation> => {
    if (!client) throw new Error('XMTP client not ready');
    // Check if home feed already exists
    const existing = conversations.find(c => getAppData(c)?.type === CONVERSATION_TYPES.HOME_FEED);
    if (existing) return existing;

    const group = await client.conversations.createGroup(
      [agentInboxId],
      {
        name: 'Home',
        description: 'Your personalized feed',
        appData: JSON.stringify({ type: CONVERSATION_TYPES.HOME_FEED }),
      }
    );
    await refreshConversations();
    return group;
  }, [client, conversations, refreshConversations]);

  // SSE sideband for AI streaming
  const streamAIResponse = useCallback(async (
    conversationId: string,
    message: string,
    fileIds?: string[],
    indexId?: string,
  ): Promise<ReadableStream> => {
    const token = await getAccessToken();
    const res = await fetch(`${NEXT_PUBLIC_API_URL}/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        message,
        conversationId,
        fileIds,
        indexId,
      }),
    });

    if (!res.ok || !res.body) {
      throw new Error(`Stream failed: ${res.status}`);
    }

    return res.body;
  }, [getAccessToken]);

  return (
    <XMTPContext.Provider value={{
      client,
      isReady,
      agentAddress,
      conversations,
      homeFeed,
      aiChats,
      humanChats,
      createAIChat,
      createHumanChat,
      getOrCreateHomeFeed,
      refreshConversations,
      streamAIResponse,
    }}>
      {children}
    </XMTPContext.Provider>
  );
}

export function useXMTP() {
  const context = useContext(XMTPContext);
  if (!context) throw new Error('useXMTP must be used within XMTPProvider');
  return context;
}
```

**Step 3: Add frontend environment variable**

Add to `frontend/.env.example`:

```bash
NEXT_PUBLIC_XMTP_ENV=dev
```

**Step 4: Verify frontend builds**

```bash
cd frontend && bun run build
```

**Step 5: Commit**

```bash
git add frontend/src/contexts/XMTPContext.tsx frontend/src/lib/xmtp.ts frontend/.env.example
git commit -m "feat: add XMTPContext and XMTP client initialization with Privy wallet"
```

---

## Phase 2: AI Chat Migration

### Task 5: Refactor Backend Chat Controller for XMTP

**Files:**
- Modify: `protocol/src/controllers/chat.controller.ts`
- Modify: `protocol/src/services/chat.service.ts`

**Context:** The chat controller currently manages PostgreSQL-backed sessions and streams AI responses via SSE. After migration:
- SSE streaming endpoint stays but becomes a "sideband" — it streams tokens but does NOT persist messages (the agent sends the final XMTP message)
- Session CRUD endpoints are removed (XMTP conversations replace sessions)
- Token/user endpoints (Stream Chat) are removed
- Agent address endpoint was added in Task 3

**Step 1: Simplify ChatController**

Rewrite `protocol/src/controllers/chat.controller.ts` to keep only:
1. `GET /agent-address` — returns agent's XMTP address (added in Task 3)
2. `POST /stream` — SSE sideband for real-time token streaming (simplified: no session creation, no message persistence)

Remove:
- `POST /token` (Stream Chat)
- `POST /user` (Stream Chat)
- `POST /message` (non-streaming, replaced by XMTP)
- `GET /sessions` (replaced by XMTP conversations)
- `POST /session` (replaced by XMTP)
- `POST /session/delete` (replaced by XMTP)
- `POST /session/title` (replaced by XMTP group name)

The simplified `POST /stream` endpoint:
- Receives `{ message, conversationId, fileIds?, indexId? }`
- Runs LangGraph pipeline
- Streams tokens via SSE
- Does NOT persist messages — the XMTP agent will send the final response as an XMTP message
- Returns conversation context (title suggestion) in the `done` event

**Step 2: Simplify ChatSessionService**

In `protocol/src/services/chat.service.ts`:
- Remove all PostgreSQL session/message CRUD methods
- Keep: `getGraphFactory()`, `processMessage()` (for agent to call), `generateSessionTitle()` logic
- Add: method to load conversation context from XMTP messages (the agent passes recent messages when invoking the graph)

**Step 3: Verify protocol builds**

```bash
cd protocol && bun run lint
```

**Step 4: Commit**

```bash
git add protocol/src/controllers/chat.controller.ts protocol/src/services/chat.service.ts
git commit -m "feat: simplify chat controller for XMTP sideband streaming"
```

---

### Task 6: Wire AI Chat Processing into XMTP Agent

**Files:**
- Modify: `protocol/src/agent/xmtp.agent.ts`

**Context:** When the agent receives a text message in an `ai_chat` conversation, it needs to:
1. Load recent conversation history from the XMTP conversation
2. Run the LangGraph chat pipeline
3. Send the final response as an XMTP message

The SSE sideband runs in parallel (initiated by the frontend) — the agent doesn't need to coordinate with it. The frontend handles reconciliation (SSE tokens are temporary, XMTP message is the persisted version).

**Step 1: Add AI chat handler**

In the `ai_chat` case of the agent's `text` handler:

```typescript
case CONVERSATION_TYPES.AI_CHAT: {
  // Load recent messages from this conversation for context
  const messages = await ctx.conversation.messages();
  const recentMessages = messages.slice(-20); // Last 20 messages for context

  // Convert to LangChain format
  const langchainMessages = recentMessages.map(msg => {
    const isFromAgent = msg.senderInboxId === agent.client.inboxId;
    return isFromAgent
      ? { role: 'assistant' as const, content: msg.content as string }
      : { role: 'user' as const, content: msg.content as string };
  });

  // Get the chat graph factory and process
  const graphFactory = chatSessionService.getGraphFactory();
  const result = await graphFactory.processWithContext(
    userId, // Need to resolve from XMTP inbox ID
    langchainMessages,
    ctx.message.content as string,
    { indexId: appData.indexId }
  );

  // Send response as XMTP message
  await ctx.sendText(result.responseText);

  // Update conversation title if needed
  if (!appData.title && result.suggestedTitle) {
    await ctx.conversation.updateName(result.suggestedTitle);
  }
  break;
}
```

**Step 2: Add user resolution helper**

The agent needs to map XMTP inbox IDs to internal user IDs. Add a utility:

```typescript
// In xmtp.agent.ts or a separate utility
async function resolveUserId(inboxId: string): Promise<string | null> {
  // Query the database for a user with this XMTP inbox ID
  // This requires storing the mapping (see Task 7)
  return null; // Placeholder
}
```

**Step 3: Commit**

```bash
git add protocol/src/agent/xmtp.agent.ts
git commit -m "feat: wire AI chat processing into XMTP agent"
```

---

### Task 7: Store XMTP Inbox ID ↔ User ID Mapping

**Files:**
- Modify: `protocol/src/schemas/database.schema.ts` (add `xmtpInboxId` column to `users` table)
- Create: migration via `bun run db:generate`

**Context:** The agent needs to know which internal user ID corresponds to an XMTP inbox ID when processing messages. We add an `xmtpInboxId` column to the `users` table. The frontend sends its inbox ID to the backend on XMTP client initialization.

**Step 1: Add column to users table**

In `protocol/src/schemas/database.schema.ts`, add to the `users` table definition:

```typescript
xmtpInboxId: text('xmtp_inbox_id').unique(),
```

**Step 2: Add API endpoint to register XMTP inbox ID**

In `protocol/src/controllers/chat.controller.ts` (or a suitable controller), add:

```typescript
@Post('/register-inbox')
@UseGuards(AuthGuard)
async registerInbox(req: Request) {
  const { inboxId } = await req.json();
  // Update user record with XMTP inbox ID
  await db.update(users).set({ xmtpInboxId: inboxId }).where(eq(users.id, user.id));
  return Response.json({ success: true });
}
```

**Step 3: Generate and apply migration**

```bash
cd protocol
bun run db:generate
bun run db:migrate
```

**Step 4: Frontend: register inbox ID on XMTP init**

In `frontend/src/contexts/XMTPContext.tsx`, after the client is created, call the register endpoint:

```typescript
// After setClient(xmtpClient):
const token = await getAccessToken();
await fetch(`${NEXT_PUBLIC_API_URL}/chat/register-inbox`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({ inboxId: xmtpClient.inboxId }),
});
```

**Step 5: Commit**

```bash
git add protocol/src/schemas/database.schema.ts protocol/src/controllers/chat.controller.ts frontend/src/contexts/XMTPContext.tsx drizzle/
git commit -m "feat: store XMTP inbox ID mapping for user resolution"
```

---

### Task 8: Refactor Frontend AI Chat UI for XMTP

**Files:**
- Modify: `frontend/src/components/ChatContent.tsx`
- Modify: `frontend/src/app/page.tsx`
- Modify: `frontend/src/app/d/[id]/page.tsx`

**Context:** `ChatContent.tsx` currently uses `useAIChat()` which manages messages in local state + PostgreSQL. After migration, it should:
- Use `useXMTP()` to create conversations and send messages
- Load message history from the XMTP conversation
- Use `streamAIResponse()` for real-time token display
- Listen for new XMTP messages (the agent's response) for final display
- The `[id]` in `/d/[id]` becomes an XMTP conversation ID (not a DB session ID)

**Step 1: Refactor ChatContent to use XMTP**

Replace `useAIChat()` usage with `useXMTP()`:
- On "send message": create a new XMTP group if needed, send text via XMTP, open SSE sideband for streaming
- On SSE `done` event: the agent will send the XMTP message separately; frontend waits for it
- Message list: loaded from XMTP conversation messages
- Session title: read/write via XMTP group name

**Step 2: Update page routes**

- `/` (home): still renders `ChatContent` for authenticated users, but the "create conversation" flow uses `createAIChat()`
- `/d/[id]`: `id` is now an XMTP conversation ID. Load conversation from `client.conversations.getConversationById(id)`

**Step 3: Verify frontend builds**

```bash
cd frontend && bun run build
```

**Step 4: Commit**

```bash
git add frontend/src/components/ChatContent.tsx frontend/src/app/page.tsx frontend/src/app/d/\\[id\\]/page.tsx
git commit -m "feat: refactor AI chat UI to use XMTP conversations"
```

---

## Phase 3: Home Feed Migration

### Task 9: Implement Home Feed as XMTP Group Chat

**Files:**
- Modify: `protocol/src/agent/xmtp.agent.ts` (add home feed message sending)
- Create: `protocol/src/agent/content-types.ts` (custom content type definitions)
- Modify: `frontend/src/app/page.tsx` (render home feed from XMTP)

**Context:** Currently the home page fetches opportunities from `GET /opportunities/home` and renders them as cards. After migration, the agent sends structured XMTP messages to the user's home_feed group chat. The frontend renders these as cards.

**Step 1: Define custom content types for structured messages**

Create `protocol/src/agent/content-types.ts`:

```typescript
export interface OpportunityCardContent {
  type: 'opportunity_card';
  opportunityId: string;
  headline: string;
  summary: string;
  actors: Array<{
    userId: string;
    name: string;
    avatar?: string;
    mutualIntentsLabel?: string;
  }>;
  narratorChip?: string;
  sectionTitle?: string;
  sectionIcon?: string;
}

export interface OpportunityUpdateContent {
  type: 'opportunity_update';
  opportunityId: string;
  headline: string;
  summary: string;
}

export type StructuredContent = OpportunityCardContent | OpportunityUpdateContent;

export function serializeContent(content: StructuredContent): string {
  return JSON.stringify(content);
}

export function parseContent(text: string): StructuredContent | null {
  try {
    const parsed = JSON.parse(text);
    if (parsed.type === 'opportunity_card' || parsed.type === 'opportunity_update') {
      return parsed as StructuredContent;
    }
    return null;
  } catch {
    return null;
  }
}
```

**Step 2: Add agent method to send opportunities to home feed**

In `protocol/src/agent/xmtp.agent.ts`, export a function that the opportunity service can call:

```typescript
export async function sendOpportunityToHomeFeed(
  userXmtpInboxId: string,
  opportunity: OpportunityCardContent,
): Promise<void> {
  const agent = getXMTPAgent();
  if (!agent) throw new Error('XMTP agent not running');

  // Find user's home feed conversation
  // The agent is a member, so it can list its conversations
  // and find the one with appData.type === 'home_feed' for this user
  const conversations = await agent.client.conversations.list();
  const homeFeed = conversations.find(c => {
    const data = getAppData(c);
    return data?.type === CONVERSATION_TYPES.HOME_FEED;
    // Additional filter: conversation includes the target user
  });

  if (!homeFeed) {
    console.warn(`[XMTP Agent] No home feed found for inbox ${userXmtpInboxId}`);
    return;
  }

  await homeFeed.sendText(serializeContent(opportunity));
}
```

**Step 3: Refactor home page to render XMTP home feed messages**

In `frontend/src/app/page.tsx`, for authenticated users:
- Use `useXMTP()` to get `homeFeed` conversation
- Call `getOrCreateHomeFeed(agentAddress)` on first load
- Load messages from the home feed conversation
- Parse structured messages and render as opportunity cards
- Keep the "What are you looking for?" input at the top (creates new `ai_chat` conversation)

**Step 4: Commit**

```bash
git add protocol/src/agent/ frontend/src/app/page.tsx
git commit -m "feat: implement home feed as XMTP group chat with structured messages"
```

---

### Task 10: Wire Opportunity Service to XMTP Home Feed

**Files:**
- Modify: `protocol/src/services/opportunity.service.ts`
- Modify: `protocol/src/lib/protocol/support/opportunity.chat-injection.ts`

**Context:** When the broker system detects a new opportunity, it currently calls the API or stores in DB. After migration, it should also tell the XMTP agent to send an opportunity card to the user's home feed.

**Step 1: Update opportunity notification flow**

When a new opportunity is created/updated, call `sendOpportunityToHomeFeed()` for both actors:

```typescript
import { sendOpportunityToHomeFeed } from '../agent/xmtp.agent';

// After opportunity creation:
await sendOpportunityToHomeFeed(actor1.xmtpInboxId, opportunityCard);
await sendOpportunityToHomeFeed(actor2.xmtpInboxId, opportunityCard);
```

**Step 2: Update opportunity.chat-injection.ts**

Replace Stream Chat injection with XMTP injection. Instead of `sendBotMessage()` through Stream, use the XMTP agent to send structured messages.

**Step 3: Commit**

```bash
git add protocol/src/services/opportunity.service.ts protocol/src/lib/protocol/support/opportunity.chat-injection.ts
git commit -m "feat: wire opportunity notifications to XMTP home feed"
```

---

## Phase 4: Human Chat Migration

### Task 11: Replace Stream Chat DMs with XMTP Group Chats

**Files:**
- Modify: `protocol/src/services/opportunity.service.ts` (acceptance flow)
- Modify: `protocol/src/agent/xmtp.agent.ts` (human chat handling)

**Context:** When an opportunity is accepted, currently a Stream Chat channel is created between the two users with the Index bot. After migration, the agent creates a 3-member XMTP group chat.

**Step 1: Update opportunity acceptance flow**

In `protocol/src/services/opportunity.service.ts`, replace the Stream channel creation (lines ~305-411) with XMTP group creation:

```typescript
// Instead of creating a Stream channel:
const agent = getXMTPAgent();
const group = await agent.client.conversations.createGroup(
  [user1XmtpInboxId, user2XmtpInboxId],
  {
    name: '',
    description: '',
    appData: JSON.stringify({
      type: CONVERSATION_TYPES.HUMAN_CHAT,
      opportunityIds: [opportunityId],
    }),
  }
);

// Send intro message
await group.sendText(serializeContent({
  type: 'opportunity_update',
  opportunityId,
  headline: presentation.headline,
  summary: presentation.personalizedSummary,
}));
```

**Step 2: Handle @mentions in human chats**

In `protocol/src/agent/xmtp.agent.ts`, update the `human_chat` case:

```typescript
case CONVERSATION_TYPES.HUMAN_CHAT: {
  const content = ctx.message.content as string;
  // Check if agent is mentioned (by name or @agent)
  if (content.includes('@agent') || content.includes('@Index')) {
    const result = await processAIRequest(ctx, appData);
    await ctx.sendText(result);
  }
  // Otherwise: silent observation
  break;
}
```

**Step 3: Commit**

```bash
git add protocol/src/services/opportunity.service.ts protocol/src/agent/xmtp.agent.ts
git commit -m "feat: replace Stream Chat DMs with XMTP group chats"
```

---

### Task 12: Refactor Frontend DM Components for XMTP

**Files:**
- Modify: `frontend/src/components/chat/ChatView.tsx`
- Modify: `frontend/src/components/ChatSidebar.tsx`
- Modify: `frontend/src/components/Sidebar.tsx`
- Modify: `frontend/src/app/u/[id]/chat/page.tsx`
- Modify: `frontend/src/components/ConnectionActions.tsx`

**Context:** All human chat (DM) components currently use Stream Chat SDK. Replace with XMTP conversation reading/writing via `useXMTP()`.

**Step 1: Refactor ChatView.tsx**

Replace all `stream-chat` imports and `Channel` usage with XMTP:
- Load conversation from `client.conversations.getConversationById(conversationId)`
- Load messages from `conversation.messages()`
- Send messages via `conversation.sendText(text)`
- Stream incoming messages via conversation message stream
- Parse structured messages for `SystemMessageCard` rendering
- Remove `getOrCreateChannel()`, `activeChannel.sendMessage()`, `channel.delete()` etc.

**Step 2: Refactor ChatSidebar.tsx**

Replace Stream channel queries with XMTP conversation listing:
- Use `useXMTP()` to get `humanChats` list
- Display conversation name, last message, unread count from XMTP
- Remove all Stream event listeners

**Step 3: Refactor Sidebar.tsx**

Replace Stream unread count logic with XMTP:
- Use `useXMTP()` instead of `useStreamChat()`
- Calculate unread counts from XMTP conversations
- Remove Stream event listeners for unread tracking

**Step 4: Update chat page route**

In `frontend/src/app/u/[id]/chat/page.tsx`:
- Replace `useStreamChat()` with `useXMTP()`
- Use XMTP conversation ID from URL params
- Pass XMTP conversation to `ChatView`

**Step 5: Update ConnectionActions.tsx**

Replace `useStreamChat()` with `useXMTP()`:
- Use `createHumanChat()` instead of `openChat()`

**Step 6: Commit**

```bash
git add frontend/src/components/chat/ChatView.tsx frontend/src/components/ChatSidebar.tsx frontend/src/components/Sidebar.tsx frontend/src/app/u/\\[id\\]/chat/page.tsx frontend/src/components/ConnectionActions.tsx
git commit -m "feat: refactor all DM components to use XMTP"
```

---

## Phase 5: Cleanup

### Task 13: Remove Stream Chat and Old Chat Tables

**Files:**
- Delete: `frontend/src/contexts/StreamChatContext.tsx`
- Delete: `frontend/src/lib/chat-channel.ts`
- Modify: `frontend/src/contexts/AIChatContext.tsx` (delete or gut — functionality moved to XMTPContext)
- Modify: `frontend/src/contexts/AIChatSessionsContext.tsx` (delete — sessions are XMTP conversations)
- Modify: `frontend/src/components/ClientWrapper.tsx` (replace `StreamChatProvider` with `XMTPProvider`)
- Delete: `protocol/src/adapters/chat.adapter.ts`
- Delete: `protocol/src/lib/protocol/interfaces/chat.interface.ts`
- Delete: `protocol/src/lib/protocol/support/chat-provider.utils.ts`
- Delete: `protocol/src/lib/protocol/support/chat.checkpointer.ts`
- Modify: `protocol/src/main.ts` (remove Stream Chat provider from controller instantiation)
- Modify: `protocol/src/schemas/database.schema.ts` (remove `chat_sessions`, `chat_messages`, related relations/types)
- Create: migration to drop chat tables

**Step 1: Remove frontend Stream Chat code**

Delete `StreamChatContext.tsx`, `chat-channel.ts`. Delete or gut `AIChatContext.tsx` and `AIChatSessionsContext.tsx`.

**Step 2: Update ClientWrapper.tsx**

Replace:
```typescript
import { StreamChatProvider } from "@/contexts/StreamChatContext";
// ...
<StreamChatProvider>
  {children}
</StreamChatProvider>
```

With:
```typescript
import { XMTPProvider } from "@/contexts/XMTPContext";
// ...
<XMTPProvider>
  {children}
</XMTPProvider>
```

**Step 3: Remove backend Stream Chat code**

Delete `chat.adapter.ts`, `chat.interface.ts`, `chat-provider.utils.ts`, `chat.checkpointer.ts`.

Update `main.ts`: remove `getChatProvider()` import and its usage in `ChatController` instantiation.

**Step 4: Remove chat tables from schema**

In `protocol/src/schemas/database.schema.ts`:
- Remove `chatMessageRoleEnum` (line 309)
- Remove `chatSessions` table (lines 312-322)
- Remove `chatMessages` table (lines 325-336)
- Remove `chatSessionsRelations` and `chatMessagesRelations` (lines 453-465)
- Remove `ChatSession`, `NewChatSession`, `ChatMessage`, `NewChatMessage` types (lines 486-489)

**Step 5: Generate migration to drop tables**

```bash
cd protocol
bun run db:generate
# Review the migration — should drop chat_sessions and chat_messages tables
bun run db:migrate
```

**Step 6: Remove stream-chat dependencies**

```bash
cd protocol && bun remove stream-chat
cd ../frontend && bun remove stream-chat
```

**Step 7: Remove environment variables**

Remove from `.env` files:
- `STREAM_API_KEY`, `STREAM_SECRET` (protocol)
- `NEXT_PUBLIC_STREAM_API_KEY` (frontend)

**Step 8: Verify everything builds**

```bash
cd protocol && bun run lint
cd ../frontend && bun run build
```

**Step 9: Commit**

```bash
git add -A
git commit -m "feat: remove Stream Chat and PostgreSQL chat tables, complete XMTP migration"
```

---

### Task 14: Update CLAUDE.md and Documentation

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update CLAUDE.md**

Update the following sections:
- **Architecture Overview**: Replace Stream Chat references with XMTP
- **Frontend Architecture**: Update context providers, remove Stream Chat mention
- **Key Dependencies**: Replace `stream-chat` with `@xmtp/browser-sdk` (frontend) and `@xmtp/agent-sdk` (protocol)
- **Environment Setup**: Update env vars (remove Stream, add XMTP)
- **Database Layer**: Remove chat_sessions/chat_messages references

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for XMTP migration"
```

---

## Summary of Changes

### Files Created
- `protocol/src/agent/xmtp.agent.ts` — XMTP agent process
- `protocol/src/agent/xmtp.types.ts` — Conversation type definitions
- `protocol/src/agent/content-types.ts` — Structured message content types
- `frontend/src/contexts/XMTPContext.tsx` — XMTP client context
- `frontend/src/lib/xmtp.ts` — XMTP utilities

### Files Heavily Modified
- `frontend/src/contexts/AuthContext.tsx` — Enable Privy embedded wallets
- `frontend/src/components/ChatContent.tsx` — XMTP AI chat
- `frontend/src/components/chat/ChatView.tsx` — XMTP human chat
- `frontend/src/components/ChatSidebar.tsx` — XMTP conversation list
- `frontend/src/components/Sidebar.tsx` — XMTP unread counts
- `frontend/src/components/ClientWrapper.tsx` — XMTPProvider
- `frontend/src/app/page.tsx` — XMTP home feed
- `protocol/src/controllers/chat.controller.ts` — Simplified for XMTP
- `protocol/src/services/chat.service.ts` — Simplified
- `protocol/src/services/opportunity.service.ts` — XMTP group creation
- `protocol/src/main.ts` — Agent startup
- `protocol/src/schemas/database.schema.ts` — Add xmtpInboxId, remove chat tables

### Files Deleted
- `frontend/src/contexts/StreamChatContext.tsx`
- `frontend/src/contexts/AIChatContext.tsx`
- `frontend/src/contexts/AIChatSessionsContext.tsx`
- `frontend/src/lib/chat-channel.ts`
- `protocol/src/adapters/chat.adapter.ts`
- `protocol/src/lib/protocol/interfaces/chat.interface.ts`
- `protocol/src/lib/protocol/support/chat-provider.utils.ts`
- `protocol/src/lib/protocol/support/chat.checkpointer.ts`

### Dependencies
- Added: `@xmtp/agent-sdk` (protocol), `@xmtp/browser-sdk` (frontend)
- Removed: `stream-chat` (both)

### Environment Variables
- Added: `XMTP_ENV`, `XMTP_WALLET_KEY`, `XMTP_DB_ENCRYPTION_KEY`, `XMTP_DB_PATH`, `NEXT_PUBLIC_XMTP_ENV`
- Removed: `STREAM_API_KEY`, `STREAM_SECRET`, `NEXT_PUBLIC_STREAM_API_KEY`
