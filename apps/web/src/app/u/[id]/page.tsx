import { useState, useEffect } from "react";
import "@/styles/split.css";
import { Check, Copy } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { useAuthContext } from "@/contexts/AuthContext";
import { useUsers, useNetworks, useOpportunities } from "@/contexts/APIContext";
import AppHandoff from "@/components/AppHandoff";
import { User } from "@/lib/types";
import { Link } from "react-router";
import { Stage, Window } from "@/components/workbench/Workbench";
import { useInAppFrame } from "@/components/intents-home/appFrameContext";
import type { ReactNode } from "react";
import NegotiationHistory from "@/components/NegotiationHistory";
import ChatView from "@/components/chat/ChatView";
import { PersonHead, PersonPane, PersonSummary, type PersonTab } from "@/components/intents-home/PersonPane";
import { getPublicUserProfile, type AgentStats } from "@/services/users";
import { log } from "@/lib/logger";
import { APIError, isNotFoundError } from "@/lib/api";
import { EmptyState } from "@/components/ui/EmptyState";
import { resolveSocials } from "@/lib/socials";
import { SOCIAL_ICONS } from "@/components/SocialIcons";
import { useBack } from "@/hooks/useBack";
import { clearPendingPair, readPendingPair, rememberPendingPair } from "@/lib/pending-pair";
import { awaitsFirstIntent, needsOnboarding } from "@/services/onboarding";
import { Placeholder } from "@/components/ui/Placeholder";
// Its in-app layout (.pl) lives here; /u/:id can be the first page opened.
import "@/styles/plain.css";

const logger = log.page.from("u/[id]");

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
  // `?as=public` renders the page as a signed-out visitor sees it.
  const asPublic = searchParams.get("as") === "public";
  const signedIn = isAuthenticated && !asPublic;
  const usersService = useUsers();
  const networksService = useNetworks();
  const opportunitiesService = useOpportunities();

  const [profileData, setProfileData] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<"notFound" | "failed" | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [oppKey, setOppKey] = useState(0);
  const [pairing, setPairing] = useState(false);
  const [pairError, setPairError] = useState(false);
  const [agentStats, setAgentStats] = useState<AgentStats | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [tab, setTab] = useState<PersonTab>("summary");
  const [chatCount, setChatCount] = useState(0);
  const inFrame = useInAppFrame();

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

        // Signed in, someone else: no network in common means both join Index Early, which pairs the agents.
        // The page waits for it, so the summary's networks and opportunities load after.
        if (signedIn && user?.id && user.id !== profile.id) {
          try {
            const networks = await networksService.getSharedNetworks(profile.id);
            if (networks.length === 0) {
              const ensured = await networksService.ensureSharedNetwork(profile.id);
              if (ensured.joined && active) setOppKey((k) => k + 1);
            }
          } catch (err) {
            logger.error('Failed to fetch shared networks', { error: err });
          }
        }
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

  // Opens an X compose window with the profile link; X unfurls it into a card.
  const profileUrl = () =>
    profileData ? `${window.location.origin}${profileData.username ? `/${profileData.username}` : `/u/${profileData.id}`}` : "";

  const shareProfile = () => {
    if (!profileData) return;
    const url = profileUrl();
    const intent = new URL("https://x.com/intent/post");
    intent.searchParams.set("text", "Have your agent talk to my agent on @indexnetwork_");
    intent.searchParams.set("url", url);
    window.open(intent.toString(), "_blank", "noopener,noreferrer");
  };

  const copyProfileLink = async () => {
    if (!profileData) return;
    try {
      await navigator.clipboard.writeText(profileUrl());
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch (err) {
      logger.error('Failed to copy profile link', { error: err });
    }
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
      <ProfileHold onClose={back}>
            {authLoading || isLoading ? (
              <Placeholder.Window rows={3} label="loading this profile" />
            ) : error === "failed" ? (
              <EmptyState
                tone="error"
                message="couldn't load this profile."
                action={{ label: "try again", onClick: () => setReloadKey((k) => k + 1) }}
              />
            ) : (
              <EmptyState message="couldn't find this person." action={{ label: "go back", onClick: back }} />
            )}
      </ProfileHold>
    );
  }

  const person = { name: profileData.name, userId: profileData.id, avatar: profileData.avatar, notOnIndex: profileData.emailVerified === false };

  // Someone else, signed in: the very pane the app opens for them (summary · chat), filling the page.
  if (isOtherUser) {
    return (
      <PersonFrame onClose={back}>
        <PersonPane
          person={person}
          tab={tab}
          onTab={(next) => (next === "chat" && !inFrame ? navigate(`/u/${profileData.id}/chat`) : setTab(next))}
          chatCount={chatCount || undefined}
          linked={false}
          summary={<PersonSummary key={oppKey} userId={profileData.id} name={profileData.name} avatar={profileData.avatar} fresh={oppKey > 0} none={(
            <p className="sv-dimp">our agents are already paired. they&apos;re talking in the background, and we&apos;ll both hear about it the moment something&apos;s worth meeting over.</p>
          )} />}
          chat={<ChatView key={profileData.id} userId={profileData.id} userName={profileData.name} userAvatar={profileData.avatar ?? undefined} onClose={() => setTab("summary")} bare onCount={setChatCount} />}
        />
      </PersonFrame>
    );
  }

  // Sorted on where each link actually points rather than on its stored label,
  // so a LinkedIn URL filed under 'custom' shows as LinkedIn instead of
  // vanishing, and anything that resolves to no address is left out entirely.
  const socialLinks = resolveSocials(profileData.socials);
  const handle = profileData.username
    ? `@${profileData.username}`
    : isSelf ? <Link to="/profile/edit" className="loc" style={{ textDecoration: "underline" }}>set a username</Link> : null;

  // Your own profile, or anyone's when signed out: the same header and sections as the pane.
  return (
    <PersonFrame onClose={back}>
      <div className="sv-person" aria-label={profileData.name}>
        <PersonHead
          person={person}
          handle={handle}
          location={profileData.location}
          linked={false}
          actions={isSelf && (
            <>
              <button type="button" className="sv-btn sm" onClick={copyProfileLink} aria-label={linkCopied ? "link copied" : "copy link"} title={linkCopied ? "copied" : "copy link"}>
                {linkCopied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
              </button>
              <button type="button" className="sv-btn sm" onClick={shareProfile}>share on X</button>
              <button type="button" className="sv-open" onClick={() => navigate("/profile/edit")}>edit profile ›</button>
            </>
          )}
        />
        <div className="sv-body sv-sum">
          <h4 className="sv-h4">bio</h4>
          {profileData.intro ? <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{profileData.intro}</p> : <p className="sv-dimp">no bio yet.</p>}

          {socialLinks.length > 0 && (
            <>
              <h4 className="sv-h4">elsewhere</h4>
              <div className="sv-socials">
                {socialLinks.map((s) => (
                  <a className="sv-soc" key={s.href} href={s.href} target="_blank" rel="noopener noreferrer" title={s.platform}>{SOCIAL_ICONS[s.platform]}<span>{s.handle}</span></a>
                ))}
              </div>
            </>
          )}

          {!signedIn && (
            <>
              <h4 className="sv-h4">opportunities</h4>
              <div className="sv-pairme">
                <p>Pair your agent with mine. They&apos;ll keep talking in the background, exploring possibilities and bringing us together whenever something interesting emerges.</p>
                <button type="button" className="sv-btn go" onClick={pair} disabled={pairing} aria-busy={pairing}>
                  {pairing ? "pairing…" : "pair agents"}
                </button>
                {pairError && <div className="sv-pair-err" role="alert">no discoverable intents in a shared network.</div>}
              </div>
            </>
          )}

          {isSelf && (
            <>
              <h4 className="sv-h4">agent analytics</h4>
              <div className="sv-stats">
                {([
                  { label: "paired agents", value: agentStats?.pairedAgents, hint: "people your agent has negotiated with" },
                  { label: "negotiations", value: agentStats?.negotiations, hint: "every conversation, all time" },
                  { label: "in progress", value: agentStats?.inProgress, hint: "still talking" },
                  { label: "connections", value: agentStats?.connected, hint: "both of you said yes" },
                ]).map((tile) => (
                  <div className="sv-stat" key={tile.label} title={tile.hint}>
                    <b>{tile.value ?? "–"}</b>
                    <span>{tile.label}</span>
                  </div>
                ))}
              </div>

              <h4 className="sv-h4">agent log</h4>
              <NegotiationHistory userId={profileData.id} />
            </>
          )}
        </div>
      </div>
    </PersonFrame>
  );
}

export const Component = UserProfilePage;

/**
 * Where a loaded profile sits: in the app it fills the page like the
 * conversations pane; elsewhere (phones, signed out) it gets its own window.
 */
function PersonFrame({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const inFrame = useInAppFrame();
  const { isAuthenticated } = useAuthContext();
  const pane = <div className="sv"><section className="sv-pane">{children}</section></div>;
  if (inFrame) return pane;
  // Signed out, the page is usually where a shared link landed: nothing behind it to close back to.
  return (
    <Stage width={720} height="min(720px, calc(100vh - 112px))">
      <Window title="profile" onClose={isAuthenticated ? onClose : undefined} style={{ height: "100%" }}>{pane}</Window>
    </Stage>
  );
}

/**
 * Where the profile sits. Signed in on desktop, the app's main window already
 * says "profile", so it fills that window like Home and Intents. Elsewhere
 * (phones, signed out) it keeps its own window on the desktop.
 */
function ProfileFrame({ title = "profile", width, height, onClose, children }: { title?: string; width: number; height?: string; onClose: () => void; children: ReactNode }) {
  const inFrame = useInAppFrame();
  const { isAuthenticated } = useAuthContext();
  if (inFrame) {
    return (
      <div className="ih-view pl">
        <div className="pl-wrap"><div className="pl-page">{children}</div></div>
      </div>
    );
  }
  return (
    <Stage width={width} height={height}>
      <Window title={title} onClose={isAuthenticated ? onClose : undefined} style={height ? { height: "100%" } : undefined}>{children}</Window>
    </Stage>
  );
}

/**
 * A page's loading or error state, held where the page itself will appear:
 * in the app's main window it starts on the page's left edge, so nothing
 * jumps when the profile arrives. Shared with `/:handle`, which shows it
 * while it works out whose page the handle is.
 */
export function ProfileHold({ title, onClose, children }: { title?: string; onClose: () => void; children: ReactNode }) {
  const inFrame = useInAppFrame();
  return (
    <ProfileFrame title={title} width={480} onClose={onClose}>
      <div style={{ padding: inFrame ? "24px 0" : "36px 24px" }}>{children}</div>
    </ProfileFrame>
  );
}
