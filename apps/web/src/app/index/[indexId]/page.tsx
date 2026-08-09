import { useEffect, useState } from "react";
import { useParams } from "react-router";

import NetworkAppJoinLanding from "@/components/NetworkAppJoinLanding";
import { Network } from "@/lib/types";
import { log } from "@/lib/logger";
import { indexesService as publicIndexesService } from "@/services/networks";
import { ensureLandingFonts } from "@/app/landing/Nav";

const logger = log.page.from("index/[indexId]");

type PageStep = "loading" | "ready" | "error";

/**
 * Public-network join landing (`/index/:id`).
 *
 * Same auth-callback shell as `/l/:code`: app-only join via
 * `index://index/<id>` and `hermes://index/<id>`. No web sign-in or
 * in-browser join.
 */
export default function PublicJoinPage() {
  const { indexId } = useParams();
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
    if (!indexId) {
      setStep("error");
      setError("Network not found");
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const network = await publicIndexesService.getPublicIndexById(indexId);
        if (cancelled) return;
        if (network.permissions?.joinPolicy !== "anyone") {
          setStep("error");
          setError("This network is private. You need an invitation to join.");
          return;
        }
        setIndex(network);
        setStep("ready");
      } catch (err) {
        if (cancelled) return;
        logger.error("Failed to load network", { error: err });
        setStep("error");
        setError((err as Error)?.message || "Network not found or is private");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [indexId]);

  return (
    <NetworkAppJoinLanding
      step={step}
      loadingLabel="Loading network…"
      errorTitle="Network unavailable"
      error={error}
      kicker="Join"
      title={index?.title}
      memberCount={index?._count?.members}
      indexHref={`index://index/${indexId}`}
      hermesHref={`hermes://index/${indexId}`}
      indexCta="Join using Index App"
      hermesCta="Join using Hermes App"
    />
  );
}

export const Component = PublicJoinPage;
