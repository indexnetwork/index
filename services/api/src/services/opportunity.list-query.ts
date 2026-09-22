import { z } from 'zod';

const listStatusSchema = z.enum(['pending', 'accepted', 'rejected', 'expired']);
const radarStatusSchema = z.enum(['negotiating', 'pending', 'accepted', 'rejected', 'expired']);

export type ListOpportunitiesQuery = {
  status?: z.infer<typeof listStatusSchema>;
  statuses?: z.infer<typeof radarStatusSchema>[];
  networkId?: string;
  peerUserId?: string;
  limit?: number;
  offset?: number;
  noCache?: boolean;
  presentation?: 'skeleton';
};

export function parseListOpportunitiesQuery(url: URL): ListOpportunitiesQuery | Response {
  const rawStatus = url.searchParams.get('status');
  const networkId = url.searchParams.get('networkId') ?? undefined;
  const limit = url.searchParams.get('limit');
  const offset = url.searchParams.get('offset');
  const peerUserId = url.searchParams.get('peerUserId') ?? undefined;
  const noCacheParam = url.searchParams.get('noCache');
  const noCache = noCacheParam === '1' || noCacheParam === 'true';

  if (rawStatus) {
    const parsed = listStatusSchema.safeParse(rawStatus);
    if (!parsed.success) {
      return Response.json(
        { error: `Invalid status; use one of: ${listStatusSchema.options.join(', ')}` },
        { status: 400 },
      );
    }
  }

  const statusesParam = url.searchParams.get('statuses');
  let statuses: z.infer<typeof radarStatusSchema>[] | undefined;
  if (statusesParam) {
    const parsed = z.array(radarStatusSchema).nonempty().safeParse(
      statusesParam.split(',').map((s) => s.trim()).filter(Boolean),
    );
    if (!parsed.success) {
      return Response.json(
        { error: `Invalid statuses; allowed: ${radarStatusSchema.options.join(', ')}` },
        { status: 400 },
      );
    }
    statuses = [...new Set(parsed.data)];
  }

  const presentationParam = url.searchParams.get('presentation');
  if (presentationParam && presentationParam !== 'skeleton' && presentationParam !== 'full') {
    return Response.json({ error: "Invalid presentation; allowed: 'skeleton', 'full'" }, { status: 400 });
  }
  const presentation = presentationParam === 'skeleton' ? 'skeleton' as const : undefined;

  return {
    status: rawStatus ? (rawStatus as z.infer<typeof listStatusSchema>) : undefined,
    statuses,
    networkId,
    peerUserId,
    limit: limit ? parseInt(limit, 10) : undefined,
    offset: offset ? parseInt(offset, 10) : undefined,
    noCache,
    presentation,
  };
}
