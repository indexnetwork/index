import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { useAuthContext } from "@/contexts/AuthContext";
import { APIError } from "@/lib/api";
import { log } from "@/lib/logger";
import { Network } from "@/lib/types";
import { needsOnboarding } from "@/services/onboarding";
import { networksService as publicNetworksService, useNetworkService } from "@/services/networks";
import { SiteSignInCard, SiteSignInMeta, SiteSignInPage } from "@/components/SiteSignIn";
import { NetworkInviteBoard, type NetworkPulse } from "@/components/NetworkInviteBoard";

const logger = log.page.from("l/[code]");

type PreviewStep = "loading" | "ready" | "error";

/** The share-code preview: the network plus its anonymized activity. */
type InviteNetwork = Network & { pulse?: NetworkPulse };

/** Friendly copy for a failed invite preview. Raw API strings stay in the console. */
const INVALID_INVITE = "This link is invalid or has expired.";
const PREVIEW_FAILED = "Couldn't load this invitation. Check your connection and try again.";
const JOIN_EXPIRED = "Couldn't join. The invite may have expired.";
const JOIN_FAILED = "Couldn't join right now. Try again in a moment.";

/** How often the invite page refreshes the network's numbers, so they read as live. */
const PULSE_REFRESH_MS = 3_000;

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
 * the invitation automatically, then go straight on: a new account to
 * onboarding (which ends on its first signal), an existing one to the network.
 */
export default function NetworkWebInviteLanding() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { isAuthenticated, isReady, user } = useAuthContext();
  const networkService = useNetworkService();

  const [previewStep, setPreviewStep] = useState<PreviewStep>(code ? "loading" : "error");
  const [network, setNetwork] = useState<InviteNetwork | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(
    code ? null : INVALID_INVITE,
  );
  const [previewRetryable, setPreviewRetryable] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinOutcome, setJoinOutcome] = useState<JoinOutcome | null>(null);
  const [loginRequested, setLoginRequested] = useState(false);
  // Set once the join lands. Where to go next depends on the account, which
  // may still be loading right after an inline sign-in.
  const [joinedNetworkId, setJoinedNetworkId] = useState<string | null>(null);
  // Set once this tab mails a sign-in link. The link opens a new tab that
  // signs in, joins and moves on; this tab stays on "check your
  // email" even after the shared session arrives, rather than joining twice.
  const [linkSentTo, setLinkSentTo] = useState<string | null>(null);
  const joinStartedRef = useRef(false);
  // The summary request can finish before or after the counts. Held here so
  // whichever lands second still keeps the other's result.
  const summaryRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    localStorage.setItem("alpha", "true");
  }, []);

  useEffect(() => {
    // A missing code is already reflected in the initial state above.
    if (!code) return;

    let cancelled = false;
    summaryRef.current = undefined;
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

  // Counts arrive after the page is up, then stay live. A failed refresh
  // keeps what is on screen; the next tick tries again.
  useEffect(() => {
    if (!code || previewStep !== "ready") return;
    let cancelled = false;
    let inFlight = false;
    const refresh = async () => {
      if (document.visibilityState !== "visible" || inFlight) return;
      inFlight = true;
      try {
        const pulse = await publicNetworksService.getNetworkSharePulse(code);
        if (cancelled) return;
        setNetwork((prev) => {
          if (!prev) return prev;
          const summary = prev.pulse?.summary !== undefined ? prev.pulse.summary : summaryRef.current;
          return { ...prev, pulse: { ...pulse, ...(summary !== undefined ? { summary } : {}) } };
        });
      } catch (err) {
        logger.warn("Failed to refresh network activity", { error: err });
      } finally {
        inFlight = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), PULSE_REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [code, previewStep]);

  // The written summary can wait on a model. It must not hold the page or the counts.
  useEffect(() => {
    if (!code || previewStep !== "ready") return;
    let cancelled = false;
    (async () => {
      try {
        const summary = await publicNetworksService.getNetworkShareSummary(code);
        if (cancelled) return;
        summaryRef.current = summary;
        setNetwork((prev) => prev?.pulse ? { ...prev, pulse: { ...prev.pulse, summary } } : prev);
      } catch (err) {
        logger.warn("Failed to load network summary", { error: err });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, previewStep]);

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
      setJoinedNetworkId(result.network.id);
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

  useEffect(() => {
    if (!joinedNetworkId || !user) return;
    navigate(needsOnboarding(user) ? "/onboarding" : `/networks/${joinedNetworkId}`, { replace: true });
  }, [joinedNetworkId, user, navigate]);

  const callbackURL =
    typeof window !== "undefined" ? window.location.href : "/";

  // The clean link to hand to an agent, without whatever query the visit carried.
  const inviteUrl =
    typeof window !== "undefined" && code ? `${window.location.origin}/l/${encodeURIComponent(code)}` : "";

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

  const signInCard = (
    <SiteSignInCard
      bar="Join the network"
      sentTo={linkSentTo}
      sentNote="Open the link in the email to join. It expires in 10 minutes."
      callbackURL={callbackURL}
      onAuthenticated={() => setLoginRequested(true)}
      onMagicLinkSent={setLinkSentTo}
      onBack={() => setLinkSentTo(null)}
    />
  );
  const showChoice = linkSentTo == null && !joining && !joinError && !joinOutcome && !isAuthenticated && isReady;

  return (
    <NetworkInviteBoard
      title={network.title}
      pulse={network.pulse}
      inviteUrl={inviteUrl}
      status={showChoice ? null : linkSentTo ? signInCard : joining ? (
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
      ) : (
        <SiteSignInMeta>Loading…</SiteSignInMeta>
      )}
    />
  );
}
