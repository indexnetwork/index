import { describe, expect, it } from 'bun:test';

import { isIndexDeepLink, parseDeepLink } from './deeplink.mjs';

const OPPORTUNITY_ID = '00000000-0000-4000-8000-00000000b222';
const USER_ID = '00000000-0000-4000-8000-00000000c333';
const CONNECT_CODE = 'a1b2c3d4';

describe('mac deep-link routing contract', () => {
  it('routes universal links for all three paths', () => {
    expect(parseDeepLink(`https://index.network/o/${OPPORTUNITY_ID}`))
      .toEqual({ route: 'card', id: OPPORTUNITY_ID });
    expect(parseDeepLink(`https://index.network/u/${USER_ID}`))
      .toEqual({ route: 'profile', id: USER_ID });
    expect(parseDeepLink(`https://index.network/c/${CONNECT_CODE}`))
      .toEqual({ route: 'legacy-connect', code: CONNECT_CODE });
  });

  it('routes index:// links for all three paths', () => {
    expect(parseDeepLink(`index://o/${OPPORTUNITY_ID}`))
      .toEqual({ route: 'card', id: OPPORTUNITY_ID });
    expect(parseDeepLink(`index://u/${USER_ID}`))
      .toEqual({ route: 'profile', id: USER_ID });
    expect(parseDeepLink(`index://c/${CONNECT_CODE}`))
      .toEqual({ route: 'legacy-connect', code: CONNECT_CODE });
  });

  it('accepts the scheme alias without an authority and with extra slashes', () => {
    expect(parseDeepLink(`index:o/${OPPORTUNITY_ID}`))
      .toEqual({ route: 'card', id: OPPORTUNITY_ID });
    expect(parseDeepLink(`index:///o/${OPPORTUNITY_ID}`))
      .toEqual({ route: 'card', id: OPPORTUNITY_ID });
    expect(parseDeepLink(`INDEX://o/${OPPORTUNITY_ID}`))
      .toEqual({ route: 'card', id: OPPORTUNITY_ID });
  });

  it('ignores query strings, fragments, trailing slashes and surrounding space', () => {
    expect(parseDeepLink(`https://index.network/o/${OPPORTUNITY_ID}/`))
      .toEqual({ route: 'card', id: OPPORTUNITY_ID });
    expect(parseDeepLink(`https://index.network/o/${OPPORTUNITY_ID}?utm_source=mail#top`))
      .toEqual({ route: 'card', id: OPPORTUNITY_ID });
    expect(parseDeepLink(`index://u/${USER_ID}/?ref=chat#bio`))
      .toEqual({ route: 'profile', id: USER_ID });
    expect(parseDeepLink(`  https://index.network/u/${USER_ID}  `))
      .toEqual({ route: 'profile', id: USER_ID });
  });

  it('decodes percent-escaped ids and keeps malformed escapes verbatim', () => {
    expect(parseDeepLink('https://index.network/o/opp%2F1'))
      .toEqual({ route: 'card', id: 'opp/1' });
    expect(parseDeepLink('index://o/opp%zz'))
      .toEqual({ route: 'card', id: 'opp%zz' });
  });

  it('treats the host as configuration, not routing', () => {
    // Default allowance is production only.
    expect(parseDeepLink(`https://staging.index.network/o/${OPPORTUNITY_ID}`)).toBeNull();
    // A dev/staging host is added without touching the route table.
    expect(parseDeepLink(`https://staging.index.network/o/${OPPORTUNITY_ID}`, {
      hosts: ['index.network', 'staging.index.network'],
    })).toEqual({ route: 'card', id: OPPORTUNITY_ID });
    // Host matching is case-insensitive; an empty list falls back to the default.
    expect(parseDeepLink(`https://INDEX.NETWORK/u/${USER_ID}`))
      .toEqual({ route: 'profile', id: USER_ID });
    expect(parseDeepLink(`https://index.network/u/${USER_ID}`, { hosts: [] }))
      .toEqual({ route: 'profile', id: USER_ID });
  });

  it('rejects foreign hosts and non-https web schemes', () => {
    expect(parseDeepLink(`https://evil.example/o/${OPPORTUNITY_ID}`)).toBeNull();
    expect(parseDeepLink(`https://index.network.evil.example/o/${OPPORTUNITY_ID}`)).toBeNull();
    expect(parseDeepLink(`https://index.network/o/${OPPORTUNITY_ID}`, { hosts: ['staging.index.network'] })).toBeNull();
    // Universal links are https-only, and no other scheme is claimed.
    expect(parseDeepLink(`http://index.network/o/${OPPORTUNITY_ID}`)).toBeNull();
    expect(parseDeepLink(`indexnetwork://o/${OPPORTUNITY_ID}`)).toBeNull();
  });

  it('rejects unknown paths and missing ids', () => {
    expect(parseDeepLink('https://index.network/')).toBeNull();
    expect(parseDeepLink('https://index.network/o')).toBeNull();
    expect(parseDeepLink('https://index.network/o/')).toBeNull();
    expect(parseDeepLink(`https://index.network/x/${OPPORTUNITY_ID}`)).toBeNull();
    expect(parseDeepLink(`https://index.network/o/${OPPORTUNITY_ID}/extra`)).toBeNull();
    expect(parseDeepLink('index://o')).toBeNull();
    expect(parseDeepLink('index://o/')).toBeNull();
    expect(parseDeepLink('index://')).toBeNull();
  });

  it('separates "is this ours" from "does it route"', () => {
    // Routable links are ours.
    expect(isIndexDeepLink(`https://index.network/o/${OPPORTUNITY_ID}`)).toBe(true);
    expect(isIndexDeepLink(`index://u/${USER_ID}`)).toBe(true);
    // Claimed host, no route in the app: the AASA claims /u/* and `*` matches
    // separators, so macOS hands over web-only routes like /u/<id>/chat.
    expect(parseDeepLink(`https://index.network/u/${USER_ID}/chat`)).toBeNull();
    expect(isIndexDeepLink(`https://index.network/u/${USER_ID}/chat`)).toBe(true);
    expect(isIndexDeepLink('https://index.network/settings')).toBe(true);
    expect(isIndexDeepLink('index://nope')).toBe(true);
    // Not ours: foreign hosts, other schemes, junk.
    expect(isIndexDeepLink(`https://evil.example/o/${OPPORTUNITY_ID}`)).toBe(false);
    expect(isIndexDeepLink(`http://index.network/o/${OPPORTUNITY_ID}`)).toBe(false);
    expect(isIndexDeepLink(`https://index.network/o/${OPPORTUNITY_ID}`, { hosts: ['staging.index.network'] })).toBe(false);
    expect(isIndexDeepLink('not a url')).toBe(false);
    expect(isIndexDeepLink(null)).toBe(false);
  });

  it('never throws on malformed or non-string input', () => {
    expect(parseDeepLink('')).toBeNull();
    expect(parseDeepLink('   ')).toBeNull();
    expect(parseDeepLink('not a url')).toBeNull();
    expect(parseDeepLink('https://')).toBeNull();
    expect(parseDeepLink('://index.network/o/1')).toBeNull();
    expect(parseDeepLink(undefined)).toBeNull();
    expect(parseDeepLink(null)).toBeNull();
    expect(parseDeepLink(42)).toBeNull();
    expect(parseDeepLink({ url: `https://index.network/o/${OPPORTUNITY_ID}` })).toBeNull();
  });
});
