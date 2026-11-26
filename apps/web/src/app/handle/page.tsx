import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";

import AppHandoff from "@/components/AppHandoff";
import NetworkAvatar from "@/components/NetworkAvatar";
import { EmptyState } from "@/components/ui/EmptyState";
import NotFound from "@/app/not-found";
import NetworkDetailPage from "@/app/networks/[id]/page";
import { ProfileHold, UserProfile } from "@/app/u/[id]/page";
import { useAuthContext } from "@/contexts/AuthContext";
import { useNetworks } from "@/contexts/APIContext";
import { useNetworksState } from "@/contexts/NetworksContext";
import { apiClient, isNotFoundError } from "@/lib/api";
import { log } from "@/lib/logger";
import { rememberAfterFirstRun } from "@/lib/after-first-run";
import { needsOnboarding } from "@/services/onboarding";
import { NetworkJoinPage } from "@/components/NetworkInviteBoard";
import { useBack } from "@/hooks/useBack";
import { Placeholder } from "@/components/ui/Placeholder";

const logger = log.page.from("handle");

type Holder =
  | { kind: "user"; id: string }
  | { kind: "network"; id: string; title: string; imageUrl: string | null; joinPolicy: "anyone" | "invite_only" };

/**
 * `index.network/<handle>`: a username or a network's link name. The two
 * share one namespace, so the handle alone says which page this is.
 */
export default function HandlePage() {
  const { handle = "" } = useParams();
  const [holder, setHolder] = useState<Holder | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "failed">("loading");
  const [reloadKey, setReloadKey] = useState(0);
  const back = useBack("/");

  useEffect(() => {
    let active = true;
    setState("loading");
    apiClient
      .getPublic<{ handle: Holder }>(`/handles/${encodeURIComponent(handle)}`)
      .then((res) => { if (active) { setHolder(res.handle); setState("ready"); } })
      .catch((err) => {
        if (!active) return;
        if (isNotFoundError(err)) return setState("missing");
        logger.error("Failed to resolve handle", { error: err });
        setState("failed");
      });
    return () => { active = false; };
  }, [handle, reloadKey]);

  if (state === "missing") return <NotFound />;
  if (state !== "ready" || !holder) {
    return (
      <ProfileHold title={handle} onClose={back}>
        {state === "failed"
          ? <EmptyState tone="error" message="couldn't load this page." action={{ label: "try again", onClick: () => setReloadKey((k) => k + 1) }} />
          : <Placeholder.Window rows={3} label="loading this page" />}
      </ProfileHold>
    );
  }

  if (holder.kind === "user") {
    return <AppHandoff kind="u" id={holder.id} webPage={<UserProfile idOrUsername={holder.id} atRoot />} />;
  }
  return <NetworkHandle handle={handle} network={holder} />;
}

/**
 * A network at its link name. Members get the network itself; everyone else
 * gets the same one-column page as an invite link: a join button for open
 * networks, and for invite-only ones, how to get in. A signed-out click signs in
 * and comes back with `?join=1`, which joins without asking twice.
 */
function NetworkHandle({ handle, network }: { handle: string; network: Extract<Holder, { kind: "network" }> }) {
  const { isAuthenticated, isLoading: authLoading, user } = useAuthContext();
  const { networks, loading: networksLoading, addNetwork } = useNetworksState();
  const networksService = useNetworks();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [preview, setPreview] = useState<{ prompt?: string | null; _count?: { members: number } } | null>(null);
  const [joining, setJoining] = useState(false);
  const [failed, setFailed] = useState(false);
  const autoJoined = useRef(false);

  const isMember = !!networks?.some((n) => n.id === network.id);
  const open = network.joinPolicy === "anyone";
  const returning = params.get("join") === "1";

  useEffect(() => {
    if (!open || isMember) return;
    let active = true;
    apiClient
      .getPublic<{ network: { prompt?: string | null; _count?: { members: number } } }>(`/networks/public/${network.id}`)
      .then((res) => { if (active) setPreview(res.network); })
      .catch((err) => logger.error("Failed to load network preview", { error: err }));
    return () => { active = false; };
  }, [open, isMember, network.id]);

  const join = useCallback(async () => {
    // Signed-out visitors sign in and come back here with ?join=1, which joins.
    if (!isAuthenticated) {
      navigate(`/login?next=${encodeURIComponent(`/${handle}?join=1`)}`);
      return;
    }
    setJoining(true);
    setFailed(false);
    try {
      const result = await networksService.joinNetwork(network.id);
      setParams({}, { replace: true });
      // New here: first run, which ends back on this network.
      if (needsOnboarding(user)) {
        rememberAfterFirstRun(`/${handle}`);
        navigate("/onboarding", { replace: true });
        return;
      }
      // Membership flips this page over to the network itself.
      if (!result.alreadyMember) addNetwork(result.network);
    } catch (err) {
      logger.error("Failed to join network", { error: err });
      setFailed(true);
    } finally {
      setJoining(false);
    }
  }, [isAuthenticated, navigate, handle, networksService, network.id, setParams, user, addNetwork]);

  // Back from signing in to join: join now.
  useEffect(() => {
    if (!returning || !open || !isAuthenticated || networksLoading || isMember || autoJoined.current) return;
    autoJoined.current = true;
    void join();
  }, [returning, open, isAuthenticated, networksLoading, isMember, join]);

  if (authLoading || (isAuthenticated && networksLoading)) {
    return (
      <ProfileHold title={network.title} onClose={() => navigate("/")}>
        <Placeholder.Window rows={4} label="loading this network" />
      </ProfileHold>
    );
  }

  if (isMember) return <NetworkDetailPage networkIdOverride={network.id} basePath={`/${handle}`} />;

  const members = preview?._count?.members;

  return (
    <NetworkJoinPage
      scroll
      kicker={open && members != null ? `${members.toLocaleString()} ${members === 1 ? "member" : "members"}` : "network on index"}
      title={network.title}
      avatar={<NetworkAvatar id={network.id} title={network.title} imageUrl={network.imageUrl} size={56} />}
      lede={open ? preview?.prompt : undefined}
    >
      <div className="invite-actions">
        {open ? (
          <div className="invite-way">
            <button aria-busy={joining} type="button" className="site-btn site-btn--block" disabled={joining} onClick={() => void join()}>
              {joining ? "joining…" : "join network →"}
            </button>
            <p className="invite-hint" role="status">
              {failed ? "couldn't join right now. try again in a moment." : "your agent starts looking among its members right away."}
            </p>
          </div>
        ) : (
          <>
            <p className="site-p">this network is invite-only. ask a member for its invite link, and it lets you straight in.</p>
            <div className="site-btn-row">
              <Link className="site-btn site-btn--secondary" to="/">{isAuthenticated ? "go home →" : "see what index is →"}</Link>
            </div>
          </>
        )}
      </div>
    </NetworkJoinPage>
  );
}

export const Component = HandlePage;
