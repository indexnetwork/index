import { Link } from "react-router";

import { DOWNLOAD_PATH } from "@/components/DeepLinkLanding";
import "@/app/l/[code]/invite.css";

type LandingStep = "loading" | "ready" | "error";

type NetworkAppJoinLandingProps = {
  step: LandingStep;
  loadingLabel: string;
  errorTitle: string;
  error?: string | null;
  kicker: string;
  title?: string | null;
  memberCount?: number | null;
  indexHref: string;
  hermesHref: string;
  indexCta: string;
  hermesCta: string;
};

/**
 * Auth-callback shell used by app-only network join landings (`/l/:code`,
 * `/index/:id`): wordmark, centered column, Index + Hermes deep-link CTAs.
 */
export default function NetworkAppJoinLanding({
  step,
  loadingLabel,
  errorTitle,
  error,
  kicker,
  title,
  memberCount,
  indexHref,
  hermesHref,
  indexCta,
  hermesCta,
}: NetworkAppJoinLandingProps) {
  return (
    <div className="invite">
      <nav className="invite-nav" aria-label="primary">
        <Link to="/" aria-label="Index Network">
          <img src="/landing/index-wordmark.svg" alt="Index Network" />
        </Link>
      </nav>

      <main>
        <div className="c">
          {step === "loading" && (
            <p className="invite-status">{loadingLabel}</p>
          )}

          {step === "error" && (
            <>
              <h1>{errorTitle}</h1>
              <p className="invite-error">
                {error || "This link is invalid or has expired."}
              </p>
            </>
          )}

          {step === "ready" && title && (
            <>
              <p className="invite-kicker">{kicker}</p>
              <h1>{title}</h1>
              {memberCount != null && (
                <p className="invite-meta">
                  {memberCount} {memberCount === 1 ? "member" : "members"}
                </p>
              )}

              <div className="cta-stack">
                <a className="cta-btn primary" href={indexHref}>
                  <AppleMark />
                  {indexCta}
                </a>
                <a className="cta-btn ghost" href={hermesHref}>
                  <HermesMark />
                  {hermesCta}
                </a>
              </div>

              <p className="invite-foot">
                Don&apos;t have the app?{" "}
                <a href={DOWNLOAD_PATH}>Download it now →</a>
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function AppleMark() {
  return (
    <svg width="14" height="16" viewBox="0 0 14 17" aria-hidden="true">
      <path
        fill="currentColor"
        d="M13.3 5.8c-.1 1.1.5 2.1 1.2 2.7-.5.7-1 1.4-1.8 1.9-.7.5-1.4.7-2.2.5-.7-.1-1.3-.4-2-.4s-1.3.3-2 .4c-.8.2-1.5 0-2.2-.5C2.8 9.7 1.4 7.3 2.3 4.8c.5-1.2 1.5-2 2.7-2.1.8-.1 1.5.2 2.1.5.6.3 1.1.3 1.8 0 .6-.3 1.3-.6 2.1-.5 1 .1 1.8.6 2.3 1.5-.1 0-.1.1 0 .1-.8.5-1.3 1.3-1.3 2.3zm-2.6-4.3c.4-.5.7-1.2.6-1.9-.7.1-1.4.4-1.9.9-.4.4-.7 1.1-.6 1.7.7 0 1.4-.3 1.9-.7z"
      />
    </svg>
  );
}

function HermesMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 1.2c-2.2 0-4 1.7-4 4.1 0 1.1.4 2.1 1.1 2.8-.2.4-.4.9-.4 1.4 0 .6.3 1.1.7 1.5-.1.3-.2.6-.2 1 0 1.3 1.2 2.2 2.8 2.2s2.8-.9 2.8-2.2c0-.4-.1-.7-.2-1 .4-.4.7-.9.7-1.5 0-.5-.1-1-.4-1.4.7-.7 1.1-1.7 1.1-2.8 0-2.4-1.8-4.1-4-4.1zm-1.6 4.6c-.4 0-.7-.4-.7-.8s.3-.8.7-.8.7.4.7.8-.3.8-.7.8zm3.2 0c-.4 0-.7-.4-.7-.8s.3-.8.7-.8.7.4.7.8-.3.8-.7.8z"
      />
    </svg>
  );
}
