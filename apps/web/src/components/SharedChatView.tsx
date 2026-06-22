import { useEffect, useState } from "react";
import { Loader2, Share2 } from "lucide-react";
import { ContentContainer } from "@/components/layout";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <p className="text-gray-500 text-sm">
          {error || "This shared conversation could not be found."}
        </p>
        <a
          href="/"
          className="text-sm font-medium text-[#4091BB] hover:underline"
        >
          Go to Index
        </a>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="sticky top-0 bg-white z-10 border-b border-gray-100 px-4 py-3">
        <ContentContainer>
          <div className="flex items-center gap-3">
            <a
              href="/"
              className="font-bold font-ibm-plex-mono text-lg text-black hover:text-gray-700"
            >
              Index
            </a>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
              <Share2 className="w-3 h-3" />
              Shared conversation
            </span>
          </div>
          {session.title && (
            <h1 className="font-semibold font-ibm-plex-mono text-gray-900 mt-1 truncate">
              {session.title}
            </h1>
          )}
        </ContentContainer>
      </div>

      <div className="px-6 lg:px-8 py-8">
        <ContentContainer>
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
        </ContentContainer>
      </div>

      <div className="border-t border-gray-100 py-6">
        <ContentContainer>
          <div className="text-center">
            <p className="text-sm text-gray-500 mb-3">
              This is a shared conversation from Index.
            </p>
            <a
              href="/"
              className="inline-flex items-center px-4 py-2 rounded-full text-sm font-medium bg-[#041729] text-white hover:bg-[#0a2d4a] transition-colors"
            >
              Try Index
            </a>
          </div>
        </ContentContainer>
      </div>
    </div>
  );
}
