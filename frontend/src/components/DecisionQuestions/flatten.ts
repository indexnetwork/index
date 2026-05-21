import type { Question } from './types';

export type Answer =
  | { kind: 'selection'; selectedLabels: string[] }
  | { kind: 'other'; text: string };

export function flattenAnswers(questions: Question[], answers: Answer[]): string {
  const multi = questions.length > 1;
  return questions
    .map((q, i) => {
      const a = answers[i];
      const text = a.kind === 'other' ? a.text.trim() : a.selectedLabels.join(', ');
      return multi ? `${q.title}: ${text}` : text;
    })
    .join('\n');
}
