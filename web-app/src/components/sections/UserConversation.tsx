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
        justifyContent: "stretch",
        alignItems: "start",
        flex: 1,
        overflowY: "auto",
        maxHeight: "calc(100dvh - 12em)",
      }}
    >
      <AskIndexes chatID={chatID} did={id} />
    </div>
  );
}
