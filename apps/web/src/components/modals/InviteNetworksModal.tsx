import { useMemo, useState } from "react";

import { useAuthContext } from "@/contexts/AuthContext";
import { useNetworksState } from "@/contexts/NetworksContext";
import { Network } from "@/lib/types";
import { resolveNetworkImageSrc } from "@/lib/network-image";
import { log } from "@/lib/logger";
import { Stage, Window } from "@/components/workbench/Workbench";

const logger = log.ui.from("InviteNetworksModal");

const TILE = ["#FF8A00", "#0055AA", "#C64B8C", "#3E8E7E", "#E8C547", "#7B5EA7"];

function NetworkTile({ id, name, photo }: { id?: string; name?: string; photo?: string | null }) {
  const [broken, setBroken] = useState(false);
  const size = 32;
  if (photo && !broken) {
    return (
      <img
        src={resolveNetworkImageSrc(photo)}
        alt=""
        onError={() => setBroken(true)}
        style={{ flex: "0 0 auto", width: size, height: size, objectFit: "cover", display: "block", border: "1px solid #000", filter: "grayscale(1) contrast(1.05)" }}
      />
    );
  }
  const seed = String(name || id || "");
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const cells = [0, 1, 2, 3].map((i) => TILE[(h >>> (i * 3)) % TILE.length]);
  return (
    <span style={{ flex: "0 0 auto", width: size, height: size, border: "1px solid #000", display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr" }}>
      {cells.map((color, i) => <span key={i} style={{ background: color }} />)}
    </span>
  );
}

export default function InviteNetworksModal({ onClose }: { onClose: () => void }) {
  const { networks } = useNetworksState();
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
        <div style={{ padding: "18px 24px 14px", borderBottom: "2px solid #000" }}>
          <h2 style={{ margin: 0, fontFamily: "var(--mac-mono)", fontSize: 22, fontWeight: 700, color: "#000" }}>invite</h2>
          <p style={{ margin: "6px 0 0", fontFamily: "var(--mac-sans)", fontSize: 13, color: "var(--ink-2)" }}>Share a link to any network you can invite people to.</p>
        </div>
        <div className="mac-scroll" style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", padding: "6px 12px 14px" }}>
          {invitable.map(({ network, isOwner, isPublic, url }) => (
            <div key={network.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderBottom: "1px solid #DDD8CC" }}>
              <NetworkTile id={network.id} name={network.title} photo={network.imageUrl} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 7, fontFamily: "var(--mac-mono)", fontSize: 14, fontWeight: 700, color: "#000" }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{network.title}</span>
                  {isOwner && <span style={{ flex: "0 0 auto", color: "var(--ink-3)", fontFamily: "var(--mac-mono)", fontSize: 13 }}>{isPublic ? "public" : "private"}</span>}
                </span>
                <code style={{ display: "block", marginTop: 3, fontFamily: "var(--mac-mono)", fontSize: 11, color: "var(--ink-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{url}</code>
              </span>
              <button
                type="button"
                onClick={() => void copy(network.id, url)}
                style={{
                  flex: "0 0 auto", cursor: "pointer", padding: "4px 10px", border: "1px solid #000",
                  background: copiedId === network.id ? "#000" : "#fff",
                  color: copiedId === network.id ? "#fff" : "#000",
                  fontFamily: "var(--mac-mono)", fontSize: 11,
                  boxShadow: "1px 1px 0 rgba(0,0,0,0.2)",
                }}>{copiedId === network.id ? "copied" : "copy"}</button>
            </div>
          ))}
          {!invitable.length && (
            <p style={{ margin: "18px 12px", fontFamily: "var(--mac-sans)", fontSize: 13, color: "var(--ink-2)" }}>No networks to invite people to yet.</p>
          )}
        </div>
      </Window>
    </Stage>
  );
}
