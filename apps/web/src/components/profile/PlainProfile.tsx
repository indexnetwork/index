import { useState } from "react";
import { Link } from "react-router";

import "@/styles/plain.css";
import AgentLog from "@/components/intents-home/AgentLog";
import PageHead from "@/components/intents-home/PageHead";
import ProfileEditor from "@/components/profile/ProfileEditor";
import NegotiationHistory from "@/components/NegotiationHistory";
import { SOCIAL_ICONS } from "@/components/SocialIcons";
import UserAvatar from "@/components/UserAvatar";
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

type Bucket = ReturnType<typeof radarBucketForOpportunity>;

/** Card stripe and status chip for each stage, in Home's colors. */
const STAGE: Record<NonNullable<Bucket>, { chip: string; label: string }> = {
  "awaiting you": { chip: "waiting", label: "waiting on you" },
  negotiating: { chip: "talks", label: "agents talking" },
  accepted: { chip: "live", label: "connected" },
  closed: { chip: "paused", label: "closed" },
};

/**
 * A person's profile inside the signed-in desktop shell, drawn like Home:
 * a big name, plain section heads with the double rule, and one short row
 * per match between you that opens to its agent log.
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
  const [picked, setPicked] = useState<string | null>(null);
  const first = (profile.name || "them").split(" ")[0];
  // Back to wherever they came from (a card, a question, a chat); home when opened fresh.
  const back = useBack("/");
  const fresh = atHistoryEntry();

  // The log beside the list: the one you picked, else the live one, else the newest.
  const rows = matches.map((match) => {
    const bucket = radarBucketForOpportunity(match.status, match.viewerCommitted) ?? "negotiating";
    const stage = STAGE[bucket];
    return {
      match,
      bucket,
      chip: stage.chip,
      label: bucket === "closed" ? (match.status === "rejected" ? "not a fit" : "missed") : stage.label,
      title: match.headline || match.mainText || "a possible match",
    };
  });
  const shown = rows.find((row) => row.match.opportunityId === picked)
    ?? rows.find((row) => row.bucket === "negotiating")
    ?? rows[0];

  return (
    <div className="ih-view pl">
      <div className="pl-col">
      <PageHead
        eyebrow={isOwn ? "YOUR PROFILE" : "PROFILE"}
        title={profile.name}
        status={[profile.location, profile.emailVerified === false ? "not on index yet" : null].filter(Boolean).join(" · ") || undefined}
        back={isOwn ? undefined : { label: fresh ? "home" : "back", onClick: back }}
      >
        {isOwn
          ? !editing && <button type="button" onClick={() => setEditing(true)}>edit profile</button>
          : <button type="button" className="go" onClick={onMessage}>send message</button>}
      </PageHead>
      <div className="pl-prof">
        <aside className="pl-prof-side">
          {editing ? (
            <ProfileEditor<Profile>
              onCancel={() => setEditing(false)}
              onSaved={(saved) => { setEditing(false); onSaved?.(saved); }}
            />
          ) : (
          <>
          <UserAvatar id={profile.id} name={profile.name} avatar={profile.avatar} size={96} />
          {profile.intro
            ? <p className="pl-profile-bio">{profile.intro}</p>
            : isOwn && <p className="pl-dim">no bio yet. add one so other agents know what you&apos;re about.</p>}
          {socials.length > 0 && (
            <div className="pl-profile-links">
              {socials.map((s) => (
                <a key={s.href} href={s.href} target="_blank" rel="noopener noreferrer">
                  {SOCIAL_ICONS[s.platform]}
                  <span>{s.handle}</span>
                </a>
              ))}
            </div>
          )}
          </>
          )}
          {!isOwn && (
            <>
              <h2>networks you share</h2>
              {networks.length === 0 ? (
                <p className="pl-dim">none yet.</p>
              ) : (
                <ul className="pl-nets">
                  {networks.map((network, index) => (
                    <li key={network.id}>
                      <Link to={`/networks/${network.id}`} className="pl-net">
                        <span className={`pl-net-mark c${index % 4}`} aria-hidden>{network.title.trim().charAt(0).toUpperCase() || "#"}</span>
                        <span className="pl-net-text">
                          <span className="pl-net-name" title={network.title}>{network.title}</span>
                          <span className="pl-net-n">{network._count.members} {network._count.members === 1 ? "person" : "people"}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </aside>

        <section className="pl-prof-main">
          {isOwn ? (
            <>
              <h2>agent log</h2>
              <NegotiationHistory userId={profile.id} />
            </>
          ) : (
            <>
              <h2>you and {first}</h2>
              {!matchesLoaded ? (
                <p className="pl-dim">checking<span className="pl-blink">_</span></p>
              ) : rows.length === 0 ? (
                <div className="pl-profile-empty">
                  <p>my agent hasn&apos;t talked to {first}&apos;s yet. pair them and they&apos;ll keep talking in the background, and I&apos;ll bring you anything worth meeting about.</p>
                  {pairError && <p className="pl-dim">no intents to pair in a network you share.</p>}
                  <button type="button" className="go" disabled={pairing} onClick={onPair}>{pairing ? "pairing…" : "pair our agents"}</button>
                </div>
              ) : (
                <>
                  <ul className="pl-rows">
                    {rows.map((row) => {
                      const on = row === shown;
                      return (
                        <li key={row.match.opportunityId} className={on ? "open" : undefined}>
                          <button type="button" className="pl-row" aria-pressed={on} onClick={() => setPicked(row.match.opportunityId)}>
                            <span className="pl-row-title" title={row.title}>{row.title}</span>
                            <span className={`pl-status ${row.chip}`}>{row.label}</span>
                            <span className="pl-row-arrow" aria-hidden>{on ? "▾" : "▸"}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {shown && (
                    <div className={`pl-prof-log ${shown.chip}`}>
                      <div className="pl-prof-log-head">
                        <b>my agent and {first}&apos;s agent</b>
                        <span className={`pl-status ${shown.chip}`}>{shown.label}</span>
                      </div>
                      {shown.match.mainText && shown.match.mainText !== shown.title && <p className="pl-blurb">{shown.match.mainText}</p>}
                      <AgentLog key={shown.match.opportunityId} opportunityId={shown.match.opportunityId} name={profile.name || "them"} />
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </section>
      </div>
      </div>
    </div>
  );
}
