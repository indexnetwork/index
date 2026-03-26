import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Loader2, UserCheck, Users, Check, Copy, ArrowRight } from "lucide-react";

import { useAuthContext } from "@/contexts/AuthContext";
import UserAvatar from "@/components/UserAvatar";
import { ContentContainer } from "@/components/layout";
import { getSharedIntent, type SharedIntentData } from "@/services/intents";

const PENDING_CHAT_KEY = "pendingChatUserId";

type ConnectStep = "idle" | "awaiting-auth" | "needs-onboarding";

export default function SharedIntentPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: authLoading, user, openLoginModal } = useAuthContext();

  const [data, setData] = useState<SharedIntentData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showShareLink, setShowShareLink] = useState(false);
  const [copied, setCopied] = useState(false);
  const [connectStep, setConnectStep] = useState<ConnectStep>("idle");
  const connectInitiated = useRef(false);

  useEffect(() => {
    if (!token) return;
    setIsLoading(true);
    getSharedIntent(token)
      .then(setData)
      .catch(() => setError("Intent not found"))
      .finally(() => setIsLoading(false));
  }, [token]);

  // After login resolves, route based on onboarding status
  useEffect(() => {
    if (!isAuthenticated || authLoading || !user || connectStep !== "awaiting-auth") return;
    connectInitiated.current = false;

    if (user.onboarding?.completedAt) {
      localStorage.removeItem(PENDING_CHAT_KEY);
      navigate(`/u/${data?.owner.id}/chat`);
    } else {
      setConnectStep("needs-onboarding");
    }
  }, [isAuthenticated, authLoading, user, connectStep, data, navigate]);

  const handleConnect = () => {
    if (!data) return;
    if (isAuthenticated) {
      navigate(`/u/${data.owner.id}/chat`);
      return;
    }
    localStorage.setItem(PENDING_CHAT_KEY, data.owner.id);
    setConnectStep("awaiting-auth");
    openLoginModal();
  };

  const handleStartOnboarding = () => {
    navigate("/onboarding");
  };

  const handleIKnowSomeone = async () => {
    if (!data) return;

    if (isAuthenticated) {
      const prefill = `Who in my network can help ${data.owner.name} with "${data.intent.summary?.trim() || data.intent.payload}"?`;
      navigate("/", { state: { prefill } });
      return;
    }

    setShowShareLink(true);
  };

  const handleCopyShareLink = async () => {
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
    <div className="min-h-screen bg-[#FAFAFA]">
      <div className="px-6 py-12">
        <ContentContainer className="max-w-md mx-auto space-y-3">
          {/* Unified card: owner + intent */}
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            {/* Owner strip */}
            <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100">
              <UserAvatar
                id={data.owner.id}
                name={data.owner.name}
                avatar={data.owner.avatar}
                size={36}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-black font-ibm-plex-mono leading-none mb-0.5">
                  {data.owner.name}
                </p>
                {data.owner.intro && (
                  <p className="text-xs text-gray-500 truncate">{data.owner.intro}</p>
                )}
              </div>
            </div>

            {/* Intent body */}
            <div className="px-5 py-5">
              <p className="text-base text-black leading-relaxed font-medium mb-3">
                {displayText}
              </p>
              <p className="text-xs text-gray-400 font-ibm-plex-mono">{createdAt}</p>
            </div>
          </div>

          {/* Onboarding nudge — shown after login if not yet onboarded */}
          {connectStep === "needs-onboarding" && (
            <div className="bg-white rounded-lg border border-gray-200 px-5 py-4">
              <p className="text-sm font-medium text-black mb-1">One step before connecting</p>
              <p className="text-xs text-gray-500 mb-4">
                We need to set up your profile so {data.owner.name} knows who's reaching out. It only takes a minute.
              </p>
              <button
                onClick={handleStartOnboarding}
                className="flex items-center gap-2 text-sm font-medium text-black hover:opacity-70 transition-opacity"
              >
                Set up my profile <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Actions */}
          {connectStep !== "needs-onboarding" && (
            showShareLink ? (
              <div className="bg-white rounded-lg border border-gray-200 px-5 py-4 space-y-3">
                <p className="text-sm font-medium text-black">Share this link</p>
                <p className="text-xs text-gray-500">
                  Send it to someone who might match {data.owner.name}'s intent — they can connect directly from this page.
                </p>
                <div className="flex items-center gap-2 bg-gray-50 rounded-sm border border-gray-200 px-3 py-2">
                  <span className="flex-1 text-xs text-gray-500 truncate">
                    {window.location.href}
                  </span>
                  <button
                    onClick={handleCopyShareLink}
                    className="shrink-0 text-gray-400 hover:text-black transition-colors"
                  >
                    {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
                <button
                  onClick={() => setShowShareLink(false)}
                  className="w-full flex items-center justify-center py-2.5 border border-gray-200 rounded-sm text-sm font-medium text-gray-600 hover:border-gray-400 hover:text-black transition-colors"
                >
                  Done
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleConnect}
                  disabled={connectStep === "awaiting-auth"}
                  className="flex-1 flex items-center justify-center gap-2 bg-[#041729] text-white px-6 py-3 rounded-sm text-sm font-medium hover:bg-[#0a2d4a] transition-colors disabled:opacity-60"
                >
                  {connectStep === "awaiting-auth" ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <UserCheck className="w-4 h-4" />
                  )}
                  {connectStep === "awaiting-auth" ? "Waiting..." : "That's me"}
                </button>
                <button
                  onClick={handleIKnowSomeone}
                  className="flex-1 flex items-center justify-center gap-2 bg-white text-black px-6 py-3 border border-gray-200 rounded-sm text-sm font-medium hover:border-gray-400 transition-colors"
                >
                  <Users className="w-4 h-4" />
                  I know someone
                </button>
              </div>
            )
          )}
        </ContentContainer>
      </div>
    </div>
  );
}

export const Component = SharedIntentPage;
