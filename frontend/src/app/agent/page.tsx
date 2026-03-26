import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import * as Tabs from "@radix-ui/react-tabs";
import {
  Loader2,
  Sparkles,
  ArrowUp,
  Handshake,
  Clock,
  TrendingUp,
} from "lucide-react";
import { useAuthContext } from "@/contexts/AuthContext";
import { useUsers } from "@/contexts/APIContext";
import UserAvatar from "@/components/UserAvatar";
import NegotiationHistory from "@/components/NegotiationHistory";
import ClientLayout from "@/components/ClientLayout";
import { ContentContainer } from "@/components/layout";
import type { NegotiationInsights } from "@/services/users";

const VALID_TABS = ["overview", "negotiations"] as const;
type TabValue = (typeof VALID_TABS)[number];

const ROLE_LABELS: Record<string, string> = {
  Helper: "Helper",
  Seeker: "Seeker",
  Peer: "Peer",
};

function StatCard({
  label,
  value,
  icon,
  sublabel,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  sublabel?: string;
}) {
  return (
    <div className="p-4 rounded-md border border-gray-100 bg-white">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-xs text-gray-500 uppercase tracking-wide">
          {label}
        </span>
      </div>
      <div className="text-2xl font-bold text-gray-900 font-ibm-plex-mono">
        {value}
      </div>
      {sublabel && (
        <div className="text-xs text-gray-400 mt-1">{sublabel}</div>
      )}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="p-4 rounded-md border border-gray-100 bg-white animate-pulse">
      <div className="h-3 bg-gray-200 rounded w-20 mb-3" />
      <div className="h-7 bg-gray-200 rounded w-12 mb-1" />
      <div className="h-3 bg-gray-200 rounded w-16" />
    </div>
  );
}

function OverviewTab({ userId }: { userId: string }) {
  const usersService = useUsers();
  const [data, setData] = useState<NegotiationInsights | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    setLoading(true);
    usersService
      .getNegotiationInsights(userId)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [userId, usersService]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
        <div className="p-5 rounded-md bg-gray-50 border border-gray-100 animate-pulse">
          <div className="h-3 bg-gray-200 rounded w-3/4 mb-2" />
          <div className="h-3 bg-gray-200 rounded w-full mb-2" />
          <div className="h-3 bg-gray-200 rounded w-1/2" />
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-sm text-gray-500 font-ibm-plex-mono py-12 text-center border border-dashed border-gray-200 rounded-lg">
        <p>No negotiation activity yet</p>
      </div>
    );
  }

  const { stats, summary } = data;
  const opportunityRate =
    stats.totalCount > 0
      ? Math.round(
          (stats.opportunityCount /
            (stats.opportunityCount + stats.noOpportunityCount || 1)) *
            100,
        )
      : 0;

  const roleEntries = Object.entries(stats.roleDistribution);
  const topRole = roleEntries.length > 0
    ? roleEntries.sort((a, b) => b[1] - a[1])[0]
    : null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Total"
          value={stats.totalCount}
          icon={<Handshake className="w-4 h-4 text-gray-400" />}
          sublabel={`${stats.opportunityCount} opportunities`}
        />
        <StatCard
          label="Opportunity rate"
          value={`${opportunityRate}%`}
          icon={<TrendingUp className="w-4 h-4 text-gray-400" />}
          sublabel={`${stats.noOpportunityCount} no opportunity`}
        />
        <StatCard
          label="Avg score"
          value={stats.avgScore ?? "—"}
          icon={<Sparkles className="w-4 h-4 text-gray-400" />}
          sublabel="Successful negotiations"
        />
        <StatCard
          label="In progress"
          value={stats.inProgressCount}
          icon={<Clock className="w-4 h-4 text-gray-400" />}
          sublabel="Active right now"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="p-4 rounded-md border border-gray-100 bg-white">
          <h3 className="text-xs text-gray-500 uppercase tracking-wide mb-3">
            Your roles
          </h3>
          {roleEntries.length === 0 ? (
            <p className="text-sm text-gray-400">No role data yet</p>
          ) : (
            <div className="space-y-2">
              {roleEntries
                .sort((a, b) => b[1] - a[1])
                .map(([role, count]) => {
                  const pct = Math.round(
                    (count / (stats.opportunityCount || 1)) * 100,
                  );
                  return (
                    <div key={role}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-gray-700">
                          {ROLE_LABELS[role] ?? role}
                        </span>
                        <span className="text-gray-500 font-ibm-plex-mono">
                          {count} ({pct}%)
                        </span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gray-900 rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              {topRole && (
                <p className="text-xs text-gray-400 mt-2">
                  You're most often matched as{" "}
                  <span className="font-medium text-gray-600">
                    {ROLE_LABELS[topRole[0]] ?? topRole[0]}
                  </span>
                </p>
              )}
            </div>
          )}
        </div>

        <div className="p-4 rounded-md border border-gray-100 bg-white">
          <h3 className="text-xs text-gray-500 uppercase tracking-wide mb-3">
            Top counterparties
          </h3>
          {stats.topCounterparties.length === 0 ? (
            <p className="text-sm text-gray-400">No counterparty data yet</p>
          ) : (
            <div className="space-y-2.5">
              {stats.topCounterparties.map((cp) => (
                <div key={cp.id} className="flex items-center gap-3">
                  <UserAvatar
                    id={cp.id}
                    name={cp.name}
                    avatar={cp.avatar}
                    size={28}
                  />
                  <span className="text-sm text-gray-700 flex-1 truncate">
                    {cp.name}
                  </span>
                  <span className="text-xs text-gray-400 font-ibm-plex-mono">
                    {cp.count} {cp.count === 1 ? "negotiation" : "negotiations"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {summary && (
        <p className="text-sm text-gray-600 leading-relaxed">{summary}</p>
      )}
    </div>
  );
}

export default function AgentPage() {
  const navigate = useNavigate();
  const { tab } = useParams<{ tab?: string }>();
  const { user, isAuthenticated, isLoading: authLoading } = useAuthContext();
  const [feedback, setFeedback] = useState("");

  const activeTab: TabValue = VALID_TABS.includes(tab as TabValue)
    ? (tab as TabValue)
    : "overview";
  const setActiveTab = (v: string) =>
    navigate(`/agent/${v}`, { replace: true });

  // TODO: wire to preference/feedback endpoint when available
  const handleFeedbackSubmit = () => {};

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate("/");
    }
  }, [authLoading, isAuthenticated, navigate]);

  if (authLoading) {
    return (
      <ClientLayout>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      </ClientLayout>
    );
  }

  return (
    <ClientLayout>
      <div className="px-6 lg:px-8 py-6 pb-32 flex-1">
        <ContentContainer>
          <h1 className="text-2xl font-bold text-black font-ibm-plex-mono mb-6">
            Agent
          </h1>

          <Tabs.Root value={activeTab} onValueChange={setActiveTab}>
            <Tabs.List className="flex border-b border-gray-200 mb-6">
              <Tabs.Trigger
                value="overview"
                className="px-4 py-2 text-sm text-gray-600 border-b-2 border-transparent data-[state=active]:border-black data-[state=active]:text-black data-[state=active]:font-bold"
              >
                Overview
              </Tabs.Trigger>
              <Tabs.Trigger
                value="negotiations"
                className="px-4 py-2 text-sm text-gray-600 border-b-2 border-transparent data-[state=active]:border-black data-[state=active]:text-black data-[state=active]:font-bold"
              >
                Negotiations
              </Tabs.Trigger>
            </Tabs.List>

            <Tabs.Content value="overview" className="w-full">
              <OverviewTab userId={user?.id ?? ""} />
            </Tabs.Content>

            <Tabs.Content value="negotiations" className="w-full">
              <NegotiationHistory userId={user?.id ?? ""} />
            </Tabs.Content>
          </Tabs.Root>
        </ContentContainer>
      </div>

      {activeTab === "overview" && (
        <div className="sticky bottom-0 z-20">
          <div className="px-6 lg:px-8">
            <ContentContainer>
              <div className="bg-[linear-gradient(to_bottom,transparent_50%,#ffffff_50%)]">
                <form
                  onSubmit={(e) => { e.preventDefault(); handleFeedbackSubmit(); }}
                  className="flex items-center gap-3 bg-[#FCFCFC] border border-[#E9E9E9] rounded-4xl px-4 py-3"
                >
                  <input
                    type="text"
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    disabled
                    placeholder="Agent preferences coming soon..."
                    className="flex-1 bg-transparent border-none outline-none text-sm text-gray-900 placeholder-gray-400 disabled:cursor-not-allowed"
                  />
                  <button
                    type="submit"
                    disabled
                    className="shrink-0 h-8 w-8 rounded-full bg-[#041729] text-white flex items-center justify-center hover:bg-[#0a2d4a] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </button>
                </form>
              </div>
              <div className="bg-white py-2" />
            </ContentContainer>
          </div>
        </div>
      )}
    </ClientLayout>
  );
}

export const Component = AgentPage;
