import { useEffect, useState } from "react";
import { Loader2, Users } from "lucide-react";

import { useNetworks } from "@/contexts/APIContext";
import { useNetworksState } from "@/contexts/IndexesContext";

import NetworkAvatar from "@/components/IndexAvatar";
import { Button } from "@/components/ui/button";
import type { Network } from "@/lib/types";

interface NetworksPanelProps {
  onJoin: (networkId: string, networkTitle: string) => void;
  pendingJoinIds?: Set<string>;
  /** Ranked network IDs from the LLM recommendation. Joinable networks are sorted by this order; unranked appended at end. */
  orderedNetworkIds?: string[];
}

type PanelNetwork = Network & { isMember?: boolean };

function memberCount(network: PanelNetwork): number {
  return network._count?.members ?? (network as unknown as { memberCount?: number }).memberCount ?? 0;
}

/** A single network row: avatar, title, member count, and a trailing action slot. */
function NetworkRow({ network, action }: { network: PanelNetwork; action: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
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
          {memberCount(network)} members
        </p>
      </div>
      {action}
    </div>
  );
}

/**
 * Inline network join panel rendered by the agent's networks_panel block.
 * Shows already-joined networks with a badge and public networks with a Join button.
 * Works in any chat context.
 */
export default function NetworksPanel({ onJoin, pendingJoinIds = new Set(), orderedNetworkIds }: NetworksPanelProps) {
  const indexesService = useNetworks();
  const { indexes: joinedIndexes } = useNetworksState();

  const [publicNetworks, setPublicNetworks] = useState<PanelNetwork[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);

  useEffect(() => {
    indexesService
      .discoverPublicIndexes(1, 50)
      .then((res) => setPublicNetworks(res.data))
      .catch(() => setFetchError(true))
      .finally(() => setLoading(false));
  }, [indexesService]);

  const joinedNonPersonal = joinedIndexes;
  const joinedIds = new Set(joinedNonPersonal.map((i) => i.id));
  const joinable = (() => {
    const unfiltered = publicNetworks.filter((n) => !joinedIds.has(n.id));
    if (!orderedNetworkIds || orderedNetworkIds.length === 0) return unfiltered;
    const orderMap = new Map(orderedNetworkIds.map((id, i) => [id, i]));
    return [...unfiltered].sort((a, b) => {
      const ai = orderMap.get(a.id) ?? Infinity;
      const bi = orderMap.get(b.id) ?? Infinity;
      return ai - bi;
    });
  })();

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
          <NetworkRow
            key={network.id}
            network={network}
            action={
              <span className="text-xs px-1.5 py-0.5 bg-gray-900 text-white rounded-sm font-medium shrink-0">
                Joined
              </span>
            }
          />
        ))}
        {joinable.map((network) => {
          const isPending = pendingJoinIds.has(network.id);
          return (
            <NetworkRow
              key={network.id}
              network={network}
              action={
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onJoin(network.id, network.title)}
                  disabled={isPending}
                  className="text-xs h-7 shrink-0"
                >
                  {isPending ? "Joining…" : "Join"}
                </Button>
              }
            />
          );
        })}
      </div>
    </div>
  );
}
