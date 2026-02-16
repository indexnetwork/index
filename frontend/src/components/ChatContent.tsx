'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUp, Loader2, Pencil, Paperclip, X, Globe, Zap, Type, ChevronDown, Lock, ChevronLeft, Bot } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MentionsTextInput } from '@/components/MentionsInput';
import { useXMTP } from '@/contexts/XMTPContext';
import { useUploadServiceV2 } from '@/services/v2/upload.service';
import { useNotifications } from '@/contexts/NotificationContext';
import { useOpportunities } from '@/contexts/APIContext';
import { validateFiles } from '@/lib/file-validation';
import InlineDiscoveryCard from '@/components/chat/InlineDiscoveryCard';
import { ContentContainer } from '@/components/layout';
import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useIndexFilter } from '@/contexts/IndexFilterContext';
import { useIndexesState } from '@/contexts/IndexesContext';
import { useSuggestions } from '@/hooks/useSuggestions';
import Image from 'next/image';
import { getAvatarUrl } from '@/lib/file-utils';
import { mentionsToMarkdownLinks } from '@/lib/mentions';
import type { HomeViewSection, HomeViewCardItem } from '@/services/opportunities';
import { DynamicIcon, type IconName } from 'lucide-react/dynamic';
import { useTypewriter } from '@/hooks/useTypewriter';
import { GroupMessageKind } from '@xmtp/browser-sdk';
import type { Group } from '@xmtp/browser-sdk';
import { useAIChatSessions } from '@/contexts/AIChatSessionsContext';
import { parseContent, type OpportunityCardContent } from '@/lib/content-types';

/**
 * When true, use GET /opportunities/home for dynamic sections; when false, use static/mock data.
 */
const USE_HOME_API = true;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiscoveryOpportunity {
  candidateId: string;
  candidateName?: string;
  candidateAvatar?: string;
  score: number;
  sourceDescription: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  attachmentNames?: string[];
  discoveries?: DiscoveryOpportunity[];
}

interface PendingFile {
  id: string;
  file: File;
}

interface ChatContentProps {
  sessionIdParam?: string | null;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/**
 * Ensure blockquote lines are always followed by a blank line so that
 * subsequent non-blockquote text isn't absorbed via markdown "lazy continuation".
 * e.g. "> Retrieving...\nHere is..." -> "> Retrieving...\n\nHere is..."
 */
function normalizeBlockquotes(text: string): string {
  return text.replace(/^(>.*)\n(?!>|\n)/gm, '$1\n\n');
}

function AssistantMessageContent({ content, isStreaming }: { content: string; isStreaming: boolean }) {
  const { text: displayedContent, isAnimating } = useTypewriter(
    normalizeBlockquotes(mentionsToMarkdownLinks(content)),
    isStreaming,
    22, // ms per character during streaming
    8,  // ms per character catch-up after stream ends
  );

  // Show cursor while streaming (even before first token) or during catch-up
  const showCursor = isStreaming || isAnimating;

  // No text yet -- render a standalone blinking cursor
  if (!displayedContent && showCursor) {
    return <span className="inline-block w-2 h-4 bg-current animate-pulse" />;
  }

  return (
    <div className={showCursor ? 'chat-markdown-typing' : undefined}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {displayedContent}
      </ReactMarkdown>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ChatContent({ sessionIdParam }: ChatContentProps) {
  const router = useRouter();
  const sessionIdFromUrl = sessionIdParam ?? null;

  // XMTP context
  const {
    client,
    isReady: xmtpReady,
    agentAddress,
    homeFeed,
    createAIChat,
    streamAIResponse,
  } = useXMTP();

  const { refetchSessions } = useAIChatSessions();

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
  const navigatingToHomeRef = useRef(false);
  const [isIndexDropdownOpen, setIsIndexDropdownOpen] = useState(false);

  // Local message + conversation state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [sessionTitle, setSessionTitle] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const conversationRef = useRef<Group | null>(null);
  // Keep conversationId in a ref so callbacks can read the latest value
  const conversationIdRef = useRef<string | null>(null);
  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  const opportunitiesService = useOpportunities();

  // Home view from API (when USE_HOME_API)
  const [homeViewData, setHomeViewData] = useState<{ sections: HomeViewSection[]; meta: { totalOpportunities: number; totalSections: number } } | null>(null);
  const [homeViewLoading, setHomeViewLoading] = useState(false);
  const [homeActionLoadingByOpportunity, setHomeActionLoadingByOpportunity] = useState<Record<string, boolean>>({});

  // XMTP home feed messages (structured content from the agent)
  const [homeFeedMessages, setHomeFeedMessages] = useState<OpportunityCardContent[]>([]);
  const [homeFeedLoading, setHomeFeedLoading] = useState(false);

  // Index filter
  const { selectedIndexIds, setSelectedIndexIds } = useIndexFilter();
  const { indexes } = useIndexesState();
  const selectedIndexId = selectedIndexIds.length === 1 ? selectedIndexIds[0] : null;

  // Suggestions (for conversation mode)
  const { suggestions } = useSuggestions({
    indexId: selectedIndexId,
    enabled: messages.length > 0,
  });

  const handleIndexSelect = useCallback((indexId: string | null) => {
    if (indexId === null) {
      setSelectedIndexIds([]);
    } else {
      setSelectedIndexIds([indexId]);
    }
  }, [setSelectedIndexIds]);

  // Fetch home view when on home (no messages) and USE_HOME_API
  useEffect(() => {
    if (!USE_HOME_API || messages.length > 0) {
      setHomeViewData(null);
      return;
    }
    setHomeViewLoading(true);
    opportunitiesService
      .getHomeView({ indexId: selectedIndexId ?? undefined, limit: 50 })
      .then((res) => {
        setHomeViewData(res);
        setHomeViewLoading(false);
      })
      .catch(() => {
        setHomeViewData(null);
        setHomeViewLoading(false);
      });
  }, [USE_HOME_API, messages.length, selectedIndexId, opportunitiesService]);

  // Load structured messages from XMTP home feed group
  useEffect(() => {
    if (!homeFeed || messages.length > 0) {
      setHomeFeedMessages([]);
      return;
    }

    let cancelled = false;
    const loadHomeFeedMessages = async () => {
      setHomeFeedLoading(true);
      try {
        await homeFeed.sync();
        const xmtpMessages = await homeFeed.messages();
        const cards: OpportunityCardContent[] = [];

        for (const msg of xmtpMessages) {
          if (msg.kind !== GroupMessageKind.Application) continue;
          if (typeof msg.content !== 'string' || !msg.content.trim()) continue;

          const parsed = parseContent(msg.content);
          if (parsed && parsed.type === 'opportunity_card') {
            cards.push(parsed);
          }
        }

        if (!cancelled) {
          setHomeFeedMessages(cards);
        }
      } catch (err) {
        console.error('[ChatContent] Failed to load home feed messages:', err);
      } finally {
        if (!cancelled) {
          setHomeFeedLoading(false);
        }
      }
    };

    loadHomeFeedMessages();
    return () => { cancelled = true; };
  }, [homeFeed, messages.length]);

  const handleSuggestionClick = useCallback((suggestion: { label: string; type: string; followupText?: string; prefill?: string }) => {
    if (suggestion.type === 'prompt' && suggestion.prefill) {
      setInput(suggestion.prefill);
      inputRef.current?.focus();
    } else if (suggestion.type === 'direct' && suggestion.followupText) {
      setInput(suggestion.followupText);
      // Auto-submit after a brief delay
      setTimeout(() => {
        inputRef.current?.form?.requestSubmit();
      }, 50);
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Load XMTP messages from a Group
  // ---------------------------------------------------------------------------
  const loadMessagesFromGroup = useCallback(async (group: Group) => {
    try {
      await group.sync();
      const xmtpMessages = await group.messages();
      const chatMessages: ChatMessage[] = [];
      const clientInboxId = client?.inboxId;

      for (const msg of xmtpMessages) {
        // Skip membership change messages
        if (msg.kind !== GroupMessageKind.Application) continue;
        // Only process text content
        if (typeof msg.content !== 'string' || !msg.content.trim()) continue;

        const isUser = msg.senderInboxId === clientInboxId;
        chatMessages.push({
          id: msg.id,
          role: isUser ? 'user' : 'assistant',
          content: msg.content,
          timestamp: msg.sentAt,
          isStreaming: false,
        });
      }

      setMessages(chatMessages);
    } catch (err) {
      console.error('[ChatContent] Failed to load XMTP messages:', err);
    }
  }, [client]);

  // ---------------------------------------------------------------------------
  // Load existing session from URL param (XMTP conversation ID)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!xmtpReady || !client) return;

    if (sessionIdFromUrl) {
      // Skip loading if we already have this conversation in memory
      if (conversationIdRef.current === sessionIdFromUrl) {
        setSessionLoaded(true);
        return;
      }

      const loadConversation = async () => {
        try {
          const conversation = await client.conversations.getConversationById(sessionIdFromUrl);
          if (conversation && 'name' in conversation) {
            const group = conversation as Group;
            conversationRef.current = group;
            setConversationId(group.id);
            setSessionTitle(group.name || null);
            await loadMessagesFromGroup(group);
          } else {
            console.warn('[ChatContent] Conversation not found or not a group:', sessionIdFromUrl);
          }
        } catch (err) {
          console.error('[ChatContent] Failed to load conversation:', err);
        } finally {
          setSessionLoaded(true);
        }
      };

      loadConversation();
    } else {
      navigatingToHomeRef.current = true;
      // Clear chat state
      setMessages([]);
      setConversationId(null);
      setSessionTitle(null);
      conversationRef.current = null;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      setSessionLoaded(true);
    }
  }, [sessionIdFromUrl, xmtpReady, client, loadMessagesFromGroup]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Update URL when conversation changes: push so back from /d/id returns to /
  useEffect(() => {
    if (navigatingToHomeRef.current) {
      navigatingToHomeRef.current = false;
      return;
    }
    if (conversationId && !sessionIdFromUrl) {
      router.push(`/d/${conversationId}`);
    }
  }, [conversationId, sessionIdFromUrl, router]);

  const handleHomeOpportunityAction = useCallback(async (
    opportunityId: string,
    action: 'accepted' | 'rejected',
    fallbackUserId?: string,
    viewerRole?: string
  ) => {
    setHomeActionLoadingByOpportunity((prev) => ({ ...prev, [opportunityId]: true }));
    try {
      // Introducers "send" the intro (latent -> pending) instead of accepting
      const isIntroducer = viewerRole === 'introducer';
      const effectiveStatus = isIntroducer && action === 'accepted' ? 'pending' : action;

      const result = await opportunitiesService.updateStatus(opportunityId, effectiveStatus);

      // Only redirect to chat for non-introducer accepts (introducers don't get a chat)
      const counterpartUserId = result.chat?.counterpartUserId ?? fallbackUserId;
      if (action === 'accepted' && !isIntroducer && counterpartUserId) {
        const channelId = result.chat?.channelId;
        const query = channelId ? `?channelId=${encodeURIComponent(channelId)}` : '';
        router.push(`/u/${counterpartUserId}/chat${query}`);
      }
      setHomeViewData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          sections: prev.sections
            .map((section) => ({
              ...section,
              items: section.items.filter((item) => item.opportunityId !== opportunityId),
            }))
            .filter((section) => section.items.length > 0),
        };
      });
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Failed to update opportunity');
    } finally {
      setHomeActionLoadingByOpportunity((prev) => ({ ...prev, [opportunityId]: false }));
    }
  }, [opportunitiesService, router, showError]);

  // ---------------------------------------------------------------------------
  // Parse SSE stream from backend
  // ---------------------------------------------------------------------------
  const processSSEStream = useCallback(async (
    stream: ReadableStream,
    assistantMessageId: string,
  ) => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6));

              switch (event.type) {
                case 'token':
                  setMessages(prev => prev.map(msg =>
                    msg.id === assistantMessageId
                      ? { ...msg, content: msg.content + event.content }
                      : msg
                  ));
                  break;
                case 'done':
                  setMessages(prev => prev.map(msg => {
                    if (msg.id !== assistantMessageId) return msg;
                    // Keep streamed content; fall back to event.response if empty
                    const finalContent = msg.content.trim()
                      ? msg.content
                      : (event.response || msg.content);
                    return { ...msg, content: finalContent, isStreaming: false };
                  }));
                  // Update session title if provided by backend
                  if (event.title) {
                    setSessionTitle(event.title);
                    // Also update the XMTP group name for persistence
                    if (conversationRef.current) {
                      conversationRef.current.updateName(event.title).catch((err: unknown) => {
                        console.error('[ChatContent] Failed to update group name:', err);
                      });
                    }
                  }
                  // Refetch sessions after streaming completes
                  refetchSessions();
                  break;
                case 'error':
                  setMessages(prev => prev.map(msg =>
                    msg.id === assistantMessageId
                      ? { ...msg, content: `Error: ${event.message}`, isStreaming: false }
                      : msg
                  ));
                  break;
              }
            } catch (e) {
              console.error('Failed to parse SSE event:', e);
            }
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        console.log('[ChatContent] SSE stream aborted');
      } else {
        console.error('[ChatContent] SSE stream error:', err);
        setMessages(prev => prev.map(msg =>
          msg.id === assistantMessageId
            ? { ...msg, content: 'Failed to get response. Please try again.', isStreaming: false }
            : msg
        ));
      }
    }
  }, [refetchSessions]);

  // ---------------------------------------------------------------------------
  // Send message
  // ---------------------------------------------------------------------------
  const sendMessage = useCallback(async (
    message: string,
    fileIds?: string[],
    attachmentNames?: string[],
  ) => {
    if (!client || !agentAddress) return;

    const displayContent = message.trim() || (fileIds?.length ? 'Attached file(s).' : '');
    if (!displayContent) return;

    // Add user message to local state
    const userMessageId = crypto.randomUUID();
    const userMessage: ChatMessage = {
      id: userMessageId,
      role: 'user',
      content: displayContent,
      timestamp: new Date(),
      ...(attachmentNames?.length ? { attachmentNames } : {}),
    };
    setMessages(prev => [...prev, userMessage]);

    // Add placeholder for assistant response
    const assistantMessageId = crypto.randomUUID();
    setMessages(prev => [...prev, {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isStreaming: true,
    }]);

    setIsLoading(true);
    abortControllerRef.current = new AbortController();

    try {
      let activeConvId = conversationIdRef.current;
      let activeGroup = conversationRef.current;

      // If no conversation yet, create a new AI chat group
      if (!activeConvId || !activeGroup) {
        const group = await createAIChat(agentAddress);
        activeGroup = group;
        activeConvId = group.id;
        conversationRef.current = group;
        setConversationId(activeConvId);
        // Show new session in sidebar immediately
        refetchSessions();
      }

      // Send user message to XMTP group
      await activeGroup.sendText(displayContent);

      // Open SSE sideband for real-time streaming tokens
      const stream = await streamAIResponse(
        activeConvId,
        displayContent,
        fileIds?.length ? fileIds : undefined,
        selectedIndexId ?? undefined,
      );

      // Process the SSE stream
      await processSSEStream(stream, assistantMessageId);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('[ChatContent] Send aborted');
      } else {
        console.error('[ChatContent] Send error:', error);
        setMessages(prev => prev.map(msg =>
          msg.id === assistantMessageId
            ? { ...msg, content: 'Failed to get response. Please try again.', isStreaming: false }
            : msg
        ));
      }
    } finally {
      setIsLoading(false);
    }
  }, [client, agentAddress, createAIChat, streamAIResponse, selectedIndexId, processSSEStream, refetchSessions]);

  // ---------------------------------------------------------------------------
  // Clear chat (go home)
  // ---------------------------------------------------------------------------
  const clearChat = useCallback(() => {
    setMessages([]);
    setConversationId(null);
    setSessionTitle(null);
    conversationRef.current = null;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

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
        inputRef.current?.focus();
        return;
      }
      setIsUploadingFiles(false);
    }

    await sendMessage(
      message || 'Attached file(s).',
      fileIds.length ? fileIds : undefined,
      attachmentNames.length ? attachmentNames : undefined
    );
    inputRef.current?.focus();
  };

  // Auto-focus input on keydown/paste anywhere
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.length === 1 || e.key === 'Backspace') {
        inputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const displayTitle = sessionTitle || 'Untitled chat';

  const startEditingTitle = () => {
    if (!conversationId) return;
    setEditTitleValue(displayTitle);
    setIsEditingTitle(true);
    setTimeout(() => titleInputRef.current?.focus(), 0);
  };

  const saveTitle = async () => {
    setIsEditingTitle(false);
    const trimmed = editTitleValue.trim();
    if (!conversationId || !trimmed || trimmed === displayTitle) return;
    // Update local state
    setSessionTitle(trimmed);
    // Persist to XMTP group name
    if (conversationRef.current) {
      try {
        await conversationRef.current.updateName(trimmed);
      } catch (err) {
        console.error('[ChatContent] Failed to update group name:', err);
      }
    }
    refetchSessions();
  };

  if (!sessionLoaded) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  // Shared input form JSX
  const renderInputForm = () => (
    <>
      <div className="bg-[linear-gradient(to_bottom,transparent_50%,#ffffff_50%)]">
        {selectedFiles.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {selectedFiles.map(({ id, file }) => (
              <span
                key={id}
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-gray-100 text-gray-800 text-sm font-ibm-plex-mono max-w-[200px]"
              >
                <span className="truncate" title={file.name}>
                  {file.name}
                </span>
                <button
                  type="button"
                  onClick={() => removeFile(id)}
                  className="shrink-0 p-0.5 rounded hover:bg-gray-200 text-gray-500 hover:text-gray-800 focus:outline-none"
                  aria-label={`Remove ${file.name}`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}
        <form onSubmit={handleSubmit} className="flex items-end gap-3 bg-[#F8F8F8] border border-[#E9E9E9] rounded-[32px] px-4 py-3">
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
            className="shrink-0 h-8 w-8 rounded-full text-gray-500 hover:text-[#4091BB] hover:bg-gray-200 p-0"
            title="Attach files"
            aria-label="Attach files"
          >
            <Paperclip className="h-4 w-4" />
          </Button>
          <MentionsTextInput
            value={input}
            onChange={setInput}
            placeholder="What are you looking for?"
            disabled={isBusy}
            autoFocus
            inputRef={inputRef}
            suggestionsAbove
          />
          <Button
            type="submit"
            size="icon"
            disabled={isBusy || !canSend}
            className="shrink-0 h-8 w-8 rounded-full bg-[#041729] text-white hover:bg-[#0a2d4a] disabled:opacity-50 disabled:cursor-not-allowed p-0"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowUp className="h-4 w-4" />
            )}
          </Button>
        </form>
      </div>
      <div className="pb-3 bg-white" />
    </>
  );

  // HOME STATE - No messages yet
  if (messages.length === 0) {
    const selectedIndex = indexes.find(i => selectedIndexIds.includes(i.id));

    // API-driven home view (dynamic sections with Lucide icons)
    if (USE_HOME_API) {
      if (homeViewLoading || (homeViewData && homeViewData.sections.length > 0)) {
        return (
          <div className="px-6 lg:px-8 min-h-full">
            <ContentContainer className="text-left">
              <div className="mt-12 mb-6">
                <h1 className="text-[28px] font-bold text-black font-ibm-plex-mono text-center">
                  Find your others
                </h1>
              </div>
              <div className="bg-[linear-gradient(to_bottom,transparent_50%,#ffffff_50%)]">
              <form onSubmit={handleSubmit} className="flex items-end gap-3 bg-[#F8F8F8] border border-[#E9E9E9] rounded-[32px] px-4 py-3 mb-6">
                <input ref={fileInputRef} type="file" multiple accept=".csv,.doc,.docx,.epub,.html,.json,.md,.pdf,.ppt,.pptx,.rtf,.tsv,.txt,.xls,.xlsx,.xml" onChange={handleFileSelect} className="sr-only" />
                <Button type="button" variant="ghost" size="icon" disabled={isBusy} onClick={() => fileInputRef.current?.click()} className="shrink-0 h-8 w-8 rounded-full text-gray-500 hover:text-[#4091BB] hover:bg-gray-200 p-0" title="Attach files"><Paperclip className="h-4 w-4" /></Button>
                <MentionsTextInput value={input} onChange={setInput} placeholder="What are you looking for?" disabled={isBusy} autoFocus inputRef={inputRef} />
                {indexes.length > 0 && (
                  <div className="relative flex-shrink-0">
                    <button type="button" onClick={() => setIsIndexDropdownOpen(!isIndexDropdownOpen)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium text-black transition-colors hover:bg-gray-100">
                      {selectedIndexIds.includes('my-network') || selectedIndex?.permissions?.joinPolicy === 'invite_only' ? <Lock className="w-4 h-4" /> : selectedIndex ? <Globe className="w-4 h-4" /> : <Globe className="w-4 h-4" />}
                      <span>{selectedIndexIds.includes('my-network') ? 'My network' : selectedIndex?.title || 'Everywhere'}</span>
                      <ChevronDown className={cn('w-4 h-4 transition-transform', isIndexDropdownOpen && 'rotate-180')} />
                    </button>
                    {isIndexDropdownOpen && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setIsIndexDropdownOpen(false)} />
                        <div className="absolute right-0 top-full mt-2 z-20 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[160px]">
                          <button type="button" onClick={() => { handleIndexSelect(null); setIsIndexDropdownOpen(false); }} className={cn('w-full px-3 py-2 text-left text-sm text-[#3D3D3D] hover:bg-gray-50 flex items-center gap-2', selectedIndexIds.length === 0 && 'text-gray-900 font-medium')}><Globe className="w-4 h-4" /> Everywhere</button>
                          <button type="button" onClick={() => { handleIndexSelect('my-network'); setIsIndexDropdownOpen(false); }} className={cn('w-full px-3 py-2 text-left text-sm text-[#3D3D3D] hover:bg-gray-50 flex items-center gap-2', selectedIndexIds.includes('my-network') && 'text-gray-900 font-medium')}><Lock className="w-4 h-4" /> My network</button>
                          <div className="my-1 border-t border-gray-200" />
                          {[...indexes].sort((a, b) => ((a.permissions?.joinPolicy === 'invite_only') ? 1 : 0) - ((b.permissions?.joinPolicy === 'invite_only') ? 1 : 0) || (a.title || '').localeCompare(b.title || '')).map((index) => (
                            <button key={index.id} type="button" onClick={() => { handleIndexSelect(index.id); setIsIndexDropdownOpen(false); }} className={cn('w-full px-3 py-2 text-left text-sm text-[#3D3D3D] hover:bg-gray-50 flex items-center gap-2', selectedIndexIds.includes(index.id) && 'text-gray-900 font-medium')}>
                              {index.permissions?.joinPolicy === 'invite_only' ? <Lock className="w-4 h-4 flex-shrink-0" /> : <Globe className="w-4 h-4 flex-shrink-0" />}
                              <span className="truncate">{index.title}</span>
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
                <Button type="submit" size="icon" disabled={isBusy || !canSend} className="shrink-0 h-8 w-8 rounded-full bg-[#041729] text-white hover:bg-[#0a2d4a] disabled:opacity-50 disabled:cursor-not-allowed p-0">{isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}</Button>
              </form>
              </div>
              <div className="pb-3 bg-white" />
              {homeViewLoading ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
                </div>
              ) : homeViewData?.sections.map((section) => (
                <div key={section.id} className={section.id === homeViewData.sections[0]?.id ? 'mt-12' : 'mt-6'}>
                  <h3 className="text-xs font-semibold text-[#3D3D3D] uppercase tracking-wider mb-3 font-ibm-plex-mono text-left flex items-center gap-2">
                    <span className="w-3.5 h-3.5 shrink-0 [&_svg]:w-3.5 [&_svg]:h-3.5">
                      <DynamicIcon name={section.iconName as IconName} />
                    </span>
                    {section.title}
                  </h3>
                  <div className="space-y-3">
                    {section.items.map((item: HomeViewCardItem) => (
                      <div key={item.opportunityId} className="bg-[#F8F8F8] rounded-md p-4">
                        <div className="flex items-center justify-between gap-2 mb-3">
                          <div className="flex items-center gap-2 min-w-0 cursor-pointer" onClick={() => router.push(`/u/${item.userId}`)}>
                            <div className="w-8 h-8 rounded-full overflow-hidden bg-gray-300/80 flex items-center justify-center shrink-0">
                              <Image src={getAvatarUrl({ id: item.userId, name: item.name, avatar: item.avatar })} alt="" width={32} height={32} className="w-full h-full object-cover" />
                            </div>
                            <div className="min-w-0">
                              <h4 className="font-bold text-gray-900 text-sm hover:underline">{item.name}</h4>
                              <p className="text-[11px] text-[#3D3D3D]">{item.mutualIntentsLabel ?? '1 mutual intent'}</p>
                            </div>
                          </div>
                          <div className="flex gap-1.5 shrink-0">
                            <button
                              type="button"
                              disabled={!!homeActionLoadingByOpportunity[item.opportunityId]}
                              className="bg-[#041729] text-white px-3 py-1.5 rounded-sm text-xs font-medium hover:bg-[#0a2d4a] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                              onClick={() => handleHomeOpportunityAction(item.opportunityId, 'accepted', item.userId, item.viewerRole)}
                            >
                              {homeActionLoadingByOpportunity[item.opportunityId] ? 'Working...' : (item.primaryActionLabel ?? 'Start Chat')}
                            </button>
                            <button
                              type="button"
                              disabled={!!homeActionLoadingByOpportunity[item.opportunityId]}
                              className="bg-transparent border border-gray-400 text-[#3D3D3D] px-3 py-1.5 rounded-sm text-xs font-medium hover:bg-gray-200 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                              onClick={() => handleHomeOpportunityAction(item.opportunityId, 'rejected', item.userId, item.viewerRole)}
                            >
                              {item.secondaryActionLabel ?? 'Skip'}
                            </button>
                          </div>
                        </div>
                        <div className="text-[14px] text-[#3D3D3D] leading-relaxed [&_a]:text-[#4091BB] [&_a]:underline [&_a]:underline-offset-1">
                          <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>{item.mainText}</ReactMarkdown>
                        </div>
                        {item.narratorChip && (
                          <div className="mt-3">
                            <div
                              className={cn("inline-flex items-center gap-2.5 px-3 py-1 bg-[#F0F0F0] rounded-md", item.narratorChip.userId && "cursor-pointer hover:bg-[#E8E8E8] transition-colors")}
                              onClick={item.narratorChip.userId ? () => router.push(`/u/${item.narratorChip!.userId}`) : undefined}
                            >
                              <div className="relative shrink-0">
                                {item.narratorChip.name === 'Index' ? (
                                  <Bot className="w-7 h-7 text-[#3D3D3D]" />
                                ) : (
                                  <Image src={getAvatarUrl({ name: item.narratorChip.name, avatar: item.narratorChip.avatar ?? null })} alt="" width={28} height={28} className="w-7 h-7 rounded-full object-cover" />
                                )}
                              </div>
                              <span className="text-[13px] text-[#3D3D3D]"><span className={cn("font-semibold", item.narratorChip.userId && "hover:underline")}>{item.narratorChip.name}:</span> {item.narratorChip.text}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {/* XMTP home feed cards (structured messages from the agent) */}
              {homeFeedMessages.length > 0 && (
                <div className="mt-6">
                  <h3 className="text-xs font-semibold text-[#3D3D3D] uppercase tracking-wider mb-3 font-ibm-plex-mono text-left flex items-center gap-2">
                    <span className="w-3.5 h-3.5 shrink-0 [&_svg]:w-3.5 [&_svg]:h-3.5">
                      <Zap className="w-3.5 h-3.5" />
                    </span>
                    From your feed
                  </h3>
                  <div className="space-y-3">
                    {homeFeedMessages.map((card) => (
                      <div key={card.opportunityId} className="bg-[#F8F8F8] rounded-md p-4">
                        <div className="flex items-center justify-between gap-2 mb-3">
                          <div className="flex items-center gap-2 min-w-0">
                            {card.actors[0] && (
                              <div className="flex items-center gap-2 min-w-0 cursor-pointer" onClick={() => router.push(`/u/${card.actors[0].userId}`)}>
                                <div className="w-8 h-8 rounded-full overflow-hidden bg-gray-300/80 flex items-center justify-center shrink-0">
                                  <Image
                                    src={getAvatarUrl({ id: card.actors[0].userId, name: card.actors[0].name, avatar: card.actors[0].avatar ?? null })}
                                    alt=""
                                    width={32}
                                    height={32}
                                    className="w-full h-full object-cover"
                                  />
                                </div>
                                <div className="min-w-0">
                                  <h4 className="font-bold text-gray-900 text-sm hover:underline">{card.actors[0].name}</h4>
                                  <p className="text-[11px] text-[#3D3D3D]">{card.actors[0].mutualIntentsLabel ?? '1 mutual intent'}</p>
                                </div>
                              </div>
                            )}
                          </div>
                          <div className="flex gap-1.5 shrink-0">
                            <button
                              type="button"
                              disabled={!!homeActionLoadingByOpportunity[card.opportunityId]}
                              className="bg-[#041729] text-white px-3 py-1.5 rounded-sm text-xs font-medium hover:bg-[#0a2d4a] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                              onClick={() => handleHomeOpportunityAction(card.opportunityId, 'accepted', card.actors[0]?.userId)}
                            >
                              {homeActionLoadingByOpportunity[card.opportunityId] ? 'Working...' : 'Start Chat'}
                            </button>
                            <button
                              type="button"
                              disabled={!!homeActionLoadingByOpportunity[card.opportunityId]}
                              className="bg-transparent border border-gray-400 text-[#3D3D3D] px-3 py-1.5 rounded-sm text-xs font-medium hover:bg-gray-200 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                              onClick={() => handleHomeOpportunityAction(card.opportunityId, 'rejected', card.actors[0]?.userId)}
                            >
                              Skip
                            </button>
                          </div>
                        </div>
                        {card.headline && (
                          <p className="text-sm font-semibold text-gray-900 mb-1">{card.headline}</p>
                        )}
                        <div className="text-[14px] text-[#3D3D3D] leading-relaxed">
                          <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>{card.summary}</ReactMarkdown>
                        </div>
                        {card.narratorChip && (
                          <div className="mt-3">
                            <div className="inline-flex items-center gap-2.5 px-3 py-1 bg-[#F0F0F0] rounded-md">
                              <Bot className="w-7 h-7 text-[#3D3D3D] shrink-0" />
                              <span className="text-[13px] text-[#3D3D3D]">{card.narratorChip}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {homeFeedLoading && !homeViewLoading && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                </div>
              )}
            </ContentContainer>
          </div>
        );
      }
    }


    // Empty state -- no opportunities to show
    return (
      <div className="px-6 lg:px-8 bg-[#FDFDFD] min-h-full">
        <ContentContainer className="text-left">
          <div className="mt-12 mb-6">
            <h1 className="text-[28px] font-bold text-black font-ibm-plex-mono text-center">
              Find your others
            </h1>
          </div>
          <div className="bg-[linear-gradient(to_bottom,transparent_50%,#ffffff_50%)]">
          <form onSubmit={handleSubmit} className="flex items-end gap-3 bg-[#F8F8F8] border border-[#E9E9E9] rounded-[32px] px-4 py-3">
            <input ref={fileInputRef} type="file" multiple accept=".csv,.doc,.docx,.epub,.html,.json,.md,.pdf,.ppt,.pptx,.rtf,.tsv,.txt,.xls,.xlsx,.xml" onChange={handleFileSelect} className="sr-only" />
            <Button type="button" variant="ghost" size="icon" disabled={isBusy} onClick={() => fileInputRef.current?.click()} className="shrink-0 h-8 w-8 rounded-full text-gray-500 hover:text-[#4091BB] hover:bg-gray-200 p-0" title="Attach files"><Paperclip className="h-4 w-4" /></Button>
            <MentionsTextInput value={input} onChange={setInput} placeholder="What are you looking for?" disabled={isBusy} autoFocus inputRef={inputRef} />
            {indexes.length > 0 && (
              <div className="relative flex-shrink-0">
                <button type="button" onClick={() => setIsIndexDropdownOpen(!isIndexDropdownOpen)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium text-black transition-colors hover:bg-gray-100">
                  {selectedIndexIds.includes('my-network') || selectedIndex?.permissions?.joinPolicy === 'invite_only' ? <Lock className="w-4 h-4" /> : <Globe className="w-4 h-4" />}
                  <span>{selectedIndexIds.includes('my-network') ? 'My network' : selectedIndex?.title || 'Everywhere'}</span>
                  <ChevronDown className={cn('w-4 h-4 transition-transform', isIndexDropdownOpen && 'rotate-180')} />
                </button>
                {isIndexDropdownOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setIsIndexDropdownOpen(false)} />
                    <div className="absolute right-0 top-full mt-2 z-20 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[160px]">
                      <button type="button" onClick={() => { handleIndexSelect(null); setIsIndexDropdownOpen(false); }} className={cn('w-full px-3 py-2 text-left text-sm text-[#3D3D3D] hover:bg-gray-50 flex items-center gap-2', selectedIndexIds.length === 0 && 'text-gray-900 font-medium')}><Globe className="w-4 h-4" /> Everywhere</button>
                      <button type="button" onClick={() => { handleIndexSelect('my-network'); setIsIndexDropdownOpen(false); }} className={cn('w-full px-3 py-2 text-left text-sm text-[#3D3D3D] hover:bg-gray-50 flex items-center gap-2', selectedIndexIds.includes('my-network') && 'text-gray-900 font-medium')}><Lock className="w-4 h-4" /> My network</button>
                      <div className="my-1 border-t border-gray-200" />
                      {[...indexes].sort((a, b) => ((a.permissions?.joinPolicy === 'invite_only') ? 1 : 0) - ((b.permissions?.joinPolicy === 'invite_only') ? 1 : 0) || (a.title || '').localeCompare(b.title || '')).map((index) => (
                        <button key={index.id} type="button" onClick={() => { handleIndexSelect(index.id); setIsIndexDropdownOpen(false); }} className={cn('w-full px-3 py-2 text-left text-sm text-[#3D3D3D] hover:bg-gray-50 flex items-center gap-2', selectedIndexIds.includes(index.id) && 'text-gray-900 font-medium')}>
                          {index.permissions?.joinPolicy === 'invite_only' ? <Lock className="w-4 h-4 flex-shrink-0" /> : <Globe className="w-4 h-4 flex-shrink-0" />}
                          <span className="truncate">{index.title}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            <Button type="submit" size="icon" disabled={isBusy || !canSend} className="shrink-0 h-8 w-8 rounded-full bg-[#041729] text-white hover:bg-[#0a2d4a] disabled:opacity-50 disabled:cursor-not-allowed p-0">{isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}</Button>
          </form>
          </div>
          <div className="pb-3 bg-white" />
          {selectedFiles.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {selectedFiles.map(({ id, file }) => (
                <span key={id} className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-gray-100 text-gray-800 text-sm font-ibm-plex-mono max-w-[200px]">
                  <span className="truncate" title={file.name}>{file.name}</span>
                  <button type="button" onClick={() => removeFile(id)} className="shrink-0 p-0.5 rounded hover:bg-gray-200 text-gray-500 hover:text-gray-800"><X className="w-3.5 h-3.5" /></button>
                </span>
              ))}
            </div>
          )}
          <div className="mt-20 flex flex-col items-center text-center pb-12">
            <Image
              src="/collab.png"
              alt="Connections illustration"
              width={280}
              height={245}
              className="mb-8 opacity-80"
            />
            <h2 className="text-lg font-semibold text-gray-900 font-ibm-plex-mono mb-3">
              No opportunities yet
            </h2>
            <p className="text-sm text-[#3D3D3D] max-w-sm leading-relaxed">
              Opportunities appear when your intents align with others in the network.
              Create intents that describe what you&apos;re looking for, and the system
              will surface meaningful connections when there&apos;s a match.
            </p>
          </div>
        </ContentContainer>
      </div>
    );
  }

  // CONVERSATION MODE - Has messages
  return (
    <>
      {/* Sticky header - full width, min-h-[68px] matches ChatView header height */}
      <div className="sticky top-0 bg-white z-10 px-4 py-3 flex items-center gap-3 min-h-[68px]">
        <button
          type="button"
          onClick={() => {
            clearChat();
            router.push('/');
          }}
          className="p-1 -ml-1 rounded-md hover:bg-gray-100 text-gray-600 hover:text-black transition-colors shrink-0"
          aria-label="Back to home"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
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
            className="flex-1 min-w-0 font-semibold font-ibm-plex-mono text-gray-900 bg-transparent border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-[#4091BB]/30 focus:border-[#4091BB]"
            placeholder="Conversation title"
          />
        ) : (
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <button
              type="button"
              onClick={startEditingTitle}
              disabled={!conversationId}
              className="text-left font-bold font-ibm-plex-mono text-lg text-black truncate hover:text-gray-700 disabled:pointer-events-none focus:outline-none rounded"
            >
              {displayTitle}
            </button>
            {conversationId && (
              <button
                type="button"
                onClick={startEditingTitle}
                title="Rename conversation"
                className="shrink-0 p-1 rounded text-gray-500 hover:text-[#4091BB] hover:bg-gray-100 focus:outline-none"
                aria-label="Rename conversation"
              >
                <Pencil className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Scrollable content */}
      <div className="px-6 lg:px-8 pb-32 flex-1">
        <ContentContainer>
          <div className="space-y-4">
              {messages.map((msg) => (
                <div key={msg.id}>
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
                          ? 'bg-[#041729] text-white'
                          : 'bg-gray-100 text-gray-900'
                      )}
                    >
                      {msg.role === 'assistant' && (
                        <span className="text-[10px] uppercase tracking-wider text-[#4091BB]/70 mb-1 block">
                          Index
                        </span>
                      )}
                      <article className={cn(
                        "chat-markdown max-w-none",
                        msg.role === 'user' && 'chat-markdown-invert',
                        msg.isStreaming && 'chat-markdown-streaming'
                      )}>
                        {msg.role === 'assistant' ? (
                          <AssistantMessageContent
                            content={msg.content}
                            isStreaming={msg.isStreaming ?? false}
                          />
                        ) : (
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {mentionsToMarkdownLinks(msg.content)}
                          </ReactMarkdown>
                        )}
                      </article>
                      {msg.role === 'user' && msg.attachmentNames && msg.attachmentNames.length > 0 && (
                        <p className="text-xs opacity-90 mt-1.5">
                          Attached: {msg.attachmentNames.join(', ')}
                        </p>
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
      <div className="sticky bottom-0 z-20">
        <div className="px-6 lg:px-8">
          <ContentContainer>
            {/* Suggestion chips - always visible in conversation */}
            {suggestions.length > 0 && (
              <div className="mb-3 flex items-center gap-2 overflow-x-auto scrollbar-hide">
                {suggestions.map((suggestion, index) => (
                  <button
                    key={index}
                    onClick={() => handleSuggestionClick(suggestion)}
                    disabled={isBusy}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-white border border-gray-200 rounded-full text-xs text-[#3D3D3D] hover:bg-gray-50 hover:border-gray-300 transition-colors shadow-sm disabled:opacity-50 whitespace-nowrap flex-shrink-0"
                  >
                    {suggestion.type === 'direct' ? (
                      <Zap className="w-3 h-3 text-gray-400" />
                    ) : (
                      <Type className="w-3 h-3 text-gray-400" />
                    )}
                    {suggestion.label}
                  </button>
                ))}
              </div>
            )}
            {renderInputForm()}
          </ContentContainer>
        </div>
      </div>
    </>
  );
}
