import type { IntegrationHandler, IntegrationFile } from '../index';
import { getClient } from '../core/composio';
import { log } from '../../log';
import { withRetry } from '../core/util';

type GmailMessage = {
  id?: string;
  messageId?: string;
  internalDate?: string;
  snippet?: string;
  payload?: { headers?: Array<{ name?: string; value?: string }> };
};

function h(headers: Array<{ name?: string; value?: string }> | undefined, name: string) {
  const x = headers?.find((y) => (y.name || '').toLowerCase() === name.toLowerCase());
  return x?.value || undefined;
}

function mdate(msg: GmailMessage): Date {
  const ms = msg.internalDate ? Number(msg.internalDate) : NaN;
  if (Number.isFinite(ms) && ms > 0) return new Date(ms);
  const d = h(msg.payload?.headers, 'Date');
  const parsed = d ? new Date(d) : undefined;
  return parsed && !isNaN(parsed.getTime()) ? parsed : new Date();
}

function after(d: Date) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `after:${y}/${m}/${day}`;
}

function fname(s: string, fallback: string) {
  const base = (s || '').trim() || fallback;
  return base.replace(/[\/:*?"<>|\n\r\t]/g, '-').slice(0, 120);
}

async function fetchFiles(userId: string, lastSyncAt?: Date): Promise<IntegrationFile[]> {
  try {
    const composio = await getClient();
    const accs = await withRetry(() => composio.connectedAccounts.list({ userIds: [userId], toolkitSlugs: ['gmail'] }));
    const acc = (accs as any)?.items?.[0];
    if (!acc) return [];

    const query = ['in:sent', lastSyncAt ? after(lastSyncAt) : undefined].filter(Boolean).join(' ');
    const args: any = { user_id: 'me', query, max_results: 100, include_payload: true, ids_only: false };
    const resp = await withRetry(() => composio.tools.execute('GMAIL_FETCH_EMAILS', { userId, connectedAccountId: acc.id, arguments: args }));
    const data = (resp as any)?.data ?? resp;
    const messages: GmailMessage[] = data?.messages || data?.details?.messages || data?.items || [];
    if (!Array.isArray(messages) || !messages.length) return [];

    const files: IntegrationFile[] = [];
    for (const msg of messages) {
      const mid = (msg as any).id || (msg as any).messageId;
      if (!mid) continue;
      const subject = h(msg.payload?.headers, 'Subject') || 'No Subject';
      const from = h(msg.payload?.headers, 'From') || '';
      const to = h(msg.payload?.headers, 'To') || '';
      const dateStr = h(msg.payload?.headers, 'Date') || mdate(msg).toISOString();
      const snippet = (msg.snippet || '').trim();
      const content = [`# ${subject}`, '', from && `From: ${from}`, to && `To: ${to}`, `Date: ${dateStr}`, '', snippet || '*No preview available*']
        .filter(Boolean)
        .join('\n');
      const file: IntegrationFile = {
        id: mid,
        name: `${fname(subject, mid)}.md`,
        content,
        lastModified: mdate(msg),
        type: 'text/markdown',
        size: content.length,
      };
      if (!lastSyncAt || file.lastModified > lastSyncAt) files.push(file);
    }
    log.info('gmail: done', { userId, files: files.length });
    return files;
  } catch (e) {
    log.error('gmail: error', { userId, error: (e as Error).message });
    return [];
  }
}

export const gmailHandler: IntegrationHandler = { fetchFiles };

