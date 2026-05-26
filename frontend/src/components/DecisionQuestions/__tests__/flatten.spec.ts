import { describe, it, expect } from 'vitest';
import { flattenAnswers, type Answer } from '../flatten';
import type { Question } from '../types';

const stageQ: Question = {
  title: 'Stage',
  prompt: 'Are you pre- or post-revenue?',
  options: [
    { label: 'Pre-revenue (Recommended)', description: 'No paying customers yet.' },
    { label: 'Post-revenue', description: 'At least one paying customer.' },
  ],
  multiSelect: false,
};

const timingQ: Question = {
  title: 'Timing',
  prompt: 'When do you need a co-founder in place?',
  options: [
    { label: 'In the next month', description: 'Urgent.' },
    { label: 'In the next quarter', description: 'Soon.' },
  ],
  multiSelect: false,
};

const prioritiesQ: Question = {
  title: 'Priority',
  prompt: 'Which traits matter most?',
  options: [
    { label: 'Technical depth', description: '...' },
    { label: 'Domain expertise', description: '...' },
    { label: 'Network reach', description: '...' },
  ],
  multiSelect: true,
};

describe('flattenAnswers', () => {
  it('flattens a single-select selection', () => {
    const answers: Answer[] = [
      { kind: 'selection', selectedLabels: ['Pre-revenue (Recommended)'] },
    ];
    expect(flattenAnswers([stageQ], answers)).toBe(
      'Stage (Are you pre- or post-revenue?): Pre-revenue (Recommended)',
    );
  });

  it('flattens an Other answer', () => {
    const answers: Answer[] = [
      { kind: 'other', text: 'in the next 6 weeks' },
    ];
    expect(flattenAnswers([timingQ], answers)).toBe(
      'Timing (When do you need a co-founder in place?): Other: in the next 6 weeks',
    );
  });

  it('joins multi-select labels with comma', () => {
    const answers: Answer[] = [
      { kind: 'selection', selectedLabels: ['Technical depth', 'Domain expertise'] },
    ];
    expect(flattenAnswers([prioritiesQ], answers)).toBe(
      'Priority (Which traits matter most?): Technical depth, Domain expertise',
    );
  });

  it('joins multiple questions with newlines, in order', () => {
    const answers: Answer[] = [
      { kind: 'selection', selectedLabels: ['Pre-revenue (Recommended)'] },
      { kind: 'other', text: 'in the next 6 weeks' },
    ];
    expect(flattenAnswers([stageQ, timingQ], answers)).toBe(
      [
        'Stage (Are you pre- or post-revenue?): Pre-revenue (Recommended)',
        'Timing (When do you need a co-founder in place?): Other: in the next 6 weeks',
      ].join('\n'),
    );
  });
});
