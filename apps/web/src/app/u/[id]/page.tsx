import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import { useAuthContext } from "@/contexts/AuthContext";
import { useUsers, useNetworks } from "@/contexts/APIContext";
import AppHandoff from "@/components/AppHandoff";
import UserAvatar from "@/components/UserAvatar";
import { User } from "@/lib/types";
import { Link } from "react-router";
import { Stage, Window } from "@/components/workbench/Workbench";
import { GhostTag } from "@/components/workbench/mac-blocks";
import NegotiationHistory from "@/components/NegotiationHistory";
import { getPublicUserProfile } from "@/services/users";
import { log } from "@/lib/logger";
import { APIError, isNotFoundError } from "@/lib/api";
import { EmptyState } from "@/components/ui/EmptyState";
import { resolveSocials } from "@/lib/socials";
import { SOCIAL_ICONS } from "@/components/SocialIcons";

const logger = log.page.from("u/[id]");

export default function UserProfilePage() {
  const { id } = useParams();
  return <AppHandoff kind="u" id={id ?? ""} webPage={<UserProfile />} />;
}

function UserProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, isAuthenticated, isLoading: authLoading } = useAuthContext();
  const usersService = useUsers();
  const networksService = useNetworks();

  const [profileData, setProfileData] = useState<User | null>(null);
  const [sharedNetworks, setSharedNetworks] = useState<Array<{ id: string; title: string; _count: { members: number } }>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<"notFound" | "failed" | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const isOtherUser = !!user?.id && user.id !== id;

  useEffect(() => {
    const fetchData = async () => {
      if (authLoading) return;
      try {
        setIsLoading(true);
        setError(null);
        const profile = isAuthenticated
          ? await usersService.getUserProfile(id)
          : await getPublicUserProfile(id!);
        setProfileData(profile);

        if (isAuthenticated && user?.id && user.id !== id) {
          try {
            const networks = await networksService.getSharedNetworks(id!);
            setSharedNetworks(networks);
          } catch (err) {
            logger.error('Failed to fetch shared networks', { error: err });
            setSharedNetworks([]);
          }
        } else {
          setSharedNetworks([]);
        }
      } catch (err) {
        logger.error('Failed to fetch profile', { error: err });
        // A 200 without a user throws a plain Error: that is "missing" too.
        setError(isNotFoundError(err) || !(err instanceof APIError) ? "notFound" : "failed");
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [id, user?.id, isAuthenticated, authLoading, usersService, networksService, reloadKey]);

  if (authLoading || isLoading || error || !profileData) {
    // Every non-content state sits in the same profile window so the ink stays legible on the desktop.
    return (
      <Stage width={480}>
        <Window title="profile" onClose={() => navigate(-1)}>
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
              <EmptyState message="couldn't find this person." action={{ label: "go back", onClick: () => (window.history.length > 1 ? navigate(-1) : navigate("/")) }} />
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
      <Window title="profile" onClose={() => navigate(-1)} style={{ height: "100%" }}>
      <div className="mac-scroll" style={{ flex: 1, overflowY: "auto", padding: "18px 24px", display: "grid", gap: 20, alignContent: "start" }}>

          {/* Avatar, Name, Location, Socials */}
          <div style={{ display: "flex", alignItems: "center", gap: 14, paddingBottom: 14, borderBottom: "1px solid #000" }}>
            <UserAvatar id={profileData.id} name={profileData.name} avatar={profileData.avatar} size={54} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontFamily: "var(--amiga-title)", fontSize: 20, fontWeight: 600 }}>{profileData.name}</div>
              {profileData.isGhost && <GhostTag />}
              {profileData.location && <div style={{ marginTop: 2, fontFamily: "var(--mac-mono)", fontSize: 11, color: "var(--ink-2)" }}>{profileData.location}</div>}
            </div>
            {isAuthenticated && isOtherUser && (
              <button type="button" className="wb-btn primary small" onClick={() => navigate(`/u/${id}/chat`)}>send message</button>
            )}
          </div>

          {profileData.intro && (
            <div>
              <div style={{ fontFamily: "var(--mac-sans)", fontSize: 12.5, fontWeight: 700, marginBottom: 5 }}>bio</div>
              <p style={{ margin: 0, fontFamily: "var(--mac-sans)", fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{profileData.intro}</p>
            </div>
          )}

          {socialLinks.length > 0 && (
            <div>
              <div style={{ fontFamily: "var(--mac-sans)", fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>elsewhere</div>
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

          {sharedNetworks.length > 0 && (
            <div>
              <div style={{ fontFamily: "var(--mac-sans)", fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>networks</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {sharedNetworks.map((network) => (
                  <Link key={network.id} to={`/networks/${network.id}`} style={{ border: "1px solid #000", padding: "4px 9px", fontFamily: "var(--mac-mono)", fontSize: 11, color: "#000", textDecoration: "none" }}>
                    {network.title} · {network._count.members}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Past Negotiations — only for authenticated users */}
          {isAuthenticated && id && (
            <div>
              <h3 style={{ fontFamily: "var(--mac-mono)", fontSize: 11, letterSpacing: 1.4, textTransform: "uppercase", marginBottom: 8 }}>negotiation</h3>
              <NegotiationHistory userId={id} />
            </div>
          )}

      </div>
      </Window>
      </Stage>
  );
}

export const Component = UserProfilePage;
