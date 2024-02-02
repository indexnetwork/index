import React from "react";
import AskIndexes from "@/components/site/indexes/AskIndexes";
import { useApp } from "@/components/site/context/AppContext";
import { useRouteParams } from "@/hooks/useRouteParams";
import { useIndexConversation } from "../IndexConversationContext";
import LoadingSection from "../../Loading";
import { EmptyScreen } from "@/components/ai/empty-screen";

export default function ChatTabSection() {
  const { id: indexID } = useRouteParams();
  const { viewedIndex } = useApp();
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
        }}
      >
        <LoadingSection />
      </div>
    );
  }

  if (itemsState.items.length > 0) {
    return <AskIndexes id={indexID} indexes={[viewedIndex?.id!]} />;
  } else {
    return <EmptyScreen setInput={() => {}} contextMessage="your responses" />;
  }
}
