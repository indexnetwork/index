import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { createIndexApiClient } from "../../../apps/mac/api/client.mjs";
import { mapIntents, mapPeopleFromRadarItems } from "../../../apps/mac/api/mappers.mjs";

export interface Signal { id: string; title: string; status: string; pending: number }
export interface Person { id: string; name: string; status: string; blurb: string; detail: string; score: number | null }
export interface Question { id: string; question: string; options?: string[]; scope?: string; matches?: { counterparty?: { name?: string } }[] }
export interface Message { id: string; role: string; parts: { text?: string }[]; metadata?: { principalMessage?: { kind?: string; questionId?: string; options?: string[]; scope?: string; matches?: Question["matches"] } } }
export interface Inbox { messages: Message[]; questions: Question[] }
export interface Negotiation { turns: { turnIndex: number; seatUserId: string; action: string; message: string }[]; outcome: string | null; counterparty: { name: string | null } }
export interface Event { type: string; data?: { intentId?: string; opportunityId?: string }; message?: { metadata?: { intentId?: string } } }

/** Use a device session, not an agent API key: owner input must speak as the owner. */
export async function connectOwner() {
  let stored: { token?: string; apiUrl?: string; authKind?: string } | null = null;
  try {
    stored = JSON.parse(await readFile(join(homedir(), ".index", "credentials.json"), "utf8"));
  } catch { /* No CLI login; the environment may still supply a session. */ }
  const token = process.env.INDEX_SESSION_TOKEN || (stored?.authKind === "session" ? stored.token : undefined);
  if (!token) throw new Error("Not logged in. Run `bun run --cwd packages/cli dev login` or set INDEX_SESSION_TOKEN.");
  const origin = (process.env.INDEX_API_URL || stored?.apiUrl || "http://localhost:3001").replace(/\/+$/, "");
  const client = createIndexApiClient({ apiBaseUrl: `${origin}/api`, getToken: () => token });
  const meResponse = await client.auth.me() as { user?: { id: string; name?: string }; id?: string; name?: string };
  const me = meResponse.user || meResponse;
  if (!me.id) throw new Error("The owner session has no user identity.");

  return {
    name: me.name || me.id,
    userId: me.id,
    async signals(): Promise<Signal[]> {
      const result = await client.intents.list({ page: 1, limit: 100 }) as { intents?: Record<string, unknown>[] };
      return mapIntents(result.intents || []).filter((row) => row.status !== "archived")
        .map((row) => ({ id: row.id, title: row.title, status: row.status, pending: row.pending }));
    },
    async inbox(intentId: string): Promise<Inbox> {
      const result = await client.conversations.messages("agent", { intentId }) as { messages?: Message[]; agent?: { questions?: Question[] } };
      return { messages: result.messages || [], questions: result.agent?.questions || [] };
    },
    async radar(intentId: string): Promise<Person[]> {
      const result = await client.opportunities.radarForIntent(intentId, { statuses: "pending,negotiating,accepted,expired" }) as { opportunities?: Record<string, unknown>[] };
      return mapPeopleFromRadarItems(result.opportunities || []).map((row) => ({
        id: row.id, name: row.name, status: row.status, blurb: row.blurb, detail: row.detail, score: row.score,
      }));
    },
    async negotiation(opportunityId: string): Promise<Negotiation | null> {
      const result = await client.opportunities.negotiation(opportunityId) as { negotiation?: Negotiation };
      return result.negotiation || null;
    },
    sendMessage: (intentId: string, text: string) => client.conversations.sendMessage("agent", {
      parts: [{ kind: "text", text }], metadata: { intentId },
    }),
    sendAnswer: (intentId: string, questionId: string, text: string) => client.conversations.sendAnswers(intentId, [{ questionId, text }]),
    setOpportunityStatus: (intentId: string, opportunityId: string, status: "accepted" | "rejected") =>
      client.opportunities.updateStatusForIntent(opportunityId, status, intentId),
    events(onEvent: (event: Event) => void): () => void {
      const abort = new AbortController();
      void (async () => {
        while (!abort.signal.aborted) {
          try {
            const response = await fetch(`${origin}/api/events`, { headers: { Authorization: `Bearer ${token}` }, signal: abort.signal });
            if (!response.ok || !response.body) throw new Error(`Events HTTP ${response.status}`);
            const reader = response.body.getReader();
            const cancelRead = () => { void reader.cancel(); };
            abort.signal.addEventListener("abort", cancelRead, { once: true });
            try {
              const decoder = new TextDecoder();
              let buffer = "";
              while (!abort.signal.aborted) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const frames = buffer.split(/\r?\n\r?\n/);
                buffer = frames.pop() || "";
                for (const frame of frames) {
                  const json = frame.split(/\r?\n/).filter((line) => line.startsWith("data:"))
                    .map((line) => line.slice(5).trimStart()).join("\n");
                  if (json) onEvent(JSON.parse(json) as Event);
                }
              }
            } finally {
              abort.signal.removeEventListener("abort", cancelRead);
              reader.releaseLock();
            }
          } catch { /* The five-second poll keeps the UI current while SSE reconnects. */ }
          if (!abort.signal.aborted) await Bun.sleep(1000);
        }
      })();
      return () => abort.abort();
    },
  };
}

export type Owner = Awaited<ReturnType<typeof connectOwner>>;
