import { describe, expect, it } from 'bun:test';

import { appLink } from './app-link';

describe('appLink', () => {
  it('links a question to Home through /q/<id>', () => {
    expect(appLink('q', 'question-1')).toMatch(/\/q\/question-1$/);
  });
});
