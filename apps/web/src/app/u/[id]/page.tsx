import { useState, useEffect } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { useAuthContext } from "@/contexts/AuthContext";
import { useUsers, useNetworks, useOpportunities } from "@/contexts/APIContext";
import type { RadarCardItem } from "@/services/opportunities";
import { radarBucketForOpportunity } from "@/lib/radar-buckets";
import AppHandoff from "@/components/AppHandoff";
import UserAvatar from "@/components/UserAvatar";
import { User } from "@/lib/types";
import { Link } from "react-router";
import { Stage, Window } from "@/components/workbench/Workbench";
import { NotOnIndexTag } from "@/components/workbench/mac-blocks";
import NegotiationHistory from "@/components/NegotiationHistory";
import NegotiationConversation from "@/components/NegotiationConversation";
import { getPublicUserProfile, type AgentStats } from "@/services/users";
import { log } from "@/lib/logger";
import { APIError, isNotFoundError } from "@/lib/api";
import { EmptyState } from "@/components/ui/EmptyState";
import { resolveSocials } from "@/lib/socials";
import { SOCIAL_ICONS } from "@/components/SocialIcons";
import { useBack } from "@/hooks/useBack";
import { clearPendingPair, readPendingPair, rememberPendingPair } from "@/lib/pending-pair";
import { awaitsFirstIntent, needsOnboarding } from "@/services/onboarding";

const logger = log.page.from("u/[id]");

const sectionLabel = { fontFamily: "var(--mac-mono)", fontSize: 11, letterSpacing: 1.4, textTransform: "uppercase", marginBottom: 8 } as const;

/** /u/:id, the old profile address. It still opens, and moves to /:username when there is one. */
export default function UserProfilePage() {
  const { id } = useParams();
  return <AppHandoff kind="u" id={id ?? ""} webPage={<UserProfile idOrUsername={id ?? ""} />} />;
}

/**
 * One person's profile. Rendered at `/:username` (the shareable address) and
 * at `/u/:id`, which hands over to `/:username` once the profile loads.
 */
export function UserProfile({ idOrUsername, atRoot = false }: { idOrUsername: string; atRoot?: boolean }) {
  const id = idOrUsername;
  const navigate = useNavigate();
  const back = useBack("/");
  const { user, isAuthenticated, isLoading: authLoading, openLoginModal } = useAuthContext();
  const [searchParams] = useSearchParams();
  // `?as=public` renders the page as a signed-out visitor sees it, which is what share profile opens.
  const asPublic = searchParams.get("as") === "public";
  const signedIn = isAuthenticated && !asPublic;
  const usersService = useUsers();
  const networksService = useNetworks();
  const opportunitiesService = useOpportunities();

  const [profileData, setProfileData] = useState<User | null>(null);
  const [sharedNetworks, setSharedNetworks] = useState<Array<{ id: string; title: string; _count: { members: number } }>>([]);
  const [sharedOpportunities, setSharedOpportunities] = useState<RadarCardItem[]>([]);
  const [openOpportunityId, setOpenOpportunityId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<"notFound" | "failed" | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [oppKey, setOppKey] = useState(0);
  const [oppsLoaded, setOppsLoaded] = useState(false);
  const [pairing, setPairing] = useState(false);
  const [pairError, setPairError] = useState(false);
  const [agentStats, setAgentStats] = useState<AgentStats | null>(null);

  // `id` is a user id or a username; the loaded profile says whose page this is.
  const profileId = profileData?.id;
  const isSelf = signedIn && !!user?.id && !!profileId && user.id === profileId;
  const isOtherUser = signedIn && !!user?.id && !!profileId && user.id !== profileId;

  useEffect(() => {
    // /u/ is a public route, so authLoading clears before /auth/me resolves; wait for the viewer too.
    if (authLoading || (isAuthenticated && !user?.id)) return;
    let active = true;
    // Stays "loading" while handing over to /:username, so nothing flashes on the way.
    let redirecting = false;
    const fetchData = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const profile = signedIn
          ? await usersService.getUserProfile(id)
          : await getPublicUserProfile(id!);
        if (!active) return;
        // The shareable address is index.network/<username>; old /u/ links move there.
        if (!atRoot && profile.username) {
          redirecting = true;
          navigate(`/${profile.username}${window.location.search}`, { replace: true });
          return;
        }
        setProfileData(profile);

        let networks: typeof sharedNetworks = [];
        if (signedIn && user?.id && user.id !== profile.id) {
          try {
            networks = await networksService.getSharedNetworks(profile.id);
            // No network in common: both join Index Early, which pairs the agents.
            if (networks.length === 0) {
              const ensured = await networksService.ensureSharedNetwork(profile.id);
              networks = ensured.networks;
              if (ensured.joined && active) setOppKey((k) => k + 1);
            }
          } catch (err) {
            logger.error('Failed to fetch shared networks', { error: err });
          }
        }
        if (active) setSharedNetworks(networks);
      } catch (err) {
        if (!active) return;
        logger.error('Failed to fetch profile', { error: err });
        // A profile that's gone can't be paired with; don't keep sending them here.
        if (readPendingPair()?.path === window.location.pathname) clearPendingPair();
        // A 200 without a user throws a plain Error: that is "missing" too.
        setError(isNotFoundError(err) || !(err instanceof APIError) ? "notFound" : "failed");
      } finally {
        if (active && !redirecting) setIsLoading(false);
      }
    };
    fetchData();
    return () => { active = false; };
  }, [id, atRoot, navigate, user?.id, isAuthenticated, signedIn, authLoading, usersService, networksService, reloadKey]);

  useEffect(() => {
    setSharedOpportunities([]);
    setOppsLoaded(false);
    if (!isOtherUser || !profileId) return;
    let active = true;
    opportunitiesService
      .getRadarView({ peerUserId: profileId, statuses: ["negotiating", "pending", "accepted", "rejected", "expired"], noCache: oppKey > 0 })
      .then((res) => { if (active) setSharedOpportunities(res.items); })
      .catch((err) => logger.error('Failed to fetch shared opportunities', { error: err }))
      .finally(() => { if (active) setOppsLoaded(true); });
    return () => { active = false; };
  }, [profileId, isOtherUser, opportunitiesService, oppKey]);

  // Agent analytics are the owner's alone: only fetched on your own profile.
  useEffect(() => {
    if (!isSelf) return;
    let active = true;
    usersService
      .getAgentStats()
      .then((stats) => { if (active) setAgentStats(stats); })
      .catch((err) => logger.error('Failed to fetch agent stats', { error: err }));
    return () => { active = false; };
  }, [isSelf, usersService]);

  const shareProfile = () => {
    if (!profileData) return;
    const path = `${profileData.username ? `/${profileData.username}` : `/u/${profileData.id}`}?as=public`;
    window.open(path, "_blank", "noopener,noreferrer");
  };

  const pair = async () => {
    if (!profileId || !profileData || pairing) return;
    // The public preview is the owner looking at their own page; nothing to pair.
    if (asPublic) return;
    if (!isAuthenticated) {
      // Signed-out visitors pair once they're in: the click is remembered through
      // sign-up and onboarding, and finished when they're brought back here.
      // Sign-in lands them in the default network, which the pair runs in.
      rememberPendingPair({ path: profileData.username ? `/${profileData.username}` : `/u/${profileId}`, userId: profileId });
      return openLoginModal(window.location.href);
    }
    setPairing(true);
    setPairError(false);
    try {
      await opportunitiesService.pairWith(profileId);
      setOppKey((k) => k + 1);
    } catch {
      setPairError(true);
    } finally {
      setPairing(false);
    }
  };

  // Back from sign-in (and onboarding, for someone new): finish the pair they asked for.
  const pendingPairFor = isOtherUser ? readPendingPair()?.userId : undefined;
  // Signed in as the very person they meant to pair with: nothing to finish.
  useEffect(() => {
    if (isSelf && readPendingPair()?.userId === profileId) clearPendingPair();
  }, [isSelf, profileId]);
  useEffect(() => {
    if (!profileId || pendingPairFor !== profileId) return;
    // New here: onboarding first. Its last step lands on the home page, which brings them back.
    if (needsOnboarding(user)) { navigate("/onboarding"); return; }
    // Profile confirmed but no intent yet, so nothing to pair with.
    if (awaitsFirstIntent(user)) { navigate("/i/new"); return; }
    clearPendingPair();
    void pair();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per arrival; pair reads current state
  }, [profileId, pendingPairFor]);

  if (authLoading || isLoading || error || !profileData) {
    // Every non-content state sits in the same profile window so the ink stays legible on the desktop.
    return (
      <Stage width={480}>
        <Window title="profile" onClose={back}>
          <div style={{ padding: "36px 24px" }}>
            {authLoading || isLoading ? (
              <EmptyState tone="loading" />
            ) : error === "failed" ? (
              <EmptyState
                tone="error"
                message="couldn't load this profile."
                action={{ label: "try again", onClick: () => setReloadKey((k) => k + 1) }}
              />
            ) : (
              <EmptyState message="couldn't find this person." action={{ label: "go back", onClick: back }} />
            )}
          </div>
        </Window>
      </Stage>
    );
  }

  // Sorted on where each link actually points rather than on its stored label,
  // so a LinkedIn URL filed under 'custom' shows as LinkedIn instead of
  // vanishing, and anything that resolves to no address is left out entirely.
  const socialLinks = resolveSocials(profileData.socials);

  return (
      <Stage width={720} height="min(720px, calc(100vh - 112px))">
      <Window title="profile" onClose={back} style={{ height: "100%" }}>
      <div className="mac-scroll" style={{ flex: 1, overflowY: "auto", padding: "18px 24px", display: "grid", gap: 20, alignContent: "start" }}>

          {/* Avatar, Name, Location, Socials */}
          <div style={{ display: "flex", alignItems: "center", gap: 14, paddingBottom: 14, borderBottom: "1px solid #000" }}>
            <UserAvatar id={profileData.id} name={profileData.name} avatar={profileData.avatar} size={54} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontFamily: "var(--amiga-title)", fontSize: 20, fontWeight: 600 }}>{profileData.name}</div>
              {profileData.username ? (
                <div style={{ marginTop: 2, fontFamily: "var(--mac-mono)", fontSize: 12 }}>@{profileData.username}</div>
              ) : isSelf && (
                <Link to="/profile/edit" style={{ display: "inline-block", marginTop: 2, fontFamily: "var(--mac-mono)", fontSize: 11, color: "var(--ink-2)" }}>set a username</Link>
              )}
              {profileData.emailVerified === false && <NotOnIndexTag />}
              {profileData.location && <div style={{ marginTop: 2, fontFamily: "var(--mac-mono)", fontSize: 11, color: "var(--ink-2)" }}>{profileData.location}</div>}
            </div>
            {isOtherUser && (
              <button type="button" className="wb-btn primary small" onClick={() => navigate(`/u/${profileData.id}/chat`)}>send message</button>
            )}
            {isSelf && (
              <div style={{ display: "flex", gap: 6, flex: "0 0 auto" }}>
                <button type="button" className="wb-btn small" onClick={() => navigate("/profile/edit")}>edit profile</button>
                <button type="button" className="wb-btn primary small" onClick={shareProfile}>share profile</button>
              </div>
            )}
          </div>

          {profileData.intro && (
            <div>
              <h3 style={sectionLabel}>bio</h3>
              <p style={{ margin: 0, fontFamily: "var(--mac-sans)", fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{profileData.intro}</p>
            </div>
          )}

          {socialLinks.length > 0 && (
            <div>
              <h3 style={sectionLabel}>elsewhere</h3>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {socialLinks.map((s) => (
                  <a key={s.href} href={s.href} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6, border: "1px solid #000", padding: "4px 9px", fontFamily: "var(--mac-mono)", fontSize: 11, color: "#000", textDecoration: "none" }}>
                    {SOCIAL_ICONS[s.platform]}
                    <span>{s.handle}</span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {isOtherUser && (
            <div>
              <h3 style={sectionLabel}>networks</h3>
              {sharedNetworks.length === 0 && <div style={{ fontFamily: "var(--mac-mono)", fontSize: 11, color: "var(--ink-2)" }}>no shared networks.</div>}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {sharedNetworks.map((network) => (
                  <Link key={network.id} to={`/networks/${network.id}`} style={{ border: "1px solid #000", padding: "4px 9px", fontFamily: "var(--mac-mono)", fontSize: 11, color: "#000", textDecoration: "none" }}>
                    {network.title} · {network._count.members}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {!signedIn && (
            <div>
              <h3 style={sectionLabel}>opportunities</h3>
              <EmptyState
                framed
                message={
                  <>
                    Pair your agent with mine. They'll keep talking in the background, exploring possibilities and bringing us together whenever something interesting emerges.
                    {pairError && <div>no discoverable intents in a shared network.</div>}
                  </>
                }
                action={{ label: pairing ? "pairing…" : "pair agents", onClick: pair, primary: true, large: true }}
              />
            </div>
          )}

          {/* Signed in, nothing between us yet. Opening the profile already made
              sure we share a network, so our agents are paired: nothing to click. */}
          {isOtherUser && oppsLoaded && sharedOpportunities.length === 0 && (
            <div>
              <h3 style={sectionLabel}>opportunities</h3>
              <div style={{ border: "1px solid #000", background: "#fff", padding: "14px 16px", fontFamily: "var(--mac-sans)", fontSize: 13, lineHeight: 1.5 }}>
                <div style={{ fontFamily: "var(--mac-mono)", fontSize: 12, fontWeight: 700, marginBottom: 4 }}>our agents are already paired.</div>
                they&apos;re talking in the background, and we&apos;ll both hear about it the moment something&apos;s worth meeting over. until then, enjoy connecting with others.
              </div>
            </div>
          )}

          {sharedOpportunities.length > 0 && (
            <div>
              <h3 style={sectionLabel}>opportunities</h3>
              <div style={{ display: "grid", gap: 8 }}>
                {sharedOpportunities.map((o) => {
                  const bucket = radarBucketForOpportunity(o.status, o.viewerCommitted);
                  const open = openOpportunityId === o.opportunityId;
                  const toggle = () => setOpenOpportunityId(open ? null : o.opportunityId);
                  return (
                    <div key={o.opportunityId} style={{ border: "1px solid #000", background: "#fff" }}>
                      <div role="button" tabIndex={0} onClick={toggle}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } }}
                        style={{ padding: "12px 14px", display: "flex", gap: 12, alignItems: "baseline", background: open ? "#F2F0EC" : "#fff" }}>
                        <div style={{ flex: 1, minWidth: 0, fontFamily: "var(--mac-sans)", fontSize: 13, lineHeight: 1.45 }}>{o.headline || o.mainText}</div>
                        <span style={{ fontFamily: "var(--mac-mono)", fontSize: 10, whiteSpace: "nowrap" }}>
                          {bucket === "closed" ? (o.status === "rejected" ? "not a fit" : "missed") : bucket === "negotiating" ? "in progress" : bucket}
                        </span>
                        <span style={{ fontFamily: "var(--mac-mono)", fontSize: 12 }}>{open ? "▾" : "›"}</span>
                      </div>
                      {open && (
                        <div style={{ borderTop: "1px solid #000" }}>
                          <NegotiationConversation opportunityId={o.opportunityId} expanded onToggle={toggle} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {isSelf && (
            <div style={{ borderTop: "1px solid #000", paddingTop: 16 }}>
              <h3 style={sectionLabel}>agent analytics</h3>
              <div style={{ display: "flex", flexWrap: "wrap", border: "1px solid #000", background: "#fff" }}>
                {([
                  { label: "paired agents", value: agentStats?.pairedAgents, hint: "people your agent has negotiated with" },
                  { label: "negotiations", value: agentStats?.negotiations, hint: "every conversation, all time" },
                  { label: "in progress", value: agentStats?.inProgress, hint: "still talking" },
                  { label: "connections", value: agentStats?.connected, hint: "both of you said yes" },
                ]).map((tile, i) => (
                  <div key={tile.label} title={tile.hint} style={{ flex: "1 1 0", minWidth: 110, display: "flex", alignItems: "baseline", gap: 6, padding: "6px 10px", borderLeft: i ? "1px solid #000" : "none" }}>
                    <span style={{ fontFamily: "var(--amiga-title)", fontSize: 16, fontWeight: 600 }}>{tile.value ?? "–"}</span>
                    <span style={{ fontFamily: "var(--mac-mono)", fontSize: 11, whiteSpace: "nowrap" }}>{tile.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Past Negotiations — only for authenticated users */}
          {isSelf && (
            <div>
              <h3 style={sectionLabel}>agent log</h3>
              <NegotiationHistory userId={profileData.id} />
            </div>
          )}

      </div>
      </Window>
      </Stage>
  );
}

export const Component = UserProfilePage;
