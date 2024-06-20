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

  const id =
    typeof rawId === "undefined"
      ? rawId
      : isConversation
        ? null
        : decodeURIComponent(rawId as string);

  const conversationId = isConversation
    ? path.replace("/conversation/", "")
    : null;

  return { id, conversationId, isLanding, isConversation, isDID, isIndex };
};
