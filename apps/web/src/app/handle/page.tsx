import { useEffect, useState } from "react";
import { useParams } from "react-router";

import AppHandoff from "@/components/AppHandoff";
import NetworkAvatar from "@/components/NetworkAvatar";
import { EmptyState } from "@/components/ui/EmptyState";
import { Stage, Window } from "@/components/workbench/Workbench";
import NotFound from "@/app/not-found";
import NetworkDetailPage from "@/app/networks/[id]/page";
import { UserProfile } from "@/app/u/[id]/page";
import { useAuthContext } from "@/contexts/AuthContext";
import { useNetworks } from "@/contexts/APIContext";
import { useNetworksState } from "@/contexts/NetworksContext";
import { useNotifications } from "@/contexts/NotificationContext";
import { apiClient, isNotFoundError } from "@/lib/api";
import { log } from "@/lib/logger";
import { useBack } from "@/hooks/useBack";

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
      <Stage width={480}>
        <Window title={handle} onClose={back}>
          <div style={{ padding: "36px 24px" }}>
            {state === "failed"
              ? <EmptyState tone="error" message="couldn't load this page." action={{ label: "try again", onClick: () => setReloadKey((k) => k + 1) }} />
              : <EmptyState tone="loading" />}
          </div>
        </Window>
      </Stage>
    );
  }

  if (holder.kind === "user") {
    return <AppHandoff kind="u" id={holder.id} webPage={<UserProfile idOrUsername={holder.id} atRoot />} />;
  }
  return <NetworkHandle handle={handle} network={holder} />;
}

/**
 * A network at its link name. Members get the network itself; everyone else
 * gets what its join policy allows: a preview with a join button for open
 * networks, and only the name for invite-only ones.
 */
function NetworkHandle({ handle, network }: { handle: string; network: Extract<Holder, { kind: "network" }> }) {
  const { isAuthenticated, isLoading: authLoading, openLoginModal } = useAuthContext();
  const { networks, loading: networksLoading, addNetwork } = useNetworksState();
  const networksService = useNetworks();
  const { error } = useNotifications();
  const back = useBack("/");
  const [preview, setPreview] = useState<{ prompt?: string | null; _count?: { members: number } } | null>(null);
  const [joining, setJoining] = useState(false);

  const isMember = !!networks?.some((n) => n.id === network.id);
  const open = network.joinPolicy === "anyone";

  useEffect(() => {
    if (!open || isMember) return;
    let active = true;
    apiClient
      .getPublic<{ network: { prompt?: string | null; _count?: { members: number } } }>(`/networks/public/${network.id}`)
      .then((res) => { if (active) setPreview(res.network); })
      .catch((err) => logger.error("Failed to load network preview", { error: err }));
    return () => { active = false; };
  }, [open, isMember, network.id]);

  if (authLoading || (isAuthenticated && networksLoading)) {
    return (
      <Stage width={480}>
        <Window title={network.title} onClose={back}>
          <div style={{ padding: "36px 24px" }}><EmptyState tone="loading" /></div>
        </Window>
      </Stage>
    );
  }

  if (isMember) return <NetworkDetailPage networkIdOverride={network.id} basePath={`/${handle}`} />;

  const join = async () => {
    // Signed-out visitors come back here after signing in, then join.
    if (!isAuthenticated) return openLoginModal(window.location.href);
    setJoining(true);
    try {
      const result = await networksService.joinNetwork(network.id);
      // Membership flips this page over to the network itself.
      if (!result.alreadyMember) addNetwork(result.network);
    } catch (err) {
      logger.error("Failed to join network", { error: err });
      error("Couldn't join this network");
    } finally {
      setJoining(false);
    }
  };

  return (
    <Stage width={480}>
      <Window title="network" onClose={back}>
        <div style={{ padding: "22px 24px", display: "grid", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <NetworkAvatar id={network.id} title={network.title} imageUrl={network.imageUrl} size={54} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: "var(--amiga-title)", fontSize: 20, fontWeight: 600 }}>{network.title}</div>
              {open && preview?._count && (
                <div style={{ marginTop: 2, fontFamily: "var(--mac-mono)", fontSize: 11, color: "var(--ink-2)" }}>
                  {preview._count.members} {preview._count.members === 1 ? "member" : "members"}
                </div>
              )}
            </div>
          </div>
          {open ? (
            <>
              {preview?.prompt && (
                <p style={{ margin: 0, fontFamily: "var(--mac-sans)", fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{preview.prompt}</p>
              )}
              <div>
                <button type="button" className="wb-btn primary" disabled={joining} onClick={() => void join()}>
                  {joining ? "joining…" : "join network"}
                </button>
              </div>
            </>
          ) : (
            <EmptyState framed message="this network is invite-only. ask a member for an invite link." />
          )}
        </div>
      </Window>
    </Stage>
  );
}

export const Component = HandlePage;
