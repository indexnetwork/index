import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { useAuthContext } from "@/contexts/AuthContext";
import { APIError } from "@/lib/api";
import { log } from "@/lib/logger";
import { networkPath } from "@/lib/network-path";
import { Network } from "@/lib/types";
import { needsOnboarding } from "@/services/onboarding";
import { networksService as publicNetworksService, useNetworkService } from "@/services/networks";
import { SiteSignInPage } from "@/components/SiteSignIn";
import { rememberAfterFirstRun } from "@/lib/after-first-run";
import { NetworkInviteBoard, PULSE_REFRESH_MS, type NetworkPulse } from "@/components/NetworkInviteBoard";
import NetworkAvatar from "@/components/NetworkAvatar";
import { Placeholder } from "@/components/ui/Placeholder";

const logger = log.page.from("l/[code]");

type PreviewStep = "loading" | "ready" | "error";

/** The share-code preview: the network plus its anonymized activity. */
type InviteNetwork = Network & { pulse?: NetworkPulse };

/** Friendly copy for a failed invite preview. Raw API strings stay in the console. */
const INVALID_INVITE = "this link is invalid or has expired. ask whoever sent it for a new one.";
const PREVIEW_FAILED = "couldn't load this invitation. check your connection and try again.";
const JOIN_EXPIRED = "couldn't join. the invite may have expired. ask whoever sent it for a new one.";
const JOIN_FAILED = "couldn't join right now. try again in a moment.";


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
 * Web invite landing (`/l/:code`): preview the network, send the visitor to
 * sign in (which comes back here), accept the invitation automatically, then go
 * straight on: a new account to onboarding (which ends on the network), an
 * existing one to the network.
 */
export default function NetworkWebInviteLanding() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { isAuthenticated, isReady, user, refetchUser } = useAuthContext();
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
  // Set once the join lands. Where to go next depends on the account, which
  // may still be loading right after an inline sign-in.
  const [joinedNetwork, setJoinedNetwork] = useState<Network | null>(null);
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
        navigate(networkPath(result.network), { replace: true });
        return;
      }
      if (result.status === "pending") {
        setJoining(false);
        setJoinOutcome("pending");
        return;
      }
      // Membership now exists, so /auth/me can report a pending consent before we leave this page.
      await refetchUser();
      setJoinedNetwork(result.network);
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
  }, [code, navigate, networkService, refetchUser]);

  useEffect(() => {
    if (previewStep !== "ready" || !isReady || !isAuthenticated) return;
    void attemptJoin();
  }, [previewStep, isReady, isAuthenticated, attemptJoin]);

  useEffect(() => {
    if (!joinedNetwork || !user) return;
    if (!needsOnboarding(user)) {
      navigate(networkPath(joinedNetwork), { replace: true });
      return;
    }
    // New here: first run, which ends on the network they just joined.
    rememberAfterFirstRun(networkPath(joinedNetwork));
    navigate("/onboarding", { replace: true });
  }, [joinedNetwork, user, navigate]);

  // The clean link to hand to an agent, without whatever query the visit carried.
  const inviteUrl =
    typeof window !== "undefined" && code ? `${window.location.origin}/l/${encodeURIComponent(code)}` : "";

  if (previewStep === "loading") {
    return <SiteSignInPage><Placeholder.Form fields={2} label="loading invitation" /></SiteSignInPage>;
  }

  if (previewStep === "error" || !network) {
    return (
      <SiteSignInPage title="this invitation doesn't work">
        <div className="signin-status">
          <p className="site-p">{previewError || INVALID_INVITE}</p>
          {previewRetryable ? (
            <button
              type="button"
              className="site-btn"
              onClick={() => { setPreviewStep("loading"); setPreviewError(null); setPreviewKey((k) => k + 1); }}
            >
              try again
            </button>
          ) : (
            <Link className="site-btn" to="/">see what index is →</Link>
          )}
        </div>
      </SiteSignInPage>
    );
  }

  const showChoice = !joining && !joinError && !joinOutcome && !isAuthenticated && isReady;
  // Waiting on an admin is no reason to wait on anything else: a new account
  // sets up meanwhile, an existing one goes home.
  const whileWaiting = needsOnboarding(user)
    ? <Link className="site-btn" to="/onboarding">set up your profile meanwhile →</Link>
    : <Link className="site-btn" to="/">go home →</Link>;

  return (
    <NetworkInviteBoard
      title={network.title}
      prompt={network.prompt}
      avatar={<NetworkAvatar id={network.id} title={network.title} imageUrl={network.imageUrl} size={56} />}
      pulse={network.pulse}
      inviteUrl={inviteUrl}
      status={showChoice ? null : joining ? (
        <button type="button" className="site-btn site-btn--block" disabled aria-busy="true">joining…</button>
      ) : joinOutcome === "pending" ? (
        <>
          <p className="site-p">you asked to join. an admin reviews it, and you&apos;re in as soon as they approve.</p>
          <div className="site-btn-row">{whileWaiting}</div>
        </>
      ) : joinOutcome === "declined" ? (
        <>
          <p className="site-p">an admin declined your request to join this network.</p>
          <div className="site-btn-row"><Link className="site-btn" to="/">go home →</Link></div>
        </>
      ) : joinError ? (
        <>
          <p className="site-p">{joinError}</p>
          <div className="site-btn-row">
            <button type="button" className="site-btn" onClick={() => void attemptJoin()}>try again</button>
          </div>
        </>
      ) : (
        <Placeholder.Form fields={2} label="loading" />
      )}
    />
  );
}
