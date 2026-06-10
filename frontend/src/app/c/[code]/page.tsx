import { useState, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router";
import { Loader2 } from "lucide-react";

import { useAuthContext } from "@/contexts/AuthContext";
import { useAuthenticatedAPI } from "@/lib/api";
import ClientLayout from "@/components/ClientLayout";
import { ContentContainer } from "@/components/layout";

type ConnectLinkGoResponse =
  | { url: string }
  | { kind: "approve_introduction" };

type PageStep = "loading" | "intro-approved" | "error";

/**
 * Connect-link continuation page.
 *
 * `/c/:code` is the frontend leg of the two-step connect-link flow:
 * 1. The backend `GET /c/:code` bridge redirects here without a DB lookup.
 * 2. This page handles authentication and then calls authenticated
 *    `GET /api/c/:code/go` to resolve the opportunity and redirect.
 *
 * Unauthenticated visitors are prompted to log in; after login Better Auth
 * returns them to this same URL so the flow continues automatically.
 */
export default function ConnectLinkPage() {
  const { code } = useParams();
  const { isAuthenticated, isLoading: authLoading, openLoginModal } = useAuthContext();
  const api = useAuthenticatedAPI();
  const navigate = useNavigate();
  const loginPromptedRef = useRef(false);
  const resolvedRef = useRef(false);

  const [step, setStep] = useState<PageStep>("loading");
  const [error, setError] = useState<string | null>(null);

  // Prompt login when unauthenticated; callbackURL returns to this same page
  // so the flow resumes automatically after the OAuth round-trip.
  useEffect(() => {
    if (!authLoading && !isAuthenticated && !loginPromptedRef.current) {
      loginPromptedRef.current = true;
      openLoginModal(window.location.href);
    }
  }, [authLoading, isAuthenticated, openLoginModal]);

  // Once authenticated, call the authenticated resolver and redirect.
  useEffect(() => {
    if (!isAuthenticated || authLoading || resolvedRef.current) return;
    resolvedRef.current = true;

    const resolve = async () => {
      try {
        const data = await api.get<ConnectLinkGoResponse>(`/c/${code}/go`);
        if ("url" in data) {
          // External URL (e.g. Telegram) or internal frontend path.
          if (data.url.startsWith("http")) {
            window.location.href = data.url;
          } else {
            navigate(data.url.replace(window.location.origin, ""));
          }
        } else if (data.kind === "approve_introduction") {
          setStep("intro-approved");
        } else {
          setError("Unrecognised link type.");
          setStep("error");
        }
      } catch (err) {
        setError((err as Error)?.message ?? "This link is unavailable.");
        setStep("error");
      }
    };

    void resolve();
  }, [isAuthenticated, authLoading, code, api, navigate]);

  const renderContent = () => {
    if (step === "intro-approved") {
      return (
        <ContentContainer>
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
            <svg
              className="w-8 h-8 text-green-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-black mb-2 font-ibm-plex-mono">
            Introduction approved
          </h1>
          <p className="text-gray-600 font-ibm-plex-mono">
            Your approval has been recorded. Both parties will be connected.
          </p>
        </ContentContainer>
      );
    }

    if (step === "error") {
      return (
        <ContentContainer>
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
            <svg
              className="w-8 h-8 text-red-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-black mb-2 font-ibm-plex-mono">
            Link unavailable
          </h1>
          <p className="text-gray-600 font-ibm-plex-mono">
            {error || "This opportunity link has expired or is no longer available."}
          </p>
        </ContentContainer>
      );
    }

    // loading — covers both "waiting for auth" and "resolving link"
    return (
      <ContentContainer>
        <div className="flex flex-col items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400 mb-4" />
          <p className="text-gray-600 font-ibm-plex-mono">
            {!isAuthenticated ? "Sign in to continue…" : "Opening opportunity…"}
          </p>
        </div>
      </ContentContainer>
    );
  };

  return (
    <ClientLayout>
      <div className="bg-[#FAFAFA]">
        <div className="px-6 py-12">{renderContent()}</div>
      </div>
    </ClientLayout>
  );
}

export const Component = ConnectLinkPage;
