import type { IntegrationFile } from '../index';
import { getClient } from '../composio';
import { log } from '../../log';
import { getIntegrationById } from '../integration-utils';

function toIsoDate(d: Date) {
  return d.toISOString();
}

function clampWindow(lastSyncAt?: Date): { timeMin?: string; timeMax?: string } {
  try {
    const now = new Date();
    if (lastSyncAt) {
      // Fetch from last sync until a reasonable future window
      const max = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 30); // +30 days
      return { timeMin: toIsoDate(lastSyncAt), timeMax: toIsoDate(max) };
    }
    // Default: past 30 days to next 90 days
    const min = new Date(now.getTime() - 1000 * 60 * 60 * 24 * 30);
    const max = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 90);
    return { timeMin: toIsoDate(min), timeMax: toIsoDate(max) };
  } catch {
    return {};
  }
}

function mapEventToFile(calendarId: string, calendarSummary: string, ev: any): IntegrationFile | null {
  const id = ev?.id;
  if (!id) return null;
  const updated = ev?.updated ? new Date(ev.updated) : new Date();
  const startStr = ev?.start?.dateTime || ev?.start?.date || ev?.start;
  const endStr = ev?.end?.dateTime || ev?.end?.date || ev?.end;
  const summary = ev?.summary || 'Untitled Event';
  const description = ev?.description || '';
  const location = ev?.location || '';
  const attendees = Array.isArray(ev?.attendees) ? ev.attendees.map((a: any) => a?.email || a?.displayName || '').filter(Boolean) : [];
  const htmlLink = ev?.htmlLink || '';

  const contentLines = [
    `# ${summary}`,
    '',
    `Calendar: ${calendarSummary || calendarId}`,
    startStr ? `Start: ${startStr}` : undefined,
    endStr ? `End: ${endStr}` : undefined,
    location ? `Location: ${location}` : undefined,
    attendees.length ? `Attendees:\n${attendees.map((a: string) => `- ${a}`).join('\n')}` : undefined,
    description ? `\n${description}` : undefined,
    htmlLink ? `\nLink: ${htmlLink}` : undefined,
  ].filter(Boolean) as string[];

  const content = contentLines.join('\n');
  return {
    id: `${calendarId}-${id}`,
    name: `${calendarSummary || calendarId}-${id}.md`,
    content,
    lastModified: updated,
    type: 'text/markdown',
    size: content.length,
  };
}

async function fetchFiles(integrationId: string, lastSyncAt?: Date): Promise<IntegrationFile[]> {
  try {
    const integration = await getIntegrationById(integrationId);
    if (!integration) {
      log.error('Integration not found', { integrationId });
      return [];
    }

    if (!integration.connectedAccountId) {
      log.error('No connected account ID found for integration', { integrationId });
      return [];
    }

    log.info('GoogleCalendar sync start', { integrationId, userId: integration.userId, lastSyncAt: lastSyncAt?.toISOString() });
    const composio = await getClient();
    const connectedAccountId = integration.connectedAccountId;

    // Strategy: list primary calendar events within a time window
    const { timeMin, timeMax } = clampWindow(lastSyncAt);

    const args: any = {
      calendarId: 'primary',
      singleEvents: true,
      maxResults: 100,
    };
    if (timeMin) args.timeMin = timeMin;
    if (timeMax) args.timeMax = timeMax;

    const resp = await composio.tools.execute('GOOGLECALENDAR_EVENTS_LIST', {
      userId: integration.userId,
      connectedAccountId,
      arguments: args,
    });

    // Composio responses typically nest data under `data`
    const data = (resp as any)?.data ?? resp;
    const events = data?.items || [];

    // Get calendar summary if available
    const calendarSummary = data?.summary || 'primary';

    const files: IntegrationFile[] = [];
    for (const ev of events) {
      const file = mapEventToFile('primary', calendarSummary, ev);
      if (!file) continue;
      // Apply lastSyncAt filter if present
      if (!lastSyncAt || file.lastModified > lastSyncAt) files.push(file);
    }

    log.info('GoogleCalendar sync done', { integrationId, files: files.length });
    return files;
  } catch (error) {
    log.error('GoogleCalendar sync error', { integrationId, error: (error as Error).message });
    return [];
  }
}


