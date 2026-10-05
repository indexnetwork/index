import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { DOWNLOAD_PATH } from "@/components/AppHandoff";
import { useAuthContext } from "@/contexts/AuthContext";
import { APIError } from "@/lib/api";
import { log } from "@/lib/logger";
import { Network } from "@/lib/types";
import { networksService as publicNetworksService, useNetworkService } from "@/services/networks";
import { SiteSignInCard, SiteSignInMeta, SiteSignInPage } from "@/components/SiteSignIn";

const logger = log.page.from("l/[code]");

type PreviewStep = "loading" | "ready" | "error";

/** Friendly copy for a failed invite preview. Raw API strings stay in the console. */
const INVALID_INVITE = "This link is invalid or has expired.";
const PREVIEW_FAILED = "Couldn't load this invitation. Check your connection and try again.";
const JOIN_EXPIRED = "Couldn't join. The invite may have expired.";
const JOIN_FAILED = "Couldn't join right now. Try again in a moment.";

/**
 * 4xx (or a 200 without a network) means the code itself is bad; 5xx and
 * network failures (APIError status 0) are worth retrying.
 */
function isInviteRejected(err: unknown): boolean {
  if (!(err instanceof APIError)) return true;
  return err.status >= 400 && err.status < 500;
}

/** Terminal outcomes that keep the visitor on this page instead of the app. */
type JoinOutcome = "pending" | "declined";

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
    code ? null : INVALID_INVITE,
  );
  const [previewRetryable, setPreviewRetryable] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinOutcome, setJoinOutcome] = useState<JoinOutcome | null>(null);
  const [loginRequested, setLoginRequested] = useState(false);
  // Set once this tab mails a sign-in link. The link opens a new tab that
  // signs in, joins and shows the download page; this tab stays on "check your
  // email" even after the shared session arrives, rather than joining twice.
  const [linkSentTo, setLinkSentTo] = useState<string | null>(null);
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
        const loaded = await publicNetworksService.getNetworkByShareCode(code);
        if (cancelled) return;
        setNetwork(loaded);
        setPreviewStep("ready");
      } catch (err) {
        if (cancelled) return;
        logger.error("Failed to load network", { error: err });
        const retryable = !isInviteRejected(err);
        setPreviewStep("error");
        setPreviewRetryable(retryable);
        setPreviewError(retryable ? PREVIEW_FAILED : INVALID_INVITE);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code, previewKey]);

  const attemptJoin = useCallback(async () => {
    if (!code || joinStartedRef.current) return;
    joinStartedRef.current = true;
    setJoining(true);
    setJoinError(null);

    try {
      const result = await networkService.acceptInvitation(code);
      if (result.status === "already_member") {
        navigate(`/networks/${result.network.id}`, { replace: true });
        return;
      }
      if (result.status === "pending") {
        setJoining(false);
        setJoinOutcome("pending");
        return;
      }
      navigate(DOWNLOAD_PATH, { replace: true });
    } catch (err) {
      setJoining(false);
      if (err instanceof APIError && err.status === 403) {
        setJoinOutcome("declined");
        return;
      }
      joinStartedRef.current = false;
      setJoinError(isInviteRejected(err) ? JOIN_EXPIRED : JOIN_FAILED);
      logger.error("Failed to accept invitation", { error: err });
    }
  }, [code, navigate, networkService]);

  useEffect(() => {
    if (previewStep !== "ready" || !isReady || linkSentTo) return;
    if (!isAuthenticated && !loginRequested) return;
    void attemptJoin();
  }, [previewStep, isReady, isAuthenticated, loginRequested, linkSentTo, attemptJoin]);

  const callbackURL =
    typeof window !== "undefined" ? window.location.href : "/";

  const memberCount = network?._count?.members;

  if (previewStep === "loading") {
    return <SiteSignInPage><SiteSignInMeta>Loading invitation…</SiteSignInMeta></SiteSignInPage>;
  }

  if (previewStep === "error" || !network) {
    return (
      <SiteSignInPage title="Invitation unavailable">
        <div className="signin-status">
          <p className="site-p">{previewError || INVALID_INVITE}</p>
          {previewRetryable ? (
            <button
              type="button"
              className="site-btn"
              onClick={() => { setPreviewStep("loading"); setPreviewError(null); setPreviewKey((k) => k + 1); }}
            >
              Try again
            </button>
          ) : (
            <Link className="site-btn" to="/">Go home</Link>
          )}
        </div>
      </SiteSignInPage>
    );
  }

  return (
    <SiteSignInPage
      kicker="You're invited to"
      title={network.title}
      meta={memberCount != null && (
        <SiteSignInMeta dot>{memberCount} {memberCount === 1 ? "member" : "members"}</SiteSignInMeta>
      )}
    >
      {linkSentTo || (!joining && !joinError && !joinOutcome && !isAuthenticated && isReady) ? (
        <SiteSignInCard
          bar="Join the network"
          sentTo={linkSentTo}
          sentNote="Open the link in the email to join. It expires in 10 minutes."
          callbackURL={callbackURL}
          onAuthenticated={() => setLoginRequested(true)}
          onMagicLinkSent={setLinkSentTo}
          onBack={() => setLinkSentTo(null)}
        />
      ) : joining ? (
        <SiteSignInMeta>Joining…</SiteSignInMeta>
      ) : joinOutcome === "pending" ? (
        <p className="site-p signin-status">
          Your request is waiting for an admin to review it. You&apos;ll be
          in as soon as they approve it.
        </p>
      ) : joinOutcome === "declined" ? (
        <div className="signin-status">
          <p className="site-p">An admin declined your request to join this network.</p>
          <Link className="site-btn" to="/">Go home</Link>
        </div>
      ) : joinError ? (
        <div className="signin-status">
          <p className="site-p">{joinError}</p>
          <button type="button" className="site-btn" onClick={() => void attemptJoin()}>Try again</button>
        </div>
      ) : null}
    </SiteSignInPage>
  );
}
