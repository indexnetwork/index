import NoIndexesChat from "@/components/ai/no-indexes";
import AskIndexes from "@/components/site/indexes/AskIndexes";
import { useApp } from "@/context/AppContext";
import { useIndexConversation } from "../IndexConversationContext";

export default function ChatTabSection() {
  const { viewedIndex, viewedProfile } = useApp();
  const { itemsState } = useIndexConversation();
  // if (indexLoading) {
  //   return (
  //     <div
  //       style={{
  //         height: "80vh",
  //         display: "flex",
  //         flexDirection: "column",
  //         alignItems: "center",
  //         justifyContent: "center",
  //       }}
  //     >
  //       <LoadingSection />
  //     </div>
  //   );
  // }

  if (itemsState.items.length > 0 && viewedIndex) {
    return (
      <div
        style={{
          display: "flex",
          overflowY: "auto",
          justifyContent: "stretch",
          alignItems: "start",
          maxHeight: "calc(-30rem + 100dvh)",
        }}
      >
        <AskIndexes />
      </div>
    );
  }
  return (
    <NoIndexesChat
      isSelfDid={viewedIndex?.controllerDID.id === viewedProfile?.id}
    />
  );
}
