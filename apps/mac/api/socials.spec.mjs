import { describe, expect, it } from 'bun:test';

import {
  buildProfileSocials,
  buildSocialHref,
  firstSocialValue,
  parseSocial,
  socialApiLabelOf,
  socialHandleOf,
  socialHrefOf,
  socialPlatformOf,
  splitProfileSocials,
} from './socials.mjs';

describe('the links that were broken in the wild', () => {
  it('opens only the first address when a field holds several', () => {
    // Rendered whole this became https://x.com/tidemid%20,%20https://…
    const social = { label: 'twitter', value: 'tidemid , https://www.instagram.com/nickerokhin/' };
    expect(socialHrefOf(social)).toBe('https://x.com/tidemid');
    expect(socialHandleOf(social)).toBe('tidemid');
  });

  it('keeps the host of a linkedin url filed under the generic custom label', () => {
    // Was https://eugene-pavlenko-b31a0430/ — the host stripped, then rebuilt
    // from a label that had none to give back.
    const social = { label: 'custom', value: 'linkedin.com/in/eugene-pavlenko-b31a0430' };
    expect(socialHrefOf(social)).toBe('https://linkedin.com/in/eugene-pavlenko-b31a0430');
    expect(socialPlatformOf(social)).toBe('linkedin');
    expect(socialHandleOf(social)).toBe('eugene-pavlenko-b31a0430');
  });

  it('keeps the host of an x url filed under the generic custom label', () => {
    // Was https://eugenepx/
    const social = { label: 'custom', value: 'x.com/eugenepx' };
    expect(socialHrefOf(social)).toBe('https://x.com/eugenepx');
    expect(socialPlatformOf(social)).toBe('x');
  });

  it('refuses to link a bare word that names no host', () => {
    // https://eugenepx/ resolves nowhere; no link beats a dead one.
    expect(socialHrefOf({ label: 'custom', value: 'eugenepx' })).toBe('');
    expect(socialHrefOf({ label: 'website', value: 'eugenepx' })).toBe('');
  });
});

describe('parseSocial', () => {
  it('reads a bare handle through its label', () => {
    expect(parseSocial({ label: 'twitter', value: '@seren' })).toEqual({
      platform: 'x', handle: 'seren', href: 'https://x.com/seren',
    });
    expect(parseSocial({ label: 'github', value: 'seren' }).href).toBe('https://github.com/seren');
    expect(parseSocial({ label: 'telegram', value: 'seren' }).href).toBe('https://t.me/seren');
    expect(parseSocial({ label: 'linkedin', value: 'seren' }).href).toBe('https://linkedin.com/in/seren');
  });

  it('lets the value outrank a label that disagrees with it', () => {
    expect(parseSocial({ label: 'linkedin', value: 'https://github.com/seren' })).toEqual({
      platform: 'github', handle: 'seren', href: 'https://github.com/seren',
    });
  });

  it('accepts full urls, scheme-relative urls and host/path values', () => {
    for (const value of [
      'https://x.com/seren', 'http://x.com/seren', '//x.com/seren',
      'x.com/seren', 'https://www.x.com/seren', 'https://twitter.com/seren',
      'https://mobile.twitter.com/seren', 'https://x.com/seren/',
    ]) {
      expect(socialHrefOf({ label: 'twitter', value })).toBe('https://x.com/seren');
    }
  });

  it('treats a platform front page as no profile at all', () => {
    expect(socialHrefOf({ label: 'twitter', value: 'https://x.com' })).toBe('');
    expect(socialHrefOf({ label: 'twitter', value: 'https://x.com/' })).toBe('');
  });

  it('keeps a website whole, path and all', () => {
    expect(parseSocial({ label: 'custom', value: 'https://index.network/about' })).toEqual({
      platform: 'website', handle: 'index.network/about', href: 'https://index.network/about',
    });
    expect(socialHrefOf({ label: 'custom', value: 'index.network' })).toBe('https://index.network');
  });

  it('holds a linkedin page that is not a person one segment up', () => {
    const social = { label: 'linkedin', value: 'https://linkedin.com/company/indexnetwork' };
    expect(socialHandleOf(social)).toBe('company/indexnetwork');
    expect(socialHrefOf(social)).toBe('https://linkedin.com/company/indexnetwork');
    // and survives the round trip through the editor
    expect(buildSocialHref('linkedin', 'company/indexnetwork'))
      .toBe('https://linkedin.com/company/indexnetwork');
  });

  it('is empty for an empty entry', () => {
    expect(parseSocial({ label: 'twitter', value: '' })).toEqual({ platform: 'x', handle: '', href: '' });
    expect(parseSocial({})).toEqual({ platform: 'website', handle: '', href: '' });
    expect(socialHrefOf({ label: 'custom', value: '   ' })).toBe('');
  });

  it('reads the demo record shape as well as the api one', () => {
    expect(socialHrefOf({ id: 'x', prefix: 'x.com/', handle: 'seren' })).toBe('https://x.com/seren');
  });

  it('does not mistake an unknown platform for a website handle', () => {
    const social = { label: 'instagram', value: 'https://instagram.com/nickerokhin' };
    expect(socialPlatformOf(social)).toBe('website');
    expect(socialHrefOf(social)).toBe('https://instagram.com/nickerokhin');
  });
});

describe('firstSocialValue', () => {
  it('takes the first entry and drops trailing prose punctuation', () => {
    expect(firstSocialValue('a, b')).toBe('a');
    expect(firstSocialValue('  https://x.com/a ; https://x.com/b ')).toBe('https://x.com/a');
    expect(firstSocialValue('https://index.network.')).toBe('https://index.network');
    expect(firstSocialValue(null)).toBe('');
  });
});

describe('socialApiLabelOf', () => {
  it('stores x as the twitter label the rest of the platform filters on', () => {
    expect(socialApiLabelOf({ label: 'twitter', value: 'seren' })).toBe('twitter');
    expect(socialApiLabelOf({ id: 'x', handle: 'seren' })).toBe('twitter');
    expect(socialApiLabelOf({ platform: 'x' })).toBe('twitter');
  });

  it('keeps the other canonical labels and buckets everything else as custom', () => {
    expect(socialApiLabelOf({ platform: 'linkedin' })).toBe('linkedin');
    expect(socialApiLabelOf({ platform: 'github' })).toBe('github');
    expect(socialApiLabelOf({ platform: 'telegram' })).toBe('telegram');
    expect(socialApiLabelOf({ platform: 'website' })).toBe('custom');
    expect(socialApiLabelOf({ label: 'custom', value: 'https://index.network' })).toBe('custom');
  });
});

describe('the editor round trip', () => {
  it('always offers every field, filled or not', () => {
    const { handles, websites } = splitProfileSocials([]);
    expect(handles).toEqual({ x: '', linkedin: '', github: '', telegram: '' });
    expect(websites).toEqual([]);
  });

  it('sorts stored rows into their fields, websites included', () => {
    const { handles, websites } = splitProfileSocials([
      { label: 'twitter', value: 'https://x.com/seren' },
      { label: 'custom', value: 'linkedin.com/in/seren' },
      { label: 'custom', value: 'https://index.network' },
      { label: 'custom', value: 'https://seren.dev/about' },
    ]);
    expect(handles).toEqual({ x: 'seren', linkedin: 'seren', github: '', telegram: '' });
    expect(websites).toEqual(['index.network', 'seren.dev/about']);
  });

  it('keeps the first of a duplicated platform rather than stacking them up', () => {
    const { handles, websites } = splitProfileSocials([
      { label: 'twitter', value: 'seren' },
      { label: 'twitter', value: 'someone-else' },
    ]);
    expect(handles.x).toBe('seren');
    expect(websites).toEqual([]);
  });

  it('writes back canonical labels and whole urls', () => {
    expect(buildProfileSocials({ x: 'seren', linkedin: 'seren', github: '', telegram: '' }, ['index.network']))
      .toEqual([
        { label: 'twitter', value: 'https://x.com/seren' },
        { label: 'linkedin', value: 'https://linkedin.com/in/seren' },
        { label: 'custom', value: 'https://index.network' },
      ]);
  });

  it('drops cleared fields instead of storing empty rows', () => {
    expect(buildProfileSocials({ x: '', linkedin: '', github: '', telegram: '' }, ['', '  ']))
      .toEqual([]);
  });

  it('accepts a pasted url in any field', () => {
    expect(buildProfileSocials({ x: 'https://x.com/seren', linkedin: '', github: '', telegram: '' }, []))
      .toEqual([{ label: 'twitter', value: 'https://x.com/seren' }]);
  });

  it('does not store the same website twice', () => {
    expect(buildProfileSocials({}, ['index.network', 'https://index.network/']))
      .toEqual([{ label: 'custom', value: 'https://index.network' }]);
  });

  it('survives a full load-edit-save cycle without drift', () => {
    const stored = [
      { label: 'twitter', value: 'https://x.com/seren' },
      { label: 'linkedin', value: 'https://linkedin.com/in/seren' },
      { label: 'github', value: 'https://github.com/seren' },
      { label: 'telegram', value: 'https://t.me/seren' },
      { label: 'custom', value: 'https://index.network' },
    ];
    const { handles, websites } = splitProfileSocials(stored);
    expect(buildProfileSocials(handles, websites)).toEqual(stored);
  });
});
