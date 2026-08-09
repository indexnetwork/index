import { expect, test } from 'bun:test';

const swift = await Bun.file(new URL('./Sources/main.swift', import.meta.url)).text();
const app = await Bun.file(new URL('./src/index-amiga/app.jsx', import.meta.url)).text();

test('injects the bundle-owned host into the native bridge', () => {
  expect(swift).toContain('static var deepLinkHosts: [String]');
  expect(swift).toContain('object(forInfoDictionaryKey: "IndexDeepLinkHost")');
  expect(swift).toContain('"deepLinkHosts": AppConfig.deepLinkHosts');
  // Share links use APP_URL, not deepLinkHosts[0] (prod-associated host).
  expect(swift).toContain('"appUrl": AppConfig.trimTrailingSlash(AppConfig.appURL)');
});

test('claims the bundle host and also the APP_URL host', () => {
  expect(swift).toContain('let configuredHost = bundleHost?.trimmingCharacters(in: .whitespacesAndNewlines)');
  expect(swift).toContain('if let configuredHost, !configuredHost.isEmpty {');
  expect(swift).toContain('hosts.append(configuredHost)');
  expect(swift).toContain('hosts.append("index.network")');
  expect(swift).toContain('URL(string: appURL)?.host');
  expect(swift).toContain('hosts.append(appHost)');
});

test('uses native hosts for parsing and unrouteable-link notices', () => {
  expect(app).toContain('window.INDEX_NATIVE?.deepLinkHosts');
  expect(app).toContain('parseDeepLink(url, deepLinkHosts)');
  expect(app).toContain('isIndexDeepLink(url, deepLinkHosts)');
});
