import { useMemo, useState } from "react";

import { useAuthContext } from "@/contexts/AuthContext";
import { useNetworksState } from "@/contexts/NetworksContext";
import { Network } from "@/lib/types";
import { resolveNetworkImageSrc } from "@/lib/network-image";
import { log } from "@/lib/logger";
import { Stage, Window } from "@/components/workbench/Workbench";
import { EmptyState } from "@/components/ui/EmptyState";

const logger = log.ui.from("InviteNetworksModal");

function NetworkTile({ id, name, photo }: { id?: string; name?: string; photo?: string | null }) {
  const [broken, setBroken] = useState(false);
  const size = 28;
  if (photo && !broken) {
    return (
      <img
        src={resolveNetworkImageSrc(photo)}
        alt=""
        onError={() => setBroken(true)}
        style={{ flex: "0 0 auto", width: size, height: size, objectFit: "cover", display: "block", borderRadius: 3 }}
      />
    );
  }
  const initial = String(name || id || "").trim().charAt(0).toUpperCase();
  return (
    <span style={{ flex: "0 0 auto", width: size, height: size, borderRadius: 3, background: "#ededea", color: "#555", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 500 }}>
      {initial}
    </span>
  );
}

export default function InviteNetworksModal({ onClose }: { onClose: () => void }) {
  const { networks, loading, error, refreshNetworks } = useNetworksState();
  const { user } = useAuthContext();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const invitable = useMemo(() => networks
    .map((network) => {
      const viewerRole = (network as Network & { role?: "owner" | "member" }).role;
      const isOwner = viewerRole === "owner" || (viewerRole !== "member" && user?.id === network.user?.id);
      const code = network.permissions?.invitationLink?.code;
      const url = code ? `${window.location.origin}/l/${code}` : "";
      return { network, isOwner, isPublic: network.permissions?.joinPolicy === "anyone", url };
    })
    .filter((item) => (item.isOwner || item.isPublic) && item.url),
    [networks, user?.id]);

  const copy = async (id: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      logger.error("Failed to copy invitation link", { error: err });
    }
  };

  return (
    <Stage width={660} height="min(620px, calc(100vh - 96px))">
      <Window title="invite" onClose={onClose} style={{ height: "100%" }}>
        <div style={{ padding: "18px 24px 14px", borderBottom: "1px solid #e3e3e0" }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 500, color: "var(--ink)" }}>invite</h2>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--ink-2)" }}>share a link to any network you can invite people to.</p>
        </div>
        <div className="mac-scroll" style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", padding: "6px 12px 14px" }}>
          {invitable.map(({ network, isOwner, isPublic, url }) => (
            <div key={network.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderBottom: "1px solid #eeeeec" }}>
              <NetworkTile id={network.id} name={network.title} photo={network.imageUrl} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{network.title}</span>
                  {isOwner && <span style={{ flex: "0 0 auto", color: "var(--ink-3)", fontSize: 12, fontWeight: 400 }}>{isPublic ? "public" : "private"}</span>}
                </span>
                <code style={{ display: "block", marginTop: 1, fontFamily: "var(--wb-code)", fontSize: 11, color: "#666", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{url}</code>
              </span>
              <button
                type="button"
                onClick={() => void copy(network.id, url)}
                style={{
                  flex: "0 0 auto", cursor: "pointer", padding: "4px 10px", border: "1px solid #ddd", borderRadius: 3,
                  background: copiedId === network.id ? "#f0f0ed" : "#fff",
                  color: copiedId === network.id ? "var(--ink-2)" : "var(--ink)",
                  fontSize: 12,
                }}>{copiedId === network.id ? "copied" : "copy"}</button>
            </div>
          ))}
          {!invitable.length && (
            loading ? (
              <EmptyState tone="loading" style={{ padding: "48px 12px" }} />
            ) : error && networks.length === 0 ? (
              <EmptyState
                tone="error"
                style={{ padding: "48px 12px" }}
                message="couldn't load your networks."
                action={{ label: "try again", onClick: () => void refreshNetworks() }}
              />
            ) : networks.length === 0 ? (
              <EmptyState
                style={{ padding: "48px 12px" }}
                message="you're not in any networks yet. create one to invite people."
                action={{ label: "create a network", to: "/networks", primary: true }}
              />
            ) : (
              <EmptyState
                style={{ padding: "48px 12px" }}
                message="none of your networks has a link you can share. an owner can create one in the network's access tab."
                action={{ label: "see networks", to: "/networks" }}
              />
            )
          )}
        </div>
      </Window>
    </Stage>
  );
}
