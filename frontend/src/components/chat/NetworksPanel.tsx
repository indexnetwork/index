import { useEffect, useState } from "react";
import { Loader2, Users } from "lucide-react";

import { useNetworks } from "@/contexts/APIContext";
import { useNetworksState } from "@/contexts/NetworksContext";

import NetworkAvatar from "@/components/NetworkAvatar";
import { Button } from "@/components/ui/button";
import type { Network } from "@/lib/types";

interface NetworksPanelProps {
  onJoin: (networkId: string, networkTitle: string) => void;
  pendingJoinIds?: Set<string>;
}

/**
 * Inline network join panel rendered by the agent's networks_panel block.
 * Shows already-joined networks with a badge and public networks with a Join button.
 * Works in any chat context — onboarding or regular chat.
 */
export default function NetworksPanel({ onJoin, pendingJoinIds = new Set() }: NetworksPanelProps) {
  const networksService = useNetworks();
  const { networks: joinedNetworks } = useNetworksState();

  const [publicNetworks, setPublicNetworks] = useState<(Network & { isMember?: boolean })[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);

  useEffect(() => {
    networksService
      .discoverPublicNetworks(1, 50)
      .then((res) => setPublicNetworks(res.data))
      .catch(() => setFetchError(true))
      .finally(() => setLoading(false));
  }, [networksService]);

  const joinedNonPersonal = joinedNetworks.filter((i) => !i.isPersonal);
  const joinedIds = new Set(joinedNonPersonal.map((i) => i.id));
  const joinable = publicNetworks.filter((n) => !joinedIds.has(n.id));

  if (loading) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
      </div>
    );
  }

  if (fetchError) {
    return (
      <p className="text-sm text-gray-400 py-4">Failed to load networks. Please try again later.</p>
    );
  }

  if (joinedNonPersonal.length === 0 && publicNetworks.length === 0) {
    return (
      <p className="text-sm text-gray-400 py-4">No public networks available</p>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-[#E8E8E8] bg-[#FAFAFA] overflow-hidden">
      <div className="divide-y divide-gray-100">
        {joinedNonPersonal.map((network) => (
          <div key={network.id} className="flex items-center gap-3 px-4 py-2.5">
            <div className="w-9 h-9 rounded-full overflow-hidden shrink-0">
              <NetworkAvatar
                id={network.id}
                title={network.title}
                imageUrl={network.imageUrl}
                size={36}
                rounded="full"
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-black truncate">{network.title}</p>
              <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                <Users className="w-3 h-3" />
                {network._count?.members ?? (network as unknown as { memberCount?: number }).memberCount ?? 0} members
              </p>
            </div>
            <span className="text-xs px-1.5 py-0.5 bg-gray-900 text-white rounded-sm font-medium shrink-0">
              Joined
            </span>
          </div>
        ))}
        {joinable.map((network) => {
          const isPending = pendingJoinIds.has(network.id);
          return (
            <div key={network.id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="w-9 h-9 rounded-full overflow-hidden shrink-0">
                <NetworkAvatar
                  id={network.id}
                  title={network.title}
                  imageUrl={network.imageUrl}
                  size={36}
                  rounded="full"
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-black truncate">{network.title}</p>
                <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                  <Users className="w-3 h-3" />
                  {network._count?.members ?? (network as unknown as { memberCount?: number }).memberCount ?? 0} members
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onJoin(network.id, network.title)}
                disabled={isPending}
                className="text-xs h-7 shrink-0"
              >
                {isPending ? "Joining…" : "Join"}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
