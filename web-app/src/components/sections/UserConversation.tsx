import AskIndexes from "components/site/indexes/AskIndexes";
import { useRouteParams } from "hooks/useRouteParams";
import { useApp } from "@/context/AppContext";

export default function UserConversationSection() {
  const { id } = useRouteParams();
  const { chatID } = useApp();

  if (!chatID || !id) {
    return null;
  }

  return <AskIndexes chatID={chatID} did={id} />;
}
