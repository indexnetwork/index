import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ChevronLeft, Loader2, Pause, Pencil, Radar, Trash2 } from "lucide-react";

import ClientLayout from "@/components/ClientLayout";
import { ContentContainer } from "@/components/layout";
import OpportunityCard from "@/components/chat/OpportunityCardInChat";
import { InjectedQuestions } from "@/components/InjectedQuestions/InjectedQuestions";
import { useIntents, useOpportunities, useQuestionsService } from "@/contexts/APIContext";
import { useNotifications } from "@/contexts/NotificationContext";
import { useOpportunityActions } from "@/hooks/useOpportunityActions";
import type { HomeViewCardItem } from "@/services/opportunities";
import type { AnswerBody, PendingQuestion } from "@/services/questions";
import { cn } from "@/lib/utils";

/** Raw opportunity status -> radar display bucket (mirrors the Hermes dashboard). */
const STATUS_BUCKET: Record<string, string> = {
  latent: "pending",
  draft: "pending",
  pending: "pending",
  negotiating: "negotiating",
  stalled: "negotiating",
  accepted: "accepted",
  rejected: "rejected",
  expired: "expired",
};

const RADAR_BUCKETS: Array<{ key: string; label: string }> = [
  { key: "pending", label: "Awaiting you" },
  { key: "negotiating", label: "Negotiating" },
  { key: "accepted", label: "Accepted" },
  { key: "rejected", label: "Rejected" },
  { key: "expired", label: "Missed" },
];

function bucketForStatus(status?: string): string {
  return STATUS_BUCKET[status ?? ""] ?? "pending";
}

/** Icon-only action button in the intent detail header (Pause / Edit / Archive). */
function ActionChip({
  icon,
  title,
  tone = "text-gray-400 hover:text-gray-700 hover:bg-gray-100",
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  tone?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={cn(
        "inline-flex items-center justify-center rounded p-1.5 leading-none transition-colors [&>svg]:h-4 [&>svg]:w-4",
        tone,
      )}
    >
      {icon}
    </button>
  );
}

/** Selectable radar status filter tab: a label with a subtle count badge. */
function StatPill({
  value,
  label,
  active,
  onSelect,
}: {
  value: number;
  label: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "bg-[#041729] text-white"
          : "text-gray-500 hover:bg-gray-100 hover:text-gray-700",
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          "min-w-[18px] rounded-full px-1 py-px text-center text-[10px] font-semibold tabular-nums",
          active ? "bg-white/20 text-white" : "bg-gray-100 text-gray-500",
        )}
      >
        {value}
      </span>
    </button>
  );
}

/** Card-style panel used for the Questions and Radar columns. */
function Panel({
  title,
  count,
  description,
  media,
  children,
  className,
}: {
  title: string;
  count?: number;
  description?: string;
  media?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      <div className="mb-4">
        <h3 className="flex items-center gap-2 text-base font-bold tracking-[0.2em] text-[#3D3D3D] font-ibm-plex-mono">
          <span>
            {title}
            {count !== undefined && ` (${count})`}
          </span>
          {media}
        </h3>
        {description && (
          <p className="mt-1.5 text-sm text-gray-500">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}

/**
 * Intent detail view. Mirrors the Hermes dashboard intent-detail layout: a
 * detail header card with a live indicator and Pause/Edit/Archive actions, a
 * primary Questions panel, and a Radar panel with a status filter strip.
 */
export default function IntentDetailPage() {
  const navigate = useNavigate();
  const { intentId } = useParams<{ intentId: string }>();
  const intentsService = useIntents();
  const opportunitiesService = useOpportunities();
  const questionsService = useQuestionsService();
  const { error: showError } = useNotifications();

  const [intent, setIntent] = useState<
    Awaited<ReturnType<typeof intentsService.getIntent>> | null
  >(null);
  const [intentLoading, setIntentLoading] = useState(true);
  const [opportunities, setOpportunities] = useState<HomeViewCardItem[]>([]);
  const [opportunitiesLoading, setOpportunitiesLoading] = useState(true);
  const [questions, setQuestions] = useState<PendingQuestion[]>([]);
  const [refineText, setRefineText] = useState("");
  const [refining, setRefining] = useState(false);
  const [showRefine, setShowRefine] = useState(false);
  const [selectedBucket, setSelectedBucket] = useState("pending");

  const scope = useMemo(
    () =>
      intentId
        ? ({ scopeType: "intent" as const, scopeId: intentId })
        : undefined,
    [intentId],
  );

  const {
    opportunityStatusMap,
    opportunityActionLoading,
    handleOpportunityAction,
    inviteModalElement,
  } = useOpportunityActions({ scope });

  const loadOpportunities = useCallback(async () => {
    if (!intentId) return;
    setOpportunitiesLoading(true);
    try {
      const res = await opportunitiesService.getHomeView({ scopeType: "intent", scopeId: intentId });
      setOpportunities(res.sections.flatMap((s) => s.items));
    } catch {
      setOpportunities([]);
    } finally {
      setOpportunitiesLoading(false);
    }
  }, [intentId, opportunitiesService]);

  useEffect(() => {
    if (!intentId) return;
    let active = true;
    setIntentLoading(true);
    intentsService
      .getIntent(intentId)
      .then((res) => {
        if (active) setIntent(res);
      })
      .catch(() => {
        if (active) setIntent(null);
      })
      .finally(() => {
        if (active) setIntentLoading(false);
      });
    questionsService
      .getPending({ scopeType: "intent", scopeId: intentId })
      .then((res) => {
        if (active) setQuestions(res);
      })
      .catch(() => {});
    void loadOpportunities();
    return () => {
      active = false;
    };
  }, [intentId, intentsService, questionsService, loadOpportunities]);

  const handleArchive = useCallback(async () => {
    if (!intentId) return;
    if (!window.confirm("Archive this intent? It will stop matching.")) return;
    try {
      await intentsService.archiveIntent(intentId);
      navigate("/");
    } catch {
      showError("Failed to archive intent");
    }
  }, [intentId, intentsService, navigate, showError]);

  const handleRefine = useCallback(async () => {
    const text = refineText.trim();
    if (!intentId || !text || refining) return;
    setRefining(true);
    try {
      const updated = await intentsService.refineIntent(intentId, text);
      setIntent(updated);
      setRefineText("");
      setShowRefine(false);
      void loadOpportunities();
    } catch {
      showError("Failed to refine intent");
    } finally {
      setRefining(false);
    }
  }, [intentId, refineText, refining, intentsService, loadOpportunities, showError]);

  const handleAnswer = useCallback(
    async (questionId: string, body: AnswerBody) => {
      await questionsService.answer(questionId, body);
      setQuestions((prev) => prev.filter((q) => q.id !== questionId));
    },
    [questionsService],
  );

  const handleDismiss = useCallback(
    async (questionId: string) => {
      await questionsService.dismiss(questionId);
      setQuestions((prev) => prev.filter((q) => q.id !== questionId));
    },
    [questionsService],
  );

  const bucketOf = useCallback(
    (item: HomeViewCardItem) => bucketForStatus(opportunityStatusMap[item.opportunityId]),
    [opportunityStatusMap],
  );

  const bucketCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of opportunities) {
      const b = bucketOf(item);
      counts[b] = (counts[b] ?? 0) + 1;
    }
    return counts;
  }, [opportunities, bucketOf]);

  const visibleOpportunities = useMemo(
    () => opportunities.filter((item) => bucketOf(item) === selectedBucket),
    [opportunities, bucketOf, selectedBucket],
  );

  const title = (intent?.summary && intent.summary.trim().length > 0
    ? intent.summary
    : intent?.payload ?? ""
  ).trim();

  return (
    <ClientLayout>
      {inviteModalElement}
      <div className="px-10 lg:px-16 py-6">
        <ContentContainer size="xwide">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="mb-4 inline-flex items-center gap-1 text-sm text-gray-600 hover:text-black transition-colors"
            aria-label="Back to home"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </button>

          {intentLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : !intent ? (
            <div className="text-sm text-gray-500 font-ibm-plex-mono py-12 text-center border border-dashed border-gray-200 rounded-lg">
              Intent not found
            </div>
          ) : (
            <>
              <div className="mb-6 rounded-lg border border-gray-200 bg-white p-5">
                <div className="flex items-start justify-between gap-4">
                  <h1 className="text-base font-bold text-black font-ibm-plex-mono leading-snug">
                    {title}
                  </h1>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <ActionChip
                      icon={<Pause />}
                      title="Pause"
                      tone="text-amber-500 hover:text-amber-600 hover:bg-amber-50"
                    />
                    <ActionChip
                      icon={<Pencil />}
                      title="Edit"
                      onClick={() => setShowRefine((v) => !v)}
                    />
                    <ActionChip
                      icon={<Trash2 />}
                      title="Archive"
                      tone="text-red-400 hover:text-red-500 hover:bg-red-50"
                      onClick={handleArchive}
                    />
                  </div>
                </div>
                <div className="mt-2.5 flex items-center gap-2 text-xs text-gray-500 font-ibm-plex-mono">
                  <span className="inline-flex items-center gap-1.5 rounded border border-green-300 px-1.5 py-0.5 font-medium lowercase tracking-wide text-green-600">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-500" />
                    </span>
                    live
                  </span>
                  <span>agent is looking in the background</span>
                </div>

                {showRefine && (
                  <div className="mt-4 flex items-center gap-2">
                    <input
                      type="text"
                      value={refineText}
                      onChange={(e) => setRefineText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleRefine();
                      }}
                      placeholder="Refine this signal..."
                      disabled={refining}
                      autoFocus
                      className="flex-1 text-sm bg-[#FCFCFC] border border-[#E9E9E9] rounded-full px-4 py-2 focus:outline-none focus:ring-2 focus:ring-[#4091BB]/30"
                    />
                    <button
                      type="button"
                      onClick={handleRefine}
                      disabled={refining || !refineText.trim()}
                      className="shrink-0 px-4 py-2 rounded-full bg-[#041729] text-white text-sm font-medium hover:bg-[#0a2d4a] disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {refining ? "Refining..." : "Refine"}
                    </button>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 items-start">
                <Panel
                  title="Questions"
                  count={questions.length}
                  description="Answer pending follow-ups for this intent."
                  className="lg:col-span-2"
                >
                  {questions.length === 0 ? (
                    <div className="text-sm text-gray-500 font-ibm-plex-mono py-8 text-center border border-dashed border-gray-200 rounded-lg">
                      No pending questions right now.
                    </div>
                  ) : (
                    <InjectedQuestions
                      questions={questions}
                      onAnswer={handleAnswer}
                      onDismiss={handleDismiss}
                    />
                  )}
                </Panel>

                <Panel
                  title="Radar"
                  description="People the network surfaced for this intent."
                  media={<Radar className="h-4 w-4 text-[#4091BB]/70" />}
                  className="lg:col-span-3"
                >
                  <div className="mb-4 flex flex-wrap gap-2">
                    {RADAR_BUCKETS.map((bucket) => (
                      <StatPill
                        key={bucket.key}
                        value={bucketCounts[bucket.key] ?? 0}
                        label={bucket.label}
                        active={selectedBucket === bucket.key}
                        onSelect={() => setSelectedBucket(bucket.key)}
                      />
                    ))}
                  </div>
                  {opportunitiesLoading ? (
                    <div className="flex justify-center py-8">
                      <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                    </div>
                  ) : visibleOpportunities.length === 0 ? (
                    <div className="text-sm text-gray-500 font-ibm-plex-mono py-8 text-center border border-dashed border-gray-200 rounded-lg">
                      No matches here yet.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {visibleOpportunities.map((item) => (
                        <OpportunityCard
                          key={item.opportunityId}
                          card={item}
                          currentStatus={opportunityStatusMap[item.opportunityId]}
                          onPrimaryAction={(oppId, userId, viewerRole, counterpartName, isGhost) =>
                            handleOpportunityAction(oppId, "accepted", userId, viewerRole, counterpartName, isGhost)
                          }
                          onSecondaryAction={(oppId, userId, viewerRole, counterpartName, isGhost) =>
                            handleOpportunityAction(oppId, "rejected", userId, viewerRole, counterpartName, isGhost)
                          }
                          isLoading={!!opportunityActionLoading[item.opportunityId]}
                        />
                      ))}
                    </div>
                  )}
                </Panel>
              </div>
            </>
          )}
        </ContentContainer>
      </div>
    </ClientLayout>
  );
}

export const Component = IntentDetailPage;
