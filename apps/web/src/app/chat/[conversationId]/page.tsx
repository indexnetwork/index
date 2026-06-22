import { useEffect, useRef, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router';
import { Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import { ContentContainer } from '@/components/layout';
import UserAvatar from '@/components/UserAvatar';
import { useAuthContext } from '@/contexts/AuthContext';
import { useConversation } from '@/contexts/ConversationContext';

export default function NegotiationDetailPage() {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const { negotiations, messages, loadMessages } = useConversation();
  const [loading, setLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const conversation = negotiations.find((c) => c.id === conversationId);
  const conversationMessages = useMemo(() => messages.get(conversationId!) ?? [], [messages, conversationId]);

  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    loadMessages(conversationId, { limit: 100 }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [conversationId, loadMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversationMessages]);

  const participants = useMemo(() => conversation?.participants ?? [], [conversation]);

  // Build lookup: participantId -> { name (agent), ownerName (user), avatar }
  const participantInfo = useMemo(() => {
    const map = new Map<string, { agentName: string; ownerName: string; avatar: string | null }>();
    for (const p of participants) {
      map.set(p.participantId, {
        agentName: p.name ?? 'Agent',
        ownerName: p.ownerName ?? p.participantId.replace('agent:', ''),
        avatar: p.avatar,
      });
    }
    return map;
  }, [participants]);

  // Determine which participant represents "our" side (the current user's agent)
  const ownAgentId = user?.id ? `agent:${user.id}` : null;

  const formatTime = (createdAt: string) => {
    if (!createdAt) return '';
    return new Date(createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  };

  return (
    <>
      {/* Header */}
      <div className="sticky top-0 bg-white z-10 px-4 py-3 flex items-center gap-3 min-h-[68px]">
        <button onClick={() => navigate('/chat')} className="text-[#3D3D3D] hover:text-black transition-colors text-xl mr-2">&larr;</button>
        <div>
          <h2 className="font-ibm-plex-mono font-bold text-lg text-black">Negotiation</h2>
          <p className="text-xs text-gray-400">
            {participants.map((p) => {
              const info = participantInfo.get(p.participantId);
              return info ? `${info.agentName} (${info.ownerName})` : p.participantId;
            }).join(' vs ')}
          </p>
        </div>
      </div>

      {/* Messages */}
      <div className="px-6 lg:px-8 pb-32 flex-1">
        <ContentContainer>
          <div className="space-y-4">
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              </div>
            ) : conversationMessages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-[#3D3D3D]">
                <p className="text-sm">No messages in this negotiation</p>
              </div>
            ) : null}

            {conversationMessages.map((message, index) => {
              const isOwn = message.senderId === ownAgentId;
              const info = participantInfo.get(message.senderId);

              // Extract text content from message parts — use `message` field from data part, or text part
              const parts = message.parts as { kind?: string; text?: string; data?: { message?: string; assessment?: { reasoning?: string } } }[];
              const dataPart = parts?.find((p) => p.kind === 'data');
              const textPart = parts?.find((p) => p.text);
              const messageText = dataPart?.data?.message;
              const reasoningText = dataPart?.data?.assessment?.reasoning;
              const content = messageText ?? reasoningText ?? textPart?.text ?? '';
              const isInternal = !messageText && !!reasoningText;
              if (!content.trim()) return null;

              const prevMessage = conversationMessages[index - 1];
              const showTimestamp = index === 0 || (prevMessage && new Date(message.createdAt).getTime() - new Date(prevMessage.createdAt).getTime() > 300_000);

              return (
                <div key={message.id}>
                  {showTimestamp && message.createdAt && (
                    <div className="text-center text-xs text-gray-400 uppercase tracking-wider my-4">
                      {(() => {
                        const d = new Date(message.createdAt);
                        const now = new Date();
                        const yesterday = new Date(now);
                        yesterday.setDate(yesterday.getDate() - 1);

                        let label: string;
                        if (d.toDateString() === now.toDateString()) {
                          label = 'Today';
                        } else if (d.toDateString() === yesterday.toDateString()) {
                          label = 'Yesterday';
                        } else {
                          label = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
                        }
                        return `${label}, ${formatTime(message.createdAt)}`;
                      })()}
                    </div>
                  )}
                  <div className={cn('flex items-end gap-2', isOwn ? 'justify-end' : 'justify-start')}>
                    {!isOwn && info && (
                      <div className="flex-shrink-0">
                        <UserAvatar avatar={info.avatar} id={message.senderId} name={info.ownerName} size={32} />
                      </div>
                    )}
                    <div className="max-w-[70%]">
                      {!isOwn && info && (
                        <p className="text-xs text-gray-400 mb-1 ml-1">
                          {info.agentName} <span className="text-gray-300">for</span> {info.ownerName}
                        </p>
                      )}
                      <div
                        className={cn(
                          'rounded-2xl px-4 py-2',
                          isInternal
                            ? 'bg-transparent border border-dashed border-gray-300 text-gray-500 italic'
                            : isOwn
                              ? 'bg-gray-900 text-white'
                              : 'bg-gray-100 text-gray-900',
                        )}
                      >
                        {isInternal && (
                          <p className="not-italic text-[10px] uppercase tracking-wider text-gray-400 mb-1">
                            Internal assessment
                          </p>
                        )}
                        <article className={cn('text-sm', !isInternal && isOwn && 'text-white')}>
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
                        </article>
                      </div>
                      {isOwn && info && (
                        <p className="text-xs text-gray-400 mt-1 mr-1 text-right">
                          {info.agentName} <span className="text-gray-300">for</span> {info.ownerName}
                        </p>
                      )}
                    </div>
                    {isOwn && info && (
                      <div className="flex-shrink-0">
                        <UserAvatar avatar={info.avatar} id={message.senderId} name={info.ownerName} size={32} />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        </ContentContainer>
      </div>
    </>
  );
}

export const Component = NegotiationDetailPage;
