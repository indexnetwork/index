import { useMemo } from 'react';
import { useQuestions } from '@/contexts/QuestionsContext';
import { QuestionGroup, groupKey, groupLabel } from './QuestionGroup';

/**
 * Dropdown panel listing all pending questions grouped by entity type.
 * Rendered from the sidebar badge.
 */
export function PendingQuestions() {
  const { questions, answer, dismiss } = useQuestions();

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

  if (questions.length === 0) {
    return (
      <div className="p-4 text-sm text-gray-400 text-center">
        No pending questions
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-3 max-h-[70vh] overflow-y-auto">
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
  );
}
