import { describe, expect, test } from 'bun:test';

import { knownMcpClientName, redirectHost } from './mcp-known-clients';

describe('knownMcpClientName', () => {
  test('ChatGPT connector redirect', () => {
    expect(knownMcpClientName('https://chatgpt.com/connector_platform_oauth_redirect')).toBe('ChatGPT');
  });

  test('Claude connector redirects', () => {
    expect(knownMcpClientName('https://claude.ai/api/mcp/auth_callback')).toBe('Claude');
    expect(knownMcpClientName('https://claude.com/api/mcp/auth_callback')).toBe('Claude');
  });

  test('unknown hosts are not vouched for', () => {
    expect(knownMcpClientName('https://example.com/callback')).toBeNull();
    expect(knownMcpClientName('http://localhost:3334/callback')).toBeNull();
  });

  test('lookalike hosts are not vouched for', () => {
    expect(knownMcpClientName('https://chatgpt.com.evil.example/cb')).toBeNull();
    expect(knownMcpClientName('https://evil-chatgpt.com/cb')).toBeNull();
    expect(knownMcpClientName('https://sub.chatgpt.com/cb')).toBeNull();
  });

  test('known host over plain HTTP, a custom port, or with credentials is not vouched for', () => {
    expect(knownMcpClientName('http://chatgpt.com/connector_platform_oauth_redirect')).toBeNull();
    expect(knownMcpClientName('https://chatgpt.com:8443/cb')).toBeNull();
    expect(knownMcpClientName('https://user@chatgpt.com/cb')).toBeNull();
  });

  test('unparseable and custom-scheme redirects are not vouched for', () => {
    expect(knownMcpClientName('not a url')).toBeNull();
    expect(knownMcpClientName('cursor://anysphere.cursor-retrieval/oauth/callback')).toBeNull();
  });
});

describe('redirectHost', () => {
  test('host with port', () => {
    expect(redirectHost('https://chatgpt.com/connector_platform_oauth_redirect')).toBe('chatgpt.com');
    expect(redirectHost('http://127.0.0.1:3334/callback')).toBe('127.0.0.1:3334');
  });

  test('falls back to the raw URI when there is no host', () => {
    expect(redirectHost('not a url')).toBe('not a url');
  });
});
