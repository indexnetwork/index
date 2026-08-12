/* ---------- Social links: one shape, whatever the source ----------
   Socials arrive two ways: the demo record carries {id, prefix, handle}, while
   the API carries {label, value} where value is usually a whole URL. Everything
   is normalized to a platform plus a bare handle, because the logo already says
   which platform it is: showing "x.com/seren" next to an X mark is the platform
   said twice.

   The reading of those shapes lives in api/socials.mjs, which is where the
   editor and the mappers read them from too, and is covered by `bun test api/`.
   It is bundled ahead of these scripts, so it is only lifted into scope here. */
const {
  SOCIAL_PREFIX, EDITABLE_PLATFORMS, parseSocial, socialPlatformOf, socialHandleOf,
  socialHrefOf, socialApiLabelOf, buildSocialHref, normalizeSocial,
  splitProfileSocials, buildProfileSocials,
} = window.IndexApi;

/* ---------- SocialGlyph: 1-bit platform marks ----------
   Drawn rather than fetched: the bundle is offline, so a webfont or an SVG
   sprite from a CDN is not an option. Each is reduced to what survives at
   13px in one colour, the X cross, the "in" tile, the octocat silhouette as
   a head-and-tail, the telegram plane, a globe for anything else. */
// SVG mask ids are document-global, so each rendered glyph needs its own or
// they collide and every cat after the first renders against the wrong mask.
let maskSeq = 0;

function SocialGlyph({ id, size = 13, color = A.fg }) {
  const k = String(id || "").toLowerCase();
  const p = { width:size, height:size, viewBox:"0 0 16 16", style:{ display:"block", flex:"0 0 auto" } };
  if (k === "x" || k === "twitter") {
    return (
      <svg {...p} fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="square">
        <line x1="3" y1="3" x2="13" y2="13"/>
        <line x1="13" y1="3" x2="3" y2="13"/>
      </svg>
    );
  }
  if (k === "linkedin") {
    return (
      <svg {...p} fill="none" stroke={color} strokeWidth={1.5}>
        <rect x="1.75" y="1.75" width="12.5" height="12.5"/>
        <rect x="4" y="6.5" width="1.8" height="5.5" fill={color} stroke="none"/>
        <rect x="4" y="3.9" width="1.8" height="1.8" fill={color} stroke="none"/>
        <path d="M7.6 12V6.5h1.8v.9c.4-.7 1.1-1 1.9-1 1.2 0 1.9.8 1.9 2.2V12h-1.8V8.9c0-.7-.3-1.1-.9-1.1s-1.1.5-1.1 1.2V12z"
          fill={color} stroke="none"/>
      </svg>
    );
  }
  if (k === "github" || k === "git" || k === "gitlab") {
    // The cat, drawn as a solid silhouette rather than an outline: at 13px a
    // 1.5px stroke closes up into mud, while a filled shape keeps its ears and
    // legs. The legs are punched out with a mask instead of being painted in a
    // paper colour, because this sits on white, on grey in the settings field,
    // and inverts to black when a profile link is hovered.
    const maskId = `gh-${maskSeq++}`;
    return (
      <svg {...p} fill="none">
        <mask id={maskId}>
          <rect width="16" height="16" fill="#000"/>
          <circle cx="8" cy="8.7" r="6.1" fill="#fff"/>
          <path d="M3.6 4.4C3.1 3.1 3.2 2.1 3.5 1.6c.7-.1 1.7.4 2.6 1.2z" fill="#fff"/>
          <path d="M12.4 4.4c.5-1.3.4-2.3.1-2.8-.7-.1-1.7.4-2.6 1.2z" fill="#fff"/>
          <path d="M6.05 15.2v-3.3h1.3v3.4z" fill="#000"/>
          <path d="M8.8 15.2v-2.9h1.3v3.0z" fill="#000"/>
        </mask>
        <rect width="16" height="16" fill={color} mask={`url(#${maskId})`}/>
        <path d="M3.75 11.9c-1.1-.3-1.5-1.25-1.5-1.25"
          stroke={color} strokeWidth={1.4} strokeLinecap="round"/>
      </svg>
    );
  }
  if (k === "telegram") {
    return (
      <svg {...p} fill="none" stroke={color} strokeWidth={1.4} strokeLinejoin="round">
        <path d="M14 2.5 1.8 7.4l3.4 1.2L13 3.6 6.6 9.9l-.2 3.4 2.1-2.4 3.3 2.3z"/>
      </svg>
    );
  }
  if (k === "email" || k === "mail") {
    return (
      <svg {...p} fill="none" stroke={color} strokeWidth={1.5}>
        <rect x="1.5" y="3.5" width="13" height="9"/>
        <path d="M1.5 4.2 8 9l6.5-4.8"/>
      </svg>
    );
  }
  // website and anything unrecognised
  return (
    <svg {...p} fill="none" stroke={color} strokeWidth={1.5}>
      <circle cx="8" cy="8" r="6.25"/>
      <ellipse cx="8" cy="8" rx="2.6" ry="6.25"/>
      <line x1="1.9" y1="8" x2="14.1" y2="8"/>
    </svg>
  );
}
