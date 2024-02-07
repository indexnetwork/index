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

  return { id, isLanding, discoveryType };
};
