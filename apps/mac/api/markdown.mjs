const ALLOWED_MARKDOWN_TAGS = new Set([
  'A', 'BLOCKQUOTE', 'BR', 'CODE', 'DEL', 'EM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'HR', 'LI', 'OL', 'P', 'PRE', 'STRONG', 'UL',
]);

function safeExternalHref(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Convert untrusted model markdown to a strict HTML subset. Raw HTML is escaped
 * before parsing, and the resulting tree is allowlisted again so parser changes
 * cannot introduce active content or credential-reading event handlers.
 */
export function renderAgentMarkdown(marked, DOMParserType, value) {
  if (!marked || typeof marked.parse !== 'function' || !DOMParserType || !value) return null;
  const escaped = String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const parsed = marked.parse(escaped, { breaks: true, async: false });
  if (typeof parsed !== 'string') return null;

  const document = new DOMParserType().parseFromString(`<body>${parsed}</body>`, 'text/html');
  const body = document.body;
  if (!body) return null;

  for (const element of [...body.querySelectorAll('*')]) {
    if (!ALLOWED_MARKDOWN_TAGS.has(element.tagName)) {
      element.replaceWith(...element.childNodes);
      continue;
    }
    const parsedHref = element.tagName === 'A'
      ? safeExternalHref(element.getAttribute('href'))
      : null;
    for (const attribute of [...element.attributes]) element.removeAttribute(attribute.name);
    if (element.tagName === 'A') {
      if (parsedHref) {
        element.setAttribute('href', parsedHref);
        element.setAttribute('target', '_blank');
        element.setAttribute('rel', 'noopener noreferrer');
      } else {
        element.replaceWith(...element.childNodes);
      }
    }
  }
  return body.innerHTML;
}
