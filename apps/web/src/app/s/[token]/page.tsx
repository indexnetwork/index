import { useParams } from "react-router";
import SharedChatView from "@/components/SharedChatView";

export default function SharedConversationPage() {
  const { token } = useParams();
  return <SharedChatView token={token!} />;
}

export const Component = SharedConversationPage;
