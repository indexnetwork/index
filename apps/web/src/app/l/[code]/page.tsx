import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";

import { DOWNLOAD_PATH } from "@/components/DeepLinkLanding";
import { Network } from "@/lib/types";
import { log } from "@/lib/logger";
import { indexesService as publicIndexesService } from "@/services/networks";
import { ensureLandingFonts } from "@/app/landing/Nav";
import "./invite.css";

const logger = log.page.from("l/[code]");

type PageStep = "loading" | "ready" | "error";

/**
 * Network invite landing (`/l/:code`).
 *
 * Auth-callback shell (wordmark + centered column) with app-only accept via
 * distinct deep links: Index (`index://l/<code>`) and Hermes (`hermes://l/<code>`).
 * No web sign-in or in-browser join.
 */
export default function InvitationPage() {
  const { code } = useParams();
  const [step, setStep] = useState<PageStep>("loading");
  const [index, setIndex] = useState<Network | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem("alpha", "true");
  }, []);

  useEffect(() => {
    ensureLandingFonts();
  }, []);

  useEffect(() => {
    if (!code) {
      setStep("error");
      setError("Invalid or expired invitation link");
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const network = await publicIndexesService.getIndexByShareCode(code);
        if (cancelled) return;
        if (network.permissions?.joinPolicy === "anyone") {
          setStep("error");
          setError("No invitation found");
          return;
        }
        setIndex(network);
        setStep("ready");
      } catch (err) {
        if (cancelled) return;
        logger.error("Failed to load network", { error: err });
        setStep("error");
        setError((err as Error)?.message || "Invalid or expired invitation link");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code]);

  const memberCount = index?._count?.members;

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
            <p className="invite-status">Loading invitation…</p>
          )}

          {step === "error" && (
            <>
              <h1>Invitation unavailable</h1>
              <p className="invite-error">
                {error || "This invitation link is invalid or has expired."}
              </p>
            </>
          )}

          {step === "ready" && index && (
            <>
              <p className="invite-kicker">You&apos;re invited to</p>
              <h1>{index.title}</h1>
              {memberCount != null && (
                <p className="invite-meta">
                  {memberCount} {memberCount === 1 ? "member" : "members"}
                </p>
              )}

              <div className="cta-stack">
                <a className="cta-btn primary" href={`index://l/${code}`}>
                  <AppleMark />
                  Accept invite in Index
                </a>
                <a className="cta-btn ghost" href={`hermes://l/${code}`}>
                  <HermesMark />
                  Accept invite in Hermes
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

export const Component = InvitationPage;
