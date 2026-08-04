import { expect, test } from 'bun:test';

const swift = await Bun.file(new URL('./Sources/main.swift', import.meta.url)).text();
const app = await Bun.file(new URL('./src/index-amiga/app.jsx', import.meta.url)).text();

test('injects the bundle-owned host into the native bridge', () => {
  expect(swift).toContain('static var deepLinkHosts: [String]');
  expect(swift).toContain('object(forInfoDictionaryKey: "IndexDeepLinkHost")');
  expect(swift).toContain('"deepLinkHosts": AppConfig.deepLinkHosts');
});

test('uses optional binding for a trimmed bundle host and falls back when empty', () => {
  expect(swift).not.toContain('host?.trimmingCharacters(in: .whitespacesAndNewlines)\n            .flatMap');
  expect(swift).toContain('let configuredHost = host?.trimmingCharacters(in: .whitespacesAndNewlines)');
  expect(swift).toContain('if let configuredHost, !configuredHost.isEmpty {');
  expect(swift).toContain('return [configuredHost]');
  expect(swift).toContain('return ["index.network"]');
});

test('uses native hosts for parsing and unrouteable-link notices', () => {
  expect(app).toContain('window.INDEX_NATIVE?.deepLinkHosts');
  expect(app).toContain('parseDeepLink(url, deepLinkHosts)');
  expect(app).toContain('isIndexDeepLink(url, deepLinkHosts)');
});
