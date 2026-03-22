import { useEffect } from "react";
import { useNavigate } from "react-router";
import { useAuthContext } from "@/contexts/AuthContext";
import ClientLayout from "@/components/ClientLayout";
import ChatContent from "@/components/ChatContent";

export default function CopilotChatPage() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: authLoading } = useAuthContext();

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate("/", { replace: true });
    }
  }, [authLoading, isAuthenticated, navigate]);

  return (
    <ClientLayout hideFeedback>
      <ChatContent />
    </ClientLayout>
  );
}

export const Component = CopilotChatPage;
