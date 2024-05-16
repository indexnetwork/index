import { useApp } from "@/context/AppContext";
import AskIndexes from "components/site/indexes/AskIndexes";
import { useRouteParams } from "hooks/useRouteParams";

export default function UserConversationSection() {
  const { id } = useRouteParams();
  const { chatID } = useApp();

  if (!chatID || !id) {
    return null;
  }

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        height: "100%",
      }}
    >
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
        <AskIndexes chatID={chatID} sources={[id]} />
      </div>
    </div>
  );
}
