import { useState, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router";
import { Loader2 } from "lucide-react";

import { useAuthContext } from "@/contexts/AuthContext";
import { useQuestionsService } from "@/contexts/APIContext";
import { APIError, useAuthenticatedAPI } from "@/lib/api";
import ClientLayout from "@/components/ClientLayout";
import UptakeQuestionsModal from "@/components/UptakeQuestionsModal";
import type { UptakeAcceptanceAdvisory, UptakeAcceptanceErrorBody } from "@/services/opportunities";
import { ContentContainer } from "@/components/layout";
import { Button } from "@/components/ui/button";

type ConnectLinkGoResponse =
  | { url: string }
  | { kind: "approve_introduction" };

type PageStep = "loading" | "intro-approved" | "uptake" | "error";

function getUptakeAdvisory(error: unknown): UptakeAcceptanceAdvisory | null {
  if (!(error instanceof APIError) || error.status !== 409) return null;
  const body = error.response as Partial<UptakeAcceptanceErrorBody> | undefined;
  return body?.advisory?.code === "unresolved_uptake_questions" ? body.advisory : null;
}

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
  const questionsService = useQuestionsService();
  const navigate = useNavigate();
  const loginPromptedRef = useRef(false);
  // Track which code was last resolved rather than a plain boolean so that
  // navigating between /c/:codeA and /c/:codeB (same component instance in
  // React Router) still resolves each code exactly once.
  const lastResolvedCodeRef = useRef<string | null>(null);

  const [step, setStep] = useState<PageStep>("loading");
  const [error, setError] = useState<string | null>(null);
  const [uptakeAdvisory, setUptakeAdvisory] = useState<UptakeAcceptanceAdvisory | null>(null);
  const [acknowledgedIds, setAcknowledgedIds] = useState<string[] | null>(null);

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
    if (!isAuthenticated || authLoading) return;
    const resolutionKey = `${code ?? ""}:${(acknowledgedIds ?? []).join(",")}`;
    if (lastResolvedCodeRef.current === resolutionKey) return; // already resolved this attempt
    if (!code) {
      setError("Invalid link — missing code.");
      setStep("error");
      return;
    }
    // Mark this code as resolved before the async call so concurrent renders
    // don't fire a second request. If the code changed, reset display state first.
    lastResolvedCodeRef.current = resolutionKey;
    setStep("loading");
    setError(null);

    const resolve = async () => {
      try {
        const acknowledgementQuery = acknowledgedIds?.length
          ? `?acknowledgedUptakeQuestionIds=${encodeURIComponent(acknowledgedIds.join(","))}`
          : "";
        const data = await api.get<ConnectLinkGoResponse>(`/c/${code}/go${acknowledgementQuery}`);
        if ("url" in data) {
          // Parse the URL: same-origin paths get client-side navigation;
          // cross-origin URLs (e.g. Telegram) get a hard redirect.
          try {
            const parsed = new URL(data.url);
            if (parsed.origin === window.location.origin) {
              navigate(parsed.pathname + parsed.search + parsed.hash);
            } else {
              window.location.href = data.url;
            }
          } catch {
            // Relative URL — pass directly to React Router.
            navigate(data.url);
          }
        } else if (data.kind === "approve_introduction") {
          setStep("intro-approved");
        } else {
          setError("Unrecognised link type.");
          setStep("error");
        }
      } catch (err) {
        const advisory = getUptakeAdvisory(err);
        if (advisory) {
          setUptakeAdvisory(advisory);
          setStep("uptake");
          return;
        }
        setError((err as Error)?.message ?? "This link is unavailable.");
        setStep("error");
      }
    };

    void resolve();
  }, [isAuthenticated, authLoading, code, api, navigate, acknowledgedIds]);

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
          <p className="text-gray-600 font-ibm-plex-mono mb-4">
            {!isAuthenticated ? "Sign in to continue…" : "Opening opportunity…"}
          </p>
          {!isAuthenticated && (
            <Button
              className="bg-[#041729] text-white hover:bg-[#0a2d4a] font-ibm-plex-mono"
              onClick={() => openLoginModal(window.location.href)}
            >
              Sign in
            </Button>
          )}
        </div>
      </ContentContainer>
    );
  };

  return (
    <>
      <ClientLayout>
        <div className="bg-[#FAFAFA]">
          <div className="px-6 py-12">{renderContent()}</div>
        </div>
      </ClientLayout>
      {step === "uptake" && uptakeAdvisory ? (
        <UptakeQuestionsModal
          advisory={uptakeAdvisory}
          onAnswer={(questionId, body) => questionsService.answer(questionId, body).then(() => undefined)}
          onDismiss={(questionId) => questionsService.dismiss(questionId)}
          onContinue={async (questionIds) => {
            lastResolvedCodeRef.current = null;
            setUptakeAdvisory(null);
            setStep("loading");
            setAcknowledgedIds(questionIds);
          }}
          onCancel={() => {
            setUptakeAdvisory(null);
            setError("Connection cancelled. The opportunity remains pending.");
            setStep("error");
          }}
        />
      ) : null}
    </>
  );
}

export const Component = ConnectLinkPage;
