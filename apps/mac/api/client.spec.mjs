import { describe, expect, it } from 'bun:test';

import { createIndexApiClient, normalizeApiBaseUrl, toQueryString } from './client.mjs';

const SELECTED_INTENT_ID = '00000000-0000-4000-8000-00000000a111';

function createRecordingFetch() {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { calls, fetchImpl };
}

async function expectCall(label, invoke, expected) {
  const { calls, fetchImpl } = createRecordingFetch();
  const client = createIndexApiClient({
    apiBaseUrl: 'https://protocol.example/api/',
    getToken: () => 'token-1',
    fetchImpl,
  });

  await invoke(client);

  expect(calls, label).toHaveLength(1);
  const call = calls[0];
  expect(call.url, label).toBe(`https://protocol.example/api${expected.path}`);
  expect(call.init.method, label).toBe(expected.method || 'GET');
  expect(call.init.headers.Authorization, label).toBe('Bearer token-1');
  if ('body' in expected) {
    expect(call.init.body, label).toBe(JSON.stringify(expected.body));
  } else {
    expect(call.init.body, label).toBeUndefined();
  }
}

describe('mac Index API client endpoint contract', () => {
  it('normalizes base URLs and query strings', () => {
    expect(normalizeApiBaseUrl('https://protocol.example/api///')).toBe('https://protocol.example/api');
    expect(toQueryString({ status: 'pending', empty: '', nil: null, missing: undefined, limit: 20 })).toBe('?status=pending&limit=20');
  });

  it('uses controller-backed auth/network/intent endpoints', async () => {
    await expectCall('auth.me', (client) => client.auth.me(), { path: '/auth/me' });
    await expectCall('networks.list', (client) => client.networks.list(), { path: '/networks' });
    await expectCall('networks.overview', (client) => client.networks.overview('net/1'), { path: '/networks/net%2F1/overview' });
    await expectCall('networks.myIntents', (client) => client.networks.myIntents('net/1'), { path: '/networks/net%2F1/my-intents' });
    await expectCall('networks.update', (client) => client.networks.update('net/1', { title: 'n' }), { path: '/networks/net%2F1', method: 'PUT', body: { title: 'n' } });
    await expectCall('networks.delete', (client) => client.networks.delete('net/1'), { path: '/networks/net%2F1', method: 'DELETE' });
    await expectCall('networks.getMembers', (client) => client.networks.getMembers('net/1'), { path: '/networks/net%2F1/members' });
    await expectCall('networks.addMember', (client) => client.networks.addMember('net/1', 'u1', ['member']), { path: '/networks/net%2F1/members', method: 'POST', body: { userId: 'u1', permissions: ['member'] } });
    await expectCall('networks.removeMember', (client) => client.networks.removeMember('net/1', 'u1'), { path: '/networks/net%2F1/members/u1', method: 'DELETE' });
    await expectCall('networks.updateMemberPermissions', (client) => client.networks.updateMemberPermissions('net/1', 'u1', ['owner']), { path: '/networks/net%2F1/members/u1', method: 'PATCH', body: { permissions: ['owner'] } });
    await expectCall('networks.inviteMember', (client) => client.networks.inviteMember('net/1', { email: 'a@b.co' }), { path: '/networks/net%2F1/members/invite', method: 'POST', body: { email: 'a@b.co' } });
    await expectCall('networks.searchUsers', (client) => client.networks.searchUsers('ada', 'net/1'), { path: '/networks/search-users?q=ada&networkId=net%2F1' });
    await expectCall('networks.acceptInvitation', (client) => client.networks.acceptInvitation('code/1'), { path: '/networks/invitation/code%2F1/accept', method: 'POST', body: {} });
    await expectCall('intents.list', (client) => client.intents.list({ page: 1 }), { path: '/intents/list', method: 'POST', body: { page: 1 } });
    await expectCall('intents.get', (client) => client.intents.get('intent/1'), { path: '/intents/intent%2F1' });
    await expectCall('intents.archive', (client) => client.intents.archive('intent/1'), { path: '/intents/intent%2F1/archive', method: 'PATCH' });
    await expectCall('intents.confirm', (client) => client.intents.confirm({ proposalId: 'p1', description: 'd' }), { path: '/intents/confirm', method: 'POST', body: { proposalId: 'p1', description: 'd' } });
    await expectCall('intents.reject', (client) => client.intents.reject({ proposalId: 'p1' }), { path: '/intents/reject', method: 'POST', body: { proposalId: 'p1' } });
    await expectCall('intents.intake.start', (client) => client.intents.intake.start(), { path: '/intents/intake/start', method: 'POST', body: {} });
    await expectCall('intents.intake.question', (client) => client.intents.intake.question({ rounds: [], plannedTotal: 2 }), { path: '/intents/intake/question', method: 'POST', body: { rounds: [], plannedTotal: 2 } });
    await expectCall('intents.intake.prepare', (client) => client.intents.intake.prepare({ rounds: [] }), { path: '/intents/intake/prepare', method: 'POST', body: { rounds: [] } });
    await expectCall('intents.intake.proposal', (client) => client.intents.intake.proposal({ runId: 'r1', rounds: [] }), { path: '/intents/intake/proposal', method: 'POST', body: { runId: 'r1', rounds: [] } });
    await expectCall('intents.intake.revise', (client) => client.intents.intake.revise({ runId: 'r1', rounds: [], feedback: 'f' }), { path: '/intents/intake/revise', method: 'POST', body: { runId: 'r1', rounds: [], feedback: 'f' } });
  });

  it('previews an invite link without sending credentials', async () => {
    const { calls, fetchImpl } = createRecordingFetch();
    const client = createIndexApiClient({
      apiBaseUrl: 'https://protocol.example/api/',
      getToken: () => 'token-1',
      getApiKey: () => 'key-1',
      fetchImpl,
    });

    await client.networks.shareByCode('code/1');

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://protocol.example/api/networks/share/code%2F1');
    expect(calls[0].init.method).toBe('GET');
    expect(calls[0].init.headers.Authorization).toBeUndefined();
    expect(calls[0].init.headers['x-api-key']).toBeUndefined();
  });

  it('uses controller-backed opportunity endpoints', async () => {
    await expectCall('opportunities.list', (client) => client.opportunities.list({ status: 'pending', limit: 10 }), { path: '/opportunities?status=pending&limit=10' });
    await expectCall('opportunities.list scoped intent', (client) => client.opportunities.list({ status: 'pending', scopeType: 'intent', scopeId: SELECTED_INTENT_ID, limit: 10 }), { path: `/opportunities?status=pending&scopeType=intent&scopeId=${SELECTED_INTENT_ID}&limit=10` });
    await expectCall('opportunities.listForIntent', (client) => client.opportunities.listForIntent(SELECTED_INTENT_ID, { status: 'pending', limit: 10 }), { path: `/opportunities?status=pending&limit=10&scopeType=intent&scopeId=${SELECTED_INTENT_ID}` });
    await expectCall('opportunities.radar', (client) => client.opportunities.radar({ noCache: true }), { path: '/opportunities/radar?noCache=true' });
    await expectCall('opportunities.radar scoped intent', (client) => client.opportunities.radar({ scopeType: 'intent', scopeId: SELECTED_INTENT_ID, noCache: true }), { path: `/opportunities/radar?scopeType=intent&scopeId=${SELECTED_INTENT_ID}&noCache=true` });
    await expectCall('opportunities.radarForIntent', (client) => client.opportunities.radarForIntent(SELECTED_INTENT_ID, { noCache: true }), { path: `/opportunities/radar?noCache=true&scopeType=intent&scopeId=${SELECTED_INTENT_ID}` });
    await expectCall('opportunities.chatContext', (client) => client.opportunities.chatContext('user/1'), { path: '/opportunities/chat-context?peerUserId=user%2F1' });
    await expectCall('opportunities.get', (client) => client.opportunities.get('opp/1'), { path: '/opportunities/opp%2F1' });
    await expectCall('opportunities.inviteMessage', (client) => client.opportunities.inviteMessage('opp/1'), { path: '/opportunities/opp%2F1/invite-message' });
    await expectCall('opportunities.updateStatus', (client) => client.opportunities.updateStatus('opp/1', 'accepted'), { path: '/opportunities/opp%2F1/status', method: 'PATCH', body: { status: 'accepted' } });
    await expectCall('opportunities.updateStatusForIntent', (client) => client.opportunities.updateStatusForIntent('opp/1', 'accepted', SELECTED_INTENT_ID), { path: '/opportunities/opp%2F1/status', method: 'PATCH', body: { status: 'accepted', scopeType: 'intent', scopeId: SELECTED_INTENT_ID } });
    await expectCall('opportunities.startChat', (client) => client.opportunities.startChat('opp/1'), { path: '/opportunities/opp%2F1/start-chat', method: 'POST', body: {} });
    await expectCall('opportunities.startChatForIntent', (client) => client.opportunities.startChatForIntent('opp/1', SELECTED_INTENT_ID), { path: '/opportunities/opp%2F1/start-chat', method: 'POST', body: { scopeType: 'intent', scopeId: SELECTED_INTENT_ID } });
  });

  it('uses controller-backed question and conversation endpoints', async () => {
    await expectCall('questions.pending', (client) => client.questions.pending({ sourceId: 'intent/1' }), { path: '/questions?status=pending&sourceId=intent%2F1' });
    await expectCall('questions.pending scoped intent', (client) => client.questions.pending({ scopeType: 'intent', scopeId: SELECTED_INTENT_ID }), { path: `/questions?status=pending&scopeType=intent&scopeId=${SELECTED_INTENT_ID}` });
    await expectCall('questions.pendingForIntent', (client) => client.questions.pendingForIntent(SELECTED_INTENT_ID), { path: `/questions?status=pending&scopeType=intent&scopeId=${SELECTED_INTENT_ID}` });
    await expectCall('questions.answered', (client) => client.questions.answered(), { path: '/questions?status=answered' });
    await expectCall('questions.answeredForIntent', (client) => client.questions.answeredForIntent(SELECTED_INTENT_ID), { path: `/questions?status=answered&scopeType=intent&scopeId=${SELECTED_INTENT_ID}` });
    await expectCall('questions.answer', (client) => client.questions.answer('question/1', { selectedOptions: ['yes'] }), { path: '/questions/question%2F1/answer', method: 'POST', body: { selectedOptions: ['yes'] } });
    await expectCall('questions.dismiss', (client) => client.questions.dismiss('question/1'), { path: '/questions/question%2F1/dismiss', method: 'POST', body: {} });

    await expectCall('conversations.list', (client) => client.conversations.list(), { path: '/conversations' });
    await expectCall('conversations.negotiations', (client) => client.conversations.negotiations(), { path: '/conversations/negotiations' });
    await expectCall('conversations.messages', (client) => client.conversations.messages('conv/1', { limit: 50 }), { path: '/conversations/conv%2F1/messages?limit=50' });
    await expectCall('conversations.sendMessage', (client) => client.conversations.sendMessage('conv/1', { parts: [{ text: 'hi' }] }), { path: '/conversations/conv%2F1/messages', method: 'POST', body: { parts: [{ text: 'hi' }] } });
    await expectCall('conversations.getOrCreateDm', (client) => client.conversations.getOrCreateDm('user/1'), { path: '/conversations/dm', method: 'POST', body: { peerUserId: 'user/1' } });
    await expectCall('conversations.updateMetadata', (client) => client.conversations.updateMetadata('conv/1', { title: 'hello' }), { path: '/conversations/conv%2F1/metadata', method: 'PATCH', body: { metadata: { title: 'hello' } } });
    await expectCall('conversations.delete', (client) => client.conversations.delete('conv/1'), { path: '/conversations/conv%2F1', method: 'DELETE' });
  });
});
