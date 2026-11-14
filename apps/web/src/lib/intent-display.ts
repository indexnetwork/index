const TITLE_MAX = 45;
const TITLE_LEAD = /^(receive|explore|find|discover|connect with|connect to|connect|meet|seeking|seek|looking for|look for|get)\s+/;

/** Shelf title: lowercase, drop a leading verb, cut on a word at 45 characters. */
export function intentTitle(raw: string): string {
  const text = String(raw || "").trim().toLowerCase().replace(/\s+/g, " ").replace(TITLE_LEAD, "");
  if (!text) return "untitled intent";
  if (text.length <= TITLE_MAX) return text;
  const head = text.slice(0, TITLE_MAX + 1);
  const lastSpace = head.lastIndexOf(" ");
  const cut = lastSpace > 12 ? head.slice(0, lastSpace) : text.slice(0, TITLE_MAX);
  return cut.replace(/[\s,;:.·/+-]+$/, "") + "…";
}

const SHORT_LEAD = /^(i\s*(?:'m|am)\s+|i\s+(?:want|would like|'d like|need|hope)\s+to\s+|i\s+want\s+|we\s*(?:'re|are)\s+|up\s+for\s+|open\s+to\s+|looking\s+(?:to|for)\s+|trying\s+to\s+|hoping\s+to\s+|receive|explore|find|discover|connect\s+with|connect\s+to|connect|meet|seeking|seek|look\s+for|get)\s*/;
/** A leading time phrase ("within the next month,", "this week", "soon,") says when, not what. */
const TIME_LEAD = /^(?:(?:within|in|over|during|for)\s+the\s+(?:next|coming)\s+(?:few\s+)?\w+|(?:this|next)\s+(?:week|weekend|month|year|summer|fall|winter|spring)|soon|right\s+now|currently|lately|these\s+days)\s*,?\s+/;
const DANGLING = new Set(["a", "an", "the", "and", "or", "with", "in", "for", "to", "of", "on", "at", "who", "that", "&", "+", "-"]);

/** An intent as a 4 to 5 word name: lowercase, no leading "i want to", cut on a word, no dangling "and". */
export function intentShort(raw: string, maxWords = 5): string {
  let text = String(raw || "").trim().toLowerCase().replace(/\s+/g, " ");
  for (let i = 0; i < 3; i++) {
    const next = text.replace(TIME_LEAD, "").replace(SHORT_LEAD, "");
    if (next === text) break;
    text = next;
  }
  text = text.replace(/^(?:a|an|the)\s+/, "");
  const words = text.split(" ").filter(Boolean);
  if (!words.length) return "untitled intent";
  let head = words.slice(0, maxWords).map((word) => word.replace(/[,;:.!?]+$/, ""));
  // A comma or full stop ends the thought early, if that still leaves a name.
  const stop = words.slice(0, maxWords).findIndex((word) => /[,;:.!?]$/.test(word));
  if (stop >= 2 && stop < maxWords - 1) head = head.slice(0, stop + 1);
  // "x and y" keeps x when x is already a name.
  const and = head.indexOf("and");
  if (and >= 3) head = head.slice(0, and);
  while (head.length > 2 && DANGLING.has(head[head.length - 1])) head.pop();
  const cut = head.length < words.length;
  return head.join(" ") + (cut ? "…" : "");
}

export function intentStatus(intent: { status?: string | null; waitingOpportunityCount?: number }): string {
  const status = (intent.status || "").toLowerCase();
  if (status === "archived" || status === "expired" || status === "fulfilled") return "closed";
  if (status === "paused") return "paused";
  if ((intent.waitingOpportunityCount ?? 0) > 0) return "agents in talks";
  return "live";
}
