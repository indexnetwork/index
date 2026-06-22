import { useParams } from "react-router";
import ClientLayout from "@/components/ClientLayout";
import ChatContent from "@/components/ChatContent";

export default function DiscoverySessionPage() {
  const { id } = useParams();
  return (
    <ClientLayout>
      <ChatContent sessionIdParam={id} />
    </ClientLayout>
  );
}

export const Component = DiscoverySessionPage;
