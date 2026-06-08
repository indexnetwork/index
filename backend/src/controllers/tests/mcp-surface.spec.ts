import { describe, expect, spyOn, test } from 'bun:test';

import {
  findTelegramHandleMismatch,
  parseClientSurface,
  resolveMcpApiKeyPrincipal,
  telegramHandleFromRequest,
} from '../mcp.controller';

function requestWithHeaders(headers: Record<string, string>): Request {
  return new Request('https://protocol.index.network/mcp', { headers });
}

describe('parseClientSurface', () => {
  test('returns "web" when header is null', () => {
    expect(parseClientSurface(null)).toBe('web');
  });

  test('returns "web" when header is empty string', () => {
    expect(parseClientSurface('')).toBe('web');
  });

  test('returns "telegram" for canonical lowercase value', () => {
    expect(parseClientSurface('telegram')).toBe('telegram');
  });

  test('returns "telegram" regardless of case', () => {
    expect(parseClientSurface('Telegram')).toBe('telegram');
    expect(parseClientSurface('TELEGRAM')).toBe('telegram');
  });

  test('trims whitespace before matching', () => {
    expect(parseClientSurface('  telegram  ')).toBe('telegram');
    expect(parseClientSurface('\ttelegram\n')).toBe('telegram');
  });

  test('returns "web" for explicit web value', () => {
    expect(parseClientSurface('web')).toBe('web');
    expect(parseClientSurface('WEB')).toBe('web');
  });

  test('coerces unknown values to "web"', () => {
    expect(parseClientSurface('slack')).toBe('web');
    expect(parseClientSurface('foo')).toBe('web');
    expect(parseClientSurface('true')).toBe('web');
  });

  test('warns exactly once per unknown value, not on subsequent calls', () => {
    const spy = spyOn(console, 'warn');
    // Use a value not seen by any earlier test so the Set is empty for it.
    parseClientSurface('zz-novel-unknown-value');
    parseClientSurface('zz-novel-unknown-value');
    parseClientSurface('zz-novel-unknown-value');
    const callCount = spy.mock.calls.filter((call) =>
      typeof call[0] === 'string' && call[0].includes('zz-novel-unknown-value')
    ).length;
    expect(callCount).toBe(1);
    spy.mockRestore();
  });
});

describe('telegramHandleFromRequest', () => {
  test('normalizes x-index-telegram-username', () => {
    expect(telegramHandleFromRequest(requestWithHeaders({
      'x-index-telegram-username': ' @alice_tg ',
    }))).toBe('alice_tg');
  });

  test('accepts x-index-telegram-handle fallback', () => {
    expect(telegramHandleFromRequest(requestWithHeaders({
      'x-index-telegram-handle': 'https://t.me/alice_tg',
    }))).toBe('alice_tg');
  });

  test('strips an uppercase t.me URL prefix (case-insensitive, matching the SQL)', () => {
    expect(telegramHandleFromRequest(requestWithHeaders({
      'x-index-telegram-handle': 'HTTPS://T.ME/alice_tg',
    }))).toBe('alice_tg');
  });

  test('rejects invalid or missing handles', () => {
    expect(telegramHandleFromRequest(requestWithHeaders({}))).toBeNull();
    expect(telegramHandleFromRequest(requestWithHeaders({
      'x-index-telegram-username': 'bad',
    }))).toBeNull();
  });
});

describe('findTelegramHandleMismatch', () => {
  test('accepts matching authenticated user telegram handle', () => {
    expect(findTelegramHandleMismatch({
      userId: 'user-1',
      telegramHandle: '@Alice_TG',
      authenticatedUserSocials: [{ userId: 'user-1', label: 'telegram', value: 'alice_tg' }],
      matchingTelegramSocials: [{ userId: 'user-1', label: 'telegram', value: 'alice_tg' }],
    })).toBeNull();
  });

  test('rejects when authenticated user has a different telegram handle', () => {
    expect(findTelegramHandleMismatch({
      userId: 'edge-city-user',
      telegramHandle: 'seren_tg',
      authenticatedUserSocials: [{ userId: 'edge-city-user', label: 'telegram', value: 'edge_city_tg' }],
      matchingTelegramSocials: [],
    })).toEqual({ reason: 'authenticated_user_handle_mismatch' });
  });

  test('rejects when requested telegram handle belongs to another user', () => {
    expect(findTelegramHandleMismatch({
      userId: 'edge-city-user',
      telegramHandle: 'seren_tg',
      authenticatedUserSocials: [],
      matchingTelegramSocials: [{ userId: 'seren-user', label: 'telegram', value: 'seren_tg' }],
    })).toEqual({ reason: 'handle_belongs_to_other_user', ownerUserId: 'seren-user' });
  });

  test('detects another owner when the handle is stored as a t.me URL with query params', () => {
    expect(findTelegramHandleMismatch({
      userId: 'edge-city-user',
      telegramHandle: 'seren_tg',
      authenticatedUserSocials: [],
      matchingTelegramSocials: [{ userId: 'seren-user', label: 'telegram', value: 'https://t.me/seren_tg?start=abc' }],
    })).toEqual({ reason: 'handle_belongs_to_other_user', ownerUserId: 'seren-user' });
  });

  test('detects another owner when the handle is stored as an uppercase t.me URL', () => {
    expect(findTelegramHandleMismatch({
      userId: 'edge-city-user',
      telegramHandle: 'seren_tg',
      authenticatedUserSocials: [],
      matchingTelegramSocials: [{ userId: 'seren-user', label: 'telegram', value: 'HTTPS://T.ME/seren_tg' }],
    })).toEqual({ reason: 'handle_belongs_to_other_user', ownerUserId: 'seren-user' });
  });

  test('allows first-time persistence when the handle is not owned elsewhere', () => {
    expect(findTelegramHandleMismatch({
      userId: 'user-1',
      telegramHandle: 'new_handle',
      authenticatedUserSocials: [],
      matchingTelegramSocials: [],
    })).toBeNull();
  });
});

describe('resolveMcpApiKeyPrincipal', () => {
  test('prefers the verified session user over the key userId', () => {
    expect(resolveMcpApiKeyPrincipal({
      userId: 'row-user',
      referenceId: null,
      metadata: null,
    }, 'session-user')).toEqual({ userId: 'session-user' });
  });

  test('resolves to the key userId when columns agree and no session is present', () => {
    expect(resolveMcpApiKeyPrincipal({
      userId: 'row-user',
      referenceId: 'row-user',
      metadata: null,
    })).toEqual({ userId: 'row-user' });
  });

  test('falls back to referenceId for a non-agent key whose userId is null', () => {
    expect(resolveMcpApiKeyPrincipal({
      userId: null,
      referenceId: 'ref-user',
      metadata: null,
    })).toEqual({ userId: 'ref-user' });
  });

  test('rejects any key whose populated principal columns disagree', () => {
    expect(() => resolveMcpApiKeyPrincipal({
      userId: 'row-user',
      referenceId: 'row-ref',
      metadata: null,
    })).toThrow(/principal mismatch/);
  });

  test('rejects agent keys whose referenceId and userId diverge', () => {
    expect(() => resolveMcpApiKeyPrincipal({
      userId: 'edge-city-user',
      referenceId: 'seren-user',
      metadata: JSON.stringify({ agentId: 'agent-1' }),
    })).toThrow(/principal mismatch/);
  });

  test('rejects agent keys missing one principal id', () => {
    expect(() => resolveMcpApiKeyPrincipal({
      userId: 'seren-user',
      referenceId: null,
      metadata: JSON.stringify({ agentId: 'agent-1' }),
    })).toThrow(/principal mismatch/);
  });

  test('returns agentId for valid agent keys', () => {
    expect(resolveMcpApiKeyPrincipal({
      userId: 'seren-user',
      referenceId: 'seren-user',
      metadata: JSON.stringify({ agentId: 'agent-1' }),
    })).toEqual({ userId: 'seren-user', agentId: 'agent-1' });
  });
});
