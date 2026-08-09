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
                  <IndexMark />
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

function IndexMark() {
  return (
    <img
      src="/favicon.svg"
      alt=""
      width={56}
      height={60}
      aria-hidden="true"
    />
  );
}

function HermesMark() {
  return (
    <img
      src="/logos/nous.webp"
      alt=""
      width={42}
      height={60}
      aria-hidden="true"
    />
  );
}
