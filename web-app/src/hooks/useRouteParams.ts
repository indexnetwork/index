import { DiscoveryType } from "@/types";
import { useParams, usePathname } from "next/navigation";
import { useMemo } from "react";

export const useRouteParams = () => {
  const params = useParams();
  const id = decodeURIComponent(params.id as string);

  const path = usePathname();
  const isLanding = useMemo(() => path === "/", [path]);

  const discoveryType = useMemo(
    () => (id.includes("did:") ? DiscoveryType.DID : DiscoveryType.INDEX),
    [id],
  );

  const isDID = useMemo(
    () => discoveryType === DiscoveryType.DID,
    [discoveryType],
  );

  const isIndex = useMemo(
    () => discoveryType === DiscoveryType.INDEX,
    [discoveryType],
  );

  return {
    id,
    isLanding,
    discoveryType,
    isDID,
    isIndex,
  };
};
