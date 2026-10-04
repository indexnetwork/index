import type { CSSProperties } from "react";

import UserAvatar from "@/components/UserAvatar";
import { AgentFace } from "@/components/workbench/agent-face";
import { useAuthContext } from "@/contexts/AuthContext";

/* Agent avatars, the same rules as the Mac app (apps/mac/src/ui/primitives/avatars.jsx).

   An agent is always somebody's, so it is drawn as its owner's photo with the
   agent's face set into the corner: the photo says who it speaks for, the face
   says it is the agent speaking. The face is a hash of the owner's id, so an
   agent looks the same on every device with nothing stored anywhere. */

type Owner = { id?: string; name?: string | null; photo?: string | null };

/** Strip any trailing agent suffix so we never say "ilya's agent's agent". */
function agentOwner(name?: string | null) {
  return String(name || "").trim().replace(/[’']s\s+agent$|\s+agent$/i, "").trim();
}

/** A nameless agent is yours; an "unknown" counterparty's is still somebody's. */
export function agentLabel(name?: string | null) {
  const owner = agentOwner(name);
  if (!owner) return "your agent";
  if (/^unknown$/i.test(owner)) return "someone's agent";
  return `${owner}'s agent`;
}

function OwnedAgentAvatar({ owner, seed, label, size, style, title }: {
  owner: Owner; seed: string; label: string; size: number; style?: CSSProperties; title?: string;
}) {
  // The mark keeps a floor, since below about 8px the faces become specks, and
  // the ring scales with the avatar so it neither vanishes nor swallows the mark.
  const badge = Math.max(8, Math.round(size * 0.44));
  const ring = Math.max(1, Math.round(size * 0.055 * 10) / 10);
  return (
    <div title={title || label} style={{ position: "relative", width: size, height: size, flex: "0 0 auto", ...style }}>
      <UserAvatar id={owner.id} name={owner.name ?? undefined} avatar={owner.photo} size={size} />
      <span style={{ position: "absolute", right: 0, bottom: 0, display: "block", lineHeight: 0, boxShadow: `0 0 0 ${ring}px #fff` }}>
        <AgentFace seed={seed} size={badge} title={title || label} />
      </span>
    </div>
  );
}

/** Your negotiator: your photo with your agent's face in the corner. */
export function MyAgentAvatar({ size = 22, style, title }: { size?: number; style?: CSSProperties; title?: string }) {
  const { user } = useAuthContext();
  const first = String(user?.name || "").trim().split(/\s+/)[0];
  return (
    <OwnedAgentAvatar
      owner={{ id: user?.id, name: user?.name, photo: user?.avatar }}
      seed={user?.id || user?.name || "index"}
      label={first ? `${first}'s agent` : "your agent"}
      size={size} style={style} title={title}
    />
  );
}

/** Anyone's negotiator, drawn the same way as yours. */
export function TheirAgentAvatar({ owner, size = 22, style, title }: { owner: Owner; size?: number; style?: CSSProperties; title?: string }) {
  return (
    <OwnedAgentAvatar
      owner={owner}
      seed={owner.id || owner.name || "someone"}
      label={agentLabel(owner.name)}
      size={size} style={style} title={title}
    />
  );
}
