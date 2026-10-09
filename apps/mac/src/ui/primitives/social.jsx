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

/* ---------- SocialGlyph: platform marks ----------
   The platforms' own logos, inlined as paths: the bundle is offline, so a
   webfont or an SVG sprite from a CDN is not an option. Same marks as the web
   profile (apps/web/src/components/SocialIcons.tsx), so a person's X or
   GitHub reads the same in both. Email and anything unrecognised fall back to
   drawn line icons. */
const BRAND_MARKS = {
  x: "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z",
  linkedin: "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z",
  github: "M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z",
  telegram: "M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z",
};
const BRAND_ALIASES = { twitter: "x", git: "github" };

function SocialGlyph({ id, size = 13, color = A.fg }) {
  const k = String(id || "").toLowerCase();
  const style = { display:"block", flex:"0 0 auto" };
  const mark = BRAND_MARKS[BRAND_ALIASES[k] || k];
  if (mark) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" style={style} fill={color}>
        <path d={mark}/>
      </svg>
    );
  }
  const p = { width:size, height:size, viewBox:"0 0 16 16", style };
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
