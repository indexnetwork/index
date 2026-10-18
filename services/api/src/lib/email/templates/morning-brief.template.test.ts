import { describe, expect, test } from 'bun:test';

import { morningBriefTemplate, type MorningBriefParams } from './morning-brief.template';

function brief(questions: MorningBriefParams['questions']) {
  return morningBriefTemplate({
    viewerId: 'owner',
    name: 'Seref',
    talked: 1,
    waiting: [],
    notes: [],
    questions,
    appUrl: 'https://index.network',
  });
}

function question(
  text: string,
  counterpartyId: string | null,
  scope: string | null,
  intentId = 'intent',
): MorningBriefParams['questions'][number] {
  return { text, counterpartyId, scope, intentId };
}

describe('morning brief questions', () => {
  test('collapses rephrased questions about the same person and scope', () => {
    const email = brief([
      question('Is Shawn working on spatial intelligence?', 'shawn', 'match', 'i1'),
      question('Shawn Cheng — still in spatial intelligence?', 'shawn', 'match', 'i2'),
      question('Does spatial intelligence describe Shawn?', 'shawn', 'match', 'i3'),
      question('Shawn and spatial intelligence, yes or no?', 'shawn', 'match', 'i4'),
      question('Confirm spatial intelligence for Shawn', 'shawn', 'Match', 'i5'),
      question('Can you meet Ada next week?', 'ada', 'match', 'i6'),
      question('What city are you in?', null, 'intent', 'i7'),
    ]);
    const text = email?.text ?? '';
    expect(text).toContain('Is Shawn working on spatial intelligence?');
    expect(text).not.toContain('Shawn Cheng — still in spatial intelligence?');
    expect(text).not.toContain('Does spatial intelligence describe Shawn?');
    expect(text).not.toContain('Confirm spatial intelligence for Shawn');
    expect(text).toContain('Can you meet Ada next week?');
    expect(text).toContain('What city are you in?');
    expect(email?.subject).toBe('I have 3 questions for you');
  });

  test('keeps a different scope about the same person', () => {
    const text = brief([
      question('Approve the intro to Shawn?', 'shawn', 'match'),
      question('Are you raising this quarter?', 'shawn', 'intent'),
    ])?.text ?? '';
    expect(text).toContain('Approve the intro to Shawn?');
    expect(text).toContain('Are you raising this quarter?');
  });

  test('keeps the same wording about two people', () => {
    const text = brief([
      question('Open to meeting?', 'shawn', 'match'),
      question('Open to meeting?', 'ada', 'match'),
    ])?.text ?? '';
    expect(text.match(/Open to meeting\?/g)).toHaveLength(2);
  });

  test('collapses identical wording when no person is attached', () => {
    const email = brief([
      question('Are you raising?', null, 'intent', 'i1'),
      question('Are you raising?', null, 'intent', 'i2'),
      question('  are   you raising? ', '  ', null, 'i3'),
      question('Where are you based?', null, 'intent', 'i4'),
    ]);
    expect(email?.text.match(/Are you raising\?/g)).toHaveLength(1);
    expect(email?.text).toContain('Where are you based?');
    expect(email?.subject).toBe('I have 2 questions for you');
  });

  test('still shows at most 3 distinct questions', () => {
    const text = brief([
      question('One?', 'a', 'match'),
      question('Two?', 'b', 'match'),
      question('Three?', 'c', 'match'),
      question('Four?', 'd', 'match'),
    ])?.text ?? '';
    expect(text).toContain('One?');
    expect(text).toContain('Two?');
    expect(text).toContain('Three?');
    expect(text).not.toContain('Four?');
  });
});
