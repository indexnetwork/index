import { useEffect, useState } from "react";
import { useParams } from "react-router";

import NetworkAppJoinLanding from "@/components/NetworkAppJoinLanding";
import { Network } from "@/lib/types";
import { log } from "@/lib/logger";
import { indexesService as publicIndexesService } from "@/services/networks";
import { ensureLandingFonts } from "@/app/landing/Nav";

const logger = log.page.from("l/[code]");

type PageStep = "loading" | "ready" | "error";

/**
 * Network invite landing (`/l/:code`).
 *
 * Auth-callback shell with app-only accept via distinct deep links:
 * Index (`index://l/<code>`) and Hermes (`hermes://l/<code>`).
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

  return (
    <NetworkAppJoinLanding
      step={step}
      loadingLabel="Loading invitation…"
      errorTitle="Invitation unavailable"
      error={error}
      kicker="You're invited to"
      title={index?.title}
      memberCount={index?._count?.members}
      indexHref={`index://l/${code}`}
      hermesHref={`hermes://l/${code}`}
      indexCta="Accept invite in Index"
      hermesCta="Accept invite in Hermes"
    />
  );
}

export const Component = InvitationPage;
