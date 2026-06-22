import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DecisionQuestions } from '../DecisionQuestions';
import type { Question } from '../types';

const questions: Question[] = [
  {
    title: 'Stage',
    prompt: 'Are you pre- or post-revenue?',
    options: [
      { label: 'Pre-revenue (Recommended)', description: 'No paying customers yet.' },
      { label: 'Post-revenue', description: 'At least one paying customer.' },
    ],
    multiSelect: false,
  },
  {
    title: 'Timing',
    prompt: 'When do you need a co-founder in place?',
    options: [
      { label: 'In the next month', description: 'Urgent.' },
      { label: 'In the next quarter', description: 'Soon.' },
    ],
    multiSelect: false,
  },
];

describe('DecisionQuestions', () => {
  it('renders all questions stacked and disables submit until all answered', () => {
    render(
      <DecisionQuestions
        questions={questions}
        submitted={false}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByText('Stage')).toBeInTheDocument();
    expect(screen.getByText('Timing')).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: /submit/i });
    expect(submit).toBeDisabled();

    fireEvent.click(screen.getAllByLabelText(/Pre-revenue \(Recommended\)/)[0]);
    expect(submit).toBeDisabled(); // 1 of 2 answered

    fireEvent.click(screen.getAllByLabelText(/In the next month/)[0]);
    expect(submit).toBeEnabled();
  });

  it('submit flattens answers and calls onSubmit', () => {
    const onSubmit = vi.fn();
    render(
      <DecisionQuestions
        questions={questions}
        submitted={false}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.click(screen.getAllByLabelText(/Pre-revenue \(Recommended\)/)[0]);
    fireEvent.click(screen.getAllByLabelText(/In the next month/)[0]);
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    expect(onSubmit).toHaveBeenCalledWith(
      'Stage (Are you pre- or post-revenue?): Pre-revenue (Recommended)\n' +
        'Timing (When do you need a co-founder in place?): In the next month',
    );
  });

  it('empty Other counts as unanswered', () => {
    render(
      <DecisionQuestions
        questions={[questions[0]]}
        submitted={false}
        onSubmit={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText(/Other \(specify\)/));
    const submit = screen.getByRole('button', { name: /submit/i });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('Specify...'), {
      target: { value: 'somewhere else' },
    });
    expect(submit).toBeEnabled();
  });

  it('when submitted, shows "Submitted." caption and disables inputs', () => {
    render(
      <DecisionQuestions
        questions={questions}
        submitted
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByText(/submitted\./i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /submit/i })).not.toBeInTheDocument();
    expect(screen.getAllByLabelText(/Pre-revenue \(Recommended\)/)[0]).toBeDisabled();
  });

  it('multiple instances do not share radio-group names', () => {
    render(
      <>
        <DecisionQuestions
          questions={[questions[0]]}
          submitted={false}
          onSubmit={vi.fn()}
        />
        <DecisionQuestions
          questions={[questions[0]]}
          submitted={false}
          onSubmit={vi.fn()}
        />
      </>,
    );
    const radios = screen.getAllByLabelText(
      /Pre-revenue \(Recommended\)/,
    ) as HTMLInputElement[];
    expect(radios).toHaveLength(2);
    expect(radios[0].name).not.toBe(radios[1].name);
  });

  it('submit stays disabled when questions array grows past current answers', () => {
    const { rerender } = render(
      <DecisionQuestions
        questions={[questions[0]]}
        submitted={false}
        onSubmit={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText(/Pre-revenue \(Recommended\)/));
    expect(screen.getByRole('button', { name: /submit/i })).toBeEnabled();

    rerender(
      <DecisionQuestions
        questions={questions}
        submitted={false}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /submit/i })).toBeDisabled();
  });
});
