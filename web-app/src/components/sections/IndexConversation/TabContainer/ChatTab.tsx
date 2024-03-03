import NoIndexesChat from "@/components/ai/no-indexes";
import AskIndexes from "@/components/site/indexes/AskIndexes";
import { useApp } from "@/context/AppContext";
import LoadingSection from "../../Loading";
import { useIndexConversation } from "../IndexConversationContext";

export default function ChatTabSection() {
  const { viewedIndex, viewedProfile, chatID } = useApp();
  const { itemsState, loading: indexLoading } = useIndexConversation();

  if (indexLoading) {
    return (
      <div
        style={{
          height: "80vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          paddingBottom: "24rem",
        }}
      >
        <LoadingSection />
      </div>
    );
  }

  if (itemsState.items.length > 0 && viewedIndex) {
    return chatID ? (
      <div
        style={{
          display: "flex",
          overflowY: "auto",
          justifyContent: "stretch",
          alignItems: "start",
          maxHeight: "calc(-30rem + 100dvh)",
        }}
      >
        <AskIndexes
          // did={viewedIndex?.ownerDID.id}
          chatID={chatID}
          indexIds={[viewedIndex?.id]}
        />
      </div>
    ) : null;
  }
  return (
    <NoIndexesChat isSelfDid={viewedIndex?.ownerDID.id === viewedProfile?.id} />
  );
}
