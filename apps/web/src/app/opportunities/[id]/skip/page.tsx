import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Loader2 } from "lucide-react";

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
      <div className="flex flex-col items-center justify-center py-20">
        <h2 className="text-xl font-bold text-red-600 mb-2">Error</h2>
        <p className="text-gray-600 mb-4">{error}</p>
        <button
          onClick={() => navigate("/")}
          className="px-4 py-2 bg-[#041729] text-white rounded hover:bg-[#0a2d4a]"
        >
          Go Home
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
    </div>
  );
}

export const Component = SkipOpportunityPage;
