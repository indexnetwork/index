import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import { useAuthContext } from "@/contexts/AuthContext";
import { useUsers, useNetworks } from "@/contexts/APIContext";
import AppHandoff from "@/components/AppHandoff";
import UserAvatar from "@/components/UserAvatar";
import { User } from "@/lib/types";
import { Link } from "react-router";
import { Stage, Window } from "@/components/workbench/Workbench";
import NegotiationHistory from "@/components/NegotiationHistory";
import { getPublicUserProfile } from "@/services/users";
import { log } from "@/lib/logger";
import { resolveSocials, type SocialPlatform } from "@/lib/socials";

const logger = log.page.from("u/[id]");

/** One mark per platform the profile can resolve a link to. */
const SOCIAL_ICONS: Record<SocialPlatform, React.ReactElement> = {
  x: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
  ),
  linkedin: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
  ),
  github: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
  ),
  telegram: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
  ),
  website: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
  ),
};

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
  const [error, setError] = useState<string | null>(null);

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
        setError('User not found');
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [id, user?.id, isAuthenticated, authLoading, usersService, networksService]);

  if (authLoading || isLoading) {
    return (
      <>
        <p style={{ padding: 24, fontFamily: "var(--mac-mono)", fontSize: 12 }}>loading…</p>
      </>
    );
  }

  if (error) {
    return (
      <>
        <div style={{ padding: 24 }}>
          <p style={{ fontFamily: "var(--mac-mono)", fontSize: 12, color: "var(--ink-warn)" }}>{error}</p>
          <button type="button" className="wb-btn" onClick={() => navigate(-1)}>back</button>
        </div>
      </>
    );
  }

  if (!profileData) return null;

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
