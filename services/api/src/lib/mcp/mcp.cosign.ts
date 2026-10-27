import { ChatDatabaseAdapter } from '../../adapters/chat.database.adapter';
import { userService } from '../../services/user.service';
import { log } from '../log';
import { callNetworkTool } from '../network-mcp/network-mcp.client';

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
    return networks.find(({ mcp }) => {
      const { hostname } = new URL(mcp.url);
      return hostname === 'cosign.co' || hostname.endsWith('.cosign.co');
    }) ?? null;
  } catch (error) {
    logger.warn('Cosign network lookup failed', { userId, error: String(error) });
    return null;
  }
}

/** @returns The tool's result, or null when the member has no Cosign login. */
async function read(network: CosignNetwork, userId: string, tool: string, args: Record<string, unknown>): Promise<unknown> {
  const text = await callNetworkTool(network, userId, tool, { reason_for_call: REASON, llm_model: 'unknown', ...args });
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

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
