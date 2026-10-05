import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import AuthForm from "@/components/AuthForm";
import { DOWNLOAD_PATH } from "@/components/AppHandoff";
import { useAuthContext } from "@/contexts/AuthContext";
import { APIError } from "@/lib/api";
import { log } from "@/lib/logger";
import { Network } from "@/lib/types";
import { networksService as publicNetworksService, useNetworkService } from "@/services/networks";
import { RuleLabel } from "@/components/workbench/Workbench";

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
    if (previewStep !== "ready" || !isReady) return;
    if (!isAuthenticated && !loginRequested) return;
    void attemptJoin();
  }, [previewStep, isReady, isAuthenticated, loginRequested, attemptJoin]);

  const callbackURL =
    typeof window !== "undefined" ? window.location.href : "/";

  const memberCount = network?._count?.members;

  const retryStyle = { display: "flex", textDecoration: "none", color: "#000" } as const;

  return (
    <div className="workbench mac-desktop wb-auth">
      <div style={{ width: 440, maxWidth: "100%" }}>
        <div className="amiga-window">
          <div className="mac-titlebar">
            <span className="mac-title"><span className="t">invite</span></span>
          </div>
          <div className="wb-body" style={{ padding: "26px 28px 24px" }}>
            {previewStep === "loading" && (
              <p className="wb-auth-p" style={{ margin: 0 }}>loading invitation…</p>
            )}

            {previewStep === "error" && (
              <>
                <h1 className="wb-auth-h">invitation unavailable</h1>
                <p className="wb-auth-p">{(previewError || INVALID_INVITE).toLowerCase()}</p>
                {previewRetryable ? (
                  <button
                    type="button"
                    className="wb-btn primary"
                    onClick={() => { setPreviewStep("loading"); setPreviewError(null); setPreviewKey((k) => k + 1); }}
                  >
                    try again
                  </button>
                ) : (
                  <Link className="wb-btn" to="/" style={retryStyle}>go home</Link>
                )}
              </>
            )}

            {previewStep === "ready" && network && (
              <>
                <RuleLabel>you&apos;re invited to</RuleLabel>
                <h1 className="wb-auth-h" style={{ marginTop: 4 }}>{network.title}</h1>
                {memberCount != null && (
                  <p style={{ margin: "10px 0 0", display: "flex", alignItems: "center", gap: 8, fontFamily: "var(--mac-mono)", fontSize: 11, color: "#000" }}>
                    <span className="wb-live" style={{ width: 7, height: 7 }} aria-hidden="true" />
                    {memberCount} {memberCount === 1 ? "member" : "members"}
                  </p>
                )}

                {joining && <p className="wb-auth-p">joining…</p>}

                {joinOutcome === "pending" && (
                  <p className="wb-auth-p">
                    your request is waiting for an admin to review it. you&apos;ll be
                    in as soon as they approve it.
                  </p>
                )}

                {joinOutcome === "declined" && (
                  <>
                    <p className="wb-auth-p">an admin declined your request to join this network.</p>
                    <Link className="wb-btn" to="/" style={retryStyle}>go home</Link>
                  </>
                )}

                {joinError && (
                  <>
                    <p className="av-error">{joinError.toLowerCase()}</p>
                    <button type="button" className="wb-btn primary" onClick={() => void attemptJoin()}>
                      try again
                    </button>
                  </>
                )}

                {!joining && !joinError && !joinOutcome && !isAuthenticated && isReady && (
                  /* AuthForm keeps every behaviour (Google OAuth, magic link,
                     password fallback); .wb-auth styles its fields. */
                  <div style={{ marginTop: 18 }}>
                    <RuleLabel>join the network</RuleLabel>
                    <AuthForm
                      variant="product"
                      showHeading={false}
                      callbackURL={callbackURL}
                      onAuthenticated={() => setLoginRequested(true)}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
