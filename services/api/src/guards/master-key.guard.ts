import { and, eq, isNull } from 'drizzle-orm/sql';

import db from '../lib/drizzle/drizzle';
import { hashMasterKey } from '../lib/experiment/master-key';
import * as schema from '../schemas/database.schema';

export interface MasterKeyNetwork {
  id: string;
  title: string;
}

export async function MasterKeyGuard(
  req: Request,
  params: Record<string, string>,
): Promise<MasterKeyNetwork> {
  const networkId = params.id;
  if (!networkId) {
    throw new Response(JSON.stringify({ error: 'Network ID is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const apiKey = req.headers.get('x-api-key');
  if (!apiKey) {
    throw new Response(JSON.stringify({ error: 'x-api-key header is required' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const [network] = await db
    .select({
      id: schema.networks.id,
      title: schema.networks.title,
      masterKeyHash: schema.networks.masterKeyHash,
    })
    .from(schema.networks)
    .where(and(
      eq(schema.networks.id, networkId),
      isNull(schema.networks.deletedAt),
    ))
    .limit(1);

  if (!network || !network.masterKeyHash) {
    throw new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const hashedKey = await hashMasterKey(apiKey);
  if (hashedKey !== network.masterKeyHash) {
    throw new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return { id: network.id, title: network.title };
}
