import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod-v4';

import { ChatDatabaseAdapter } from '../../adapters/chat.database.adapter';
import { userService } from '../../services/user.service';
import { log } from '../log';
import { callNetworkTool } from '../network-mcp/network-mcp.client';

import { mcpSuccess } from './mcp.results';

const logger = log.lib.from('mcp/mcp.cosign');

type CosignNetwork = Awaited<ReturnType<ChatDatabaseAdapter['getMemberMcpNetworks']>>[number];

const CONTEXT_TIMEOUT_MS = 6_000;
const REASON = 'Index Network is acting for the member, showing Cosign context beside their matches';

interface CosignPerson {
  handle?: string;
  name?: string;
  headline?: string | null;
  profileUrl?: string;
  cosignedByCount?: number;
  cosignedBy?: { name?: string; handle?: string; quote?: string }[];
  cosignedCount?: number;
  cosigned?: { name?: string; handle?: string; quote?: string }[];
}

/** What Cosign says about a peer, shown beside an opportunity. */
export interface CosignContext {
  url: string | null;
  headline: string | null;
  cosignedByCount: number;
  cosignedBy: { name: string; quote: string }[];
  cosignedCount: number;
  mutuals: string[];
}

/** The member's Cosign network, when they have joined it. */
export async function cosignNetwork(userId: string): Promise<CosignNetwork | null> {
  try {
    const networks = await new ChatDatabaseAdapter().getMemberMcpNetworks(userId);
    return networks.find(({ mcp }) => new URL(mcp.url).hostname.endsWith('cosign.co')) ?? null;
  } catch (error) {
    logger.warn('Cosign network lookup failed', { userId, error: String(error) });
    return null;
  }
}

async function read(network: CosignNetwork, userId: string, tool: string, args: Record<string, unknown>): Promise<unknown> {
  const text = await callNetworkTool(network, userId, tool, { reason_for_call: REASON, llm_model: 'unknown', ...args });
  if (text === null) throw new NotSignedIn();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

class NotSignedIn extends Error {}

function xHandle(socials: { label: string; value: string }[]): string | null {
  const value = socials.find(({ label }) => label === 'twitter' || label === 'x')?.value.trim();
  return value?.match(/(?:x|twitter)\.com\/@?([\w]+)/i)?.[1] ?? value?.match(/^@?(\w+)$/)?.[1] ?? null;
}

async function personOf(network: CosignNetwork, userId: string, forUserId: string): Promise<CosignPerson | null> {
  const handle = xHandle(await userService.getSocials(forUserId));
  if (!handle) return null;
  const person = await read(network, userId, 'get_person', { handle: `@${handle}` });
  return typeof person === 'object' && person ? person as CosignPerson : null;
}

const handlesOf = (person: CosignPerson | null) =>
  new Map([...(person?.cosignedBy ?? []), ...(person?.cosigned ?? [])].flatMap((entry) => (entry.handle ? [[entry.handle, entry.name ?? entry.handle] as const] : [])));

/**
 * A function that reads the Cosign context of a peer for one viewer, or null
 * when the viewer has not joined Cosign. It never throws: a peer without
 * Cosign data, or a slow Cosign, just has no context.
 */
export async function cosignEnricher(viewerId: string): Promise<((peerId: string) => Promise<CosignContext | null>) | null> {
  const network = await cosignNetwork(viewerId);
  if (!network) return null;
  const viewer = personOf(network, viewerId, viewerId).catch(() => null);

  return async (peerId) => {
    try {
      const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Cosign timed out')), CONTEXT_TIMEOUT_MS));
      const [peer, mine] = await Promise.race([Promise.all([personOf(network, viewerId, peerId), viewer]), timeout]);
      if (!peer) return null;
      const own = handlesOf(mine);
      return {
        url: peer.profileUrl ?? null,
        headline: peer.headline ?? null,
        cosignedByCount: peer.cosignedByCount ?? 0,
        cosignedBy: (peer.cosignedBy ?? []).slice(0, 3).map(({ name, quote }) => ({ name: name ?? '', quote: quote ?? '' })),
        cosignedCount: peer.cosignedCount ?? 0,
        mutuals: [...handlesOf(peer)].filter(([handle]) => own.has(handle)).map(([, name]) => name),
      };
    } catch (error) {
      logger.warn('Cosign context unavailable', { viewerId, peerId, error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  };
}

/** One line for an opportunity summary, or empty when Cosign has nothing on the peer. */
export function cosignLine(context: CosignContext | null): string {
  if (!context || (!context.cosignedByCount && !context.cosignedCount)) return '';
  const [first] = context.cosignedBy;
  const parts = [
    first ? `${first.name} — “${first.quote}”` : null,
    `${context.cosignedByCount} ${context.cosignedByCount === 1 ? 'cosign' : 'cosigns'} received`,
    context.mutuals.length ? `${context.mutuals.length} ${context.mutuals.length === 1 ? 'mutual' : 'mutuals'}` : null,
  ].filter(Boolean);
  return `\n  Cosign: ${parts.join(' · ')}`;
}

/** Add the demo's two mocked Cosign commands to a fresh MCP server. */
export function registerCosignTools(server: McpServer): void {
  server.registerTool(
    'cosign_create_cosign',
    {
      description: 'MOCK. Prepare a cosign (a vouch) for a person. Nothing is saved: Cosign offers no write access yet. Ask the owner first, and tell them it is only prepared.',
      inputSchema: z.object({
        person: z.string().trim().min(1),
        type: z.enum(['would_work_with_anywhere', 'will_be_a_star', 'shaped_my_career']),
        visibility: z.enum(['private', 'public']).optional(),
      }).strict(),
      annotations: { title: 'Prepare a cosign (mock)', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ person, type, visibility = 'private' }) => Promise.resolve(mcpSuccess(
      { mock: true, saved: false, cosign: { person, type, visibility }, message: 'Prepared only. Nothing was saved to Cosign.' },
      `Prepared a ${visibility} cosign for ${person}: ${type.replace(/_/g, ' ')}. Mock: not saved.`,
    )),
  );

  server.registerTool(
    'introduce_people',
    {
      description: 'MOCK. Ask both people\'s agents to negotiate an introduction between two people the owner knows. Nothing is sent yet. Ask the owner first, and tell them it is only a preview.',
      inputSchema: z.object({ first: z.string().trim().min(1), second: z.string().trim().min(1), reason: z.string().trim().optional() }).strict(),
      annotations: { title: 'Introduce two people (mock)', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ first, second, reason }) => Promise.resolve(mcpSuccess(
      { mock: true, sent: false, introduction: { first, second, reason: reason ?? null }, message: 'Preview only. No agent was contacted.' },
      `Introduction between ${first} and ${second}: both agents would be asked, and it is surfaced only if both sides agree. Mock: nothing was sent.`,
    )),
  );
}
