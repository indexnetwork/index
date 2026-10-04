import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";

import SiteLayout from "@/app/site/SiteLayout";
import { useAuthContext } from "@/contexts/AuthContext";
import { useOpportunities } from "@/contexts/APIContext";
import { useNotifications } from "@/contexts/NotificationContext";

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
        const message = err instanceof Error ? err.message : "Something went wrong";
        setError(message);
      }
    })();
    return () => { cancelled = true; };
  }, [id, authLoading, isAuthenticated, navigate, opportunitiesService]);

  if (error) {
    return (
      <SiteLayout>
        <section className="site-hero">
          <h1 className="site-h1">Couldn’t skip that</h1>
          <p className="site-p">{error}</p>
          <button type="button" className="site-btn" onClick={() => navigate("/")}>
            Go home
          </button>
        </section>
      </SiteLayout>
    );
  }

  return (
    <SiteLayout>
      <p className="site-p">Skipping…</p>
    </SiteLayout>
  );
}

export const Component = SkipOpportunityPage;
