import { EmptyScreen } from "@/components/ai/empty-screen";
import { useApp } from "@/context/AppContext";
import AskIndexes from "@/components/site/indexes/AskIndexes";
import React from "react";
import LoadingSection from "../../Loading";
import { useIndexConversation } from "../IndexConversationContext";

export default function ChatTabSection() {
  const { viewedIndex, chatID } = useApp();
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
    return chatID ? (
      <AskIndexes chatID={chatID} indexes={[viewedIndex?.id!]} />
    ) : null;
  }
    return <EmptyScreen setInput={() => {}} contextMessage="your responses" />;
}
