import type { McpServer } from '@modelcontextprotocol/server';

/**
 * MCP Apps UI for hosts that render components (ChatGPT, per the Apps SDK).
 * One inline match card: the opportunity, with Accept and Pass buttons that
 * call accept_opportunity and reject_opportunity over the host bridge, so a
 * click goes through the same tools, annotations, and approval gates as the
 * model's own calls.
 */

/** Hosts treat the URI as the template's cache key: a breaking template change needs a new URI. */
export const MATCH_CARD_RESOURCE_URI = 'ui://index/match-card-v1.html';

const MATCH_CARD_MIME_TYPE = 'text/html;profile=mcp-app';

/**
 * Attached to tools whose result the card renders. `ui.resourceUri` is the
 * MCP Apps standard; `openai/outputTemplate` is ChatGPT's alias for it.
 */
export const MATCH_CARD_TOOL_META = {
  'ui': { resourceUri: MATCH_CARD_RESOURCE_URI },
  'openai/outputTemplate': MATCH_CARD_RESOURCE_URI,
  'openai/toolInvocation/invoking': 'Laying out the match…',
  'openai/toolInvocation/invoked': 'Match card ready',
} as const;

/**
 * The card is self-contained: actions go through the host bridge and the
 * avatar is initials, so the CSP allows no external connects or resources.
 */
const MATCH_CARD_UI_META = {
  'ui': {
    prefersBorder: true,
    csp: { connectDomains: [], resourceDomains: [] },
  },
  'openai/ui': {
    prefersBorder: true,
    availableDisplayModes: ['inline'],
  },
} as const;

/**
 * The template reads the render tool's structured content from
 * window.openai.toolOutput ({ opportunity: { … } }, the match-card output
 * schema in mcp.tools.ts) and keeps to the inline-card rules: at most two
 * actions, no navigation, system fonts, no logo.
 */
const MATCH_CARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  :root { --ink: #111827; --quiet: #6b7280; --edge: #e5e7eb; --tint: #f3f4f6; --btn-bg: #111827; --btn-ink: #ffffff; --err: #b91c1c; }
  @media (prefers-color-scheme: dark) {
    :root { --ink: #ececf1; --quiet: #9ca3af; --edge: #3f3f46; --tint: #27272a; --btn-bg: #ececf1; --btn-ink: #111827; --err: #f87171; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; color: var(--ink); font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .card { padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; }
  .head { display: flex; gap: 12px; align-items: center; }
  .avatar { flex: none; width: 40px; height: 40px; border-radius: 50%; background: var(--tint); border: 1px solid var(--edge); display: flex; align-items: center; justify-content: center; font-weight: 600; }
  .name { font-weight: 600; font-size: 15px; }
  .headline { color: var(--quiet); }
  .summary { margin: 0; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .cosign, .note, .quiet { margin: 0; color: var(--quiet); font-size: 13px; }
  .error { margin: 0; color: var(--err); font-size: 13px; }
  .actions { display: flex; gap: 8px; padding-top: 2px; }
  button { font: inherit; font-weight: 600; border-radius: 10px; padding: 8px 16px; cursor: pointer; border: 1px solid var(--edge); background: transparent; color: var(--ink); }
  button.primary { background: var(--btn-bg); border-color: var(--btn-bg); color: var(--btn-ink); }
  button:disabled { opacity: 0.55; cursor: default; }
</style>
</head>
<body>
<div id="root"></div>
<script>
(function () {
  var root = document.getElementById('root');
  var state = { done: null, chatUrl: null, error: null, busy: false };

  function api() { return window.openai || {}; }
  function opp() {
    var out = api().toolOutput;
    return out && out.opportunity ? out.opportunity : null;
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  }
  function initials(name) {
    var parts = String(name || '').trim().split(/\\s+/).filter(Boolean);
    if (!parts.length) return '?';
    var first = parts[0].charAt(0);
    var last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : '';
    return (first + last).toUpperCase();
  }
  function fitHeight() {
    if (typeof api().notifyIntrinsicHeight === 'function') {
      api().notifyIntrinsicHeight(document.documentElement.scrollHeight);
    }
  }
  function openLink(href) {
    if (href && typeof api().openExternal === 'function') api().openExternal({ href: href });
  }
  // Tool results arrive as structured content, or as a summary line followed by one JSON line.
  function parseResult(result) {
    if (!result) return null;
    if (result.structuredContent) return result.structuredContent;
    var content = Array.isArray(result.content) ? result.content : [];
    for (var i = 0; i < content.length; i++) {
      if (content[i] && content[i].type === 'text' && typeof content[i].text === 'string') {
        var lines = content[i].text.split('\\n');
        for (var j = lines.length - 1; j >= 0; j--) {
          var line = lines[j].trim();
          if (line.charAt(0) === '{') {
            try { return JSON.parse(line); } catch (e) { /* keep looking */ }
          }
        }
      }
    }
    return null;
  }
  function act(accepted) {
    var o = opp();
    if (!o || state.busy || typeof api().callTool !== 'function') return;
    state.busy = true;
    state.error = null;
    render();
    api().callTool(accepted ? 'accept_opportunity' : 'reject_opportunity', { opportunityId: o.id })
      .then(function (result) {
        var parsed = parseResult(result);
        if ((parsed && parsed.success === false) || (result && result.isError)) {
          state.error = (parsed && parsed.error) || 'That did not go through. Try again.';
        } else {
          state.done = accepted ? 'accepted' : 'passed';
          state.chatUrl = (parsed && parsed.chatUrl) || o.chatUrl || null;
        }
      })
      .catch(function () { state.error = 'That did not go through. Try again.'; })
      .then(function () { state.busy = false; render(); });
  }
  function button(label, primary, onClick) {
    var b = el('button', primary ? 'primary' : null, label);
    b.disabled = state.busy;
    b.addEventListener('click', onClick);
    return b;
  }
  function render() {
    root.textContent = '';
    var o = opp();
    if (!o) {
      var empty = el('div', 'card');
      empty.appendChild(el('p', 'quiet', 'No match to show.'));
      root.appendChild(empty);
      fitHeight();
      return;
    }
    var card = el('div', 'card');
    var head = el('div', 'head');
    head.appendChild(el('div', 'avatar', initials(o.peer && o.peer.name)));
    var names = el('div');
    names.appendChild(el('div', 'name', (o.peer && o.peer.name) || 'Someone'));
    if (o.headline) names.appendChild(el('div', 'headline', o.headline));
    head.appendChild(names);
    card.appendChild(head);
    if (o.summary) card.appendChild(el('p', 'summary', o.summary));
    if (o.cosignText) card.appendChild(el('p', 'cosign', o.cosignText));
    if (state.error) card.appendChild(el('p', 'error', state.error));

    var name = (o.peer && o.peer.name) || 'them';
    var chatUrl = state.chatUrl || o.chatUrl || o.url;
    var actions = el('div', 'actions');
    if (state.done === 'accepted') {
      card.appendChild(el('p', 'note', 'You said yes — your chat with ' + name + ' is open.'));
      actions.appendChild(button('Open chat', true, function () { openLink(chatUrl); }));
    } else if (state.done === 'passed') {
      card.appendChild(el('p', 'note', 'Passed on this match.'));
    } else if (o.viewerCommitted || o.status === 'accepted') {
      card.appendChild(el('p', 'note', 'You already said yes to this match.'));
      actions.appendChild(button('Open chat', true, function () { openLink(chatUrl); }));
    } else if (o.status === 'rejected') {
      card.appendChild(el('p', 'note', 'You passed on this match.'));
    } else if (o.status === 'expired') {
      card.appendChild(el('p', 'note', 'This match expired.'));
    } else {
      actions.appendChild(button(state.busy ? 'Working…' : 'Accept', true, function () { act(true); }));
      actions.appendChild(button('Pass', false, function () { act(false); }));
    }
    if (actions.childNodes.length) card.appendChild(actions);
    root.appendChild(card);
    fitHeight();
  }
  render();
})();
</script>
</body>
</html>
`;

/** Register the UI resources every MCP host may read; hosts without UI support simply never fetch them. */
export function registerMcpUi(server: McpServer): void {
  server.registerResource(
    'match-card',
    MATCH_CARD_RESOURCE_URI,
    {
      title: 'Index match card',
      description: 'Inline card showing one opportunity with Accept and Pass actions.',
      mimeType: MATCH_CARD_MIME_TYPE,
      _meta: MATCH_CARD_UI_META,
    },
    (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: MATCH_CARD_MIME_TYPE,
        text: MATCH_CARD_HTML,
        _meta: MATCH_CARD_UI_META,
      }],
    }),
  );
}
