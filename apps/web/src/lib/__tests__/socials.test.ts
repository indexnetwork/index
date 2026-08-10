import { describe, expect, it } from 'vitest';

import { firstSocialValue, parseSocial, resolveSocials, socialHrefOf } from '../socials';

describe('the links that were broken in the wild', () => {
  it('opens only the first address when a field holds several', () => {
    // Rendered whole this became https://x.com/tidemid%20,%20https://…
    expect(socialHrefOf({ label: 'twitter', value: 'tidemid , https://www.instagram.com/nickerokhin/' }))
      .toBe('https://x.com/tidemid');
  });

  it('keeps the host of a linkedin url filed under the generic custom label', () => {
    // Was https://eugene-pavlenko-b31a0430/
    const social = { label: 'custom', value: 'linkedin.com/in/eugene-pavlenko-b31a0430' };
    expect(parseSocial(social)).toEqual({
      platform: 'linkedin',
      handle: 'eugene-pavlenko-b31a0430',
      href: 'https://linkedin.com/in/eugene-pavlenko-b31a0430',
    });
  });

  it('keeps the host of an x url filed under the generic custom label', () => {
    // Was https://eugenepx/
    expect(socialHrefOf({ label: 'custom', value: 'x.com/eugenepx' })).toBe('https://x.com/eugenepx');
  });

  it('refuses to link a bare word that names no host', () => {
    expect(socialHrefOf({ label: 'custom', value: 'eugenepx' })).toBe('');
  });
});

describe('parseSocial', () => {
  it('reads a bare handle through its label', () => {
    expect(socialHrefOf({ label: 'twitter', value: '@seren' })).toBe('https://x.com/seren');
    expect(socialHrefOf({ label: 'linkedin', value: 'seren' })).toBe('https://linkedin.com/in/seren');
    expect(socialHrefOf({ label: 'github', value: 'seren' })).toBe('https://github.com/seren');
    expect(socialHrefOf({ label: 'telegram', value: 'seren' })).toBe('https://t.me/seren');
  });

  it('settles every twitter host onto x.com', () => {
    for (const value of [
      'https://x.com/seren', 'http://twitter.com/seren', '//x.com/seren',
      'x.com/seren', 'https://www.x.com/seren', 'https://mobile.twitter.com/seren',
      'https://x.com/seren/',
    ]) {
      expect(socialHrefOf({ label: 'twitter', value })).toBe('https://x.com/seren');
    }
  });

  it('lets the value outrank a label that disagrees with it', () => {
    expect(parseSocial({ label: 'linkedin', value: 'https://github.com/seren' }).platform).toBe('github');
  });

  it('treats a platform front page as no profile at all', () => {
    expect(socialHrefOf({ label: 'twitter', value: 'https://x.com/' })).toBe('');
  });

  it('keeps a website whole, path and all', () => {
    expect(parseSocial({ label: 'custom', value: 'https://index.network/about' })).toEqual({
      platform: 'website', handle: 'index.network/about', href: 'https://index.network/about',
    });
    expect(socialHrefOf({ label: 'custom', value: 'index.network' })).toBe('https://index.network');
  });

  it('holds a linkedin page that is not a person one segment up', () => {
    expect(socialHrefOf({ label: 'linkedin', value: 'https://linkedin.com/company/indexnetwork' }))
      .toBe('https://linkedin.com/company/indexnetwork');
  });

  it('is empty for an empty entry', () => {
    expect(socialHrefOf({ label: 'twitter', value: '' })).toBe('');
    expect(socialHrefOf({})).toBe('');
  });
});

describe('firstSocialValue', () => {
  it('takes the first entry and drops trailing prose punctuation', () => {
    expect(firstSocialValue('a, b')).toBe('a');
    expect(firstSocialValue('https://index.network.')).toBe('https://index.network');
    expect(firstSocialValue(null)).toBe('');
  });
});

describe('resolveSocials', () => {
  it('shows a mislabelled link under the platform it actually points at', () => {
    expect(resolveSocials([
      { label: 'custom', value: 'https://index.network' },
      { label: 'custom', value: 'linkedin.com/in/seren' },
      { label: 'x', value: 'seren' },
    ])).toEqual([
      { platform: 'x', handle: 'seren', href: 'https://x.com/seren' },
      { platform: 'linkedin', handle: 'seren', href: 'https://linkedin.com/in/seren' },
      { platform: 'website', handle: 'index.network', href: 'https://index.network' },
    ]);
  });

  it('leaves out what resolves to nothing, and never repeats an address', () => {
    expect(resolveSocials([
      { label: 'custom', value: 'eugenepx' },
      { label: 'twitter', value: 'seren' },
      { label: 'custom', value: 'https://x.com/seren' },
      { label: 'github', value: '' },
    ])).toEqual([{ platform: 'x', handle: 'seren', href: 'https://x.com/seren' }]);
  });

  it('is empty rather than throwing when there are no socials', () => {
    expect(resolveSocials(undefined)).toEqual([]);
    expect(resolveSocials(null)).toEqual([]);
  });
});
