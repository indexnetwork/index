import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import AuthForm from "@/components/AuthForm";
import { DOWNLOAD_PATH } from "@/components/DeepLinkLanding";
import { useAuthContext } from "@/contexts/AuthContext";
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

  const [previewStep, setPreviewStep] = useState<PreviewStep>(code ? "loading" : "error");
  const [network, setNetwork] = useState<Network | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(
    code ? null : "Invalid or expired invitation link",
  );
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [loginRequested, setLoginRequested] = useState(false);
  const joinStartedRef = useRef(false);

  useEffect(() => {
    localStorage.setItem("alpha", "true");
  }, []);

  useEffect(() => {
    // A missing code is already reflected in the initial state above.
    if (!code) return;

    let cancelled = false;
    (async () => {
      try {
        const loaded = await publicIndexesService.getIndexByShareCode(code);
        if (cancelled) return;
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

  const memberCount = network?._count?.members;

  return (
    <div className="invite">
      <header className="invite-header">
        <Link className="invite-logo" to="/" aria-label="Index Network">
          <img src="/logos/logo-white-full.svg" alt="Index Network" />
        </Link>
      </header>

      <main className="invite-main">
        {previewStep === "loading" && (
          <p className="invite-status">Loading invitation…</p>
        )}

        {previewStep === "error" && (
          <>
            <h1 className="invite-title">Invitation unavailable</h1>
            <p className="invite-error">
              {previewError || "This link is invalid or has expired."}
            </p>
          </>
        )}

        {previewStep === "ready" && network && (
          <>
            <p className="invite-kicker">You&apos;re invited to</p>
            <h1 className="invite-title">{network.title}</h1>
            {memberCount != null && (
              <p className="invite-meta">
                <span className="invite-meta__dot" aria-hidden="true" />
                {memberCount} {memberCount === 1 ? "member" : "members"}
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
              /* The card is chrome only; AuthForm keeps every behaviour it
                  already had (Google OAuth, magic link, password fallback).
                  Its .av-* internals are restyled from invite.css. */
              <section className="invite-card">
                <h2 className="invite-card__bar">JOIN THE NETWORK</h2>
                <div className="invite-card__body auth">
                  <AuthForm
                    variant="inline"
                    callbackURL={callbackURL}
                    onAuthenticated={() => setLoginRequested(true)}
                  />
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
