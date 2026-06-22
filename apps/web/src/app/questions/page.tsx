import { useMemo } from 'react';
import { CircleHelp } from 'lucide-react';
import { useQuestions } from '@/contexts/QuestionsContext';
import { QuestionGroup, groupKey, groupLabel } from '@/components/PendingQuestions/QuestionGroup';
import ClientLayout from '@/components/ClientLayout';
import { ContentContainer } from '@/components/layout';

/**
 * Full-page view of all pending questions, grouped by entity type.
 * Replaces the former sidebar dropdown panel.
 */
export function QuestionsPage() {
  const { questions, answer, dismiss, loading } = useQuestions();

  const groups = useMemo(() => {
    const map = new Map<string, typeof questions>();
    for (const q of questions) {
      const key = groupKey(q);
      const list = map.get(key) ?? [];
      list.push(q);
      map.set(key, list);
    }
    return Array.from(map.entries()).map(([key, items]) => ({
      key,
      label: groupLabel(items[0].detection.sourceType, items[0].detection.mode),
      questions: items,
    }));
  }, [questions]);

  return (
    <ClientLayout>
      <div className="px-6 lg:px-8 py-8">
        <ContentContainer>
          <h1 className="text-2xl font-bold text-black font-ibm-plex-mono mb-8">Questions</h1>

          {loading && questions.length === 0 ? (
            <div className="text-sm text-gray-400 py-12 text-center">Loading…</div>
          ) : questions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <CircleHelp className="w-10 h-10 text-gray-300 mb-3" />
              <p className="text-sm text-gray-500">No pending questions</p>
              <p className="text-xs text-gray-400 mt-1">
                We&apos;ll surface questions here when your agent needs your input.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-8 max-w-2xl">
              {groups.map((g) => (
                <QuestionGroup
                  key={g.key}
                  label={g.label}
                  questions={g.questions}
                  onAnswer={answer}
                  onDismiss={dismiss}
                />
              ))}
            </div>
          )}
        </ContentContainer>
      </div>
    </ClientLayout>
  );
}

export const Component = QuestionsPage;

export default QuestionsPage;
