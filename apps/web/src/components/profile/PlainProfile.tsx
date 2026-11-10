import { useState } from "react";
import { Link } from "react-router";
import { Check, Copy } from "lucide-react";

import "@/styles/plain.css";
import NegotiationConversation from "@/components/NegotiationConversation";
import NegotiationHistory from "@/components/NegotiationHistory";
import ProfileEditor from "@/components/profile/ProfileEditor";
import { SOCIAL_ICONS } from "@/components/SocialIcons";
import UserAvatar from "@/components/UserAvatar";
import { NotOnIndexTag } from "@/components/workbench/mac-blocks";
import { useBack, atHistoryEntry } from "@/hooks/useBack";
import { radarBucketForOpportunity } from "@/lib/radar-buckets";
import type { resolveSocials } from "@/lib/socials";
import type { RadarCardItem } from "@/services/opportunities";

/** The parts of a profile this view shows. */
interface Profile {
  id: string;
  name: string;
  avatar?: string | null;
  location?: string | null;
  intro?: string | null;
  emailVerified?: boolean;
}

/**
 * A profile inside the signed-in desktop shell, in the classic profile look
 * (as on main): photo, name and actions over a black rule, then bio,
 * elsewhere, and your agent log or what's between you and them. It fills
 * the page beside the sidebar instead of sitting in its own window.
 */
export default function PlainProfile({
  profile, socials, isOwn, networks, matches, matchesLoaded, pairing, pairError, onPair, onMessage, onSaved,
}: {
  profile: Profile;
  socials: ReturnType<typeof resolveSocials>;
  isOwn: boolean;
  networks: Array<{ id: string; title: string; _count: { members: number } }>;
  matches: RadarCardItem[];
  matchesLoaded: boolean;
  pairing: boolean;
  pairError: boolean;
  onPair: () => void;
  onMessage: () => void;
  /** Your own profile only: the saved record, after an edit. */
  onSaved?: (profile: Profile) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Back to wherever they came from (a card, a question, a chat); home when opened fresh.
  const back = useBack("/");
  const fresh = atHistoryEntry();

  const profileUrl = () => `${window.location.origin}/u/${profile.id}`;
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(profileUrl());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* the clipboard can be blocked; nothing to undo */ }
  };
  const share = () => {
    const intent = new URL("https://x.com/intent/post");
    intent.searchParams.set("text", "Have your agent talk to my agent on @indexnetwork_");
    intent.searchParams.set("url", profileUrl());
    window.open(intent.toString(), "_blank", "noopener,noreferrer");
  };

  return (
    <div className="ih-view ih-classic ih-profile">
      <div className="mac-scroll profile-content">
        {!isOwn && <button type="button" className="profile-back" onClick={back}>◂ {fresh ? "home" : "back"}</button>}

        <div className="profile-header">
          <UserAvatar id={profile.id} name={profile.name} avatar={profile.avatar} size={54} />
          <div className="profile-identity">
            <div className="profile-name">{profile.name}</div>
            {profile.emailVerified === false && <NotOnIndexTag />}
            {profile.location && <div className="profile-location">{profile.location}</div>}
          </div>
          {isOwn ? (
            <div className="profile-actions">
              {!editing && <button type="button" className="wb-btn small" onClick={() => setEditing(true)}>edit profile</button>}
              <button type="button" className="wb-btn small profile-icon-btn" onClick={() => void copyLink()} aria-label={copied ? "link copied" : "copy link"} title={copied ? "copied" : "copy link"}>
                {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
              </button>
              <button type="button" className="wb-btn primary small" onClick={share}>share on X</button>
            </div>
          ) : (
            <button type="button" className="wb-btn primary small profile-message" onClick={onMessage}>send message</button>
          )}
        </div>

        {editing ? (
          <div className="pl profile-editing">
            <ProfileEditor<Profile>
              onCancel={() => setEditing(false)}
              onSaved={(saved) => { setEditing(false); onSaved?.(saved); }}
            />
          </div>
        ) : (
          <>
            {profile.intro && (
              <section>
                <h3 className="profile-label">bio</h3>
                <p className="profile-bio">{profile.intro}</p>
              </section>
            )}

            {socials.length > 0 && (
              <section>
                <h3 className="profile-label">elsewhere</h3>
                <div className="profile-chips">
                  {socials.map((s) => (
                    <a className="profile-social" key={s.href} href={s.href} target="_blank" rel="noopener noreferrer">
                      {SOCIAL_ICONS[s.platform]}
                      <span>{s.handle}</span>
                    </a>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {!isOwn && (
          <section>
            <h3 className="profile-label">networks</h3>
            {networks.length === 0 && <div className="profile-dim">no shared networks.</div>}
            <div className="profile-chips">
              {networks.map((network) => (
                <Link key={network.id} to={`/networks/${network.id}`} className="profile-social">
                  {network.title} · {network._count.members}
                </Link>
              ))}
            </div>
          </section>
        )}

        {!isOwn && matchesLoaded && matches.length === 0 && (
          <section>
            <h3 className="profile-label">opportunities</h3>
            <div className="profile-box">
              <div className="profile-box-title">our agents haven&apos;t talked yet.</div>
              pair them and they&apos;ll keep talking in the background, and we&apos;ll both hear about it the moment something&apos;s worth meeting over.
              {pairError && <div className="profile-dim">no intents to pair in a network you share.</div>}
              <div style={{ marginTop: 10 }}>
                <button type="button" className="wb-btn primary small" disabled={pairing} onClick={onPair}>{pairing ? "pairing…" : "pair agents"}</button>
              </div>
            </div>
          </section>
        )}

        {!isOwn && matches.length > 0 && (
          <section>
            <h3 className="profile-label">opportunities</h3>
            <div className="profile-opps">
              {matches.map((o) => {
                const bucket = radarBucketForOpportunity(o.status, o.viewerCommitted);
                const open = openId === o.opportunityId;
                const toggle = () => setOpenId(open ? null : o.opportunityId);
                return (
                  <div key={o.opportunityId} className="profile-opp">
                    <div role="button" tabIndex={0} className={open ? "profile-opp-row open" : "profile-opp-row"} onClick={toggle}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } }}>
                      <div className="profile-opp-title">{o.headline || o.mainText}</div>
                      <span className="profile-opp-stage">
                        {bucket === "closed" ? (o.status === "rejected" ? "not a fit" : "missed") : bucket === "negotiating" ? "in progress" : bucket}
                      </span>
                      <span className="profile-opp-arrow">{open ? "▾" : "›"}</span>
                    </div>
                    {open && (
                      <div className="profile-opp-log">
                        <NegotiationConversation opportunityId={o.opportunityId} expanded onToggle={toggle} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {isOwn && (
          <section className="profile-ruled">
            <h3 className="profile-label">agent log</h3>
            <NegotiationHistory userId={profile.id} />
          </section>
        )}
      </div>
    </div>
  );
}
