import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QuestionCard } from '../QuestionCard';
import type { Question } from '../types';
import type { Answer } from '../flatten';

const q: Question = {
  title: 'Stage',
  prompt: 'Are you pre- or post-revenue?',
  options: [
    { label: 'Pre-revenue (Recommended)', description: 'No paying customers yet.' },
    { label: 'Post-revenue', description: 'At least one paying customer.' },
  ],
  multiSelect: false,
};

describe('QuestionCard', () => {
  it('renders title chip, prompt, options, and Other row', () => {
    render(
      <QuestionCard
        questionId="q0"
        question={q}
        answer={null}
        disabled={false}
        onAnswerChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Stage')).toBeInTheDocument();
    expect(screen.getByText('Are you pre- or post-revenue?')).toBeInTheDocument();
    expect(screen.getByLabelText(/Pre-revenue \(Recommended\)/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Post-revenue/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Other \(specify\)/)).toBeInTheDocument();
  });

  it('single-select: clicking a radio emits a selection answer with that single label', () => {
    const onChange = vi.fn();
    render(
      <QuestionCard
        questionId="q0"
        question={q}
        answer={null}
        disabled={false}
        onAnswerChange={onChange}
      />,
    );
    fireEvent.click(screen.getByLabelText(/Pre-revenue \(Recommended\)/));
    expect(onChange).toHaveBeenCalledWith({
      kind: 'selection',
      selectedLabels: ['Pre-revenue (Recommended)'],
    } satisfies Answer);
  });

  it('multi-select: clicking a checkbox toggles that label in selectedLabels', () => {
    const multi: Question = { ...q, multiSelect: true };
    const onChange = vi.fn();
    render(
      <QuestionCard
        questionId="q0"
        question={multi}
        answer={{ kind: 'selection', selectedLabels: ['Pre-revenue (Recommended)'] }}
        disabled={false}
        onAnswerChange={onChange}
      />,
    );
    fireEvent.click(screen.getByLabelText(/Post-revenue/));
    expect(onChange).toHaveBeenCalledWith({
      kind: 'selection',
      selectedLabels: ['Pre-revenue (Recommended)', 'Post-revenue'],
    } satisfies Answer);
  });

  it('selecting Other reveals a text input and emits an other answer when typed', () => {
    const onChange = vi.fn();
    render(
      <QuestionCard
        questionId="q0"
        question={q}
        answer={null}
        disabled={false}
        onAnswerChange={onChange}
      />,
    );
    fireEvent.click(screen.getByLabelText(/Other \(specify\)/));
    const input = screen.getByPlaceholderText('Specify...');
    fireEvent.change(input, { target: { value: 'somewhere else' } });
    expect(onChange).toHaveBeenLastCalledWith({
      kind: 'other',
      text: 'somewhere else',
    } satisfies Answer);
  });

  it('disabled: inputs are not interactive', () => {
    render(
      <QuestionCard
        questionId="q0"
        question={q}
        answer={{ kind: 'selection', selectedLabels: ['Pre-revenue (Recommended)'] }}
        disabled
        onAnswerChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/Pre-revenue \(Recommended\)/)).toBeDisabled();
  });

  it('multi-select: unchecking Other restores a selection answer with current selections', () => {
    const multi: Question = { ...q, multiSelect: true };
    const onChange = vi.fn();
    render(
      <QuestionCard
        questionId="q0"
        question={multi}
        answer={{ kind: 'other', text: 'something' }}
        disabled={false}
        onAnswerChange={onChange}
      />,
    );
    fireEvent.click(screen.getByLabelText(/Other \(specify\)/));
    expect(onChange).toHaveBeenLastCalledWith({
      kind: 'selection',
      selectedLabels: [],
    } satisfies Answer);
  });
});
