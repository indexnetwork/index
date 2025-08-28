import type { IntegrationHandler, IntegrationFile } from '../index';
import { getClient } from '../core/composio';
import { log } from '../../log';
import { withRetry, concurrencyLimit } from '../core/util';

type GmailThread = { id: string; historyId?: string };
type GmailMessage = {
  id?: string;
  messageId?: string;
  threadId?: string;
  thread_id?: string;
  internalDate?: string; // ms since epoch as string
  messageTimestamp?: string; // ISO date string
  snippet?: string;
  labelIds?: string[];
  payload?: {
    headers?: Array<{ name?: string; value?: string }>;
    mimeType?: string;
    body?: { data?: string; size?: number };
    parts?: Array<{
      mimeType?: string;
      filename?: string;
      body?: { data?: string; size?: number; attachmentId?: string };
      parts?: any[];
    }>;
  };
};

function decodeBase64Url(data?: string): string {
  if (!data) return '';
  try {
    const pad = data.length % 4 === 0 ? data : data + '='.repeat(4 - (data.length % 4));
    const normalized = pad.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(normalized, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function stripHtml(html: string): string {
  try {
    return html
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<br\s*\/?>(?=\s*<)/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
      .replace(/<li>/gi, '- ')
      .replace(/<[^>]+>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  } catch {
    return html;
  }
}

function extractBodyFromPayload(payload: GmailMessage['payload']): { text: string; attachments: string[] } {
  const attachments: string[] = [];
  let textPlain = '';
  let textHtml = '';

  const walk = (part: any) => {
    if (!part) return;
    const mime = (part.mimeType || '').toLowerCase();
    const bodyData = part.body?.data ? decodeBase64Url(part.body.data) : '';

    if (part.filename && part.body && (part.body.attachmentId || (part.body.size || 0) > 0) && !mime.startsWith('text/')) {
      attachments.push(`${part.filename}`);
    }

    if (mime === 'text/plain' && bodyData) {
      textPlain += (textPlain ? '\n\n' : '') + bodyData;
    } else if (mime === 'text/html' && bodyData) {
      textHtml += (textHtml ? '\n\n' : '') + stripHtml(bodyData);
    }

    if (Array.isArray(part.parts)) {
      for (const p of part.parts) walk(p);
    }
  };

  if (payload) {
    if (payload.body?.data) {
      const data = decodeBase64Url(payload.body.data);
      if ((payload.mimeType || '').toLowerCase() === 'text/plain') textPlain += data;
      else if ((payload.mimeType || '').toLowerCase() === 'text/html') textHtml += stripHtml(data);
    }
    if (Array.isArray(payload.parts)) {
      for (const part of payload.parts) walk(part);
    }
  }

  const text = textPlain || textHtml || '';
  return { text: text.trim(), attachments };
}

function safeHeader(headers: Array<{ name?: string; value?: string }> | undefined, name: string): string | undefined {
  const h = headers?.find((x) => (x.name || '').toLowerCase() === name.toLowerCase());
  return h?.value || undefined;
}

function toDateFromMessage(msg: GmailMessage): Date {
  // Prefer internalDate (milliseconds since epoch). Fallback to Date header.
  const internal = msg.internalDate ? Number(msg.internalDate) : NaN;
  if (Number.isFinite(internal) && internal > 0) return new Date(internal);
  // Next prefer messageTimestamp if present
  if (msg.messageTimestamp) {
    const d = new Date(msg.messageTimestamp);
    if (!isNaN(d.getTime())) return d;
  }
  const dateHeader = safeHeader(msg.payload?.headers, 'Date');
  if (dateHeader) {
    const d = new Date(dateHeader);
    if (!isNaN(d.getTime())) return d;
  }
  return new Date();
}

function sanitizeFilename(s: string, fallback: string): string {
  const base = (s || '').trim() || fallback;
  return base.replace(/[\/:*?"<>|\n\r\t]/g, '-').slice(0, 120);
}

function mapGmailMessageToFile(threadId: string, msg: GmailMessage): IntegrationFile {
  const headers = msg.payload?.headers || [];
  const subject = safeHeader(headers, 'Subject') || 'No Subject';
  const from = safeHeader(headers, 'From') || '';
  const to = safeHeader(headers, 'To') || '';
  const cc = safeHeader(headers, 'Cc') || '';
  const dateStr = safeHeader(headers, 'Date') || toDateFromMessage(msg).toISOString();
  const labels = (msg.labelIds || []).join(', ');
  const snippet = (msg.snippet || '').trim();
  const snippetPreview = snippet.length > 1000 ? snippet.slice(0, 1000) + '…' : snippet;

  const parts: string[] = [];
  parts.push(`# ${subject}`);
  parts.push('');
  if (from) parts.push(`From: ${from}`);
  if (to) parts.push(`To: ${to}`);
  if (cc) parts.push(`Cc: ${cc}`);
  if (dateStr) parts.push(`Date: ${dateStr}`);
  if (labels) parts.push(`Labels: ${labels}`);
  parts.push('');
  parts.push(snippetPreview ? snippetPreview : '*No preview available*');

  const content = parts.join('\n');
  const lastModified = toDateFromMessage(msg);
  const safeName = sanitizeFilename(subject, threadId);
  return {
    id: `${threadId}-${msg.id}`,
    name: `${safeName}-${msg.id}.md`,
    content,
    lastModified,
    type: 'text/markdown',
    size: content.length,
  };
}

function toGmailAfterQuery(d: Date): string {
  // Gmail supports after:YYYY/MM/DD (no time). Use UTC date to be deterministic.
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `after:${y}/${m}/${day}`;
}

async function fetchFiles(userId: string, lastSyncAt?: Date): Promise<IntegrationFile[]> {
  try {
    log.info('Gmail sync start', { userId, lastSyncAt: lastSyncAt?.toISOString() });
    const composio = await getClient();

    // Find a connected Gmail account via Composio
    const connectedAccounts = await withRetry(() => composio.connectedAccounts.list({
      userIds: [userId],
      toolkitSlugs: ['gmail'],
    }));

    const account = (connectedAccounts as any)?.items?.[0];
    if (!account) return [];
    const connectedAccountId = account.id;

    // Build query
    const baseQuery = 'label:INBOX';
    const dateQuery = lastSyncAt ? toGmailAfterQuery(lastSyncAt) : undefined;
    const query = [baseQuery, dateQuery].filter(Boolean).join(' ');

    // List threads
    const maxResults = 75;
    // Provide both camelCase and snake_case variants to match Composio expectations
    const listArgs: any = { user_id: 'me', userId: 'me', max_results: maxResults, maxResults };
    if (query) { listArgs.query = query; listArgs.q = query; }

    const threadsResp = await withRetry(() =>
      composio.tools.execute('GMAIL_LIST_THREADS', {
        userId,
        connectedAccountId,
        arguments: listArgs,
      })
    );

    // Be robust to response shapes
    const data = (threadsResp as any)?.data ?? threadsResp;
    const threadsList: GmailThread[] =
      data?.threads ||
      data?.details?.threads ||
      data?.data?.threads ||
      data?.data?.details?.threads ||
      data?.items ||
      [];

    log.info('Gmail threads fetched', { count: threadsList.length, keys: Object.keys(data || {}), query, usedArgs: Object.keys(listArgs) });
    if (!threadsList.length) return [];

    const limit = concurrencyLimit(6);
    const files: IntegrationFile[] = [];

    const tasks = threadsList.map((th) => limit(async () => {
      if (!th?.id) return;
      const threadId = th.id;
      const threadResp = await withRetry(() =>
        composio.tools.execute('GMAIL_FETCH_MESSAGE_BY_THREAD_ID', {
          userId,
          connectedAccountId,
          // Supply several variants just in case tool expects different naming
          arguments: { user_id: 'me', userId: 'me', thread_id: threadId, threadId, id: threadId },
        }),
        { retries: 3 }
      );

      const tdata = (threadResp as any)?.data ?? threadResp;
      const tdataKeys = tdata && typeof tdata === 'object' ? Object.keys(tdata) : [];
      // Try multiple shapes for messages array
      const candidates: any[] = [
        tdata?.messages,
        tdata?.details?.messages,
        tdata?.data?.messages,
        tdata?.data?.details?.messages,
        tdata?.thread?.messages,
        tdata?.data?.thread?.messages,
        tdata?.details,
        tdata,
      ];
      let messages: GmailMessage[] = [];
      for (const c of candidates) {
        if (Array.isArray(c) && c.length && (c[0]?.id || c[0]?.messageId)) { messages = c; break; }
        if (Array.isArray(c) && c.length === 0) { messages = []; break; }
      }
      if (!Array.isArray(messages) || !messages.length) {
        log.warn('Gmail thread has no messages', { threadId, tdataKeys });
        return;
      }
      const firstKeys = messages[0] && typeof messages[0] === 'object' ? Object.keys(messages[0]) : [];
      log.info('Gmail thread messages', { threadId, count: messages.length, firstKeys });

      for (const msg of messages) {
        const mid = (msg as any).id || (msg as any).messageId;
        if (!mid) continue;
        let enrichedMsg: GmailMessage = msg;
        if (!msg.payload || (!msg.payload.body && !msg.payload.parts)) {
          try {
            const fullResp = await withRetry(() =>
              composio.tools.execute('GMAIL_GET_MESSAGE', {
                userId,
                connectedAccountId,
                arguments: { user_id: 'me', userId: 'me', message_id: mid, id: mid, format: 'full' },
              }),
              { retries: 2 }
            );
            const fdata = (fullResp as any)?.data ?? fullResp;
            const fmsg = (fdata as any)?.message || (fdata as any)?.data || fdata;
            if (fmsg?.payload) {
              enrichedMsg = { ...msg, payload: fmsg.payload } as GmailMessage;
            }
          } catch (e) {
            log.debug('Gmail full message fetch failed, using existing snippet', { messageId: mid });
          }
        }
        const file = mapGmailMessageToFileRich(threadId, enrichedMsg);
        if (!lastSyncAt || file.lastModified > lastSyncAt) {
          files.push(file);
        }
      }
    }));

    await Promise.all(tasks);
    // Fallback: if no files created via thread hydration, try direct message fetch
    if (files.length === 0) {
      try {
        const searchArgs: any = {
          user_id: 'me', userId: 'me',
          max_results: 25, maxResults: 25,
          include_payload: true, includePayload: true,
          ids_only: false, idsOnly: false,
        };
        if (query) { searchArgs.query = query; searchArgs.q = query; }
        const searchResp = await withRetry(() =>
          composio.tools.execute('GMAIL_FETCH_EMAILS', {
            userId,
            connectedAccountId,
            arguments: searchArgs,
          }),
          { retries: 2 }
        );
        const sdata = (searchResp as any)?.data ?? searchResp;
        const skeys = sdata && typeof sdata === 'object' ? Object.keys(sdata) : [];
        const candidates: any[] = [
          sdata?.messages,
          sdata?.details?.messages,
          sdata?.data?.messages,
          sdata?.data?.details?.messages,
          sdata?.items,
          sdata?.details,
        ];
        let smessages: GmailMessage[] = [];
        for (const c of candidates) {
          if (Array.isArray(c) && (c.length === 0 || c[0]?.id || c[0]?.messageId)) { smessages = c; break; }
        }
        const firstFallbackKeys = Array.isArray(smessages) && smessages[0] ? Object.keys(smessages[0]) : [];
        log.info('Gmail fallback search', { skeys, smessages: Array.isArray(smessages) ? smessages.length : 'n/a', firstFallbackKeys });
        if (Array.isArray(smessages)) {
          for (const msg of smessages) {
            const mid = (msg as any).id || (msg as any).messageId;
            if (!mid) continue;
            const threadId = (msg as any).threadId || (msg as any).thread_id || 'thread';
            let enrichedMsg: GmailMessage = msg as GmailMessage;
            if (!enrichedMsg.payload || (!enrichedMsg.payload.body && !enrichedMsg.payload.parts)) {
              try {
                const fullResp = await withRetry(() =>
                  composio.tools.execute('GMAIL_GET_MESSAGE', {
                    userId,
                    connectedAccountId,
                    arguments: { user_id: 'me', userId: 'me', message_id: mid, id: mid, format: 'full' },
                  }),
                  { retries: 2 }
                );
                const fdata = (fullResp as any)?.data ?? fullResp;
                const fmsg = (fdata as any)?.message || (fdata as any)?.data || fdata;
                if (fmsg?.payload) {
                  enrichedMsg = { ...enrichedMsg, payload: fmsg.payload } as GmailMessage;
                }
              } catch (e) {
                // ignore
              }
            }
            const file = mapGmailMessageToFileRich(threadId, enrichedMsg);
            if (!lastSyncAt || file.lastModified > lastSyncAt) files.push(file);
          }
        }
      } catch (err) {
        log.warn('Gmail fallback search error', { error: (err as Error).message });
      }
    }

    log.info('Gmail sync done', { userId, files: files.length });
    return files;
  } catch (error) {
    log.error('Gmail sync error', { userId, error: (error as Error).message });
    return [];
  }
}

function mapGmailMessageToFileRich(threadId: string, msg: GmailMessage): IntegrationFile {
  const headers = msg.payload?.headers || [];
  const subject = safeHeader(headers, 'Subject') || 'No Subject';
  const from = safeHeader(headers, 'From') || '';
  const to = safeHeader(headers, 'To') || '';
  const cc = safeHeader(headers, 'Cc') || '';
  const dateStr = safeHeader(headers, 'Date') || toDateFromMessage(msg).toISOString();
  const labels = (msg.labelIds || []).join(', ');

  const snippet = (msg.snippet || '').trim();
  const bodyInfo = extractBodyFromPayload(msg.payload);
  const body = bodyInfo.text || snippet;
  const bodyPreview = body.length > 8000 ? body.slice(0, 8000) + '\n…[truncated]' : body;

  const parts: string[] = [];
  parts.push(`# ${subject}`);
  parts.push('');
  if (from) parts.push(`From: ${from}`);
  if (to) parts.push(`To: ${to}`);
  if (cc) parts.push(`Cc: ${cc}`);
  if (dateStr) parts.push(`Date: ${dateStr}`);
  if (labels) parts.push(`Labels: ${labels}`);
  parts.push('');
  parts.push(bodyPreview ? bodyPreview : '*No content available*');
  if (bodyInfo.attachments.length) {
    parts.push('');
    parts.push('Attachments:');
    for (const a of bodyInfo.attachments) parts.push(`- ${a}`);
  }

  const content = parts.join('\n');
  const lastModified = toDateFromMessage(msg);
  const safeName = sanitizeFilename(subject, threadId);
  const mid = (msg as any).id || (msg as any).messageId || 'message';
  return {
    id: `${threadId}-${mid}`,
    name: `${safeName}-${mid}.md`,
    content,
    lastModified,
    type: 'text/markdown',
    size: content.length,
  };
}

export const gmailHandler: IntegrationHandler = { fetchFiles };
