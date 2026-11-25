import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";

import UserAvatar from "@/components/UserAvatar";
import NegotiationConversation from "@/components/NegotiationConversation";
import { Placeholder } from "@/components/ui/Placeholder";
import { useNetworks, useOpportunities, useUsers } from "@/contexts/APIContext";
import { useConversation } from "@/contexts/ConversationContext";
import { useIntentsData } from "@/contexts/IntentsDataContext";
import { radarBucketForOpportunity } from "@/lib/radar-buckets";
import { resolveSocials } from "@/lib/socials";
import { SOCIAL_ICONS } from "@/components/SocialIcons";
import type { OpportunityLifecycleStatus, RadarCardItem } from "@/services/opportunities";
import { intentLabel } from "@/components/intents-home/stages";

export type PersonTab = "summary" | "chat";

/** The person a pane is about. */
export interface PanePerson {
  name: string;
  userId?: string;
  avatar?: string | null;
  notOnIndex?: boolean;
  /** Used for the avatar's colour when there is no user yet. */
  fallbackId?: string;
}

interface Profile {
  username?: string | null;
  intro?: string | null;
  location?: string | null;
  socials?: Array<{ label: string; value: string }> | null;
}

/** Profiles once loaded, so the header and the summary don't each fetch one. */
const profileCache = new Map<string, Promise<Profile>>();
function useProfile(userId?: string): Profile | null {
  const users = useUsers();
  const [state, setState] = useState<{ id: string; profile: Profile } | null>(null);
  useEffect(() => {
    if (!userId) return;
    let active = true;
    let pending = profileCache.get(userId);
    if (!pending) {
      pending = users.getUserProfile(userId).then((p) => p as Profile);
      pending.catch(() => profileCache.delete(userId));
      profileCache.set(userId, pending);
    }
    pending.then((profile) => { if (active) setState({ id: userId, profile }); }).catch(() => {});
    return () => { active = false; };
  }, [userId, users]);
  return state && state.id === userId ? state.profile : null;
}

/**
 * Who a person is, on top of their pane and their profile page: photo, name,
 * @handle · where. Whatever sits under the name (the tabs) comes as children.
 */
export function PersonHead({ person, handle, location, linked = true, actions, onClose, children }: {
  person: PanePerson;
  /** "@name", or what to show when there's none yet. */
  handle?: ReactNode;
  location?: string | null;
  /** Photo and name open their profile (off on the profile itself). */
  linked?: boolean;
  /** Beside the name, e.g. your own profile's "edit profile". */
  actions?: ReactNode;
  onClose?: () => void;
  children?: ReactNode;
}) {
  const face = <UserAvatar id={person.userId ?? person.fallbackId} name={person.name} avatar={person.avatar} size={48} />;
  const link = linked && person.userId;
  return (
    <header className="sv-ph">
      {onClose && <button type="button" className="sv-x" aria-label="close (esc)" title="close (esc)" onClick={onClose}>×</button>}
      <div className="sv-pid">
        {link ? <Link to={`/u/${person.userId}`} title={`${person.name}'s profile`} style={{ display: "flex" }}>{face}</Link> : face}
        <div className="who">
          <div className="sv-pn">{link ? <Link to={`/u/${person.userId}`}>{person.name}</Link> : person.name}</div>
          <div className="sv-pu">
            {person.notOnIndex ? <span className="loc">not on index yet</span> : (
              <>
                {handle}
                {location && <span className="loc">{handle ? " · " : ""}{location}</span>}
              </>
            )}
          </div>
        </div>
        {actions && <div className="sv-pact">{actions}</div>}
      </div>
      {children}
    </header>
  );
}

/**
 * One person, the same everywhere (home, an intent, conversations, their
 * profile): who they are on top (photo, name, @handle · where), then
 * "summary · chat" under the name. The header never moves. Summary is their
 * profile and every opportunity between you two; chat is the conversation in
 * a warm box joined to its composer.
 */
export function PersonPane({ person, tab, onTab, chatOff, chatCount, onClose, linked, summary, foot, chat }: {
  person: PanePerson;
  tab: PersonTab;
  onTab: (tab: PersonTab) => void;
  /** Chat isn't open yet: what the chat tab says instead, above the foot. */
  chatOff?: string;
  /** Messages so far, beside "chat". */
  chatCount?: number;
  onClose?: () => void;
  /** Photo and name open their profile (off on the profile itself). */
  linked?: boolean;
  summary: ReactNode;
  foot?: ReactNode;
  chat: ReactNode;
}) {
  const profile = useProfile(person.userId);
  const first = person.name.split(" ")[0];
  const showChat = tab === "chat";
  // Once opened, the chat stays mounted behind summary, so a half-typed message survives the switch.
  const [chatOpened, setChatOpened] = useState(showChat);
  if (showChat && !chatOpened) setChatOpened(true);

  return (
    <div className="sv-person" aria-label={`you and ${first}`}>
      <PersonHead person={person} handle={profile?.username ? `@${profile.username}` : null} location={profile?.location} linked={linked} onClose={onClose}>
        <div className="sv-tabs" role="tablist" aria-label={`${first}: summary or chat`}>
          <button type="button" role="tab" data-sv-key="tab-summary" aria-current={!showChat} onClick={() => onTab("summary")}>summary</button>
          <button type="button" role="tab" data-sv-key="tab-chat" aria-current={showChat} onClick={() => onTab("chat")}>
            chat{!!chatCount && <span className="n">{chatCount}</span>}
          </button>
        </div>
      </PersonHead>

      {chatOpened && !chatOff && <div className="sv-chat" role="tabpanel" hidden={!showChat}>{chat}</div>}
      {showChat && chatOff && (
        // Not open yet: the same warm box, saying when it opens, with accept and pass as its foot.
        <div className="sv-chat" role="tabpanel">
          <div className="sv-well"><div className="sv-wait">{chatOff}</div></div>
          {foot && <div className="sv-wellbar">{foot}</div>}
        </div>
      )}
      {!showChat && (
        <>
          <div className="sv-body sv-sum" role="tabpanel">{summary}</div>
          {foot && <div className="sv-bar">{foot}</div>}
        </>
      )}
    </div>
  );
}

/** How a status reads, like the profile page, and which square it gets. */
function statusOf(item: RadarCardItem, hasChat: boolean): { label: string; cls: string } {
  const bucket = radarBucketForOpportunity(item.status, item.viewerCommitted, hasChat);
  if (bucket === "closed") return { label: item.status === "rejected" ? "not a fit" : "missed", cls: "paused" };
  if (bucket === "negotiating") return { label: "in progress", cls: "talks" };
  if (bucket === "awaiting you") return { label: "waiting on you", cls: "waiting" };
  return { label: "accepted", cls: "live" };
}

/** Every opportunity between you two, open or closed. */
const PAIR_STATUSES: OpportunityLifecycleStatus[] = ["negotiating", "pending", "accepted", "rejected", "expired"];

/** 444, 1.2k, 3m: how the prototype counts members. */
const compact = (n: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n).toLowerCase();

const shortDate = (iso?: string) => iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }).toLowerCase() : "";

/**
 * The summary: bio, elsewhere, networks you share, then every opportunity
 * between you two as a row (headline · status ›). The one this pane opened
 * for starts open, showing why your agent found them and the agents' log.
 */
export function PersonSummary({ userId, focusId, why, intentId, none, fresh }: {
  userId?: string;
  /** The opportunity this pane is for: its row starts open. */
  focusId?: string;
  /** Why your agent surfaced them, for the focused row (or on its own when there's no user yet). */
  why?: string;
  intentId?: string;
  /** What "opportunities" says when there's nothing between you two yet. */
  none?: ReactNode;
  /** Skip the cached opportunities, e.g. right after pairing. */
  fresh?: boolean;
}) {
  const profile = useProfile(userId);
  const networksApi = useNetworks();
  const opportunitiesApi = useOpportunities();
  const { conversations } = useConversation();
  const { intents } = useIntentsData();
  const [nets, setNets] = useState<{ id: string; list: Array<{ id: string; title: string; _count: { members: number } }> } | null>(null);
  const [opps, setOpps] = useState<{ id: string; list: RadarCardItem[] } | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    networksApi.getSharedNetworks(userId).then((list) => { if (active) setNets({ id: userId, list }); }).catch(() => { if (active) setNets({ id: userId, list: [] }); });
    // Rows come first from stored cards, blank where none is written yet (always
    // so for one still negotiating); writing those up takes seconds, so they
    // fill in from a second request instead of holding the whole list back.
    const query = { peerUserId: userId, statuses: PAIR_STATUSES, noCache: fresh };
    opportunitiesApi.getRadarView({ ...query, presentation: "skeleton" })
      .then((res) => {
        if (active) setOpps({ id: userId, list: res.items });
        return res.items.some((item) => item.presentationPending);
      }, () => true)
      .then((pending) => pending && active ? opportunitiesApi.getRadarView(query) : null)
      .then((res) => { if (res && active) setOpps({ id: userId, list: res.items }); })
      .catch(() => { if (active) setOpps((prev) => prev && prev.id === userId ? prev : { id: userId, list: [] }); });
    return () => { active = false; };
  }, [userId, networksApi, opportunitiesApi, fresh]);

  const shared = nets && nets.id === userId ? nets.list : null;
  const list = opps && opps.id === userId ? opps.list : null;
  const socials = resolveSocials(profile?.socials ?? []);
  const hasChat = !!userId && conversations.some((conv) => (conv.participants ?? []).some((p) => p.participantType === "user" && p.participantId === userId));
  const intentTitle = intentLabel(intents.find((intent) => intent.id === intentId));

  return (
    <>
      {userId && (
        <>
          <h4 className="sv-h4">bio</h4>
          {profile ? (profile.intro ? <p>{profile.intro}</p> : <p className="sv-dimp">no bio yet.</p>) : <Placeholder.Text lines={2} label="loading bio" />}
        </>
      )}

      {socials.length > 0 && (
        <>
          <h4 className="sv-h4">elsewhere</h4>
          <div className="sv-socials">
            {socials.map((s) => (
              <a className="sv-soc" key={s.href} href={s.href} target="_blank" rel="noopener noreferrer" title={s.platform}>{SOCIAL_ICONS[s.platform]}<span>{s.handle}</span></a>
            ))}
          </div>
        </>
      )}

      {shared && shared.length > 0 && (
        <>
          <h4 className="sv-h4">networks</h4>
          <div className="sv-socials">
            {shared.map((n) => <Link key={n.id} className="sv-soc" to={`/networks/${n.id}`}>{n.title} · {compact(n._count.members)}</Link>)}
          </div>
        </>
      )}

      <h4 className="sv-h4">opportunities</h4>
      {!userId ? (
        why ? <p>{why}</p> : <p className="sv-dimp">I&apos;m still writing this up.</p>
      ) : !list ? (
        <Placeholder.Rows count={2} avatar={false} label="loading opportunities" />
      ) : list.length === 0 ? (
        why ? <p>{why}</p> : none ?? <p className="sv-dimp">nothing between you two yet.</p>
      ) : (
        <div className="sv-olist">
          {list.map((item) => {
            const isOpen = open === item.opportunityId;
            const status = statusOf(item, hasChat);
            const headline = item.headline || item.mainText;
            const reason = item.opportunityId === focusId && why ? why : (item.personalizedSummary || (item.mainText !== headline ? item.mainText : ""));
            return (
              <div key={item.opportunityId} className={`sv-orow${isOpen ? " open" : ""}`}>
                <button type="button" className="sv-orh" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : item.opportunityId)}>
                  <span className="sv-oh">{headline || (item.presentationPending ? <Placeholder.Text lines={1} label="writing this up" style={{ width: "70%" }} /> : "an opportunity")}</span>
                  <span className="sv-os">{status.cls === "talks" && item.opportunityId === focusId && <span className="sv-dot" />}{status.label}</span>
                  <span className="sv-oc">{isOpen ? "▾" : "›"}</span>
                </button>
                {isOpen && (
                  <div className="sv-olog">
                    <div className="sv-alh">
                      {item.opportunityId === focusId && intentTitle ? <>for <Link to={`/i/${intentId}`}>{intentTitle}</Link></> : item.mutualIntentsLabel}
                      {item.createdAt && ` · ${shortDate(item.createdAt)}`}
                    </div>
                    {reason && <p className="sv-owhy">{reason}</p>}
                    <NegotiationConversation opportunityId={item.opportunityId} expanded onToggle={() => setOpen(null)} look="turns" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
