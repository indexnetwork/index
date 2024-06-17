import { DiscoveryType } from "@/types";
import { useParams, usePathname } from "next/navigation";
import { useMemo } from "react";

export const useRouteParams = () => {
  const { id: rawId } = useParams();
  const path = usePathname();

  const isLanding = useMemo(() => path === "/", [path]);
  const isConversation = useMemo(() => path.includes("conversation"), [path]);
  const isDID = useMemo(() => path?.includes("did:"), [path]);

  const isIndex = useMemo(
    () => !isConversation && !isDID,
    [isConversation, isDID],
  );

  let id: string;
  if (isConversation) {
    id = path.replace("/conversation/", "");
  } else id = decodeURIComponent(rawId as string);

  const discoveryType = useMemo(() => {
    if (id) {
      return id.includes("did:") ? DiscoveryType.DID : DiscoveryType.INDEX;
    }
    return undefined;
  }, [id, isConversation]);

  console.log({
    isConversation,
    isLanding,
    isIndex,
    isDID,
    id,
    path,
    discoveryType,
  });
  return { id, isLanding, isConversation, isDID, isIndex, discoveryType };
};
