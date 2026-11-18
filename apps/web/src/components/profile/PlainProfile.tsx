import { useState } from "react";
import { Link } from "react-router";
import { Check, Copy } from "lucide-react";
import { useTranslation } from "react-i18next";

import "@/styles/plain.css";
import NegotiationConversation from "@/components/NegotiationConversation";
import NegotiationHistory from "@/components/NegotiationHistory";
import ProfileEditor from "@/components/profile/ProfileEditor";
import TranslatedMark from "@/components/TranslatedMark";
import { SOCIAL_ICONS } from "@/components/SocialIcons";
import UserAvatar from "@/components/UserAvatar";
import { NotOnIndexTag } from "@/components/workbench/mac-blocks";
import { useBack, atHistoryEntry } from "@/hooks/useBack";
import { useContentTranslation } from "@/lib/content-translation";
import { radarBucketForOpportunity } from "@/lib/radar-buckets";
import type { resolveSocials } from "@/lib/socials";
import type { RadarCardItem } from "@/services/opportunities";

/** Each stage's status chip, in Home's colors. */
const OPP_CHIP: Record<NonNullable<ReturnType<typeof radarBucketForOpportunity>>, string> = {
  "awaiting you": "waiting",
  negotiating: "talks",
  accepted: "chat",
  closed: "paused",
};

/** Agent-written text in the viewer's language, without the toggle (for one-line titles). */
function ContentText({ text }: { text: string }) {
  return <>{useContentTranslation(text).text}</>;
}

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
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Back to wherever they came from (a card, a question, a chat); home when opened fresh.
  const back = useBack("/");
  const fresh = atHistoryEntry();
  // Someone else's bio is shown in the viewer's language; your own stays as you wrote it.
  const intro = useContentTranslation(isOwn ? null : profile.intro);

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
        {!isOwn && <button type="button" className="profile-back" onClick={back}>◂ {fresh ? t("home") : t("back")}</button>}

        <div className="profile-header">
          <UserAvatar id={profile.id} name={profile.name} avatar={profile.avatar} size={54} />
          <div className="profile-identity">
            <div className="profile-name">{profile.name}</div>
            {profile.emailVerified === false && <NotOnIndexTag />}
            {profile.location && <div className="profile-location">{profile.location}</div>}
          </div>
          {isOwn ? (
            <div className="profile-actions">
              {!editing && <button type="button" className="wb-btn small" onClick={() => setEditing(true)}>{t("edit profile")}</button>}
              <button type="button" className="wb-btn small profile-icon-btn" onClick={() => void copyLink()} aria-label={copied ? t("link copied") : t("copy link")} title={copied ? t("copied") : t("copy link")}>
                {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
              </button>
              <button type="button" className="wb-btn primary small" onClick={share}>{t("share on X")}</button>
            </div>
          ) : (
            <button type="button" className="wb-btn primary small profile-message" onClick={onMessage}>{t("send message")}</button>
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
                <h3 className="profile-label">{t("bio")}</h3>
                <p className="profile-bio">{isOwn ? profile.intro : intro.text}</p>
                {!isOwn && <TranslatedMark state={intro} />}
              </section>
            )}

            {socials.length > 0 && (
              <section>
                <h3 className="profile-label">{t("elsewhere")}</h3>
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
            <h3 className="profile-label">{t("networks you share")}</h3>
            {networks.length === 0 && <div className="profile-dim">{t("no shared networks.")}</div>}
            {/* The same tiles as the networks page: a colored initial, the name, how many people. */}
            {networks.length > 0 && (
              <ul className="pl-nets">
                {networks.map((network, index) => (
                  <li key={network.id}>
                    <Link to={`/networks/${network.id}`} className="pl-net">
                      <span className={`pl-net-mark c${index % 4}`} aria-hidden>{network.title.trim().charAt(0).toUpperCase() || "#"}</span>
                      <span className="pl-net-text">
                        <span className="pl-net-name" title={network.title}>{network.title}</span>
                        <span className="pl-net-n">{network._count.members === 1 ? t("{{n}} person", { n: network._count.members }) : t("{{n}} people", { n: network._count.members })}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {!isOwn && matchesLoaded && matches.length === 0 && (
          <section>
            <h3 className="profile-label">{t("opportunities")}</h3>
            <div className="profile-box">
              <div className="profile-box-title">{t("our agents haven't talked yet.")}</div>
              {t("pair them and they'll keep talking in the background, and we'll both hear about it the moment something's worth meeting over.")}
              {pairError && <div className="profile-dim">{t("no intents to pair in a network you share.")}</div>}
              <div style={{ marginTop: 10 }}>
                <button type="button" className="wb-btn primary small" disabled={pairing} onClick={onPair}>{pairing ? t("pairing…") : t("pair agents")}</button>
              </div>
            </div>
          </section>
        )}

        {!isOwn && matches.length > 0 && (
          <section>
            <h3 className="profile-label">{t("opportunities")}</h3>
            {/* One line each, between thin rules like Home; a line opens to the agents' conversation. */}
            <div className="profile-opps">
              {matches.map((o) => {
                const bucket = radarBucketForOpportunity(o.status, o.viewerCommitted) ?? "negotiating";
                const open = openId === o.opportunityId;
                const toggle = () => setOpenId(open ? null : o.opportunityId);
                return (
                  <div key={o.opportunityId} className={open ? "profile-opp open" : "profile-opp"}>
                    <div role="button" tabIndex={0} className="profile-opp-row" aria-expanded={open} onClick={toggle}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } }}>
                      <div className="profile-opp-title"><ContentText text={o.headline || o.mainText} /></div>
                      <span className={`pl-status ${OPP_CHIP[bucket]}`}>
                        {bucket === "closed" ? (o.status === "rejected" ? t("not a fit") : t("missed")) : bucket === "negotiating" ? t("in progress") : t(bucket)}
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
            <h3 className="profile-label">{t("agent log")}</h3>
            <NegotiationHistory userId={profile.id} />
          </section>
        )}
      </div>
    </div>
  );
}
