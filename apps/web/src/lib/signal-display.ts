const TITLE_MAX = 45;
const TITLE_LEAD = /^(receive|explore|find|discover|connect with|connect to|connect|meet|seeking|seek|looking for|look for|get)\s+/;

/** Shelf title: lowercase, drop a leading verb, cut on a word at 45 characters. */
export function signalTitle(raw: string): string {
  const text = String(raw || "").trim().toLowerCase().replace(/\s+/g, " ").replace(TITLE_LEAD, "");
  if (!text) return "untitled signal";
  if (text.length <= TITLE_MAX) return text;
  const head = text.slice(0, TITLE_MAX + 1);
  const lastSpace = head.lastIndexOf(" ");
  const cut = lastSpace > 12 ? head.slice(0, lastSpace) : text.slice(0, TITLE_MAX);
  return cut.replace(/[\s,;:.·/+-]+$/, "") + "…";
}

export function signalStatus(intent: { status?: string | null; waitingOpportunityCount?: number }): string {
  const status = (intent.status || "").toLowerCase();
  if (status === "archived" || status === "expired" || status === "fulfilled") return "closed";
  if (status === "draft") return "draft";
  if (status === "paused") return "paused";
  if ((intent.waitingOpportunityCount ?? 0) > 0) return "negotiating";
  return "live";
}
