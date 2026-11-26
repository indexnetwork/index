import { SOCIAL_ICONS } from "@/components/SocialIcons";
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Link } from 'react-router';
import UserAvatar from '@/components/UserAvatar';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { formatChatClock, formatChatDayLabel, formatChatTime } from '@/lib/utils';
import { useAuthContext } from '@/contexts/AuthContext';
import { useConversation } from '@/contexts/ConversationContext';
import { useOpportunities, useUsers } from '@/contexts/APIContext';
import type { ChatContextOpportunity } from '@/services/opportunities';
import { buildChatTimeline } from './timeline';
import OpportunityEvent from './OpportunityEvent';
import { resolveSocials } from '@/lib/socials';
import type { SocialEntry } from '@/lib/socials';
import { log } from '@/lib/logger';
import { useInAppFrame } from '@/components/intents-home/appFrameContext';
import { Placeholder } from "@/components/ui/Placeholder";

const logger = log.ui.from('ChatView');

interface ChatViewProps {
  userId: string;
  userName: string;
  userAvatar?: string;
  initialGroupId?: string;
  /** Pre-fill the message input. */
  initialMessage?: string;
  /** If true, auto-send initialMessage when the conversation is ready instead of just prefilling. */
  autoSend?: boolean;
  /** Called once after the first message is successfully sent (used to accept a pending opportunity). */
  onFirstMessageSent?: () => void;
  onClose: () => void;
  onBack?: () => void;
  /** The conversations page is not a window, so its head has no close button. */
  noClose?: boolean;
  /** Third window on an intent: the window already has the name header. */
  embedded?: boolean;
  /** Match write-up shown above the thread, the way the desktop chat opens. */
  opener?: { headline?: string; detail?: string };
  /** Why these two were matched, shown in the thread until the chat has context of its own (nobody accepted yet). */
  fallbackContext?: ChatContextOpportunity[];
  /** Changes when the match with this person changes (an accept went through), so its context is read again. */
  contextKey?: string;
  /** Shown at the end of the thread, under the messages. */
  threadExtra?: React.ReactNode;
  /** Takes the composer's place while there is no chat to write in yet: accept and pass, say. */
  footer?: React.ReactNode;
  /** Only the conversation: no profile head and no match write-up (the pane around it shows who they are). */
  bare?: boolean;
  /** Told how many messages there are, e.g. for a count beside the "chat" tab. */
  onCount?: (count: number) => void;
}

/** What the chat's head shows of the other person, beyond their name and photo. */
interface PeerProfile {
  intro?: string | null;
  location?: string | null;
  socials?: SocialEntry[] | null;
}

/** Icons the "something else" pill rolls through: a new one on every press. */
const START_ICONS = ["✦", "⚡", "☀", "✺", "❖"];

type StartKey = "hi" | "call" | "other";

/** First lines for an empty chat, a pile per pill: every press picks another. Nothing goes until you press send. */
function startLines(n: string): Record<StartKey, string[]> {
  return {
    hi: [
      `hey ${n}! our agents matched us, so: hi 👋`,
      `hi ${n}, the robots introduced us. figured i'd say hi myself`,
      `hey ${n}, saw we got matched. how's it going?`,
      `hey hey ${n} 👋 how's your week been?`,
      `hi ${n}, tell me one thing that isn't on your profile`,
      `yo ${n}, our agents did the awkward part. hi!`,
      `hey ${n}! what are you deep in right now?`,
      `hi ${n} 🙂 nice when the agents get it right. how's it going?`,
      `${n}, hello from the other side of the match`,
      `hey ${n}, curious what you're up to these days`,
    ],
    call: [
      `hey ${n}, want to talk for 20 min this week?`,
      `${n}, up for a call sometime this week? i have questions`,
      `hi ${n}! quick call sometime soon?`,
      `hey ${n}, i'm better on voice than in DMs. free this week?`,
      `${n}, coffee chat but remote? 20 min this week?`,
      `hey ${n}, easier to just talk? 15 min whenever works`,
      `hi ${n}, got 20 min this week? happy to work around your timezone`,
      `${n}! let's talk before our agents schedule it for us`,
      `hi ${n}, want to just call? when works for you?`,
      `hey ${n}, call sometime? no rush`,
    ],
    other: [
      `hey ${n}, what are you obsessed with right now?`,
      `${n}, what's the most overrated thing in your space?`,
      `hi ${n}, what are you working on that nobody asks you about?`,
      `hey ${n}, what's been the hardest part of your week?`,
      `${n}, if you could meet anyone this month, who would it be?`,
      `hey ${n}, what's something you changed your mind on recently?`,
      `${n}, best thing you've read or watched lately? need a new rabbit hole`,
      `hey ${n}, what got you into this in the first place?`,
      `hi ${n}, want to trade notes on what's been working?`,
      `${n}, what's one thing you wish someone would just build already?`,
      `hi ${n}, what's keeping you busy lately?`,
    ],
  };
}

/** A random index below `size` that isn't `last`. */
function rollOther(size: number, last: number) {
  if (size < 2) return 0;
  let next = Math.floor(Math.random() * (size - 1));
  if (next >= last && last >= 0) next += 1;
  return next;
}

function normText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function conversationIdForPeer(
  conversations: { id: string; participants?: { participantId: string; participantType: string }[] }[],
  userId: string,
  initialGroupId?: string,
) {
  if (initialGroupId) return initialGroupId;
  return conversations.find((conversation) =>
    conversation.participants?.some((participant) => participant.participantType === "user" && participant.participantId === userId),
  )?.id ?? null;
}

export default function ChatView({ userId, userName, userAvatar, initialGroupId, initialMessage, autoSend = false, onFirstMessageSent, onClose, onBack, noClose = false, embedded = false, opener, fallbackContext, contextKey, threadExtra, footer, bare = false, onCount }: ChatViewProps) {
  const { user } = useAuthContext();
  const opportunitiesService = useOpportunities();
  const usersService = useUsers();
  const {
    messages: allMessages,
    conversations,
    sendMessage: conversationSend,
    loadMessages,
    loadSessionHistory,
    sessionHistory,
    getOrCreateDm,
    markConversationRead,
    hideConversation,
  } = useConversation();

  const startingConversationId = conversationIdForPeer(conversations, userId, initialGroupId);
  const [conversationId, setConversationId] = useState<string | null>(startingConversationId);
  const [messageText, setMessageText] = useState(autoSend ? '' : (initialMessage ?? ''));
  const hasAutoSentRef = useRef(false);
  const hasFiredFirstMessageRef = useRef(false);
  const [messagesLoading, setMessagesLoading] = useState(
    () => startingConversationId != null && !allMessages.has(startingConversationId),
  );
  const [contextLoading, setContextLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [acceptedOpportunities, setAcceptedOpportunities] = useState<ChatContextOpportunity[]>([]);
  // The chat context is written by a model on a cold cache, so it takes seconds: the
  // thread never waits on it. Its cards join the timeline when they arrive.
  const [acceptedOpportunitiesLoading, setAcceptedOpportunitiesLoading] = useState(true);
  const [peer, setPeer] = useState<PeerProfile | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const headMoreRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inFrame = useInAppFrame();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const scrolledConversationRef = useRef<string | null>(null);
  const scrolledCountRef = useRef(0);
  // The pill that last filled the box, and what it put there: a pill only replaces its own text, never yours.
  const [startPicked, setStartPicked] = useState<{ key: StartKey; text: string } | null>(null);
  const startLastRef = useRef<Record<StartKey, number>>({ hi: -1, call: -1, other: -1 });
  const [startIcon, setStartIcon] = useState({ glyph: START_ICONS[0], rolls: 0 });

  // Route param changes reuse this instance. Adjust before paint so the previous
  // thread never flashes, and keep a cached thread on screen instead of a spinner.
  const [trackedUserId, setTrackedUserId] = useState(userId);
  if (trackedUserId !== userId) {
    const nextId = conversationIdForPeer(conversations, userId, initialGroupId);
    setTrackedUserId(userId);
    setConversationId(nextId);
    setMessagesLoading(nextId != null && !allMessages.has(nextId));
    setContextLoading(true);
    setMessageText(autoSend ? '' : (initialMessage ?? ''));
    setShowMenu(false);
    setAcceptedOpportunities([]);
    setAcceptedOpportunitiesLoading(true);
    setPeer(null);
    setStartPicked(null);
    hasAutoSentRef.current = false;
    hasFiredFirstMessageRef.current = false;
  }

  const messages = useMemo(
    () => (conversationId ? allMessages.get(conversationId) ?? [] : []),
    [conversationId, allMessages],
  );
  useEffect(() => { onCount?.(messages.length); }, [messages.length, onCount]);
  const conversationSummary = conversationId
    ? conversations.find((conversation) => conversation.id === conversationId) ?? null
    : null;
  const via = conversationSummary?.via ?? [];
  const latestVia = via[0] ?? null;
  const history = conversationId ? sessionHistory.get(conversationId) : undefined;

  useEffect(() => {
    if (!conversationId || (conversationSummary?.unreadCount ?? 0) <= 0) return;
    void markConversationRead(conversationId);
  }, [conversationId, conversationSummary?.unreadCount, markConversationRead]);

  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    opportunitiesService
      .getChatContext(userId, { signal: controller.signal })
      .then((list) => {
        if (!controller.signal.aborted) setAcceptedOpportunities(list);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        logger.error('Failed to load chat context', { error: err });
      })
      .finally(() => {
        if (!controller.signal.aborted) setAcceptedOpportunitiesLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [userId, opportunitiesService, contextKey]);

  // Who they are, for the head of the chat. The name and photo are already here, so a failed read just leaves those.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    usersService.getUserProfile(userId)
      .then((profile) => { if (!cancelled) setPeer(profile as PeerProfile); })
      .catch((err: unknown) => { if (!cancelled) logger.error('Failed to load chat peer', { error: err }); });
    return () => { cancelled = true; };
  }, [userId, usersService]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);

  // Load messages when we have a conversationId
  useEffect(() => {
    const cid = initialGroupId ?? conversationId;
    if (cid) {
      loadMessages(cid).finally(() => setMessagesLoading(false));
    } else {
      // No conversation yet: clear the initial loading state via microtask
      // to satisfy react-hooks/set-state-in-effect.
      queueMicrotask(() => setMessagesLoading(false));
    }
  }, [initialGroupId, conversationId, loadMessages]);

  // Get or create DM conversation
  useEffect(() => {
    let mounted = true;
    const init = async () => {
      try {
        const conv = await getOrCreateDm(userId);
        if (!mounted) return;
        const cid = initialGroupId ?? conv.id;
        if (cid) setConversationId(cid);
      } catch (err) {
        logger.error('DM init error', { error: err });
      } finally {
        if (mounted) setContextLoading(false);
      }
    };

    init();
    return () => { mounted = false; };
  }, [userId, initialGroupId, getOrCreateDm]);

  useEffect(() => {
    const sameConversation = scrolledConversationRef.current === conversationId;
    const grew = scrolledCountRef.current > 0 && messages.length > scrolledCountRef.current;
    scrolledConversationRef.current = conversationId;
    scrolledCountRef.current = messages.length;
    scrollToBottom(sameConversation && grew ? 'smooth' : 'auto');
  }, [messages, conversationId, scrollToBottom]);

  // The conversation is open once the DM exists. Land in the composer then,
  // including after accept navigates here (autoFocus alone loses that race).
  useEffect(() => {
    if (contextLoading) return;
    inputRef.current?.focus();
  }, [contextLoading, userId]);

  // Auto-resize textarea (handles both typing and prefilled values)
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    // scrollHeight leaves out the border; add it back so one more line never needs a scrollbar
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }, [messageText]);

  // Auto-send initialMessage once the conversation is ready
  useEffect(() => {
    if (!autoSend) return;
    if (hasAutoSentRef.current) return;
    if (!initialMessage?.trim()) return;
    if (contextLoading) return;

    const text = initialMessage.trim();
    hasAutoSentRef.current = true;
    (async () => {
      setSending(true);
      try {
        if (conversationId) {
          await conversationSend(conversationId, [{ text }]);
        } else {
          const conv = await getOrCreateDm(userId);
          setConversationId(conv.id);
          await conversationSend(conv.id, [{ text }]);
          loadSessionHistory(conv.id);
        }
        if (!hasFiredFirstMessageRef.current) {
          hasFiredFirstMessageRef.current = true;
          onFirstMessageSent?.();
        }
      } catch (err) {
        hasAutoSentRef.current = false;
        logger.error('Auto-send error', { error: err });
      } finally {
        setSending(false);
      }
    })();
  }, [autoSend, contextLoading, conversationId, initialMessage, conversationSend, getOrCreateDm, userId, loadSessionHistory, onFirstMessageSent]);

  const handleSend = useCallback(async () => {
    if (!messageText.trim() || sending) return;
    const text = messageText.trim();
    setMessageText('');
    setSending(true);
    try {
      if (conversationId) {
        await conversationSend(conversationId, [{ text }]);
      } else {
        const conv = await getOrCreateDm(userId);
        setConversationId(conv.id);
        await conversationSend(conv.id, [{ text }]);
        loadSessionHistory(conv.id);
      }
      if (!hasFiredFirstMessageRef.current) {
        hasFiredFirstMessageRef.current = true;
        onFirstMessageSent?.();
      }
      inputRef.current?.focus();
    } catch (err) {
      logger.error('Send error', { error: err });
      setMessageText(text);
    } finally {
      setSending(false);
    }
  }, [conversationId, userId, messageText, sending, conversationSend, getOrCreateDm, loadSessionHistory, onFirstMessageSent]);

  const handleKeyPress = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }, [handleSend]);

  const firstName = userName.split(" ")[0];
  const lines = useMemo(() => startLines(firstName), [firstName]);
  // Each press puts a different line from that pill's pile in the box, but never over something you typed.
  const fillStart = useCallback((key: StartKey) => {
    if (messageText.trim() && messageText !== startPicked?.text) return;
    const pile = lines[key];
    const next = rollOther(pile.length, startLastRef.current[key]);
    startLastRef.current[key] = next;
    const text = pile[next];
    if (key === 'other') {
      setStartIcon((icon) => {
        const pool = START_ICONS.filter((glyph) => glyph !== icon.glyph);
        return { glyph: pool[Math.floor(Math.random() * pool.length)], rolls: icon.rolls + 1 };
      });
    }
    setStartPicked({ key, text });
    setMessageText(text);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(text.length, text.length);
    });
  }, [messageText, startPicked, lines]);
  // Only while the chat is empty: the first message sent takes them away.
  const showStarts = !messagesLoading && messages.length === 0 && !footer && !sending && !(autoSend && initialMessage?.trim());
  const startPressed = (key: StartKey) => startPicked?.key === key && messageText === startPicked.text;
  const starts = showStarts ? (
    <div className="pl-dm-starts">
      <button type="button" className="pl-dm-start" aria-pressed={startPressed('hi')} onClick={() => fillStart('hi')}>say hi</button>
      <button type="button" className="pl-dm-start" aria-pressed={startPressed('call')} onClick={() => fillStart('call')}>suggest a call</button>
      <button type="button" className="pl-dm-start" aria-pressed={startPressed('other')} onClick={() => fillStart('other')}>
        <span key={startIcon.rolls} className={startIcon.rolls ? "pl-dm-start-ic roll" : "pl-dm-start-ic"} aria-hidden="true">{startIcon.glyph}</span>
        something else
      </button>
    </div>
  ) : null;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.length === 1 || e.key === 'Backspace') inputRef.current?.focus();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setShowMenu(false);
    };
    if (showMenu) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMenu]);

  const timeline = useMemo(
    () => buildChatTimeline(messages, acceptedOpportunities.length ? acceptedOpportunities : fallbackContext ?? []),
    [messages, acceptedOpportunities, fallbackContext],
  );
  // Each match's intent, as this viewer sees it, and which match the chat opened on.
  const hasContext = timeline.some((item) => item.type === 'opportunity');
  const renderOpportunities = (opportunities: ChatContextOpportunity[]) => opportunities.map((opportunity) => (
    <OpportunityEvent
      key={`opp-${opportunity.opportunityId}`}
      opportunity={opportunity}
    />
  ));
  // What the two of you were matched on, newest first, listed under their profile.
  const headOpportunities = useMemo(() => {
    const fromChat = acceptedOpportunities.length > 0;
    const when = (o: ChatContextOpportunity) => Date.parse(o.foundAt ?? o.acceptedAt ?? "") || 0;
    return [...(fromChat ? acceptedOpportunities : fallbackContext ?? [])]
      .sort((a, b) => when(b) - when(a))
      .map((opportunity) => ({
        opportunity,
        status: opportunity.status === "accepted" ? "accepted"
          : opportunity.status === "pending" ? (fromChat ? "accepted" : "awaiting you")
          : opportunity.status === "rejected" ? "not a fit"
          : opportunity.status === "expired" ? "missed"
          : "in progress",
      }));
  }, [acceptedOpportunities, fallbackContext]);
  const [allOpportunities, setAllOpportunities] = useState(false);
  const [openOpportunityId, setOpenOpportunityId] = useState<string | null>(null);
  const shownOpportunities = allOpportunities ? headOpportunities : headOpportunities.slice(0, 2);
  const peerIntro = peer?.intro?.trim() ?? "";
  const peerLocation = peer?.location?.trim() ?? "";
  const peerSocials = useMemo(() => resolveSocials(peer?.socials), [peer?.socials]);
  const hasHeadMore = Boolean(peerIntro || peerLocation || peerSocials.length || headOpportunities.length);
  const [bioOpen, setBioOpen] = useState(false);

  // The head is their full profile at the top of the thread. Scroll down and it
  // becomes a one-line bar (photo, name, close) in a single step, never part way;
  // scroll back to the top, or press the bar, and the profile is back.
  const hasThreadExtra = threadExtra != null && threadExtra !== false;
  const hasFooter = footer != null;
  useEffect(() => {
    const head = headRef.current, more = headMoreRef.current, thread = logRef.current;
    if (!head || !thread) return;
    let full = 0, small = 0, moreFull = 0;
    const set = (on: boolean) => {
      head.style.setProperty("--p", on ? "1" : "0");
      head.classList.toggle("small", on);
      if (more) {
        more.style.maxHeight = on ? "0px" : `${moreFull}px`;
        more.style.opacity = on ? "0" : "1";
      }
      // The bar keeps the room the profile had, so the thread under it never jumps
      // and the scroll position means the same thing in both states.
      head.style.marginBottom = on ? `${Math.max(0, full - small)}px` : "0px";
    };
    const wanted = () => thread.scrollTop > (head.classList.contains("small") ? 2 : 8);
    const measure = () => {
      const was = head.classList.contains("small");
      head.classList.add("measuring");
      head.style.marginBottom = "0px";
      head.style.setProperty("--p", "1");
      if (more) more.style.maxHeight = "0px";
      small = head.offsetHeight;
      head.style.setProperty("--p", "0");
      if (more) more.style.maxHeight = "none";
      full = head.offsetHeight;
      moreFull = more?.scrollHeight ?? 0;
      // Whatever the state should be now is set without animating: only a scroll animates it.
      set(was);
      set(wanted());
      void head.offsetHeight;
      head.classList.remove("measuring");
    };
    const onScroll = () => {
      const on = wanted();
      if (on !== head.classList.contains("small")) set(on);
    };
    const row = head.querySelector<HTMLElement>(".pl-dmh-row");
    const onRow = (event: MouseEvent) => {
      if ((event.target as HTMLElement).closest("a") || !head.classList.contains("small")) return;
      thread.scrollTo({ top: 0, behavior: "smooth" });
    };
    thread.addEventListener("scroll", onScroll, { passive: true });
    row?.addEventListener("click", onRow);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(thread);
    measure();
    return () => { thread.removeEventListener("scroll", onScroll); row?.removeEventListener("click", onRow); observer?.disconnect(); };
  }, [timeline, hasHeadMore, peerIntro, bioOpen, messagesLoading, acceptedOpportunitiesLoading, conversationId, hasThreadExtra, hasFooter, headOpportunities, allOpportunities, openOpportunityId]);

  const openerHeadline = opener?.headline?.trim() ?? "";
  const openerBody = opener?.detail?.trim() || openerHeadline;
  const showOpenerHeadline = Boolean(openerHeadline && openerBody && normText(openerHeadline) !== normText(openerBody));

  // Signed in on desktop: drawn like the agent chat beside Home (plain.css .pl-agent-*).
  if (inFrame && !embedded) {
    const linkOut = { a: ({ href, children }: { href?: string; children?: React.ReactNode }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> };
    return (
      <div className="pl pl-agent pl-dm">
        <div className="pl-agent-log pl-dm-tl" ref={logRef}>
          {/* Who they are is the head; why you're talking is the history under it. */}
          {!bare && <div className="pl-dmh" ref={headRef}>
            {!noClose && <button type="button" className="pl-win-close pl-dmh-x" aria-label="close (esc)" title="close (esc)" onClick={onClose}>×</button>}
            <div className="pl-dmh-row">
              <Link to={`/u/${userId}`} className="pl-dmh-face"><UserAvatar avatar={userAvatar} id={userId} name={userName} size={72} /></Link>
              <div className="pl-dm-who">
                <Link to={`/u/${userId}`} className="pl-dm-name">{userName}</Link>
                  {/* Only in the small bar: at full size the profile stands alone. */}
                {conversationSummary?.createdAt && (
                  <div className="pl-dm-sub">chat started {formatChatDayLabel(conversationSummary.createdAt)}</div>
                )}
              </div>
            </div>
            {hasHeadMore && (
              <div className="pl-dmh-more" ref={headMoreRef}>
                {peerLocation && <div className="pl-dmh-loc">{peerLocation}</div>}
                {peerSocials.length > 0 && (
                  <div className="pl-dmh-meta">
                    {peerSocials.map((social) => (
                      <a key={social.href} className="pl-dmh-soc" href={social.href} target="_blank" rel="noopener noreferrer">
                        {SOCIAL_ICONS[social.platform]}
                        <span>{social.handle}</span>
                      </a>
                    ))}
                  </div>
                )}
                {peerIntro && <p className={bioOpen ? "pl-dmh-bio" : "pl-dmh-bio clamp"}>{peerIntro}</p>}
                {peerIntro.length > 120 && (
                  <button type="button" className="pl-more" onClick={() => setBioOpen((open) => !open)}>{bioOpen ? "less" : "more"}</button>
                )}
                {shownOpportunities.length > 0 && (
                  <div className="pl-dmh-opps">
                    <h3>opportunities</h3>
                    {shownOpportunities.map(({ opportunity, status }) => {
                      const open = openOpportunityId === opportunity.opportunityId;
                      return (
                        <div key={opportunity.opportunityId} className={open ? "pl-dmh-opp on" : "pl-dmh-opp"}>
                          <button type="button" className="pl-row" aria-expanded={open} onClick={() => setOpenOpportunityId(open ? null : opportunity.opportunityId)}>
                            <span className="pl-dmh-opp-t">{opportunity.headline || opportunity.personalizedSummary}</span>
                            <span className="pl-dmh-opp-s">{status}</span>
                            <span className="pl-dmh-opp-c">{open ? "▾" : "›"}</span>
                          </button>
                          {open && <div className="pl-dmh-opp-b"><OpportunityEvent opportunity={opportunity} /></div>}
                        </div>
                      );
                    })}
                    {headOpportunities.length > 2 && (
                      <button type="button" className="pl-more" onClick={() => setAllOpportunities((all) => !all)}>
                        {allOpportunities ? "see less" : `see more (${headOpportunities.length - 2})`}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>}
          {history?.hasPreviousSession && conversationId && history.loadingPrevious && <Placeholder.Thread label="loading earlier messages" />}
          {openerBody && !bare && (
            <div className="pl-dm-opener">
              {showOpenerHeadline && <b>{openerHeadline}</b>}
              <span>{openerBody}</span>
            </div>
          )}
          {messagesLoading && <Placeholder.Thread label="loading messages" />}

          {timeline.map((item, index) => {
            if (item.type === 'opportunity') return null;
            const message = item.message;
            const previousMessage = [...timeline.slice(0, index)].reverse().find((candidate) => candidate.type === 'message')?.message;
            const isOwn = message.senderId === user?.id;
            const content = (message.parts as { text?: string }[] | undefined)?.find((p) => p.text)?.text ?? '';
            if (!content.trim()) return null;
            const day = message.createdAt ? formatChatDayLabel(message.createdAt) : "";
            const prevDay = previousMessage?.createdAt ? formatChatDayLabel(previousMessage.createdAt) : "";
            // The day marker above already says the date, so each message shows its time only.
            const clock = message.createdAt ? formatChatTime(message.createdAt) : "";
            return (
              <div key={message.id} className="pl-dm-item">
                {day && day !== prevDay && <div className="pl-dm-day"><span>{day}</span></div>}
                <div className={isOwn ? "pl-agent-line mine" : "pl-agent-line"}>
                  <div className={isOwn ? "pl-agent-bubble mine" : "pl-agent-bubble"}>
                    <div className="pl-agent-meta">{isOwn ? "you" : userName.split(" ")[0]}{clock && <> · <time>{clock}</time></>}</div>
                    <div className="pl-agent-md"><ReactMarkdown remarkPlugins={[remarkGfm]} components={linkOut}>{content}</ReactMarkdown></div>
                  </div>
                </div>
              </div>
            );
          })}
          {threadExtra}
          <div ref={messagesEndRef} />
        </div>

        {footer ? <div className="pl-agent-compose pl-dm-decide">{footer}</div> : (
          <form className="pl-agent-compose" onSubmit={(e) => { e.preventDefault(); handleSend(); }}>
            {starts}
            <textarea
              ref={inputRef}
              rows={2}
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              onKeyDown={handleKeyPress}
              placeholder={`write to ${userName.split(" ")[0]}…`}
              disabled={sending}
              autoFocus
              aria-label={`Message ${userName}`}
            />
            <button type="submit" className="go" disabled={!messageText.trim() || sending}>send</button>
          </form>
        )}
      </div>
    );
  }

  return (
    <>
      {!embedded && (
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #000", display: "flex", gap: 12, alignItems: "center" }}>
          <Link to={`/u/${userId}`} style={{ display: "flex" }}><UserAvatar avatar={userAvatar} id={userId} name={userName} size={34} /></Link>
          <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
            <Link to={`/u/${userId}`} style={{ fontFamily: "var(--amiga-title)", fontSize: 15, fontWeight: 600, color: "#000", textDecoration: "none" }}>{userName}</Link>
            {(conversationSummary?.createdAt || latestVia) && (
              <div style={{ fontFamily: "var(--mac-mono)", fontSize: 10, color: "var(--ink-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {conversationSummary?.createdAt ? `chat started ${formatChatDayLabel(conversationSummary.createdAt)}` : ""}
                {conversationSummary?.createdAt && latestVia ? " · " : ""}
                {latestVia ? <Link to={`/i/${latestVia.intentId}`} style={{ color: "inherit", textDecoration: "none" }}>{latestVia.title}</Link> : null}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="mac-scroll" style={{ flex: 1, overflowY: "auto", padding: "14px 16px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {history?.hasPreviousSession && conversationId && history.loadingPrevious && (
              <Placeholder.Thread label="loading earlier messages" />
            )}
            {openerBody && !hasContext && (
              <div style={{ border: "1px solid var(--ink-4)", background: "#FBFAF7", padding: "12px 14px", display: "grid", gap: 7, marginBottom: 6 }}>
                {showOpenerHeadline && (
                  <span style={{ fontFamily: "var(--mac-sans)", fontSize: 13.5, fontWeight: 600, color: "#000", lineHeight: 1.35, letterSpacing: -0.1 }}>{openerHeadline}</span>
                )}
                <span style={{ fontFamily: "var(--mac-sans)", fontSize: 13, lineHeight: 1.5, color: "var(--ink-2)" }}>{openerBody}</span>
              </div>
            )}
            {messagesLoading && <Placeholder.Thread label="loading messages" />}

            {timeline.map((item, index) => {
                if (item.type === 'opportunity') return renderOpportunities(item.opportunities);

                const message = item.message;
                const previousMessage = [...timeline.slice(0, index)].reverse().find((candidate) => candidate.type === 'message')?.message;
                const isOwn = message.senderId === user?.id;
                const textPart = (message.parts as { text?: string }[] | undefined)?.find((p) => p.text)?.text;
                const content = textPart ?? '';
                if (!content.trim()) return null;
                const day = message.createdAt ? formatChatDayLabel(message.createdAt) : "";
                const prevDay = previousMessage?.createdAt ? formatChatDayLabel(previousMessage.createdAt) : "";
                const clock = message.createdAt ? formatChatClock(message.createdAt) : "";

                return (
                  <div key={message.id}>
                    {day && day !== prevDay && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, margin: index === 0 ? "0 0 2px" : "6px 0 2px" }}>
                        <span style={{ flex: 1, height: 1, background: "var(--ink-4)" }} />
                        <span style={{ fontFamily: "var(--mac-mono)", fontSize: 10, color: "var(--ink-3)", letterSpacing: 0.3 }}>{day}</span>
                        <span style={{ flex: 1, height: 1, background: "var(--ink-4)" }} />
                      </div>
                    )}
                    <div style={{ display: "flex", alignItems: "baseline", gap: 6, justifyContent: isOwn ? "flex-end" : "flex-start" }}>
                      {isOwn && clock && <time style={{ fontFamily: "var(--mac-mono)", fontSize: 9, color: "var(--ink-3)", letterSpacing: 0.2, whiteSpace: "nowrap" }}>{clock}</time>}
                      <div className="wb-chat" style={{
                        maxWidth: "82%",
                        border: "1px solid #000",
                        background: isOwn ? "#000" : "#fff",
                        color: isOwn ? "#fff" : "#000",
                        padding: "8px 11px",
                        fontFamily: "var(--mac-sans)", fontSize: 13, lineHeight: 1.4,
                        boxShadow: isOwn ? "none" : "inset 1px 1px 0 #fff, inset -1px -1px 0 var(--ink-3)",
                      }}>
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            a: ({ href, children }) => (
                              <a href={href} target="_blank" rel="noopener noreferrer">
                                {children}
                              </a>
                            ),
                          }}
                        >
                          {content}
                        </ReactMarkdown>
                      </div>
                      {!isOwn && clock && <time style={{ fontFamily: "var(--mac-mono)", fontSize: 9, color: "var(--ink-3)", letterSpacing: 0.2, whiteSpace: "nowrap" }}>{clock}</time>}
                    </div>
                  </div>
                );
            })}
            <div ref={messagesEndRef} />
          </div>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} style={{ borderTop: "1px solid #000", background: "#fff", padding: "7px 12px 8px", display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
        {starts}
        <textarea
          ref={inputRef}
          rows={1}
          value={messageText}
          onChange={(e) => setMessageText(e.target.value)}
          onKeyDown={handleKeyPress}
          placeholder={embedded ? `message ${userName}…` : "write a message…"}
          disabled={sending}
          autoFocus
          style={{ flex: 1, minWidth: 0, border: "none", outline: "none", resize: "none", fontFamily: "var(--mac-sans)", fontSize: 13, lineHeight: 1.4, background: "transparent", padding: "4px 0" }}
        />
        <button type="submit" disabled={!messageText.trim() || sending} aria-label="send" title="send" style={{ background: "none", border: "none", padding: 0, cursor: messageText.trim() ? "pointer" : "default", color: messageText.trim() ? "#111" : "#b9b3a4" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="square">
            <line x1="12" y1="20" x2="12" y2="5" />
            <polyline points="5,12 12,5 19,12" />
          </svg>
        </button>
      </form>
    </>
  );
}
