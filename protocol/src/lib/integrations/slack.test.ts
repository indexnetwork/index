import test from 'node:test';
import assert from 'node:assert/strict';
import { handlers } from './index';
import { slackHandler, __setComposio } from './slack';

test('Slack handler is registered', () => {
  assert.equal(handlers.slack, slackHandler);
});

test('fetchFiles returns empty array when no Slack accounts', async () => {
  __setComposio({
    connectedAccounts: { list: async () => ({ items: [] }) },
  });
  const files = await slackHandler.fetchFiles('user-1');
  assert.deepEqual(files, []);
});

