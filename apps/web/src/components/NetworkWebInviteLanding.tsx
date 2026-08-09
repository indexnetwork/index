import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import AuthForm from "@/components/AuthForm";
import { DOWNLOAD_PATH } from "@/components/DeepLinkLanding";
import { useAuthContext } from "@/contexts/AuthContext";
import { ensureLandingFonts } from "@/app/landing/Nav";
import { log } from "@/lib/logger";
import { Network } from "@/lib/types";
import { indexesService as publicIndexesService, useNetworkService } from "@/services/networks";
import "@/app/l/[code]/invite.css";
import "@/components/AuthModal.css";

const logger = log.page.from("l/[code]");

type PreviewStep = "loading" | "ready" | "error";

/**
 * Web invite landing (`/l/:code`): preview the network, sign in inline, accept
 * the invitation automatically, then redirect to the app download page.
 */
export default function NetworkWebInviteLanding() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { isAuthenticated, isReady } = useAuthContext();
  const networkService = useNetworkService();

  const [previewStep, setPreviewStep] = useState<PreviewStep>("loading");
  const [network, setNetwork] = useState<Network | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [loginRequested, setLoginRequested] = useState(false);
  const joinStartedRef = useRef(false);

  useEffect(() => {
    localStorage.setItem("alpha", "true");
  }, []);

  useEffect(() => {
    ensureLandingFonts();
  }, []);

  useEffect(() => {
    if (!code) {
      setPreviewStep("error");
      setPreviewError("Invalid or expired invitation link");
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const loaded = await publicIndexesService.getIndexByShareCode(code);
        if (cancelled) return;
        if (loaded.permissions?.joinPolicy === "anyone") {
          setPreviewStep("error");
          setPreviewError("No invitation found");
          return;
        }
        setNetwork(loaded);
        setPreviewStep("ready");
      } catch (err) {
        if (cancelled) return;
        logger.error("Failed to load network", { error: err });
        setPreviewStep("error");
        setPreviewError((err as Error)?.message || "Invalid or expired invitation link");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code]);

  const attemptJoin = useCallback(async () => {
    if (!code || joinStartedRef.current) return;
    joinStartedRef.current = true;
    setJoining(true);
    setJoinError(null);

    try {
      await networkService.acceptInvitation(code);
      navigate(DOWNLOAD_PATH, { replace: true });
    } catch (err) {
      joinStartedRef.current = false;
      setJoining(false);
      setJoinError((err as Error)?.message || "Couldn't join — the invite may have expired.");
      logger.error("Failed to accept invitation", { error: err });
    }
  }, [code, navigate, networkService]);

  useEffect(() => {
    if (previewStep !== "ready" || !isReady) return;
    if (!isAuthenticated && !loginRequested) return;
    void attemptJoin();
  }, [previewStep, isReady, isAuthenticated, loginRequested, attemptJoin]);

  const callbackURL =
    typeof window !== "undefined" ? window.location.href : "/";

  return (
    <div className="invite">
      <nav className="invite-nav" aria-label="primary">
        <Link to="/" aria-label="Index Network">
          <img src="/landing/index-wordmark.svg" alt="Index Network" />
        </Link>
      </nav>

      <main>
        <div className="c">
          {previewStep === "loading" && (
            <p className="invite-status">Loading invitation…</p>
          )}

          {previewStep === "error" && (
            <>
              <h1>Invitation unavailable</h1>
              <p className="invite-error">
                {previewError || "This link is invalid or has expired."}
              </p>
            </>
          )}

          {previewStep === "ready" && network && (
            <>
              <p className="invite-kicker">You&apos;re invited to</p>
              <h1>{network.title}</h1>
              {network._count?.members != null && (
                <p className="invite-meta">
                  {network._count.members}{" "}
                  {network._count.members === 1 ? "member" : "members"}
                </p>
              )}

              {joining && (
                <p className="invite-status invite-status--join">Joining…</p>
              )}

              {joinError && (
                <>
                  <p className="invite-error">{joinError}</p>
                  <button
                    type="button"
                    className="invite-retry"
                    onClick={() => void attemptJoin()}
                  >
                    Retry
                  </button>
                </>
              )}

              {!joining && !joinError && !isAuthenticated && isReady && (
                <div className="invite-auth">
                  <div className="auth">
                    <AuthForm
                      variant="inline"
                      callbackURL={callbackURL}
                      onAuthenticated={() => setLoginRequested(true)}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
