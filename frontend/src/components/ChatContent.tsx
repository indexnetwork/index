'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Send, Loader2, Sparkles, Pencil, Paperclip, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAIChat } from '@/contexts/AIChatContext';
import { useUploadServiceV2 } from '@/services/v2/upload.service';
import { useNotifications } from '@/contexts/NotificationContext';
import { useConnections, useSynthesis, useDiscover } from '@/contexts/APIContext';
import { validateFiles } from '@/lib/file-validation';
import ThinkingDropdown from '@/components/chat/ThinkingDropdown';
import InlineDiscoveryCard from '@/components/chat/InlineDiscoveryCard';
import DiscoveryCard from '@/components/DiscoveryCard';
import { ConnectionAction } from '@/components/ConnectionActions';
import { ContentContainer } from '@/components/layout';
import { StakesByUserResponse } from '@/lib/types';
import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface PendingFile {
  id: string;
  file: File;
}

export default function ChatContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionIdFromUrl = searchParams?.get('sessionId') ?? null;
  const { messages, isLoading, sendMessage, clearChat, loadSession, sessionId, sessionTitle, updateSessionTitle } = useAIChat();
  const uploadServiceV2 = useUploadServiceV2();
  const { error: showError } = useNotifications();
  const [input, setInput] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<PendingFile[]>([]);
  const [isUploadingFiles, setIsUploadingFiles] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);
  const justCreatedSessionRef = useRef<string | null>(null);

  // Discovery state
  const [discoverStakes, setDiscoverStakes] = useState<StakesByUserResponse[]>([]);
  const [syntheses, setSyntheses] = useState<Record<string, string>>({});
  const [synthesisLoading, setSynthesisLoading] = useState<Record<string, boolean>>({});
  const [discoveryLoading, setDiscoveryLoading] = useState(true);
  const fetchedSynthesesRef = useRef<Set<string>>(new Set());

  const connectionsService = useConnections();
  const synthesisService = useSynthesis();
  const discoverService = useDiscover();

  useEffect(() => {
    if (sessionIdFromUrl) {
      // Skip loading if we just created this session ourselves
      if (justCreatedSessionRef.current === sessionIdFromUrl) {
        justCreatedSessionRef.current = null;
        setSessionLoaded(true);
        return;
      }
      loadSession(sessionIdFromUrl).finally(() => setSessionLoaded(true));
    } else {
      clearChat();
      setSessionLoaded(true);
    }
  }, [sessionIdFromUrl, loadSession, clearChat]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Update URL when session changes
  useEffect(() => {
    if (sessionId && !sessionIdFromUrl) {
      // Mark that we just created this session to avoid reloading it
      justCreatedSessionRef.current = sessionId;
      router.replace(`/?sessionId=${sessionId}`, { scroll: false });
    }
  }, [sessionId, sessionIdFromUrl, router]);

  // Fetch discoveries for home state
  const fetchSynthesis = useCallback(async (targetUserId: string) => {
    if (fetchedSynthesesRef.current.has(targetUserId)) return;
    fetchedSynthesesRef.current.add(targetUserId);
    setSynthesisLoading(prev => ({ ...prev, [targetUserId]: true }));

    try {
      const response = await synthesisService.generateVibeCheck({ targetUserId });
      setSyntheses(prev => ({ ...prev, [targetUserId]: response.synthesis }));
    } catch (error) {
      console.error('Error fetching synthesis:', error);
      setSyntheses(prev => ({ ...prev, [targetUserId]: "" }));
    } finally {
      setSynthesisLoading(prev => ({ ...prev, [targetUserId]: false }));
    }
  }, [synthesisService]);

  const fetchDiscovery = useCallback(async () => {
    try {
      const discoverData = await discoverService.discoverUsers({
        excludeDiscovered: true,
        limit: 3
      });

      const transformedStakesData: StakesByUserResponse[] = (discoverData?.results || []).map(result => ({
        user: { id: result.user.id, name: result.user.name, avatar: result.user.avatar || '' },
        intents: (result.intents || []).map(stake => ({
          intent: { id: stake.intent.id, summary: stake.intent.summary, payload: stake.intent.payload, updatedAt: stake.intent.createdAt },
          totalStake: String(stake.totalStake),
          agents: []
        }))
      }));

      setDiscoverStakes(transformedStakesData);
      transformedStakesData.forEach(stake => fetchSynthesis(stake.user.id));
    } catch (error) {
      console.error('Error fetching discovery:', error);
    } finally {
      setDiscoveryLoading(false);
    }
  }, [discoverService, fetchSynthesis]);

  useEffect(() => {
    if (sessionLoaded && messages.length === 0 && !sessionIdFromUrl) {
      fetchDiscovery();
    }
  }, [sessionLoaded, messages.length, sessionIdFromUrl, fetchDiscovery]);

  const handleConnectionAction = useCallback(async (action: ConnectionAction, userId: string) => {
    try {
      switch (action) {
        case 'REQUEST': await connectionsService.requestConnection(userId); break;
        case 'SKIP': await connectionsService.skipConnection(userId); break;
        case 'ACCEPT': await connectionsService.acceptConnection(userId); break;
        case 'DECLINE': await connectionsService.declineConnection(userId); break;
        case 'CANCEL': await connectionsService.cancelConnection(userId); break;
      }
      setDiscoverStakes(prev => prev.filter(s => s.user.id !== userId));
    } catch (error) {
      console.error('Error handling connection action:', error);
      throw error;
    }
  }, [connectionsService]);

  const handleUserClick = useCallback((userId: string) => router.push(`/u/${userId}`), [router]);

  const canSend = input.trim() || selectedFiles.length > 0;
  const isBusy = isLoading || isUploadingFiles;

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    const list = Array.from(files);
    const validation = validateFiles(list, 'general');
    if (!validation.isValid) {
      showError(validation.message ?? 'Invalid file(s)');
      e.target.value = '';
      return;
    }
    setSelectedFiles((prev) => [
      ...prev,
      ...list.map((file) => ({ id: crypto.randomUUID(), file })),
    ]);
    e.target.value = '';
  }, [showError]);

  const removeFile = useCallback((id: string) => {
    setSelectedFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSend || isBusy) return;

    const message = input.trim();
    setInput('');

    let fileIds: string[] = [];
    const attachmentNames: string[] = [];
    if (selectedFiles.length > 0) {
      setIsUploadingFiles(true);
      try {
        const uploaded = await Promise.all(
          selectedFiles.map(({ file }) => uploadServiceV2.uploadFile(file))
        );
        fileIds = uploaded.map((f) => f.id);
        attachmentNames.push(...selectedFiles.map(({ file }) => file.name));
        setSelectedFiles([]);
      } catch (err) {
        console.error('[AI Chat] Upload failed:', err);
        showError(err instanceof Error ? err.message : 'Failed to upload file(s)');
        setIsUploadingFiles(false);
        return;
      }
      setIsUploadingFiles(false);
    }

    await sendMessage(
      message || 'Attached file(s).',
      fileIds.length ? fileIds : undefined,
      attachmentNames.length ? attachmentNames : undefined
    );
  };

  const displayTitle =
    sessionTitle ||
    (messages[0]?.role === 'user' ? (messages[0].content.slice(0, 50).trim() + (messages[0].content.length > 50 ? '…' : '')) : null) ||
    'New chat';

  const startEditingTitle = () => {
    if (!sessionId) return;
    setEditTitleValue(displayTitle);
    setIsEditingTitle(true);
    setTimeout(() => titleInputRef.current?.focus(), 0);
  };

  const saveTitle = async () => {
    setIsEditingTitle(false);
    const trimmed = editTitleValue.trim();
    if (!sessionId || !trimmed || trimmed === displayTitle) return;
    await updateSessionTitle(sessionId, trimmed);
  };

  if (!sessionLoaded) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Shared input form JSX
  const renderInputForm = () => (
    <>
      {selectedFiles.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {selectedFiles.map(({ id, file }) => (
            <span
              key={id}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-muted text-foreground text-sm font-ibm-plex-mono max-w-[200px]"
            >
              <span className="truncate" title={file.name}>
                {file.name}
              </span>
              <button
                type="button"
                onClick={() => removeFile(id)}
                className="shrink-0 p-0.5 rounded hover:bg-muted/80 text-muted-foreground hover:text-foreground focus:outline-none"
                aria-label={`Remove ${file.name}`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}
      <form onSubmit={handleSubmit} className="flex items-center gap-3 bg-muted rounded-full px-4 py-3">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".csv,.doc,.docx,.epub,.html,.json,.md,.pdf,.ppt,.pptx,.rtf,.tsv,.txt,.xls,.xlsx,.xml"
          onChange={handleFileSelect}
          className="sr-only"
          aria-label="Attach files"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={isBusy}
          onClick={() => fileInputRef.current?.click()}
          className="shrink-0 h-8 w-8 rounded-full text-muted-foreground hover:text-accent hover:bg-muted/80 p-0"
          title="Attach files"
          aria-label="Attach files"
        >
          <Paperclip className="h-4 w-4" />
        </Button>
        <Input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="What are you looking for?"
          disabled={isBusy}
          className="flex-1 font-ibm-plex-mono border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-muted-foreground"
        />
        <Button
          type="submit"
          size="icon"
          disabled={isBusy || !canSend}
          className="shrink-0 h-8 w-8 rounded-full bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed p-0"
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </form>
    </>
  );

  // HOME STATE - No messages yet
  if (messages.length === 0) {
    return (
      <div className="px-6 lg:px-8 py-6">
        <ContentContainer>
          <div className="my-6" />
          {renderInputForm()}

          {!discoveryLoading && discoverStakes.length > 0 && (
            <div className="mt-12">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4 font-ibm-plex-mono">
                Waiting for action
              </h3>
              <div className="space-y-4 divide-y divide-border">
                {discoverStakes.slice(0, 3).map((stake) => (
                  <DiscoveryCard
                    key={stake.user.id}
                    user={stake.user}
                    intents={stake.intents}
                    synthesis={syntheses[stake.user.id]}
                    synthesisLoading={synthesisLoading[stake.user.id]}
                    onUserClick={() => handleUserClick(stake.user.id)}
                    onAction={handleConnectionAction}
                  />
                ))}
              </div>
            </div>
          )}

          {discoveryLoading && (
            <div className="mt-8 flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}
        </ContentContainer>
      </div>
    );
  }

  // CONVERSATION MODE - Has messages
  return (
    <>
      {/* Sticky header - full width, min-h-[68px] matches ChatView header height */}
      <div className="sticky top-0 bg-background z-10 px-4 py-3 flex items-center gap-3 min-h-[68px]">
        <Sparkles className="h-5 w-5 shrink-0 text-accent" aria-hidden />
        {isEditingTitle ? (
          <input
            ref={titleInputRef}
            type="text"
            value={editTitleValue}
            onChange={(e) => setEditTitleValue(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur();
              }
              if (e.key === 'Escape') {
                setEditTitleValue(displayTitle);
                setIsEditingTitle(false);
              }
            }}
            className="flex-1 min-w-0 font-semibold font-ibm-plex-mono text-foreground bg-transparent border border-border rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent"
            placeholder="Conversation title"
          />
        ) : (
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <button
              type="button"
              onClick={startEditingTitle}
              disabled={!sessionId}
              className="text-left font-bold font-ibm-plex-mono text-lg text-foreground truncate hover:text-muted-foreground disabled:pointer-events-none focus:outline-none rounded"
            >
              {displayTitle}
            </button>
            {sessionId && (
              <button
                type="button"
                onClick={startEditingTitle}
                title="Rename conversation"
                className="shrink-0 p-1 rounded text-muted-foreground hover:text-accent hover:bg-muted focus:outline-none"
                aria-label="Rename conversation"
              >
                <Pencil className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Scrollable content */}
      <div className="px-6 lg:px-8 py-6 pb-32 flex-1">
        <ContentContainer>
          <div className="space-y-4">
              {messages.map((msg) => (
                <div key={msg.id}>
                  {msg.role === 'assistant' && msg.thinking && (
                    <div className="flex justify-start mb-2">
                      <div className="max-w-[80%]">
                        <ThinkingDropdown
                          thinking={msg.thinking}
                          isStreaming={msg.isStreaming}
                        />
                      </div>
                    </div>
                  )}
                  <div
                    className={cn(
                      'flex',
                      msg.role === 'user' ? 'justify-end' : 'justify-start'
                    )}
                  >
                    <div
                      className={cn(
                        'max-w-[80%] rounded-sm px-3 py-2',
                        msg.role === 'user'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-foreground'
                      )}
                    >
                      {msg.role === 'assistant' && (
                        <span className="text-[10px] uppercase tracking-wider text-accent/70 font-ibm-plex-mono mb-1 block">
                          AI Assistant
                        </span>
                      )}
                      <article className={cn(
                        "chat-markdown max-w-none",
                        msg.role === 'user' && 'chat-markdown-invert'
                      )}>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {msg.content}
                        </ReactMarkdown>
                      </article>
                      {msg.role === 'user' && msg.attachmentNames && msg.attachmentNames.length > 0 && (
                        <p className="text-xs opacity-90 mt-1.5 font-ibm-plex-mono">
                          Attached: {msg.attachmentNames.join(', ')}
                        </p>
                      )}
                      {msg.isStreaming && (
                        <span className="inline-block w-2 h-4 bg-current animate-pulse ml-1" />
                      )}
                    </div>
                  </div>
                  {/* Inline discovery cards */}
                  {msg.role === 'assistant' && msg.discoveries && msg.discoveries.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {msg.discoveries.map((discovery, idx) => (
                        <InlineDiscoveryCard key={`${discovery.candidateId}-${idx}`} discovery={discovery} />
                      ))}
                    </div>
                  )}
                </div>
              ))}
              <div ref={scrollRef} />
            </div>
        </ContentContainer>
      </div>

      {/* Fixed input at bottom */}
      <div className="fixed bottom-0 left-0 right-0 lg:left-64 z-20">
        <div className="px-6 lg:px-8 py-4">
          <ContentContainer>
            {renderInputForm()}
          </ContentContainer>
        </div>
      </div>
    </>
  );
}
