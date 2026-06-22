import { useEffect } from "react";
import { useNavigate } from "react-router";
import { MessagesSquare } from "lucide-react";
import { useAuthContext } from "@/contexts/AuthContext";
import ChatSidebar from "@/components/ChatSidebar";

export default function ChatLandingPage() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: authLoading } = useAuthContext();

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/', { replace: true });
    }
  }, [authLoading, isAuthenticated, navigate]);

  return (
    <div className="h-full">
      {/* Mobile: full-screen conversation list */}
      <div className="lg:hidden h-full">
        <ChatSidebar />
      </div>
      {/* Desktop: placeholder (ChatSidebar is in the aside via ClientWrapper) */}
      <div className="hidden lg:flex flex-col items-center justify-center h-full text-gray-400">
        <MessagesSquare className="w-12 h-12 mb-3 text-gray-300" />
        <p className="text-sm">Select a conversation</p>
      </div>
    </div>
  );
}

export const Component = ChatLandingPage;
