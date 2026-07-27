/** Persistable, privacy-bounded request context for asynchronous tool runs. */
export interface ToolRequestContext {
  userId: string;
  userName: string;
  userEmail: string;
  scopeType?: "network" | "intent";
  scopeId?: string;
  indexName?: string;
  sessionId?: string;
  agentId?: string;
  clientSurface?: "telegram" | "web";
}
