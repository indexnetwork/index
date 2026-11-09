import { Link } from "react-router";

import { useIntentAgentChat } from "@/components/IntentNegotiatorChat";
import type { Stage } from "@/components/intents-home/stages";
import { discoverySummary } from "@/components/workbench/mac-blocks";
import { useIntentsData } from "@/contexts/IntentsDataContext";

const dot = (line: string) => (/[.!?…]$/.test(line) ? line : `${line}.`);

/**
 * What my agent is doing for an intent started in the home chat: the same
 * progress the intent page shows (warming up, the plan, the searches, who it
 * found and reached), then who it's negotiating with and who waits on you.
 * Updates live while the chat is open.
 */
export default function IntentActivity({ intentId }: { intentId: string }) {
  const { feed, questions, loading } = useIntentAgentChat(intentId);
  const { entriesByIntent } = useIntentsData();

  const counts: Record<Stage, number> = { awaiting: 0, talks: 0, chat: 0, closed: 0 };
  for (const entry of entriesByIntent[intentId] ?? []) counts[entry.stage] += 1;

  const lines: { id: string; text: string; strong?: boolean; sub?: string[] }[] = [];
  for (const piece of feed) {
    if (piece.kind === "discovery") {
      const loadingLines = piece.loading.length && !piece.loading.some((l) => l.startsWith("Warming up")) ? ["Warming up", ...piece.loading] : piece.loading;
      loadingLines.forEach((text, i) => lines.push({ id: `${piece.id}-l${i}`, text: dot(text) }));
      if (piece.plan) lines.push({ id: `${piece.id}-plan`, text: piece.plan });
      if (piece.queries.length) {
        lines.push({ id: `${piece.id}-q`, text: `ran ${piece.queries.length} ${piece.queries.length === 1 ? "search" : "searches"}`, sub: piece.queries.map((q) => `looking for ${q}`) });
      }
      const summary = typeof piece.discovered === "number" ? discoverySummary(piece.discovered, piece.reached) : piece.progress;
      if (summary) lines.push({ id: `${piece.id}-s`, text: dot(summary), strong: true });
    } else if (piece.kind === "progress" || piece.kind === "note") {
      lines.push({ id: piece.id, text: piece.text });
    }
  }
  if (!lines.length) lines.push({ id: "warming", text: loading ? "checking in…" : "Warming up." });

  const status = [
    counts.talks && `negotiating with ${counts.talks} ${counts.talks === 1 ? "other agent" : "other agents"}`,
    counts.awaiting && `${counts.awaiting} waiting on you`,
    counts.chat && `${counts.chat} chatting`,
    questions.length && `${questions.length} ${questions.length === 1 ? "question" : "questions"} for you`,
  ].filter(Boolean) as string[];
  const working = !status.length && !lines.some((line) => line.strong);

  return (
    <div className="pl-act" aria-live="polite">
      <div className="pl-act-head">
        <span className={working ? "pl-act-dot on" : "pl-act-dot"} />
        <span>WHAT I&apos;M DOING</span>
      </div>
      <ul className="pl-act-lines">
        {lines.map((line) => (
          <li key={line.id} className={line.strong ? "strong" : undefined}>
            {line.text}
            {line.sub && (
              <ul className="pl-act-sub">
                {line.sub.map((text) => <li key={text}>{text}</li>)}
              </ul>
            )}
          </li>
        ))}
        {working && <li className="pl-dim">working<span className="pl-blink">_</span></li>}
      </ul>
      {status.length > 0 && <div className="pl-act-status">{status.join(" · ")}</div>}
      <Link className="pl-act-open" to={`/i/${intentId}`}>open this intent ▸</Link>
    </div>
  );
}
