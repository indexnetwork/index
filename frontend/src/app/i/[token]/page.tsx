import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Loader2, MessageCircle, Share2, Check } from "lucide-react";

import { useAuthContext } from "@/contexts/AuthContext";
import UserAvatar from "@/components/UserAvatar";
import { ContentContainer } from "@/components/layout";
import { getSharedIntent, type SharedIntentData } from "@/services/intents";

export default function SharedIntentPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: authLoading } = useAuthContext();

  const [data, setData] = useState<SharedIntentData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!token) return;
    setIsLoading(true);
    getSharedIntent(token)
      .then(setData)
      .catch(() => setError("Intent not found"))
      .finally(() => setIsLoading(false));
  }, [token]);

  const handleConnect = () => {
    if (!data) return;
    if (isAuthenticated) {
      navigate(`/u/${data.owner.id}/chat`);
    } else {
      const returnTo = `/u/${data.owner.id}/chat`;
      navigate(`/onboarding?returnTo=${encodeURIComponent(returnTo)}`);
    }
  };

  const handleCopyLink = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isLoading || authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-bold text-gray-900 mb-2 font-ibm-plex-mono">Not Found</h2>
          <p className="text-gray-500 font-ibm-plex-mono mb-4">This intent link is invalid or has been removed.</p>
          <button
            onClick={() => navigate("/")}
            className="px-4 py-2 bg-[#041729] text-white rounded-sm text-sm font-medium hover:bg-[#0a2d4a] transition-colors"
          >
            Go Home
          </button>
        </div>
      </div>
    );
  }

  const displayText = data.intent.summary?.trim() || data.intent.payload;
  const createdAt = new Date(data.intent.createdAt).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="min-h-screen bg-gray-50/50">
      <div className="px-6 lg:px-8 py-12 pb-20">
        <ContentContainer className="max-w-xl mx-auto space-y-8">
          {/* Intent Card */}
          <div className="bg-white rounded-lg border border-gray-200 p-8 shadow-sm">
            <p className="text-lg text-gray-900 leading-relaxed font-medium mb-4">
              {displayText}
            </p>
            <p className="text-xs text-gray-400 font-ibm-plex-mono">{createdAt}</p>
          </div>

          {/* Owner */}
          <div className="flex items-center gap-3">
            <UserAvatar
              id={data.owner.id}
              name={data.owner.name}
              avatar={data.owner.avatar}
              size={40}
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-gray-900 font-ibm-plex-mono truncate">
                {data.owner.name}
              </p>
              {data.owner.intro && (
                <p className="text-xs text-gray-500 truncate">{data.owner.intro}</p>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleConnect}
              className="flex-1 flex items-center justify-center gap-2 bg-[#041729] text-white px-6 py-3 rounded-sm text-sm font-medium hover:bg-[#0a2d4a] transition-colors"
            >
              <MessageCircle className="w-4 h-4" />
              Connect
            </button>
            <button
              onClick={handleCopyLink}
              className="flex items-center gap-2 px-4 py-3 border border-gray-200 rounded-sm text-sm text-gray-600 hover:border-gray-400 hover:text-gray-900 transition-colors"
            >
              {copied ? <Check className="w-4 h-4" /> : <Share2 className="w-4 h-4" />}
              {copied ? "Copied" : "Share"}
            </button>
          </div>
        </ContentContainer>
      </div>
    </div>
  );
}

export const Component = SharedIntentPage;
