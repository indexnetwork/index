import { useEffect, useState } from "react";
import { Link } from "react-router";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import SiteLayout from "@/app/site/SiteLayout";
import OpportunityCard, { type OpportunityCardData, OpportunitySkeleton } from "@/components/chat/OpportunityCardInChat";
import { apiUrl } from "@/lib/api";

interface SharedMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
}

interface SharedSession {
  id: string;
  title: string | null;
  createdAt: string;
}

type MessageSegment =
  | { type: "text"; content: string }
  | { type: "opportunity"; data: OpportunityCardData }
  | { type: "opportunity_loading" };

function parseOpportunityBlocks(content: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  const regex = /```opportunity\s*\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      const textBefore = content.slice(lastIndex, match.index);
      if (textBefore.trim()) {
        segments.push({ type: "text", content: textBefore });
      }
    }

    try {
      const data = JSON.parse(match[1].trim()) as OpportunityCardData;
      if (data.opportunityId && data.userId) {
        segments.push({ type: "opportunity", data });
      } else {
        segments.push({ type: "text", content: match[0] });
      }
    } catch {
      segments.push({ type: "text", content: match[0] });
    }

    lastIndex = match.index + match[0].length;
  }

  const remaining = content.slice(lastIndex);
  const partialMatch = remaining.match(/```opportunity/);
  if (partialMatch) {
    const textBefore = remaining.slice(0, partialMatch.index!);
    if (textBefore.trim()) segments.push({ type: "text", content: textBefore });
    segments.push({ type: "opportunity_loading" });
  } else if (remaining.trim()) {
    segments.push({ type: "text", content: remaining });
  }

  if (segments.length === 0 && content.trim()) {
    segments.push({ type: "text", content });
  }

  return segments;
}

/** Keep first occurrence of each opportunityId; leave other segment types unchanged. */
function dedupeOpportunitySegments(
  segments: MessageSegment[]
): MessageSegment[] {
  const seen = new Set<string>();
  return segments.filter((seg) => {
    if (seg.type !== "opportunity") return true;
    if (seen.has(seg.data.opportunityId)) return false;
    seen.add(seg.data.opportunityId);
    return true;
  });
}

interface SharedChatViewProps {
  token: string;
}

export default function SharedChatView({ token }: SharedChatViewProps) {
  const [session, setSession] = useState<SharedSession | null>(null);
  const [messages, setMessages] = useState<SharedMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(apiUrl(`/api/chat/shared/${token}`))
      .then(async (res) => {
        if (!res.ok) throw new Error("Conversation not found");
        const data = await res.json();
        setSession(data.session);
        setMessages(data.messages);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <SiteLayout>
        <p className="site-p">Loading…</p>
      </SiteLayout>
    );
  }

  if (error || !session) {
    return (
      <SiteLayout>
        <section className="site-hero">
          <h1 className="site-h1">Conversation not found</h1>
          <p className="site-p">{error || "This shared conversation could not be found."}</p>
          <Link className="site-btn" to="/">Go home</Link>
        </section>
      </SiteLayout>
    );
  }

  return (
    <SiteLayout>
      <section className="site-hero">
        <h1 className="site-h1">{session.title || "Shared conversation"}</h1>
        <div className="space-y-4">
            {messages
              .filter((msg) => msg.role !== "system")
              .map((msg) => (
                <div key={msg.id}>
                  <div
                    className={cn(
                      "flex",
                      msg.role === "user" ? "justify-end" : "justify-start",
                    )}
                  >
                    <div
                      className={cn(
                        msg.role === "user" ? "max-w-[75%]" : "max-w-[90%]",
                        msg.role === "user"
                          ? "bg-[#FAFAFA] text-gray-900 border border-[#E8E8E8] rounded-[32px] px-4 py-1 text-sm leading-relaxed"
                          : "text-gray-900",
                      )}
                    >
                      {msg.role === "assistant" && (
                        <span className="text-[10px] uppercase tracking-wider text-black font-bold mb-1 block">
                          Index
                        </span>
                      )}
                      <article className="max-w-none">
                        {msg.role === "assistant" ? (
                          <div>
                            {dedupeOpportunitySegments(
                              parseOpportunityBlocks(msg.content),
                            ).map((segment, idx) => {
                              if (segment.type === "opportunity") {
                                return (
                                  <div
                                    key={segment.data.opportunityId}
                                    className="my-3"
                                  >
                                    <OpportunityCard card={segment.data} />
                                  </div>
                                );
                              }
                              if (segment.type === "opportunity_loading") {
                                return (
                                  <div key={`loading-${idx}`} className="my-3">
                                    <OpportunitySkeleton />
                                  </div>
                                );
                              }
                              return (
                                <div
                                  key={`text-${idx}`}
                                  className="chat-markdown max-w-none"
                                >
                                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                    {segment.content}
                                  </ReactMarkdown>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="chat-markdown max-w-none">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {msg.content}
                            </ReactMarkdown>
                          </div>
                        )}
                      </article>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        <p className="site-p">This is a shared conversation from Index.</p>
        <Link className="site-btn" to="/">Try Index</Link>
      </section>
    </SiteLayout>
  );
}
