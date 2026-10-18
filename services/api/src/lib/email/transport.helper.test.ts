import { describe, expect, test } from 'bun:test';

import { emailTags } from './transport.helper';

describe('emailTags', () => {
  test('tags the kind and the user', () => {
    expect(emailTags('message', 'a1b2-c3_d4')).toEqual([{ name: 'kind', value: 'message' }, { name: 'user_id', value: 'a1b2-c3_d4' }]);
  });

  test('leaves email without a kind untagged, whatever the user', () => {
    expect(emailTags(undefined, 'user_1')).toBeUndefined();
  });

  test('drops a user id Resend would reject', () => {
    expect(emailTags('message', 'has space@x')).toEqual([{ name: 'kind', value: 'message' }]);
    expect(emailTags('message')).toEqual([{ name: 'kind', value: 'message' }]);
  });
});
