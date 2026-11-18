import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";

import { useAuthContext } from "@/contexts/AuthContext";
import { useOpportunities } from "@/contexts/APIContext";
import { useNotifications } from "@/contexts/NotificationContext";
import { StatusPage } from "@/components/SiteSignIn";
import i18n from "@/lib/i18n";

export default function SkipOpportunityPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: authLoading } = useAuthContext();
  const opportunitiesService = useOpportunities();
  const { info } = useNotifications();
  const infoRef = useRef(info);
  useEffect(() => { infoRef.current = info; }, [info]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) {
      navigate("/", { replace: true });
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        await opportunitiesService.updateStatus(id!, "rejected");
        if (!cancelled) {
          navigate("/", { replace: true });
          setTimeout(() => infoRef.current(i18n.t("Opportunity skipped")), 0);
        }
      } catch (err: unknown) {
        if (cancelled) return;
        const status = (err as { status?: number })?.status;
        if (status === 400) {
          navigate("/", { replace: true });
          return;
        }
        const message = err instanceof Error ? err.message : i18n.t("Something went wrong");
        setError(message);
      }
    })();
    return () => { cancelled = true; };
  }, [id, authLoading, isAuthenticated, navigate, opportunitiesService]);

  if (error) {
    return (
      <StatusPage bar={t("opportunity")} title={t("Couldn’t skip that")} message={error}>
        <button type="button" className="site-btn" onClick={() => navigate("/")}>
          {t("Go home")}
        </button>
      </StatusPage>
    );
  }

  return <StatusPage bar={t("opportunity")} title={t("Skipping…")} />;
}

export const Component = SkipOpportunityPage;
