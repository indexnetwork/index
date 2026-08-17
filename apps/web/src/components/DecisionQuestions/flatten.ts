import type { Question } from './types';

export type Answer =
  | { kind: 'selection'; selectedLabels: string[] }
  | { kind: 'other'; text: string };

export function flattenAnswers(questions: Question[], answers: Answer[]): string {
  return questions
    .map((q, i) => {
      const a = answers[i];
      const text =
        a.kind === 'other'
          ? `Other: ${a.text.trim()}`
          : a.selectedLabels.join(', ');
      return `${q.title} (${q.prompt}): ${text}`;
    })
    .join('\n');
}
