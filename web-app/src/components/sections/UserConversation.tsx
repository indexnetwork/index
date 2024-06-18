import { useApp } from "@/context/AppContext";
import AskIndexes from "components/site/indexes/AskIndexes";

export default function UserConversationSection() {
  const { setViewedConversation, deleteConversation } = useApp();

  const handleNewChat = () => {
    setViewedConversation(undefined);
  };

  const handleDeleteChat = () => {
    deleteConversation();
    setViewedConversation(undefined);
  };

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        height: "100%",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          alignSelf: "end",
          padding: "16px",
          display: "flex",
          flexDirection: "row",
          gap: "16px",
        }}
      >
        <button onClick={handleNewChat}> new chat </button>
        <button onClick={handleDeleteChat}> delete chat </button>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "start",
          flex: 1,
          overflowY: "auto",
          maxHeight: "calc(100dvh - 12em)",
          height: "100%",
        }}
      >
        <AskIndexes />
      </div>
    </div>
  );
}
