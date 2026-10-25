import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router";
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
import { getPublicUserProfile } from "@/services/users";
import { log } from "@/lib/logger";
import { APIError, isNotFoundError } from "@/lib/api";
import { EmptyState } from "@/components/ui/EmptyState";
import { resolveSocials } from "@/lib/socials";
import { SOCIAL_ICONS } from "@/components/SocialIcons";
import { useBack } from "@/hooks/useBack";

const logger = log.page.from("u/[id]");

const sectionLabel = { fontFamily: "var(--mac-mono)", fontSize: 11, letterSpacing: 1.4, textTransform: "uppercase", marginBottom: 8 } as const;

export default function UserProfilePage() {
  const { id } = useParams();
  return <AppHandoff kind="u" id={id ?? ""} webPage={<UserProfile />} />;
}

function UserProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const back = useBack("/");
  const { user, isAuthenticated, isLoading: authLoading, openLoginModal } = useAuthContext();
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

  const isOtherUser = !!user?.id && user.id !== id;

  useEffect(() => {
    // /u/ is a public route, so authLoading clears before /auth/me resolves; wait for the viewer too.
    if (authLoading || (isAuthenticated && !user?.id)) return;
    let active = true;
    const fetchData = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const profile = isAuthenticated
          ? await usersService.getUserProfile(id)
          : await getPublicUserProfile(id!);
        if (!active) return;
        setProfileData(profile);

        let networks: typeof sharedNetworks = [];
        if (isAuthenticated && user?.id && user.id !== id) {
          try {
            networks = await networksService.getSharedNetworks(id!);
          } catch (err) {
            logger.error('Failed to fetch shared networks', { error: err });
          }
        }
        if (active) setSharedNetworks(networks);
      } catch (err) {
        if (!active) return;
        logger.error('Failed to fetch profile', { error: err });
        // A 200 without a user throws a plain Error: that is "missing" too.
        setError(isNotFoundError(err) || !(err instanceof APIError) ? "notFound" : "failed");
      } finally {
        if (active) setIsLoading(false);
      }
    };
    fetchData();
    return () => { active = false; };
  }, [id, user?.id, isAuthenticated, authLoading, usersService, networksService, reloadKey]);

  useEffect(() => {
    setSharedOpportunities([]);
    setOppsLoaded(false);
    if (!isOtherUser || !id) return;
    let active = true;
    opportunitiesService
      .getRadarView({ peerUserId: id, statuses: ["negotiating", "pending", "accepted", "rejected", "expired"], noCache: oppKey > 0 })
      .then((res) => { if (active) setSharedOpportunities(res.items); })
      .catch((err) => logger.error('Failed to fetch shared opportunities', { error: err }))
      .finally(() => { if (active) setOppsLoaded(true); });
    return () => { active = false; };
  }, [id, isOtherUser, opportunitiesService, oppKey]);

  const pair = async () => {
    if (!id || pairing) return;
    // Signed-out viewers pair after login; sign-in lands them in the default network.
    if (!isAuthenticated) return openLoginModal();
    setPairing(true);
    setPairError(false);
    try {
      await opportunitiesService.pairWith(id);
      setOppKey((k) => k + 1);
    } catch {
      setPairError(true);
    } finally {
      setPairing(false);
    }
  };

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
              {profileData.emailVerified === false && <NotOnIndexTag />}
              {profileData.location && <div style={{ marginTop: 2, fontFamily: "var(--mac-mono)", fontSize: 11, color: "var(--ink-2)" }}>{profileData.location}</div>}
            </div>
            {isAuthenticated && isOtherUser && (
              <button type="button" className="wb-btn primary small" onClick={() => navigate(`/u/${id}/chat`)}>send message</button>
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

          {isAuthenticated && isOtherUser && (
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

          {(!isAuthenticated || (isOtherUser && oppsLoaded && sharedOpportunities.length === 0)) && (
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
                          {bucket === "closed" ? (o.status === "rejected" ? "not a fit" : "missed") : bucket === "negotiating" ? "in talks" : bucket}
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

          {/* Past Negotiations — only for authenticated users */}
          {isAuthenticated && id && !isOtherUser && (
            <div>
              <h3 style={sectionLabel}>agent log</h3>
              <NegotiationHistory userId={id} />
            </div>
          )}

      </div>
      </Window>
      </Stage>
  );
}

export const Component = UserProfilePage;
