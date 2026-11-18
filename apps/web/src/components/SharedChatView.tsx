import { useEffect, useState } from "react";
import { Link } from "react-router";
import { cn, formatDate } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import SiteLayout from "@/app/site/SiteLayout";
import OpportunityCard, { type OpportunityCardData, OpportunitySkeleton } from "@/components/chat/OpportunityCardInChat";
import { apiUrl } from "@/lib/api";
import { log } from "@/lib/logger";
import { useTranslation } from "react-i18next";
import TranslatedMark from "@/components/TranslatedMark";
import { useContentTranslation } from "@/lib/content-translation";

const logger = log.ui.from("SharedChatView");

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

/** Message text written by the agent or by the person who shared the chat, shown in the viewer's language. */
function TranslatedMarkdown({ content }: { content: string }) {
  const shown = useContentTranslation(content);
  return (
    <div className="chat-markdown max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {shown.text}
      </ReactMarkdown>
      <TranslatedMark state={shown} />
    </div>
  );
}

interface SharedChatViewProps {
  token: string;
}

export default function SharedChatView({ token }: SharedChatViewProps) {
  const { t } = useTranslation();
  const [session, setSession] = useState<SharedSession | null>(null);
  const [messages, setMessages] = useState<SharedMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<"notFound" | "failed" | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    fetch(apiUrl(`/api/chat/shared/${token}`))
      .then(async (res) => {
        if (res.status === 404 || res.status === 410) {
          setError("notFound");
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setSession(data.session);
        setMessages(data.messages ?? []);
        setError(data.session ? null : "notFound");
      })
      .catch((err) => {
        logger.error("Failed to load shared conversation", { error: err });
        setError("failed");
      })
      .finally(() => setLoading(false));
  }, [token, reloadKey]);

  const shownTitle = useContentTranslation(session?.title);

  if (loading) {
    return (
      <SiteLayout>
        <p className="site-p">{t("Loading…")}</p>
      </SiteLayout>
    );
  }

  if (error === "failed") {
    return (
      <SiteLayout>
        <section className="site-hero">
          <h1 className="site-h1">{t("Couldn't load this conversation")}</h1>
          <p className="site-p">{t("Check your connection and try again.")}</p>
          <button
            type="button"
            className="site-btn"
            onClick={() => { setLoading(true); setError(null); setReloadKey((k) => k + 1); }}
          >
            {t("Try again")}
          </button>
        </section>
      </SiteLayout>
    );
  }

  if (error || !session) {
    return (
      <SiteLayout>
        <section className="site-hero">
          <h1 className="site-h1">{t("Conversation not found")}</h1>
          <p className="site-p">{t("This shared conversation doesn't exist, or its link was turned off.")}</p>
          <Link className="site-btn" to="/">{t("Go home")}</Link>
        </section>
      </SiteLayout>
    );
  }

  const visibleMessages = messages.filter((msg) => msg.role !== "system");

  return (
    <SiteLayout>
      <section className="site-hero">
        <h1 className="site-h1">{session.title ? shownTitle.text : t("Shared conversation")}</h1>
        {visibleMessages.length === 0 && (
          <p className="site-p">{t("This conversation has no messages yet.")}</p>
        )}
        <div className="space-y-4">
            {visibleMessages
              .map((msg) => (
                <div key={msg.id}>
                  <div
                    title={formatDate(msg.createdAt)}
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
                                <TranslatedMarkdown
                                  key={`text-${idx}`}
                                  content={segment.content}
                                />
                              );
                            })}
                          </div>
                        ) : (
                          <TranslatedMarkdown content={msg.content} />
                        )}
                      </article>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        <p className="site-p">{t("This is a shared conversation from Index.")}</p>
        <Link className="site-btn" to="/">{t("Try Index")}</Link>
      </section>
    </SiteLayout>
  );
}
