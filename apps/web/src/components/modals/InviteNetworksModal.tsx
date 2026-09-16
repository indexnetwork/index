import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, Globe, Lock, X } from "lucide-react";

import NetworkAvatar from "@/components/NetworkAvatar";
import { useAuthContext } from "@/contexts/AuthContext";
import { useNetworksState } from "@/contexts/NetworksContext";
import { Network } from "@/lib/types";
import { log } from "@/lib/logger";

const logger = log.ui.from("InviteNetworksModal");

interface InviteNetworksModalProps {
  onClose: () => void;
}

/**
 * Lists every network the signed-in user can hand someone a link to: their own
 * networks (public or private) plus the public ones they are a member of.
 */
export default function InviteNetworksModal({ onClose }: InviteNetworksModalProps) {
  const { networks } = useNetworksState();
  const { user } = useAuthContext();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const invitable = useMemo(() => networks
    .map((network) => {
      const viewerRole = (network as Network & { role?: 'owner' | 'member' }).role;
      const isOwner = viewerRole === 'owner'
        || (viewerRole !== 'member' && user?.id === network.user?.id);
      return { network, isOwner, isPublic: network.permissions?.joinPolicy === 'anyone' };
    })
    .filter(({ isOwner, isPublic, network }) => (isOwner || isPublic) && network.permissions?.invitationLink?.code),
    [networks, user?.id]);

  const handleCopy = async (network: Network) => {
    const code = network.permissions?.invitationLink?.code;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/l/${code}`);
      setCopiedId(network.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      logger.error("Failed to copy invitation link", { error: err });
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-lg shadow-xl w-full max-w-xl mx-4 p-6 flex flex-col gap-5 max-h-[80vh]">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-gray-900 font-ibm-plex-mono">Invite</h2>
            <p className="text-sm text-gray-500 mt-1">
              Share a link to any network you can invite people to.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0 mt-0.5"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {invitable.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">
            You don&apos;t have any networks to invite people to yet.
          </p>
        ) : (
          <div className="overflow-y-auto divide-y divide-gray-100">
            {invitable.map(({ network, isOwner, isPublic }) => (
              <div key={network.id} className="flex items-center gap-3 py-3">
                <NetworkAvatar id={network.id} title={network.title} imageUrl={network.imageUrl} size={32} rounded="full" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-black truncate flex items-center gap-1.5">
                    {network.title}
                    {isOwner && (
                      isPublic
                        ? <Globe className="h-3 w-3 text-gray-400 flex-shrink-0" aria-label="Public" />
                        : <Lock className="h-3 w-3 text-gray-400 flex-shrink-0" aria-label="Private" />
                    )}
                  </p>
                  <code className="text-xs text-gray-400 truncate block">
                    {`${window.location.origin}/l/${network.permissions?.invitationLink?.code}`}
                  </code>
                </div>
                <button
                  type="button"
                  aria-label={`Copy invitation link for ${network.title}`}
                  onClick={() => handleCopy(network)}
                  className={`flex-shrink-0 p-1.5 rounded-sm transition-colors ${copiedId === network.id ? 'text-green-600' : 'text-gray-400 hover:text-black'}`}
                >
                  {copiedId === network.id ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
