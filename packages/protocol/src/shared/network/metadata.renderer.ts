interface NetworkForRendering {
  type: string;
  title: string;
  prompt?: string | null;
  metadata: Record<string, unknown>;
}

interface EventMetadata {
  startDate?: string;
  endDate?: string;
  timezone?: string;
  location?: string;
  themes?: string[];
  events?: Array<{
    externalId: string;
    title: string;
    startTime: string;
    endTime: string;
    location?: string;
    description?: string;
    tags?: string[];
  }>;
}

/**
 * Render a network's metadata as structured markdown for LLM context.
 *
 * @param network - The network to render, with type, title, optional prompt, and metadata.
 * @returns Markdown string suitable for injection into an LLM prompt.
 */
export function renderNetworkContext(network: NetworkForRendering): string {
  switch (network.type) {
    case 'event':
      return renderEventNetwork(network);
    case 'community':
    default:
      return renderCommunityNetwork(network);
  }
}

function renderCommunityNetwork(network: NetworkForRendering): string {
  const lines: string[] = [`## ${network.title}`];
  if (network.prompt) {
    lines.push('', network.prompt);
  }
  return lines.join('\n');
}

function renderEventNetwork(network: NetworkForRendering): string {
  const meta = network.metadata;
  const startDate = typeof meta.startDate === 'string' ? meta.startDate : undefined;
  const endDate = typeof meta.endDate === 'string' ? meta.endDate : undefined;
  const location = typeof meta.location === 'string' ? meta.location : undefined;
  const timezone = typeof meta.timezone === 'string' ? meta.timezone : undefined;
  const themes = Array.isArray(meta.themes) ? meta.themes.filter((t: unknown): t is string => typeof t === 'string') : [];
  const events = Array.isArray(meta.events) ? normalizeEvents(meta.events) : [];
  const lines: string[] = [`## ${network.title}`];

  if (network.prompt) {
    lines.push('', network.prompt);
  }

  lines.push('');
  lines.push('- **Type:** Event');

  const dateRange = startDate && endDate ? formatDateRange(startDate, endDate) : undefined;
  if (dateRange) {
    lines.push(`- **Dates:** ${dateRange}`);
  }
  if (location) {
    lines.push(`- **Location:** ${location}`);
  }
  if (timezone) {
    lines.push(`- **Timezone:** ${timezone}`);
  }
  if (themes.length > 0) {
    lines.push(`- **Themes:** ${themes.join(', ')}`);
  }

  lines.push('');
  const upcoming = getUpcomingEvents(events, 7);
  if (upcoming.length === 0) {
    lines.push('No upcoming events in the next 7 days.');
  } else {
    lines.push('### Upcoming Events (next 7 days)');
    lines.push('| Time | Event | Location |');
    lines.push('|------|-------|----------|');
    for (const evt of upcoming) {
      const time = formatEventTime(evt.startTime);
      const loc = escapeTableCell(evt.location ?? '');
      const title = escapeTableCell(evt.title);
      lines.push(`| ${time} | ${title} | ${loc} |`);
    }
  }

  return lines.join('\n');
}

function formatDateRange(start: string, end: string): string | undefined {
  const s = new Date(start);
  const e = new Date(end);
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return undefined;
  const opts: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' };
  return `${s.toLocaleDateString('en-US', opts)} – ${e.toLocaleDateString('en-US', opts)}`;
}

function formatEventTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) +
    ', ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function normalizeEvents(raw: unknown[]): NonNullable<EventMetadata['events']> {
  return raw.filter((e): e is NonNullable<EventMetadata['events']>[number] => {
    if (typeof e !== 'object' || e === null) return false;
    const obj = e as Record<string, unknown>;
    return typeof obj.title === 'string' && typeof obj.startTime === 'string' && typeof obj.endTime === 'string';
  });
}

function getUpcomingEvents(
  events: NonNullable<EventMetadata['events']>,
  windowDays: number,
): NonNullable<EventMetadata['events']> {
  const now = Date.now();
  const windowEnd = now + windowDays * 24 * 60 * 60 * 1000;
  return events
    .map((e) => ({ e, t: new Date(e.startTime).getTime() }))
    .filter(({ t }) => !isNaN(t) && t >= now && t <= windowEnd)
    .sort((a, b) => a.t - b.t)
    .map(({ e }) => e);
}
