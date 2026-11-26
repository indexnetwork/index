import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";

import { useAuthContext } from "@/contexts/AuthContext";
import { useOpportunities } from "@/contexts/APIContext";
import { useNotifications } from "@/contexts/NotificationContext";
import { StatusPage } from "@/components/SiteSignIn";

export default function SkipOpportunityPage() {
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
          setTimeout(() => infoRef.current("Opportunity skipped"), 0);
        }
      } catch (err: unknown) {
        if (cancelled) return;
        const status = (err as { status?: number })?.status;
        if (status === 400) {
          navigate("/", { replace: true });
          return;
        }
        const message = err instanceof Error ? err.message : "something went wrong. try again from home.";
        setError(message);
      }
    })();
    return () => { cancelled = true; };
  }, [id, authLoading, isAuthenticated, navigate, opportunitiesService]);

  if (error) {
    return (
      <StatusPage bar="opportunity" title="couldn’t skip that" message={error}>
        <button type="button" className="site-btn" onClick={() => navigate("/")}>
          go home →
        </button>
      </StatusPage>
    );
  }

  return (
    <StatusPage bar="opportunity" title="skipping this opportunity">
      <button type="button" className="site-btn" disabled aria-busy="true">skipping…</button>
    </StatusPage>
  );
}

export const Component = SkipOpportunityPage;
