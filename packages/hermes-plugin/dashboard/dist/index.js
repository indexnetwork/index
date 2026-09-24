/**
 * Index Network Hermes dashboard.
 *
 * Intent-centric layout: each intent owns its opportunities ("radar"),
 * in a master-detail view. The selected intent
 * is mirrored into the URL hash so browser Back/Forward navigate between
 * intents. Data loads through the plugin backend, which reuses native Hermes
 * tool handlers so connector authority and protocol visibility rules stay
 * centralized.
 */
(function () {
  "use strict";

  // Desktop seam: the generated desktop plugin (desktop/build.mjs) sets this
  // global before evaluating this file, providing a dashboard-SDK-compatible
  // `sdk` ({ React, fetchJSON, components }), an `assets` map (blob URLs
  // fetched over the plugin REST bridge), and an `onComponent` sink instead of
  // window.__HERMES_PLUGINS__.register. When absent we are in the web
  // dashboard host and behave exactly as before.
  const DESKTOP_ENV = window.__INDEX_NETWORK_DESKTOP_ENV__ || null;
  const SDK = DESKTOP_ENV ? DESKTOP_ENV.sdk : window.__HERMES_PLUGIN_SDK__;
  if (!SDK || !SDK.React || (!DESKTOP_ENV && !window.__HERMES_PLUGINS__)) {
    console.warn("[index-network] Hermes dashboard plugin SDK is unavailable.");
    return;
  }

  const React = SDK.React;
  const components = SDK.components || {};
  const Card = components.Card || "section";
  const CardHeader = components.CardHeader || "div";
  const CardTitle = components.CardTitle || "h2";
  const CardContent = components.CardContent || "div";
  const Badge = components.Badge || "span";
  const Button = components.Button || "button";
  const API = "/api/plugins/index-network";
  // Resolve sibling static assets (e.g. dist/loading-white.webp) relative to this
  // bundle's own URL so the image loads regardless of the host's plugin mount path.
  const ASSET_BASE = (function () {
    const strip = function (url) { return url ? url.replace(/[^/]*$/, "") : ""; };
    try {
      if (document.currentScript && document.currentScript.src) {
        return strip(document.currentScript.src);
      }
    } catch (e) { /* no-op */ }
    try {
      const nodes = document.querySelectorAll('script[src*="index-network"][src*="index.js"], link[href*="index-network"][href*="style.css"]');
      for (let i = 0; i < nodes.length; i++) {
        const url = nodes[i].src || nodes[i].href;
        if (url) return strip(url);
      }
    } catch (e) { /* no-op */ }
    return "";
  })();
  // The animated art is line work on transparency, so one rendering can only
  // read against one kind of surface: every role ships a dark file and a light
  // file, picked by the host theme (see useColorScheme below). Keys are
  // "<role>-<scheme>"; keep this map in step with desktop/tail.js and the
  // allow-list in dashboard/plugin_api.py, which serve the same files.
  const ASSET_FILES = {
    "pitch-dark": "loading-white.webp",
    "pitch-light": "loading-black.webp",
    "radar-dark": "eye-white.webp",
    "radar-light": "eye-black.webp",
    "loading-dark": "loading2-white.webp",
    "loading-light": "loading2.png",
  };
  // In the desktop host, assets arrive async as blob URLs (DESKTOP_ENV.assets)
  // — resolve lazily and let callers skip the <img> while empty.
  function assetSrc(key) {
    if (DESKTOP_ENV) return (DESKTOP_ENV.assets && DESKTOP_ENV.assets[key]) || "";
    return ASSET_BASE + ASSET_FILES[key];
  }
  // Resolved theme for the current render pass. The root component assigns it
  // before React descends into the children that read it, which keeps the
  // asset choice out of every component's props.
  let SCHEME = "dark";
  function PITCH_IMAGE() { return assetSrc("pitch-" + SCHEME); }
  function RADAR_IMAGE() { return assetSrc("radar-" + SCHEME); }
  function LOADING_IMAGE() { return assetSrc("loading-" + SCHEME); }

  // Theme seam for the animated art. The pitch and radar frames ship as white
  // line work on transparent, so they vanish on a light surface: style.css
  // carries a light and a dark treatment and picks between them off the
  // `data-scheme` attribute this resolves onto the dashboard root. Hosts
  // signal the scheme differently — the desktop app stamps data-hermes-mode
  // and .dark on <html>, the web dashboard only swaps palette variables — so
  // try the explicit signals first and fall back to the measured luminance of
  // the surface we actually paint on.
  let COLOR_SWATCH = null;
  function readColor(color) {
    if (!color) return null;
    const plain = /^rgba?\(([^)]+)\)$/i.exec(String(color).trim());
    if (plain) {
      const nums = plain[1].split(/[,\s/]+/).filter(Boolean).map(parseFloat);
      if (nums.length >= 3) return [nums[0], nums[1], nums[2], nums.length > 3 ? nums[3] : 1];
    }
    // Both hosts build surfaces out of color-mix(), which computed styles
    // report back in syntaxes not worth hand-parsing — let a canvas resolve
    // whatever the browser hands us.
    try {
      if (!COLOR_SWATCH) {
        COLOR_SWATCH = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
      }
      if (!COLOR_SWATCH) return null;
      COLOR_SWATCH.clearRect(0, 0, 1, 1);
      COLOR_SWATCH.fillStyle = "rgba(0, 0, 0, 0)";
      COLOR_SWATCH.fillStyle = color;
      COLOR_SWATCH.fillRect(0, 0, 1, 1);
      const px = COLOR_SWATCH.getImageData(0, 0, 1, 1).data;
      return [px[0], px[1], px[2], px[3] / 255];
    } catch (e) {
      return null;
    }
  }

  function backgroundLuminance(color) {
    const rgba = readColor(color);
    if (!rgba || rgba[3] < 0.05) return null; // unpainted — keep walking up
    return (0.2126 * rgba[0] + 0.7152 * rgba[1] + 0.0722 * rgba[2]) / 255;
  }

  // Walk up to the first ancestor that actually paints a background.
  function surfaceScheme(node) {
    let el = node;
    while (el && el.nodeType === 1) {
      const lum = backgroundLuminance(window.getComputedStyle(el).backgroundColor);
      if (lum !== null) return lum < 0.5 ? "dark" : "light";
      el = el.parentElement;
    }
    return null;
  }

  function resolveScheme(node) {
    const root = document.documentElement;
    const mode = root.dataset ? root.dataset.hermesMode : null;
    if (mode === "light" || mode === "dark") return mode;
    const declared = (window.getComputedStyle(root).colorScheme || "").toLowerCase();
    const declaresDark = declared.indexOf("dark") >= 0;
    const declaresLight = declared.indexOf("light") >= 0;
    if (declaresDark !== declaresLight) return declaresDark ? "dark" : "light";
    if (root.classList && root.classList.contains("dark")) return "dark";
    const measured = surfaceScheme(node);
    if (measured) return measured;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  // Re-resolves whenever the host flips its theme (attribute/variable swap on
  // <html>) or the OS scheme changes under a `system` theme setting.
  function useColorScheme(nodeRef) {
    const schemeState = React.useState("dark");
    React.useEffect(function () {
      let alive = true;
      const setScheme = schemeState[1];
      const update = function () {
        if (!alive) return;
        const next = resolveScheme(nodeRef.current);
        setScheme(function (prev) { return prev === next ? prev : next; });
      };
      update();
      let observer = null;
      try {
        observer = new MutationObserver(update);
        observer.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ["class", "style", "data-hermes-mode", "data-theme"],
        });
      } catch (e) { /* no-op */ }
      const media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
      if (media && media.addEventListener) media.addEventListener("change", update);
      else if (media && media.addListener) media.addListener(update);
      return function () {
        alive = false;
        if (observer) observer.disconnect();
        if (media && media.removeEventListener) media.removeEventListener("change", update);
        else if (media && media.removeListener) media.removeListener(update);
      };
    }, []);
    return schemeState[0];
  }
  const REFRESH_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>';
  const ACCOUNT_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
  const MESSAGES_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  // Web frontend's index-network wordmark (same paths as apps/mac and the
  // /cli-auth callback page), recolored to currentColor so it follows the theme.
  const INDEX_WORDMARK_SVG = '<svg viewBox="0 0 522 44" fill="currentColor" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="index network">'
    + '<path d="M184.51 21.66C184.51 18.33 187.42 15.73 191.23 15.73C195.04 15.73 197.95 18.33 197.95 21.66C197.95 24.99 195.1 27.54 191.23 27.54C187.36 27.54 184.51 25 184.51 21.66Z"/>'
    + '<path d="M0 0.72998H7.47V42.61H0V0.72998Z"/>'
    + '<path d="M16.6301 0.72998H25.0701L44.3701 27.26H45.4001V0.72998H52.9301V42.61H44.4301L25.1901 16.08H24.1001V42.61H16.6301V0.72998Z"/>'
    + '<path d="M99.91 21.67C99.91 33.63 90.74 42.61 78.54 42.61H62.03V0.72998H78.54C90.74 0.72998 99.91 9.70995 99.91 21.67ZM92.2 21.67C92.2 14.93 86.25 9.88998 78.3 9.88998H69.5V33.44H78.3C86.25 33.44 92.2 28.4 92.2 21.66V21.67Z"/>'
    + '<path d="M137.61 33.45V42.62H107.08V0.73999H137.31V9.91H114.55V17.13H135.31V25.99H114.55V33.46H137.62L137.61 33.45Z"/>'
    + '<path d="M167.53 21.7899L181.49 42.61H172.75L162.43 27.86H160.97L150.71 42.61H141.3L155.56 21.37L141.84 0.72998H150.58L160.66 15.36H162.06L172.14 0.72998H181.55L167.53 21.7899Z"/>'
    + '<path d="M209.87 0.72998H218.31L237.61 27.26H238.64V0.72998H246.17V42.61H237.67L218.43 16.08H217.34V42.61H209.87V0.72998Z"/>'
    + '<path d="M285.8 33.45V42.62H255.27V0.73999H285.5V9.91H262.74V17.13H283.5V25.99H262.74V33.46H285.81L285.8 33.45Z"/>'
    + '<path d="M324.77 9.88998H311.48V42.61H304.01V9.88998H290.72V0.719971H324.77V9.88998Z"/>'
    + '<path d="M328.96 0.72998H336.91L346.14 28.35H347.41L356.09 0.72998H362.71L371.45 28.35H372.79L381.89 0.72998H390.33L376.92 42.61H368.42L360.59 17.24H358.71L350.88 42.61H342.38L328.97 0.72998H328.96Z"/>'
    + '<path d="M391.54 21.67C391.54 9.34998 401.07 0 413.7 0C426.33 0 435.86 9.34998 435.86 21.67C435.86 33.99 426.33 43.34 413.7 43.34C401.07 43.34 391.54 33.99 391.54 21.67ZM428.14 21.67C428.14 14.63 421.89 9.35004 413.69 9.35004C405.49 9.35004 399.24 14.63 399.24 21.67C399.24 28.71 405.49 33.99 413.69 33.99C421.89 33.99 428.14 28.71 428.14 21.67Z"/>'
    + '<path d="M459.46 29.5H450.42V42.61H442.95V0.72998H462.13C470.57 0.72998 477 6.91996 477 15.12C477 21.31 473.36 26.35 467.9 28.47L477.55 42.61H468.45L459.47 29.5H459.46ZM450.42 20.33H461.95C466.44 20.33 469.23 18.27 469.23 15.11C469.23 11.95 466.44 9.88998 461.95 9.88998H450.42V20.33Z"/>'
    + '<path d="M497.83 25.56L491.4 30.96V42.61H483.93V0.72998H491.4V17.67H492.92L509.07 0.72998H521.03L503.31 20.21L521.46 42.61H512.11L497.85 25.55L497.83 25.56Z"/>'
    + '</svg>';
  /* ---------- Social links: one normalizer for everything ----------
     Ported from apps/mac/api/socials.mjs, which carries the reasoning in full
     and is covered by `bun test api/` there. Kept in sync by hand: this bundle
     is hand-authored with no import step, so it cannot share the module.

     Values arrive in every shape a person or a scraper can produce: a full URL,
     a host with a path, a bare handle, an @handle, and — from enrichment — a
     few of those packed into one field separated by commas. The label is no
     steadier: the API's vocabulary is linkedin|twitter|github|telegram|custom,
     and 'custom' is also where every website lands, so a LinkedIn URL routinely
     arrives labelled 'custom'.

     The rule that keeps a link working: when the value carries a host, the
     value decides where it goes and is never reassembled. Rebuilding from a
     label the value disagrees with is what turned a linkedin.com/in/… value
     into https://eugene-pavlenko-b31a0430/. The label is consulted only for a
     bare handle, which carries no destination of its own. */

  /** Where a bare handle lives, per platform. */
  const SOCIAL_PREFIX = {
    x: "x.com/",
    twitter: "x.com/",
    linkedin: "linkedin.com/in/",
    github: "github.com/",
    telegram: "t.me/",
  };

  /** Labels that name a bucket rather than a platform, so the value decides. */
  const GENERIC_SOCIAL_LABELS = ["", "custom", "website", "web", "link", "site", "url", "other"];

  /** Hosts we can name. Anything else is a website, which is not a lesser kind. */
  const PLATFORM_HOSTS = [
    [/^(mobile\.)?(x\.com|twitter\.com)$/, "x"],
    [/^([a-z0-9-]+\.)?linkedin\.com$/, "linkedin"],
    [/^github\.com$/, "github"],
    [/^(t\.me|telegram\.me|telegram\.dog)$/, "telegram"],
  ];

  const SOCIAL_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

  /** The platforms the editor always offers, in the order it shows them. */
  const EDITABLE_PLATFORMS = ["x", "linkedin", "github", "telegram"];

  /**
   * The first address in a field that may hold several. Enrichment writes
   * discoveries like "tidemid , https://instagram.com/nick/" into one value;
   * used whole it became a single unopenable link. A URL contains none of these
   * separators, so splitting on them cannot damage a well-formed one.
   */
  function firstSocialValue(raw) {
    const text = String(raw == null ? "" : raw).trim();
    if (!text) return "";
    const parts = text.split(/[\s,;|]+/).filter(Boolean);
    // Trailing sentence punctuation rides along when these are scraped from prose.
    return (parts[0] || "").replace(/[),.;:]+$/, "");
  }

  /** Whether a value names a host of its own, rather than being a bare handle. */
  function looksHosted(value) {
    if (SOCIAL_SCHEME.test(value)) return true;
    const head = value.replace(/^\/\//, "").split("/")[0];
    // A dotted label is a domain; "eugenepx" is not, and treating it as one is
    // exactly how https://eugenepx/ got rendered as a link.
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+\.?$/i.test(head);
  }

  /** Split a hosted value into a lowercase bare host and its path. */
  function splitSocialHostPath(value) {
    let text = value.replace(SOCIAL_SCHEME, "").replace(/^\/\//, "");
    text = text.replace(/^www\./i, "");
    const cut = text.search(/[/?#]/);
    const bareHost = (cut === -1 ? text : text.slice(0, cut)).toLowerCase().replace(/\.$/, "");
    const path = (cut === -1 ? "" : text.slice(cut)).replace(/\/+$/, "");
    return { host: bareHost, path: path };
  }

  function platformForHost(host) {
    for (let i = 0; i < PLATFORM_HOSTS.length; i += 1) {
      if (PLATFORM_HOSTS[i][0].test(host)) return PLATFORM_HOSTS[i][1];
    }
    return "";
  }

  /** The platform an entry's own label names, or '' when it names a bucket. */
  function labelPlatform(social) {
    const id = String(social.id || social.label || social.platform || "").toLowerCase().trim();
    if (GENERIC_SOCIAL_LABELS.indexOf(id) >= 0) return "";
    if (id === "twitter" || id === "x") return "x";
    return SOCIAL_PREFIX[id] ? id : "";
  }

  /** The identifying part of a hosted value: no scheme, no host, no /in/. */
  function handleFromPath(platform, host, path) {
    if (platform === "website") return host + path;
    const rest = path.replace(/^\//, "").replace(/^@/, "");
    // LinkedIn keeps people under /in/ and everything else (companies, schools)
    // one segment up, so only /in/ is dropped: what is left still says which.
    return platform === "linkedin" ? rest.replace(/^in\//, "") : rest;
  }

  /**
   * The canonical address for a platform plus an already-bare handle. A handle
   * that kept a slash is a path under the platform's own host rather than a
   * username, so LinkedIn's /in/ is left off for those.
   */
  function platformHref(platform, handle) {
    if (!handle) return "";
    if (platform === "linkedin") {
      return handle.indexOf("/") >= 0 ? "https://linkedin.com/" + handle : "https://linkedin.com/in/" + handle;
    }
    const prefix = SOCIAL_PREFIX[platform];
    return prefix ? "https://" + prefix + handle : "";
  }

  /**
   * Resolve any stored or typed entry to {platform, handle, href}. `href` is ''
   * when there is no openable destination; callers hide those rather than
   * rendering a dead link.
   */
  function parseSocial(social) {
    const entry = social || {};
    const fromLabel = labelPlatform(entry);
    const raw = firstSocialValue(entry.handle == null ? entry.value : entry.handle);
    if (!raw) return { platform: fromLabel || "website", handle: "", href: "" };

    if (looksHosted(raw)) {
      const parts = splitSocialHostPath(raw);
      const platform = platformForHost(parts.host) || fromLabel || "website";
      const handle = handleFromPath(platform, parts.host, parts.path);
      // A platform host with nothing after it is the platform's front page, not
      // anybody's profile.
      if (platform !== "website" && !handle) return { platform: platform, handle: "", href: "" };
      // A named platform is rebuilt onto its canonical host, so twitter.com and
      // the mobile host settle to one address; a website keeps the host it came
      // with, because there it is the identity.
      const href = platform === "website"
        ? "https://" + parts.host + parts.path
        : platformHref(platform, handle);
      return { platform: platform, handle: handle, href: href };
    }

    const bare = raw.replace(/^@+/, "");
    const platform = fromLabel || "website";
    return { platform: platform, handle: bare, href: platformHref(platform, bare) };
  }

  /**
   * The label to store an entry under. The API's set is fixed
   * (linkedin|twitter|github|telegram|custom), so 'x' is stored as 'twitter'.
   * A label outside the set silently loses the link.
   */
  function socialApiLabelOf(social) {
    const entry = social || {};
    const platform = entry.platform || parseSocial(entry).platform;
    if (platform === "x" || platform === "twitter") return "twitter";
    return SOCIAL_PREFIX[platform] ? platform : "custom";
  }

  /**
   * Bucket a stored social list into the editor's fixed fields plus websites.
   * Every field is always present so it can be cleared and filled again.
   */
  function splitProfileSocials(socials) {
    const handles = {};
    for (let i = 0; i < EDITABLE_PLATFORMS.length; i += 1) handles[EDITABLE_PLATFORMS[i]] = "";
    const websites = [];
    const list = Array.isArray(socials) ? socials : [];
    for (let i = 0; i < list.length; i += 1) {
      const parsed = parseSocial(list[i]);
      if (Object.prototype.hasOwnProperty.call(handles, parsed.platform)) {
        // Duplicates happen (enrichment and the person can both supply one);
        // the first that resolves wins rather than stacking up as extras.
        if (!handles[parsed.platform] && parsed.handle) handles[parsed.platform] = parsed.handle;
      } else if (parsed.href) {
        const shown = parsed.href.replace(SOCIAL_SCHEME, "");
        if (websites.indexOf(shown) < 0) websites.push(shown);
      }
    }
    return { handles: handles, websites: websites };
  }

  /** The editor's fields back into the API's {label, value} rows. */
  function buildProfileSocials(handles, websites) {
    const rows = [];
    function add(platform, typed) {
      const parsed = parseSocial({ id: platform, handle: typed });
      if (!parsed.href) return;
      // 'custom' is the one label the per-user uniqueness index exempts, so more
      // than one website can be stored; a second linkedin would be rejected.
      const label = socialApiLabelOf({ platform: parsed.platform });
      let clash = false;
      for (let i = 0; i < rows.length; i += 1) {
        if (rows[i].value === parsed.href || (label !== "custom" && rows[i].label === label)) {
          clash = true;
          break;
        }
      }
      if (!clash) rows.push({ label: label, value: parsed.href });
    }
    for (let i = 0; i < EDITABLE_PLATFORMS.length; i += 1) {
      add(EDITABLE_PLATFORMS[i], (handles || {})[EDITABLE_PLATFORMS[i]] || "");
    }
    const sites = Array.isArray(websites) ? websites : [];
    for (let i = 0; i < sites.length; i += 1) add("website", sites[i]);
    return rows;
  }

  /** Rows for read-only display: resolved, deduplicated, dead links dropped. */
  function displayProfileSocials(socials) {
    const rows = [];
    const list = Array.isArray(socials) ? socials : [];
    for (let i = 0; i < list.length; i += 1) {
      const parsed = parseSocial(list[i]);
      if (!parsed.href) continue;
      let seen = false;
      for (let j = 0; j < rows.length; j += 1) {
        if (rows[j].href === parsed.href) { seen = true; break; }
      }
      if (seen) continue;
      // The prefix already names the platform, so the handle is shown under it
      // rather than repeating the label: "x.com/pm", not "twitter: https://…".
      const prefix = SOCIAL_PREFIX[parsed.platform] || "";
      rows.push({
        href: parsed.href,
        platform: parsed.platform,
        text: prefix ? prefix + parsed.handle : parsed.handle,
      });
    }
    return rows;
  }

  function fetchPluginJSON(path, options) {
    if (SDK.fetchJSON) {
      return SDK.fetchJSON(path, options);
    }
    return window.fetch(path, options).then(function (response) {
      return response.json();
    });
  }

  /**
   * Read the owner's realtime event stream, one parsed frame at a time.
   *
   * The plugin backend relays the upstream stream with its own API key. We
   * consume that relay with SDK.authedFetch (which injects the Hermes dashboard
   * session auth — the `X-Hermes-Session-Token` header in loopback mode,
   * cookies in gated mode) plus a streaming body reader, rather than a raw
   * EventSource: EventSource cannot set the session header and the host does not
   * accept a ?token= query param on plugin routes, so it would fail to
   * authenticate in the default desktop (loopback) mode. Reconnects with
   * exponential backoff (5s * 2^n, capped at 60s, 10 tries).
   *
   * Connects nothing in the desktop host, whose REST bridge buffers whole
   * responses and so cannot stream; those callers live on their own poll.
   *
   * @returns The cleanup function for the caller's effect.
   */
  function subscribeUserEvents(onFrame) {
    if (DESKTOP_ENV) return function () { /* nothing was opened */ };

    let retryTimer = null;
    let retries = 0;
    let stopped = false;
    let reader = null;

    function scheduleRetry() {
      if (stopped) return;
      retries += 1;
      if (retries > 10) return;
      retryTimer = setTimeout(connect, Math.min(5000 * Math.pow(2, retries - 1), 60000));
    }

    function streamFetch() {
      const url = API + "/conversations/stream";
      const opts = { headers: { Accept: "text/event-stream" } };
      if (SDK.authedFetch) return SDK.authedFetch(url, opts);
      return window.fetch(url, Object.assign({ credentials: "include" }, opts));
    }

    function connect() {
      streamFetch()
        .then(function (response) {
          if (!response || !response.ok || !response.body || !response.body.getReader) {
            throw new Error("stream unavailable");
          }
          retries = 0;
          reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          function pump() {
            return reader.read().then(function (result) {
              if (stopped) { try { reader.cancel(); } catch (e) { /* noop */ } return; }
              if (result.done) { scheduleRetry(); return; }
              buffer += decoder.decode(result.value, { stream: true });
              let sep;
              while ((sep = buffer.indexOf("\n\n")) >= 0) {
                const frame = buffer.slice(0, sep);
                buffer = buffer.slice(sep + 2);
                const lines = frame.split("\n");
                for (let i = 0; i < lines.length; i++) {
                  if (lines[i].indexOf("data:") !== 0) continue;
                  let data;
                  try { data = JSON.parse(lines[i].slice(5).trim()); } catch (e) { continue; }
                  if (data) onFrame(data);
                }
              }
              return pump();
            });
          }
          return pump();
        })
        .catch(function () { if (!stopped) scheduleRetry(); });
    }

    connect();
    return function () {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (reader) { try { reader.cancel(); } catch (e) { /* noop */ } }
    };
  }

  function BadgeText(props) {
    const className = "index-dashboard__badge" + (props.className ? " " + props.className : "");
    const badgeProps = { className: className };
    // The host Badge reads `tone` (not `variant`); forward it when given so
    // semantic tags (e.g. a green "Running") match Hermes' own cron badges.
    if (props.tone) badgeProps.tone = props.tone;
    else badgeProps.variant = props.variant || "outline";
    return React.createElement(Badge, badgeProps, props.children);
  }

  // Mirrors Hermes CronPage STATUS_TONE so an intent's "Running" reads like a
  // scheduled cron job (green success tag).
  function statusTone(status) {
    const s = String(status || "").toLowerCase();
    if (["running", "active", "enabled", "scheduled", "accepted", "connected", "live", "matched"].indexOf(s) >= 0) return "success";
    if (["paused", "pending", "negotiating", "stalled"].indexOf(s) >= 0) return "warning";
    if (["error", "failed", "completed", "rejected", "declined"].indexOf(s) >= 0) return "destructive";
    return "outline";
  }

  function formatCount(count) {
    return Number.isFinite(count) ? String(count) : "0";
  }

  function svgIcon(className, children) {
    return React.createElement("svg", {
      xmlns: "http://www.w3.org/2000/svg", width: 24, height: 24, viewBox: "0 0 24 24",
      fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round",
      className: className || "", "aria-hidden": "true",
    }, children);
  }

  function svgPath(d) {
    return React.createElement("path", { key: d, d: d });
  }

  function ICON_SPARKLES() {
    return svgIcon("h-4 w-4", [
      svgPath("M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"),
      svgPath("M20 3v4"),
      svgPath("M22 5h-4"),
      svgPath("M4 17v2"),
      svgPath("M5 18H3"),
    ]);
  }

  function ICON_PAUSE() {
    return svgIcon("", [
      React.createElement("rect", { key: "a", x: 14, y: 3, width: 5, height: 18, rx: 1 }),
      React.createElement("rect", { key: "b", x: 5, y: 3, width: 5, height: 18, rx: 1 }),
    ]);
  }

  function ICON_PLAY() {
    return svgIcon("", [
      React.createElement("polygon", { key: "a", points: "6 3 20 12 6 21 6 3" }),
    ]);
  }

  function ICON_ARROW_LEFT() {
    return svgIcon("", [
      svgPath("m12 19-7-7 7-7"),
      svgPath("M19 12H5"),
    ]);
  }

  function ICON_ARROW_UP() {
    return svgIcon("", [
      svgPath("M12 19V5"),
      svgPath("m5 12 7-7 7 7"),
    ]);
  }

  // The blinking eye, sized to sit inline next to the "Radar" title.
  function RADAR_EYE() {
    const src = RADAR_IMAGE();
    if (!src) return null;
    return React.createElement("img", { className: "index-dashboard__radar-eye", src: src, alt: "", "aria-hidden": "true", loading: "lazy" });
  }

  function ICON_TRASH() {
    return svgIcon("", [
      svgPath("M10 11v6"),
      svgPath("M14 11v6"),
      svgPath("M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"),
      svgPath("M3 6h18"),
      svgPath("M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"),
    ]);
  }

  function HeaderActionButton(props) {
    return React.createElement("button", {
      type: "button",
      title: props.title,
      "aria-label": props.title,
      className: "font-mono group relative flex cursor-pointer items-center gap-1.5 leading-0 font-bold tracking-[0.2em] px-2 py-2 [&>svg]:size-3.5 border border-current/30 bg-transparent hover:bg-midground/10 shadow-none " + (props.tone || "text-current"),
      onClick: props.onClick,
    }, props.children, props.label ? React.createElement("span", { className: "text-[10px] uppercase" }, props.label) : null);
  }

  // Wraps an element in a hover tooltip (styled CSS bubble, not native title,
  // so it renders reliably regardless of how the host Button forwards props).
  function Tip(key, label, child) {
    return React.createElement("span", { key: key, className: "index-dashboard__tip", "data-tip": label }, child);
  }

  // React twin of the DOM controls injected into the web dashboard's banner
  // header — rendered inline when no such header exists (desktop host).
  function SidecarToggle() {
    const [state, setState] = React.useState({ running: false, busy: false, error: "" });
    const refresh = React.useCallback(function () {
      fetchPluginJSON(API + "/sidecar", { method: "GET" }).then(function (payload) {
        if (!payload) return;
        setState(function (current) {
          return Object.assign({}, current, { running: payload.running === true });
        });
      }).catch(function () { /* status is shown again on the next poll */ });
    }, []);
    React.useEffect(function () {
      refresh();
      const timer = window.setInterval(refresh, 5000);
      return function () { window.clearInterval(timer); };
    }, [refresh]);
    function toggle() {
      const path = state.running ? "/sidecar/stop" : "/sidecar/start";
      setState(function (current) { return Object.assign({}, current, { busy: true, error: "" }); });
      fetchPluginJSON(API + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }).then(function (payload) {
        setState({
          running: payload.running === true,
          busy: false,
          error: payload.success === false ? (payload.error || "Could not update the sidecar.") : "",
        });
      }).catch(function (error) {
        setState(function (current) {
          return Object.assign({}, current, {
            busy: false,
            error: (error && error.message) || "Could not update the sidecar.",
          });
        });
      });
    }
    const label = state.busy
      ? (state.running ? "Stopping…" : "Starting…")
      : (state.running ? "Stop" : "Start");
    return React.createElement(React.Fragment, null,
      React.createElement("span", { className: "index-dashboard__hdr-label" }, "SIDECAR"),
      React.createElement("button", {
        type: "button",
        className: "index-dashboard__hdr-sidecar" + (state.running ? " index-dashboard__hdr-sidecar--on" : ""),
        disabled: state.busy,
        title: state.error || (state.running ? "Stop sidecar" : "Start sidecar"),
        "aria-label": state.running ? "Stop sidecar" : "Start sidecar",
        onClick: toggle,
      }, label),
    );
  }

  function InlineHeaderControls(props) {
    return React.createElement("div", { className: "index-dashboard__hdr index-dashboard__hdr--inline" },
      DESKTOP_ENV ? React.createElement(SidecarToggle) : null,
      React.createElement("span", { className: "index-dashboard__hdr-label" }, "AUTO-REFRESH"),
      React.createElement("button", {
        type: "button",
        className: "index-dashboard__switch" + (props.autoRefresh ? " index-dashboard__switch--on" : ""),
        role: "switch",
        "aria-checked": props.autoRefresh ? "true" : "false",
        "aria-label": "Auto-refresh",
        onClick: props.onToggle,
      }, React.createElement("span", { className: "index-dashboard__switch-knob" })),
      props.autoRefresh ? null : React.createElement("button", {
        type: "button",
        className: "index-dashboard__header-refresh",
        "aria-label": "Refresh",
        title: "Refresh",
        disabled: props.loading,
        "data-busy": props.loading ? "true" : undefined,
        onClick: props.onRefresh,
        dangerouslySetInnerHTML: { __html: REFRESH_ICON_SVG },
      }),
      React.createElement("button", {
        type: "button",
        className: "index-dashboard__hdr-account" + (props.hasUnread ? " index-dashboard__hdr-account--dot" : ""),
        "aria-label": "Messages",
        title: "Messages",
        onClick: props.onMessages,
        dangerouslySetInnerHTML: { __html: MESSAGES_ICON_SVG },
      }),
      React.createElement("button", {
        type: "button",
        className: "index-dashboard__hdr-account",
        "aria-label": "Profile & settings",
        title: "Profile & settings",
        onClick: props.onAccount,
        dangerouslySetInnerHTML: { __html: ACCOUNT_ICON_SVG },
      }),
    );
  }

  // Discover lives at `/index-network` (Hermes HashRouter: `#/index-network`).
  // View state is query on that path — never a bare `#intent=` fragment, which
  // misses the plugin route and the host's `*` catch-all sends you to new chat.
  const PAGE_PATH = "/index-network";
  const LAST_PATH_KEY = "index-network.path";

  function pageSearchParams() {
    const hash = window.location.hash || "";
    const mark = hash.indexOf("?");
    const params = new URLSearchParams(window.location.search || "");
    if (mark >= 0) {
      new URLSearchParams(hash.slice(mark)).forEach(function (value, key) {
        if (!params.has(key)) params.set(key, value);
      });
    }
    return params;
  }

  function parseView() {
    const params = pageSearchParams();
    const chat = params.get("chat");
    return {
      intentId: params.get("intent") || null,
      messagesOpen: params.has("chat"),
      messagesTarget: chat || null,
      profileOpen: params.get("profile") === "1",
      viewUserId: params.get("user") || null,
    };
  }

  function parseHash() {
    return { intentId: parseView().intentId };
  }

  function viewPath(view) {
    const params = pageSearchParams();
    if (view.intentId) params.set("intent", view.intentId);
    else params.delete("intent");
    if (view.messagesOpen) params.set("chat", view.messagesTarget || "");
    else params.delete("chat");
    if (view.profileOpen) params.set("profile", "1");
    else params.delete("profile");
    if (view.viewUserId) params.set("user", view.viewUserId);
    else params.delete("user");
    const q = params.toString();
    return q ? PAGE_PATH + "?" + q : PAGE_PATH;
  }

  function currentPageHref() {
    if (DESKTOP_ENV) return ((window.location.hash || "").replace(/^#/, "")).split("#")[0] || "";
    return window.location.pathname + window.location.search;
  }

  function rememberPagePath(path) {
    try {
      if (path && path.split("?")[0] === PAGE_PATH) window.localStorage.setItem(LAST_PATH_KEY, path);
    } catch (e) { /* noop */ }
  }

  function onPagePath() {
    const path = currentPageHref().split("?")[0];
    return path === PAGE_PATH || path.startsWith(PAGE_PATH + "/");
  }

  function writeView(view, force) {
    const target = viewPath(view);
    rememberPagePath(target);
    if (currentPageHref() === target) return;
    if (!force && !onPagePath()) return;
    if (DESKTOP_ENV && DESKTOP_ENV.navigate) {
      DESKTOP_ENV.navigate(target);
      return;
    }
    if (DESKTOP_ENV) {
      const hash = "#" + target;
      if ((window.location.hash || "") !== hash) window.location.hash = hash;
      return;
    }
    if (window.location.pathname + window.location.search !== target) {
      window.history.replaceState(null, "", target);
    }
  }

  /**
   * What an OS notification asked us to focus, as `?o=`, `?chat=` or `?intent=`
   * on the activate URL. The web host carries it in the query; the desktop host
   * routes on the hash, so it arrives inside that instead. Reading both keeps
   * one activate URL working on both.
   */
  function parseFocusTarget() {
    const hash = window.location.hash || "";
    const mark = hash.indexOf("?");
    const params = new URLSearchParams(window.location.search || "");
    if (mark >= 0) {
      new URLSearchParams(hash.slice(mark)).forEach(function (value, key) {
        if (!params.has(key)) params.set(key, value);
      });
    }
    const opportunityId = params.get("o");
    if (opportunityId) return { kind: "opportunity", id: opportunityId };
    const conversationId = params.get("chat");
    if (conversationId) return { kind: "conversation", id: conversationId };
    const intentId = params.get("intent");
    if (intentId) return { kind: "intent", id: intentId };
    return null;
  }

  function writeHash(intentId) {
    const view = parseView();
    view.intentId = intentId || null;
    writeView(view, true);
  }

  function EmptyState(props) {
    return React.createElement("div", { className: "index-dashboard__empty" }, props.children || "Nothing to show yet.");
  }

  function Panel(props) {
    const titleText = props.count !== undefined
      ? props.title + " (" + formatCount(props.count) + ")"
      : props.title;
    const header = React.createElement(CardHeader, { className: "index-dashboard__card-header" },
      React.createElement("div", { className: "index-dashboard__card-title-row" },
        React.createElement("div", null,
          React.createElement("h2", { className: "index-dashboard__card-title" },
            props.icon || null,
            titleText,
            props.titleAfter || null,
          ),
          props.description ? React.createElement("p", { className: "index-dashboard__card-description" }, props.description) : null,
        ),
        props.media
          ? React.createElement("img", { className: "index-dashboard__card-title-media", src: props.media, alt: "", "aria-hidden": "true", loading: "lazy" })
          : null,
        props.action || null,
      ),
    );
    return React.createElement(Card, { className: props.primary ? "index-dashboard__card index-dashboard__card--primary" : "index-dashboard__card" },
      header,
      React.createElement(CardContent, { className: "index-dashboard__card-content" }, props.children),
    );
  }

  function StatPill(props) {
    const className = "index-dashboard__stat"
      + (props.onSelect ? " index-dashboard__stat--selectable" : "")
      + (props.active ? " index-dashboard__stat--active" : "");
    const children = [
      React.createElement("strong", { key: "v" }, formatCount(props.value)),
      React.createElement("span", { key: "l" }, props.label),
    ];
    if (props.onSelect) {
      return React.createElement("button", {
        type: "button",
        className: className,
        "aria-pressed": props.active ? "true" : "false",
        onClick: props.onSelect,
      }, children);
    }
    return React.createElement("div", { className: className }, children);
  }

  // Mirrors plugin_api.py _STATUS_BUCKET: raw status -> display bucket.
  // Rejected is hidden (null bucket), matching the mac app: those are mostly
  // agent-side filtering decisions, and listing them reads as user rejection.
  const STATUS_BUCKET = {
    pending: "pending",
    negotiating: "negotiating",
    stalled: "negotiating",
    accepted: "accepted",
    rejected: null,
    expired: "expired",
  };

  const RADAR_BUCKETS = [
    { key: "pending", label: "Awaiting you" },
    { key: "negotiating", label: "negotiating" },
    { key: "accepted", label: "accepted" },
    { key: "expired", label: "Missed" },
  ];

  function bucketForStatus(status) {
    const key = String(status || "");
    return key in STATUS_BUCKET ? STATUS_BUCKET[key] : "pending";
  }

  function statusCountsFromOpportunities(opportunities) {
    const counts = { pending: 0, negotiating: 0, accepted: 0, expired: 0 };
    (opportunities || []).forEach(function (opp) {
      const bucket = bucketForStatus(opp && opp.status);
      if (bucket && bucket in counts) counts[bucket] += 1;
    });
    return counts;
  }

  function RadarStrip(props) {
    const counts = props.counts || {};
    return React.createElement("div", { className: "index-dashboard__radar-strip" },
      RADAR_BUCKETS.map(function (bucket) {
        const active = props.selected === bucket.key;
        return React.createElement(StatPill, {
          key: bucket.key,
          value: counts[bucket.key] || 0,
          label: bucket.label,
          active: active,
          // Mac-app parity: picking a stage filters to it, picking it again
          // goes back to the whole radar.
          onSelect: props.onSelect ? function () { props.onSelect(active ? "all" : bucket.key); } : null,
        });
      }),
    );
  }

  const OPP_RESOLVED_LABEL = { accepted: "Connected", expired: "Missed" };

  // Faithful re-implementation of boring-avatars' "bauhaus" variant + default
  // palette, so dashboard avatars match the Index web app exactly.
  const BORING_PALETTE = ["#92A1C6", "#146A7C", "#F0AB3D", "#C271B4", "#C20D90"];

  function baHash(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = (hash << 5) - hash + name[i].codePointAt(0);
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  function baDigit(num, ntn) {
    return Math.floor((num / Math.pow(10, ntn)) % 10);
  }

  function baBool(num, ntn) {
    return !(baDigit(num, ntn) % 2);
  }

  function baUnit(num, range, index) {
    const value = num % range;
    if (index && baDigit(num, index) % 2 === 0) return -value;
    return value;
  }

  function baColor(num) {
    return BORING_PALETTE[num % BORING_PALETTE.length];
  }

  function BoringAvatar(props) {
    const SIZE = 80;
    const ELEMENTS = 4;
    const seed = String(props.seed || "default");
    const num = baHash(seed);
    const props_ = [];
    for (let t = 0; t < ELEMENTS; t++) {
      props_.push({
        color: baColor(num + t),
        translateX: baUnit(num * (t + 1), SIZE / 2 - (t + 17), 1),
        translateY: baUnit(num * (t + 1), SIZE / 2 - (t + 17), 2),
        rotate: baUnit(num * (t + 1), 360),
        isSquare: baBool(num, 2),
      });
    }
    const maskId = "ba-mask-" + num;
    return React.createElement("svg", {
      viewBox: "0 0 " + SIZE + " " + SIZE, fill: "none", role: "img",
      xmlns: "http://www.w3.org/2000/svg", width: "100%", height: "100%",
    },
      React.createElement("mask", { id: maskId, maskUnits: "userSpaceOnUse", x: 0, y: 0, width: SIZE, height: SIZE },
        React.createElement("rect", { width: SIZE, height: SIZE, rx: SIZE * 2, fill: "#FFFFFF" }),
      ),
      React.createElement("g", { mask: "url(#" + maskId + ")" },
        React.createElement("rect", { width: SIZE, height: SIZE, fill: props_[0].color }),
        React.createElement("rect", {
          x: (SIZE - 60) / 2, y: (SIZE - 20) / 2, width: SIZE,
          height: props_[1].isSquare ? SIZE : SIZE / 8, fill: props_[1].color,
          transform: "translate(" + props_[1].translateX + " " + props_[1].translateY + ") rotate(" + props_[1].rotate + " " + SIZE / 2 + " " + SIZE / 2 + ")",
        }),
        React.createElement("circle", {
          cx: SIZE / 2, cy: SIZE / 2, fill: props_[2].color, r: SIZE / 5,
          transform: "translate(" + props_[2].translateX + " " + props_[2].translateY + ")",
        }),
        React.createElement("line", {
          x1: 0, y1: SIZE / 2, x2: SIZE, y2: SIZE / 2, strokeWidth: 2, stroke: props_[3].color,
          transform: "translate(" + props_[3].translateX + " " + props_[3].translateY + ") rotate(" + props_[3].rotate + " " + SIZE / 2 + " " + SIZE / 2 + ")",
        }),
      ),
    );
  }

  /**
   * A network's picture layered over its generated avatar, like UserAvatar: a
   * stored image that fails to load (a key can outlive its file) uncovers the
   * fallback underneath instead of leaving a broken tile.
   */
  function NetworkAvatar(props) {
    const children = [React.createElement(BoringAvatar, { key: "fallback", seed: props.seed || "network" })];
    if (props.imageUrl) {
      children.push(React.createElement("img", {
        key: "img",
        className: "index-dashboard__net-avatar-img",
        src: props.imageUrl,
        alt: "",
        loading: "lazy",
        onError: function (e) { if (e && e.currentTarget) e.currentTarget.style.display = "none"; },
      }));
    }
    return React.createElement("span", {
      className: "index-dashboard__net-avatar" + (props.className ? " " + props.className : ""),
      "aria-hidden": "true",
    }, children);
  }

  function UserAvatar(props) {
    const seed = props.id || props.name || "default";
    const size = props.size;
    const className = "index-dashboard__avatar"
      + (props.className ? " " + props.className : "")
      + (props.ghost ? " index-dashboard__net-member-avatar--ghost" : "");
    const style = size ? { width: size, height: size } : undefined;
    const children = [React.createElement(BoringAvatar, { key: "fallback", seed: seed })];
    if (props.avatar) {
      children.push(React.createElement("img", {
        key: "img",
        className: "index-dashboard__avatar-img",
        src: props.avatar,
        alt: "",
        loading: "lazy",
        onError: function (e) { if (e && e.currentTarget) e.currentTarget.style.display = "none"; },
      }));
    }
    return React.createElement("span", {
      className: className,
      style: style,
      "aria-hidden": props.ariaHidden !== false ? "true" : undefined,
    }, children);
  }

  function OpportunityCard(props) {
    const opportunity = props.opportunity;
    const status = opportunity.status || "";
    const resolved = OPP_RESOLVED_LABEL[status];
    const acting = !!props.actingId && props.actingId === opportunity.opportunityId;
    let actionButtons = null;
    if (props.onAccept && bucketForStatus(status) === "pending") {
      actionButtons = [
        React.createElement(Button, {
          key: "accept", type: "button", size: "sm", className: "index-dashboard__btn-md",
          disabled: acting,
          onClick: function () { props.onAccept(opportunity); },
        }, acting ? "Working…" : "accept"),
        React.createElement(Button, {
          key: "pass", type: "button", ghost: true, size: "sm", className: "index-dashboard__btn-md",
          disabled: acting,
          onClick: function () { if (props.onSkip) props.onSkip(opportunity); },
        }, "pass"),
      ];
    } else if (status === "accepted") {
      if (props.onStartChat && opportunity.counterpartUserId) {
        actionButtons = [React.createElement(Button, {
          key: "chat", type: "button", size: "sm", className: "index-dashboard__btn-md",
          disabled: acting,
          onClick: function () { props.onStartChat(opportunity); },
        }, acting ? "Working…" : "open chat",
          acting ? null : React.createElement("span", { className: "index-dashboard__opp-negotiating-chev", "aria-hidden": "true" }, "\u203A"))];
      } else if (opportunity.chatUrl) {
        actionButtons = [React.createElement("a", {
          key: "open", className: "index-dashboard__opp-openchat",
          href: opportunity.chatUrl, target: "_blank", rel: "noopener noreferrer",
        }, "Open chat ↗")];
      }
    }
    const clickable = !!props.onOpenUser && !!opportunity.counterpartUserId;
    const idProps = clickable
      ? {
        className: "index-dashboard__opp-id index-dashboard__opp-id--clickable",
        role: "button",
        tabIndex: 0,
        title: "View " + (opportunity.name || "profile"),
        onClick: function () { props.onOpenUser(opportunity.counterpartUserId); },
        onKeyDown: function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); props.onOpenUser(opportunity.counterpartUserId); } },
      }
      : { className: "index-dashboard__opp-id" };
    return React.createElement("article", { className: "index-dashboard__opp" },
      React.createElement("div", { className: "index-dashboard__opp-head" },
        React.createElement("div", idProps,
          React.createElement(UserAvatar, {
            id: opportunity.counterpartUserId,
            name: opportunity.name,
            avatar: opportunity.avatar,
          }),
          React.createElement("div", { className: "index-dashboard__opp-meta" },
            React.createElement("strong", { className: "index-dashboard__opp-name" }, opportunity.name || "New match"),
            // Mac-app parity: a radar row is a name and what the pairing is for,
            // nothing else. Only the negotiations rows carry a subtitle.
            opportunity.subtitle
              ? React.createElement("span", { className: "index-dashboard__opp-sub" }, opportunity.subtitle)
              : null,
          ),
        ),
        // Mac-app parity: the head's right column shows the action buttons when
        // the card is actionable, otherwise the status label — never both.
        actionButtons
          ? React.createElement("div", { className: "index-dashboard__opp-btns" }, actionButtons)
          // A negotiating row is the only status you can open: the two agents
          // are mid-conversation and it is readable.
          : props.onOpenNegotiation && bucketForStatus(status) === "negotiating"
            ? React.createElement("button", {
              type: "button",
              className: "index-dashboard__opp-negotiating",
              onClick: function () { props.onOpenNegotiation(opportunity); },
            },
              React.createElement("span", { className: "index-dashboard__opp-negotiating-dot", "aria-hidden": "true" }),
              "negotiating",
              React.createElement("span", { className: "index-dashboard__opp-negotiating-chev", "aria-hidden": "true" }, "\u203A"),
            )
            : resolved
              ? React.createElement(BadgeText, { tone: statusTone(status), className: "index-dashboard__opp-status" }, resolved)
              : status ? React.createElement(BadgeText, { tone: statusTone(status), className: "index-dashboard__opp-status" }, String(status).replace(/_/g, " ")) : null,
      ),
      opportunity.mainText ? React.createElement("p", { className: "index-dashboard__opp-text" }, opportunity.mainText) : null,
    );
  }

  function RadarList(props) {
    const items = Array.isArray(props.items) ? props.items : [];
    if (props.error) {
      return React.createElement("div", { className: "index-dashboard__error" }, props.error);
    }
    if (items.length === 0) {
      return React.createElement(EmptyState, null, props.empty || "No matches surfaced yet.");
    }
    return React.createElement("div", { className: "index-dashboard__opps" },
      items.map(function (opportunity, index) {
        return React.createElement(OpportunityCard, {
          key: opportunity.opportunityId || String(index),
          opportunity: opportunity,
          onOpenUser: props.onOpenUser,
          onOpenNegotiation: props.onOpenNegotiation,
          onAccept: props.onAccept,
          onSkip: props.onSkip,
          onStartChat: props.onStartChat,
          actingId: props.actingId,
          webUrl: props.webUrl,
        });
      }),
    );
  }

  function IntentRow(props) {
    const intent = props.intent;
    // The row carries its own signal instead of a status tag: a dot and a meta
    // line that say whether anything is waiting on this intent.
    const matches = intentMatchCount(intent);
    const className = "index-dashboard__intent-row"
      + (matches ? " index-dashboard__intent-row--matched" : "")
      + (props.selected ? " index-dashboard__intent-row--selected" : "");
    return React.createElement("button", { type: "button", className: className, onClick: function () { props.onSelect(intent.id); } },
      React.createElement("span", { className: "index-dashboard__intent-dot", "aria-hidden": "true" }),
      React.createElement("div", { className: "index-dashboard__intent-main" },
        React.createElement("span", { className: "index-dashboard__intent-title" }, intent.title || "Untitled intent"),
        // What is waiting rides the count tag; the meta line only says paused.
        intent.status === "paused"
          ? React.createElement("div", { className: "index-dashboard__intent-meta" },
            React.createElement("span", null, "paused"),
          )
          : null,
      ),
      matches
        ? React.createElement("span", {
          className: "index-dashboard__intent-count",
          "aria-label": matches === 1 ? "1 match waiting" : matches + " matches waiting",
        }, String(matches))
        : null,
      React.createElement("span", { className: "index-dashboard__intent-chevron", "aria-hidden": "true" }, "\u203A"),
    );
  }

  // One consolidated number per row: awaiting opportunities. Every surface
  // (Hermes web/desktop, mac app) shows this same count so they stay consistent.
  function intentMatchCount(intent) {
    return Number.isFinite(intent.pendingCount) ? intent.pendingCount : 0;
  }

  function IntentPitch() {
    return React.createElement("aside", { className: "index-dashboard__pitch" },
      PITCH_IMAGE() ? React.createElement("img", {
        className: "index-dashboard__pitch-media",
        src: PITCH_IMAGE(),
        alt: "",
        "aria-hidden": "true",
        loading: "lazy",
      }) : null,
      React.createElement("div", { className: "index-dashboard__pitch-body" },
        React.createElement("h2", { className: "index-dashboard__pitch-title" },
          "find your others",
        ),
        React.createElement("p", { className: "index-dashboard__pitch-text" },
          "tell index what you're after. agents negotiate quietly in the background, and let you know if there's an alignment.",
        ),
      ),
    );
  }

  function ICON_USERS() {
    return svgIcon("index-dashboard__net-sub-icon", [
      svgPath("M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"),
      React.createElement("circle", { key: "head", cx: 9, cy: 7, r: 4 }),
      svgPath("M22 21v-2a4 4 0 0 0-3-3.87"),
      svgPath("M16 3.13a4 4 0 0 1 0 7.75"),
    ]);
  }

  function ICON_GLOBE() {
    return svgIcon("index-dashboard__net-tab-icon", [
      React.createElement("circle", { key: "c", cx: 12, cy: 12, r: 10 }),
      svgPath("M2 12h20"),
      svgPath("M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"),
    ]);
  }

  function ICON_LOCK() {
    return svgIcon("index-dashboard__net-tab-icon", [
      React.createElement("rect", { key: "a", x: 3, y: 11, width: 18, height: 11, rx: 2, ry: 2 }),
      svgPath("M7 11V7a5 5 0 0 1 10 0v4"),
    ]);
  }

  function resolveShareBase(webUrl, apiUrl) {
    if (webUrl) return String(webUrl).replace(/\/+$/, "");
    // Derive from the API the summary reported — never invent production.
    if (apiUrl) {
      try {
        const u = new URL(apiUrl);
        let host = u.hostname;
        if (host === "localhost" || host === "127.0.0.1") {
          return u.protocol + "//" + host + ":3000";
        }
        if (host.indexOf("protocol.") === 0) host = host.slice("protocol.".length);
        return "https://" + host;
      } catch (e) { /* ignore */ }
    }
    return null;
  }

  function networkShareUrl(network, webUrl, apiUrl) {
    if (!network) return null;
    if (network.role !== "owner") return null;
    const base = resolveShareBase(webUrl, apiUrl);
    if (!base) return null;
    const code = network.invitationLink && network.invitationLink.code;
    if (code) return base + "/l/" + encodeURIComponent(code);
    return null;
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        resolve();
      } catch (e) { reject(e); }
    });
  }

  function ICON_COPY() {
    return svgIcon("index-dashboard__net-invite-icon", [
      React.createElement("rect", { key: "a", x: 9, y: 9, width: 13, height: 13, rx: 2, ry: 2 }),
      svgPath("M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"),
    ]);
  }

  function ICON_CHECK() {
    return svgIcon("index-dashboard__net-invite-icon", [
      React.createElement("polyline", { key: "a", points: "20 6 9 17 4 12" }),
    ]);
  }

  function ICON_REFRESH() {
    return svgIcon("index-dashboard__net-invite-icon", [
      svgPath("M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"),
      svgPath("M21 3v5h-5"),
      svgPath("M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"),
      svgPath("M8 16H3v5"),
    ]);
  }

  // Owner network detail — web overview / settings / access parity (no integrations).
  function NetworkDetailModal(props) {
    const network = props.network || {};
    const isOwner = network.role === "owner";
    const showOwnerTabs = isOwner;
    const meId = props.currentUserId || "";
    const tabState = React.useState("overview");
    const tab = tabState[0];
    const setTab = tabState[1];
    const localState = React.useState(network);
    const local = localState[0];
    const setLocal = localState[1];
    React.useEffect(function () { setLocal(network); }, [network]);
    const copiedState = React.useState(false);
    const copied = copiedState[0];
    const setCopied = copiedState[1];
    const busyState = React.useState(false);
    const busy = busyState[0];
    const setBusy = busyState[1];
    const errState = React.useState(null);
    const err = errState[0];
    const setErr = errState[1];
    const signalsState = React.useState([]);
    const signals = signalsState[0];
    const setSignals = signalsState[1];
    const signalsLoadingState = React.useState(false);
    const signalsLoading = signalsLoadingState[0];
    const setSignalsLoading = signalsLoadingState[1];
    const membersState = React.useState([]);
    const members = membersState[0];
    const setMembers = membersState[1];
    const membersLoadingState = React.useState(false);
    const membersLoading = membersLoadingState[0];
    const setMembersLoading = membersLoadingState[1];
    const queryState = React.useState("");
    const query = queryState[0];
    const setQuery = queryState[1];
    const suggestionsState = React.useState([]);
    const suggestions = suggestionsState[0];
    const setSuggestions = suggestionsState[1];
    const showSugState = React.useState(false);
    const showSug = showSugState[0];
    const setShowSug = showSugState[1];
    const pageState = React.useState(1);
    const page = pageState[0];
    const setPage = pageState[1];
    const titleState = React.useState(network.title || "");
    const title = titleState[0];
    const setTitle = titleState[1];
    const promptState = React.useState(network.detail || "");
    const prompt = promptState[0];
    const setPrompt = promptState[1];
    const imageState = React.useState(network.imageUrl || null);
    const imagePreview = imageState[0];
    const setImagePreview = imageState[1];
    const imageDataState = React.useState(null);
    const imageData = imageDataState[0];
    const setImageData = imageDataState[1];
    const removeImageState = React.useState(false);
    const removeImage = removeImageState[0];
    const setRemoveImage = removeImageState[1];
    const deleteTextState = React.useState("");
    const deleteText = deleteTextState[0];
    const setDeleteText = deleteTextState[1];
    const showDeleteState = React.useState(false);
    const showDelete = showDeleteState[0];
    const setShowDelete = showDeleteState[1];
    const showRegenerateConfirmState = React.useState(false);
    const showRegenerateConfirm = showRegenerateConfirmState[0];
    const setShowRegenerateConfirm = showRegenerateConfirmState[1];
    const PAGE_SIZE = 10;
    const shareUrl = networkShareUrl(local, props.webUrl, props.apiUrl);
    const count = typeof local.memberCount === "number" ? local.memberCount : members.length || null;
    const isPublic = local.joinPolicy === "anyone";
    const label = "Invitation link";
    const settingsDirty = title !== (local.title || "")
      || prompt !== (local.detail || "")
      || !!imageData
      || removeImage;

    React.useEffect(function () {
      setTitle(network.title || "");
      setPrompt(network.detail || "");
      setImagePreview(network.imageUrl || null);
      setImageData(null);
      setRemoveImage(false);
    }, [network.id, network.title, network.detail, network.imageUrl]);

    React.useEffect(function () {
      if (!local.id) return;
      let cancelled = false;
      setSignalsLoading(true);
      fetchPluginJSON(API + "/networks/" + encodeURIComponent(local.id) + "/overview")
        .then(function (payload) {
          if (cancelled) return;
          if (!payload || payload.success === false) throw new Error((payload && payload.error) || "Failed to load signals.");
          setSignals(Array.isArray(payload.intents) ? payload.intents : []);
        })
        .catch(function () { if (!cancelled) setSignals([]); })
        .finally(function () { if (!cancelled) setSignalsLoading(false); });
      return function () { cancelled = true; };
    }, [local.id]);

    React.useEffect(function () {
      if (!showOwnerTabs || !local.id || tab !== "access") return;
      let cancelled = false;
      setMembersLoading(true);
      fetchPluginJSON(API + "/networks/" + encodeURIComponent(local.id) + "/members")
        .then(function (payload) {
          if (cancelled) return;
          if (!payload || payload.success === false) throw new Error((payload && payload.error) || "Failed to load members.");
          setMembers(Array.isArray(payload.members) ? payload.members : []);
        })
        .catch(function () { if (!cancelled) setMembers([]); })
        .finally(function () { if (!cancelled) setMembersLoading(false); });
      return function () { cancelled = true; };
    }, [showOwnerTabs, local.id, tab]);

    React.useEffect(function () {
      if (!query.trim()) { setSuggestions([]); return; }
      const handle = setTimeout(function () {
        fetchPluginJSON(API + "/networks/search-users?q=" + encodeURIComponent(query.trim()) + "&networkId=" + encodeURIComponent(local.id || ""))
          .then(function (payload) {
            const users = (payload && Array.isArray(payload.users)) ? payload.users : [];
            const ids = {};
            members.forEach(function (m) { if (m && m.id) ids[m.id] = true; });
            setSuggestions(users.filter(function (u) { return u && u.id && !ids[u.id]; }));
            setShowSug(true);
          })
          .catch(function () { setSuggestions([]); });
      }, 220);
      return function () { clearTimeout(handle); };
    }, [query, local.id, members]);

    function patchLocal(patch) {
      const merged = Object.assign({}, local, patch);
      setLocal(merged);
      if (props.onUpdated) props.onUpdated(merged);
    }

    function onCopy() {
      if (!shareUrl) return;
      copyText(shareUrl).then(function () {
        setCopied(true);
        setTimeout(function () { setCopied(false); }, 2000);
      }).catch(function () { /* leave idle */ });
    }

    function regenerateLink() {
      if (!local.id || busy) return;
      setBusy(true);
      setErr(null);
      fetchPluginJSON(API + "/networks/" + encodeURIComponent(local.id) + "/regenerate-invitation", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
        .then(function (payload) {
          if (!payload || payload.success === false) {
            throw new Error((payload && payload.error) || "Could not regenerate invitation link.");
          }
          patchLocal({
            invitationLink: payload.invitationLink || local.invitationLink,
          });
          setShowRegenerateConfirm(false);
        })
        .catch(function (e) { setErr(e && e.message ? e.message : String(e)); })
        .finally(function () { setBusy(false); });
    }

    function setJoinPolicy(anyone) {
      if (!local.id || busy) return;
      const next = anyone ? "anyone" : "invite_only";
      if (local.joinPolicy === next) return;
      setBusy(true);
      setErr(null);
      fetchPluginJSON(API + "/networks/" + encodeURIComponent(local.id) + "/permissions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ joinPolicy: next }),
      })
        .then(function (payload) {
          if (!payload || payload.success === false) {
            throw new Error((payload && payload.error) || "Could not update visibility.");
          }
          patchLocal({
            joinPolicy: payload.joinPolicy || next,
            invitationLink: payload.invitationLink || local.invitationLink,
          });
        })
        .catch(function (e) { setErr(e && e.message ? e.message : String(e)); })
        .finally(function () { setBusy(false); });
    }

    function onPickImage(event) {
      const file = event.target && event.target.files && event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function () {
        setImageData(String(reader.result || ""));
        setImagePreview(String(reader.result || ""));
        setRemoveImage(false);
      };
      reader.readAsDataURL(file);
    }

    function saveSettings() {
      if (!local.id || busy || !title.trim()) return;
      setBusy(true);
      setErr(null);
      const finish = function (imageUrl) {
        const body = { title: title.trim(), prompt: prompt.trim() || null };
        if (imageUrl !== undefined) body.imageUrl = imageUrl;
        return fetchPluginJSON(API + "/networks/" + encodeURIComponent(local.id), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }).then(function (payload) {
          if (!payload || payload.success === false) {
            throw new Error((payload && payload.error) || "Could not save settings.");
          }
          const patch = {
            title: payload.title || title.trim(),
            detail: payload.detail != null ? payload.detail : (prompt.trim() || ""),
          };
          if (payload.imageUrl !== undefined) patch.imageUrl = payload.imageUrl;
          else if (removeImage) patch.imageUrl = null;
          patchLocal(patch);
          setImageData(null);
          setRemoveImage(false);
        });
      };
      const upload = imageData
        ? fetchPluginJSON(API + "/network-images", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dataUrl: imageData }),
        }).then(function (payload) {
          if (!payload || payload.success === false) {
            throw new Error((payload && payload.error) || "Image upload failed.");
          }
          return payload.imageUrl;
        })
        : Promise.resolve(removeImage ? null : undefined);
      upload.then(finish)
        .catch(function (e) { setErr(e && e.message ? e.message : String(e)); })
        .finally(function () { setBusy(false); });
    }

    function deleteNetwork() {
      if (!local.id || busy || deleteText !== local.title) return;
      setBusy(true);
      setErr(null);
      fetchPluginJSON(API + "/networks/" + encodeURIComponent(local.id), { method: "DELETE" })
        .then(function (payload) {
          if (!payload || payload.success === false) {
            throw new Error((payload && payload.error) || "Could not delete network.");
          }
          if (props.onDeleted) props.onDeleted(local);
          else if (props.onClose) props.onClose();
        })
        .catch(function (e) { setErr(e && e.message ? e.message : String(e)); setBusy(false); });
    }

    function leaveNetwork() {
      if (!local.id || busy) return;
      setBusy(true);
      setErr(null);
      fetchPluginJSON(API + "/networks/" + encodeURIComponent(local.id) + "/leave", { method: "POST" })
        .then(function (payload) {
          if (!payload || payload.success === false) {
            throw new Error((payload && payload.error) || "Could not leave network.");
          }
          if (props.onLeft) props.onLeft(local);
          else if (props.onClose) props.onClose();
        })
        .catch(function (e) { setErr(e && e.message ? e.message : String(e)); })
        .finally(function () { setBusy(false); });
    }

    function addMember(user) {
      if (!local.id || busy || !user || !user.id) return;
      setBusy(true);
      setErr(null);
      fetchPluginJSON(API + "/networks/" + encodeURIComponent(local.id) + "/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, permissions: ["member"] }),
      })
        .then(function (payload) {
          if (!payload || payload.success === false) {
            throw new Error((payload && payload.error) || "Could not add member.");
          }
          if (payload.member) setMembers(function (prev) { return prev.concat([payload.member]); });
          setQuery("");
          setSuggestions([]);
          setShowSug(false);
        })
        .catch(function (e) { setErr(e && e.message ? e.message : String(e)); })
        .finally(function () { setBusy(false); });
    }

    function inviteEmail(email) {
      if (!local.id || busy) return;
      setBusy(true);
      setErr(null);
      fetchPluginJSON(API + "/networks/" + encodeURIComponent(local.id) + "/members/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email }),
      })
        .then(function (payload) {
          if (!payload || payload.success === false) {
            throw new Error((payload && payload.error) || "Could not invite.");
          }
          return fetchPluginJSON(API + "/networks/" + encodeURIComponent(local.id) + "/members");
        })
        .then(function (payload) {
          setMembers((payload && Array.isArray(payload.members)) ? payload.members : []);
          setQuery("");
          setSuggestions([]);
          setShowSug(false);
        })
        .catch(function (e) { setErr(e && e.message ? e.message : String(e)); })
        .finally(function () { setBusy(false); });
    }

    function removeMember(id) {
      if (!local.id || busy) return;
      setBusy(true);
      setErr(null);
      fetchPluginJSON(API + "/networks/" + encodeURIComponent(local.id) + "/members/" + encodeURIComponent(id), { method: "DELETE" })
        .then(function (payload) {
          if (!payload || payload.success === false) {
            throw new Error((payload && payload.error) || "Could not remove member.");
          }
          setMembers(function (prev) { return prev.filter(function (m) { return m.id !== id; }); });
        })
        .catch(function (e) { setErr(e && e.message ? e.message : String(e)); })
        .finally(function () { setBusy(false); });
    }

    function setMemberRole(id, role) {
      if (!local.id || busy) return;
      setBusy(true);
      setErr(null);
      fetchPluginJSON(API + "/networks/" + encodeURIComponent(local.id) + "/members/" + encodeURIComponent(id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissions: role === "owner" ? ["owner"] : ["member"] }),
      })
        .then(function (payload) {
          if (!payload || payload.success === false) {
            throw new Error((payload && payload.error) || "Could not update role.");
          }
          const updated = payload.member;
          if (updated) {
            setMembers(function (prev) {
              return prev.map(function (m) {
                return m.id === id ? Object.assign({}, m, { permissions: updated.permissions || m.permissions }) : m;
              });
            });
          }
        })
        .catch(function (e) { setErr(e && e.message ? e.message : String(e)); })
        .finally(function () { setBusy(false); });
    }

    function tabButton(id, labelText) {
      return React.createElement("button", {
        type: "button",
        className: "index-dashboard__profile-tab" + (tab === id ? " index-dashboard__profile-tab--active" : ""),
        onClick: function () { setTab(id); },
      }, labelText);
    }

    function memberAvatar(member, size) {
      const sz = size || 28;
      const avatar = member.avatar;
      const looksAbsolute = avatar && /^(https?:|data:)/i.test(String(avatar));
      return React.createElement(UserAvatar, {
        id: member.id,
        name: member.name,
        avatar: looksAbsolute ? avatar : null,
        size: sz,
        ghost: !!member.isGhost,
        className: "index-dashboard__net-member-avatar"
          + (looksAbsolute ? "" : " index-dashboard__net-member-avatar--fallback"),
      });
    }

    const head = React.createElement("div", { className: "index-dashboard__net-detail-head" },
      React.createElement(NetworkAvatar, { className: "index-dashboard__net-avatar--lg", imageUrl: local.imageUrl, seed: local.id || local.title }),
      React.createElement("div", { className: "index-dashboard__net-detail-head-text" },
        React.createElement("h3", { className: "index-dashboard__net-detail-title" }, local.title || "Untitled network"),
        React.createElement("div", { className: "index-dashboard__net-detail-bits" },
          React.createElement("span", { className: "index-dashboard__net-detail-bit" },
            isPublic ? ICON_GLOBE() : ICON_LOCK(),
            isPublic ? "Public" : "Private",
          ),
          React.createElement("span", { className: "index-dashboard__net-detail-bit" },
            ICON_USERS(),
            (count !== null ? formatCount(count) : "0") + (count === 1 ? " member" : " members"),
          ),
          isOwner
            ? React.createElement("span", { className: "index-dashboard__net-detail-owner" }, "Owner")
            : null,
        ),
      ),
      !isOwner
        ? React.createElement("button", {
          type: "button",
          className: "index-dashboard__net-leave-btn",
          disabled: busy,
          onClick: leaveNetwork,
        }, "Leave")
        : null,
    );

    const totalPages = Math.max(1, Math.ceil(members.length / PAGE_SIZE));
    const safePage = Math.min(page, totalPages);
    const pageMembers = members.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
    const noResults = showSug && query.trim() && suggestions.length === 0;

    const accessBody = React.createElement("div", { className: "index-dashboard__net-access-panel" },
      React.createElement("div", null,
          React.createElement("p", { className: "index-dashboard__net-invite-label" }, "Visibility"),
          React.createElement("div", { className: "index-dashboard__net-visibility" },
            React.createElement("button", {
              type: "button",
              disabled: busy,
              className: "index-dashboard__net-visibility-card" + (isPublic ? " index-dashboard__net-visibility-card--on" : ""),
              onClick: function () { setJoinPolicy(true); },
            }, ICON_GLOBE(), React.createElement("span", { className: "index-dashboard__net-access" },
              React.createElement("strong", null, "Public"),
              React.createElement("span", null, "Anyone can join"),
            )),
            React.createElement("button", {
              type: "button",
              disabled: busy,
              className: "index-dashboard__net-visibility-card" + (!isPublic ? " index-dashboard__net-visibility-card--on" : ""),
              onClick: function () { setJoinPolicy(false); },
            }, ICON_LOCK(), React.createElement("span", { className: "index-dashboard__net-access" },
              React.createElement("strong", null, "Private"),
              React.createElement("span", null, "Invite only"),
            )),
          ),
        ),
      (shareUrl
          ? React.createElement("div", { className: "index-dashboard__net-invite" },
            React.createElement("p", { className: "index-dashboard__net-invite-label" }, label),
            React.createElement("div", { className: "index-dashboard__net-invite-row" },
              React.createElement("code", { className: "index-dashboard__net-invite-url" }, shareUrl),
              React.createElement("button", {
                type: "button",
                className: "index-dashboard__net-invite-copy" + (showRegenerateConfirm ? " index-dashboard__net-invite-copy--ok" : ""),
                "aria-label": "Regenerate invitation link",
                title: "Regenerate invitation link",
                disabled: busy,
                onClick: function () { setShowRegenerateConfirm(!showRegenerateConfirm); },
              }, ICON_REFRESH()),
              React.createElement("button", {
                type: "button",
                className: "index-dashboard__net-invite-copy" + (copied ? " index-dashboard__net-invite-copy--ok" : ""),
                "aria-label": copied ? "Copied" : "Copy link",
                title: copied ? "Copied" : "Copy link",
                onClick: onCopy,
              }, copied ? ICON_CHECK() : ICON_COPY()),
            ),
            showRegenerateConfirm
              ? React.createElement("div", { className: "index-dashboard__net-regenerate" },
                React.createElement("p", null, "The current link stops working immediately. Regenerate?"),
                React.createElement("div", { className: "index-dashboard__net-regenerate-actions" },
                  React.createElement("button", {
                    type: "button",
                    disabled: busy,
                    onClick: function () { setShowRegenerateConfirm(false); },
                  }, "Cancel"),
                  React.createElement("button", {
                    type: "button",
                    disabled: busy,
                    onClick: regenerateLink,
                  }, busy ? "Regenerating…" : "Regenerate"),
                ),
              )
              : null,
          )
          : React.createElement("p", { className: "index-dashboard__net-invite-empty" }, "No invitation link yet.")),
      React.createElement("div", { className: "index-dashboard__net-members" },
        React.createElement("p", { className: "index-dashboard__net-invite-label" },
          "Members (", String(members.length), ")"),
        React.createElement("div", { className: "index-dashboard__net-member-search" },
          React.createElement("input", {
            className: "index-dashboard__net-member-input",
            value: query,
            placeholder: "Search by name or add by email…",
            onChange: function (e) { setQuery(e.target.value); setShowSug(true); },
            onFocus: function () { setShowSug(true); },
          }),
          showSug && query.trim() && suggestions.length > 0
            ? React.createElement("div", { className: "index-dashboard__net-member-suggestions" },
              suggestions.map(function (u) {
                return React.createElement("button", {
                  key: u.id,
                  type: "button",
                  className: "index-dashboard__net-member-suggestion",
                  onClick: function () { addMember(u); },
                }, memberAvatar(u, 24), React.createElement("span", null, u.name || u.email || "User"), React.createElement("em", null, "Add"));
              }),
            )
            : null,
          noResults
            ? React.createElement("div", { className: "index-dashboard__net-member-suggestions" },
              query.indexOf("@") >= 0
                ? React.createElement("button", {
                  type: "button",
                  className: "index-dashboard__net-member-suggestion",
                  disabled: busy,
                  onClick: function () { inviteEmail(query.trim()); },
                }, "Invite \"" + query.trim() + "\"")
                : React.createElement("div", { className: "index-dashboard__net-invite-empty" }, "No results found"),
            )
            : null,
        ),
        membersLoading
          ? React.createElement("p", { className: "index-dashboard__net-invite-empty" }, "Loading members…")
          : React.createElement("div", { className: "index-dashboard__net-member-list" },
            pageMembers.map(function (m) {
              const perms = Array.isArray(m.permissions) ? m.permissions : [];
              const owner = perms.indexOf("owner") >= 0;
              const isSelf = meId && m.id === meId;
              return React.createElement("div", { key: m.id, className: "index-dashboard__net-member-row" },
                React.createElement("button", {
                  type: "button",
                  className: "index-dashboard__net-member-main",
                  onClick: function () { if (props.onOpenUser) props.onOpenUser(m.id); },
                },
                  memberAvatar(m),
                  React.createElement("span", { className: "index-dashboard__net-member-name" },
                    m.name || "Unknown",
                    m.isGhost ? React.createElement("em", { className: "index-dashboard__net-member-ghost" }, "ghost") : null,
                  ),
                ),
                React.createElement("span", {
                  className: "index-dashboard__net-member-role" + (owner ? " index-dashboard__net-member-role--owner" : ""),
                }, owner ? "Owner" : (perms.indexOf("member") >= 0 ? "Member" : "Contact")),
                !owner && perms.indexOf("member") >= 0 && !isSelf
                  ? React.createElement("button", {
                    type: "button", title: "Promote to owner", disabled: busy,
                    className: "index-dashboard__net-member-act",
                    onClick: function () { setMemberRole(m.id, "owner"); },
                  }, "↑")
                  : null,
                owner && !isSelf
                  ? React.createElement("button", {
                    type: "button", title: "Demote to member", disabled: busy,
                    className: "index-dashboard__net-member-act",
                    onClick: function () { setMemberRole(m.id, "member"); },
                  }, "↓")
                  : null,
                !owner
                  ? React.createElement("button", {
                    type: "button", title: "Remove member", disabled: busy,
                    className: "index-dashboard__net-member-act index-dashboard__net-member-act--danger",
                    onClick: function () { removeMember(m.id); },
                  }, "×")
                  : null,
              );
            }),
          ),
        totalPages > 1
          ? React.createElement("div", { className: "index-dashboard__net-member-pager" },
            React.createElement("span", null,
              String((safePage - 1) * PAGE_SIZE + 1) + "–" + String(Math.min(safePage * PAGE_SIZE, members.length)) + " of " + String(members.length)),
            React.createElement("span", null,
              React.createElement("button", { type: "button", disabled: safePage <= 1, onClick: function () { setPage(safePage - 1); } }, "prev"),
              React.createElement("button", { type: "button", disabled: safePage >= totalPages, onClick: function () { setPage(safePage + 1); } }, "next"),
            ),
          )
          : null,
      ),
      err ? React.createElement("div", { className: "index-dashboard__error" }, err) : null,
    );

    const settingsBody = React.createElement("div", { className: "index-dashboard__net-settings-panel" },
      React.createElement("div", { className: "index-dashboard__net-settings-photo" },
        React.createElement("label", { className: "index-dashboard__net-settings-photo-btn" },
          (imagePreview && !removeImage)
            ? React.createElement("img", { src: imagePreview, alt: "", className: "index-dashboard__net-settings-photo-img" })
            : React.createElement(BoringAvatar, { seed: local.id || title }),
          React.createElement("input", { type: "file", accept: "image/*", onChange: onPickImage, hidden: true }),
        ),
        imagePreview && !removeImage
          ? React.createElement("button", {
            type: "button",
            className: "index-dashboard__net-settings-remove",
            onClick: function () { setRemoveImage(true); setImageData(null); },
          }, "Remove image")
          : null,
      ),
      React.createElement("label", { className: "index-dashboard__net-settings-field" },
        React.createElement("span", null, "Title"),
        React.createElement("input", {
          value: title,
          onChange: function (e) { setTitle(e.target.value); },
        }),
      ),
      React.createElement("label", { className: "index-dashboard__net-settings-field" },
        React.createElement("span", null, "Prompt"),
        React.createElement("textarea", {
          rows: 4,
          value: prompt,
          onChange: function (e) { setPrompt(e.target.value); },
          placeholder: "What people can share in this network…",
        }),
      ),
      React.createElement("div", { className: "index-dashboard__net-settings-actions" },
        React.createElement("button", {
          type: "button",
          disabled: !settingsDirty || busy,
          onClick: function () {
            setTitle(local.title || "");
            setPrompt(local.detail || "");
            setImagePreview(local.imageUrl || null);
            setImageData(null);
            setRemoveImage(false);
          },
        }, "Cancel"),
        React.createElement("button", {
          type: "button",
          className: "index-dashboard__net-settings-save",
          disabled: !settingsDirty || !title.trim() || busy,
          onClick: saveSettings,
        }, busy ? "Saving…" : "Save"),
      ),
      React.createElement("div", { className: "index-dashboard__net-danger" },
        React.createElement("button", {
          type: "button",
          className: "index-dashboard__net-danger-toggle",
          "aria-expanded": showDelete,
          onClick: function () { setShowDelete(!showDelete); },
        },
          React.createElement("span", {
            className: "index-dashboard__net-danger-chevron",
            "aria-hidden": "true",
          }, showDelete ? "▲" : "▼"),
          "Danger Zone"),
        showDelete
          ? React.createElement("div", { className: "index-dashboard__net-danger-box" },
            React.createElement("p", null, "Delete this network. Type the name to confirm."),
            React.createElement("input", {
              value: deleteText,
              placeholder: local.title || "",
              onChange: function (e) { setDeleteText(e.target.value); },
            }),
            React.createElement("button", {
              type: "button",
              disabled: deleteText !== local.title || busy,
              onClick: deleteNetwork,
            }, "Delete"),
          )
          : null,
      ),
      err ? React.createElement("div", { className: "index-dashboard__error" }, err) : null,
    );

    const overviewBody = React.createElement("div", { className: "index-dashboard__net-overview" },
      React.createElement("div", { className: "index-dashboard__net-overview-head" },
        React.createElement("p", { className: "index-dashboard__net-invite-label" }, "Your Signals"),
        React.createElement("span", { className: "index-dashboard__net-overview-count" },
          signalsLoading ? "…" : (String(signals.length) + (signals.length === 1 ? " signal" : " signals"))),
      ),
      signalsLoading
        ? React.createElement("p", { className: "index-dashboard__net-invite-empty" }, "Loading signals…")
        : (signals.length
          ? React.createElement("div", { className: "index-dashboard__net-signal-list" },
            signals.map(function (sig) {
              const text = (sig.summary && String(sig.summary).trim()) || sig.payload || "Untitled signal";
              return React.createElement("button", {
                key: sig.id,
                type: "button",
                className: "index-dashboard__net-signal-row",
                onClick: function () {
                  if (props.onSelectIntent) props.onSelectIntent(sig.id);
                  if (props.onClose) props.onClose();
                },
              }, React.createElement("span", null, text));
            }),
          )
          : React.createElement("p", { className: "index-dashboard__net-invite-empty" },
            "You haven't shared any signals in this network yet")),
    );

    const body = (showOwnerTabs && tab === "access")
      ? accessBody
      : (showOwnerTabs && tab === "settings")
        ? settingsBody
        : overviewBody;

    return React.createElement("div", { className: "index-dashboard__profile-overlay", onClick: props.onClose },
      React.createElement("div", {
        className: "index-dashboard__profile-panel index-dashboard__net-detail-modal",
        onClick: function (e) { e.stopPropagation(); },
      },
        React.createElement("div", { className: "index-dashboard__profile-header" },
          React.createElement("h2", { className: "index-dashboard__profile-title" }, "Network"),
          React.createElement("button", { type: "button", className: "index-dashboard__profile-close", "aria-label": "Close", onClick: props.onClose }, "×"),
        ),
        React.createElement("div", { className: "index-dashboard__net-detail-body" },
          head,
          showOwnerTabs
            ? React.createElement("div", { className: "index-dashboard__profile-tabs" },
              tabButton("overview", "overview"),
              tabButton("settings", "settings"),
              tabButton("access", "access"),
            )
            : null,
          body,
        ),
      ),
    );
  }

  function NetworkMiniRow(props) {
    const network = props.network;
    const count = typeof network.memberCount === "number" ? network.memberCount : null;
    const isOwner = network.role === "owner";
    return React.createElement("button", {
      type: "button",
      className: "index-dashboard__net-row index-dashboard__net-row--button",
      onClick: props.onOpen ? function () { props.onOpen(network); } : undefined,
    },
      React.createElement(NetworkAvatar, { imageUrl: network.imageUrl, seed: network.id || network.title }),
      React.createElement("span", { className: "index-dashboard__net-meta" },
        React.createElement("span", { className: "index-dashboard__net-title" }, network.title || "Untitled network"),
        React.createElement("span", { className: "index-dashboard__net-sub" },
          ICON_USERS(),
          (count !== null ? formatCount(count) : "0") + (count === 1 ? " member" : " members"),
        ),
      ),
      isOwner
        ? React.createElement(BadgeText, null, "Owner")
        : React.createElement(BadgeText, { tone: "secondary" }, "Member"),
    );
  }

  function NetworkDiscoverRow(props) {
    const network = props.network;
    const count = typeof network.memberCount === "number" ? network.memberCount : null;
    const joining = props.joiningId === network.id;
    return React.createElement("div", { className: "index-dashboard__net-row" },
      React.createElement(NetworkAvatar, { imageUrl: network.imageUrl, seed: network.id || network.title }),
      React.createElement("span", { className: "index-dashboard__net-meta" },
        React.createElement("span", { className: "index-dashboard__net-title" }, network.title || "Untitled network"),
        React.createElement("span", { className: "index-dashboard__net-sub" },
          ICON_USERS(),
          (count !== null ? formatCount(count) : "0") + (count === 1 ? " member" : " members"),
        ),
      ),
      React.createElement(Button, {
        type: "button", outlined: true, size: "sm", className: "index-dashboard__btn-md",
        disabled: joining, onClick: function () { if (props.onJoin) props.onJoin(network.id); },
      }, joining ? "Joining…" : "Join"),
    );
  }

  function NetworkRows(props) {
    const items = Array.isArray(props.items) ? props.items : [];
    if (props.error) {
      return React.createElement("div", { className: "index-dashboard__error" }, props.error);
    }
    if (items.length === 0) {
      return React.createElement(EmptyState, null, props.empty || "Nothing to show yet.");
    }
    return React.createElement("div", { className: "index-dashboard__net-list" },
      items.map(function (network, index) {
        return props.discover
          ? React.createElement(NetworkDiscoverRow, { key: network.id || String(index), network: network, onJoin: props.onJoin, joiningId: props.joiningId })
          : React.createElement(NetworkMiniRow, { key: network.id || String(index), network: network, onOpen: props.onOpen });
      }),
    );
  }

  function ICON_PLUS() {
    return svgIcon("index-dashboard__net-discover-icon", [
      React.createElement("line", { key: "v", x1: 12, y1: 5, x2: 12, y2: 19 }),
      React.createElement("line", { key: "h", x1: 5, y1: 12, x2: 19, y2: 12 }),
    ]);
  }

  // Rough-size brackets for the request form, matching the web modal's options
  // so the same question reads the same on every surface.
  const NETWORK_SIZE_OPTIONS = ["Under 100", "100 – 1K", "1K – 10K", "10K+"];

  // A pending / needs-changes request the caller submitted. Rendered above the
  // joined networks, mirroring the web /networks page.
  function NetworkRequestRow(props) {
    const req = props.request;
    const needsChanges = req.status === "needs_changes";
    return React.createElement("div", { className: "index-dashboard__net-row index-dashboard__net-request-row" },
      React.createElement(NetworkAvatar, { imageUrl: req.imageUrl, seed: req.id || req.title }),
      React.createElement("span", { className: "index-dashboard__net-meta" },
        React.createElement("span", { className: "index-dashboard__net-title" }, req.title || "Untitled network"),
        React.createElement("span", { className: "index-dashboard__net-sub" }, needsChanges ? "Needs changes" : "In review"),
        needsChanges && req.reviewNote
          ? React.createElement("span", { className: "index-dashboard__net-request-review" }, "“" + req.reviewNote + "”")
          : null,
      ),
      React.createElement("span", { className: "index-dashboard__net-request-btns" },
        needsChanges
          ? React.createElement(Button, { type: "button", outlined: true, size: "sm", className: "index-dashboard__btn-md", onClick: function () { if (props.onEdit) props.onEdit(req); } }, "Update")
          : React.createElement(BadgeText, { tone: "secondary" }, "Pending"),
        React.createElement("button", { type: "button", className: "index-dashboard__net-request-dismiss", onClick: function () { if (props.onDismiss) props.onDismiss(req.id); } }, needsChanges ? "Dismiss" : "Withdraw"),
      ),
    );
  }

  // Early-access "request a network" form. Same fields as Mac create-network
  // (picture, name, description, access) plus expected size. Submits to
  // /network-requests. `initial` (needs_changes) switches into resubmit mode.
  function RequestNetworkForm(props) {
    const useState = React.useState;
    const useRef = React.useRef;
    const initial = props.initial || null;
    const nameState = useState(initial ? (initial.title || "") : "");
    const name = nameState[0]; const setName = nameState[1];
    const descState = useState(initial ? (initial.purpose || "") : "");
    const desc = descState[0]; const setDesc = descState[1];
    const photoState = useState(initial && initial.imageUrl ? initial.imageUrl : null);
    const photo = photoState[0]; const setPhoto = photoState[1];
    const photoFileRef = useRef(null);
    const accessState = useState(initial && initial.joinPolicy === "anyone" ? "public" : "private");
    const access = accessState[0]; const setAccess = accessState[1];
    const sizeState = useState(initial ? (initial.expectedSize || "") : "");
    const size = sizeState[0]; const setSize = sizeState[1];
    const sendingState = useState(false);
    const sending = sendingState[0]; const setSending = sendingState[1];
    const errState = useState(null);
    const err = errState[0]; const setErr = errState[1];
    const doneState = useState(null);
    const done = doneState[0]; const setDone = doneState[1];

    const trimmed = (name || "").trim();
    const canSend = trimmed.length > 0 && !sending;
    const isEdit = !!initial;

    function onPhotoFile(e) {
      const file = e.target && e.target.files && e.target.files[0];
      if (!file) return;
      if (!String(file.type || "").startsWith("image/")) {
        setErr("That isn’t an image.");
        return;
      }
      if (file.size > 4 * 1024 * 1024) {
        setErr("That image is over 4mb. Pick a smaller one.");
        return;
      }
      const reader = new FileReader();
      reader.onload = function (ev) {
        setPhoto(ev.target ? ev.target.result : null);
        setErr(null);
      };
      reader.onerror = function () { setErr("Couldn’t read that file."); };
      reader.readAsDataURL(file);
    }

    function submit() {
      if (!canSend) return;
      setSending(true);
      setErr(null);

      const uploadStep = photo && String(photo).indexOf("data:") === 0
        ? fetchPluginJSON(API + "/network-images", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dataUrl: photo }),
          }).then(function (payload) {
            if (!payload || payload.success === false) {
              throw new Error((payload && payload.error) || "Network picture could not be uploaded.");
            }
            return payload.imageUrl || undefined;
          })
        : Promise.resolve(undefined);

      uploadStep
        .then(function (imageUrl) {
          return props.onSubmit({
            name: trimmed,
            purpose: (desc || "").trim() || undefined,
            expectedSize: size || undefined,
            joinPolicy: access === "public" ? "anyone" : "invite_only",
            ...(imageUrl ? { imageUrl: imageUrl } : {}),
          });
        })
        .then(function (req) { setDone(req || { title: trimmed }); })
        .catch(function (e) { setErr(e && e.message ? e.message : String(e)); })
        .finally(function () { setSending(false); });
    }

    if (done) {
      return React.createElement("div", { className: "index-dashboard__profile-section" },
        React.createElement("p", { className: "index-dashboard__net-request-note" },
          React.createElement("strong", null, (done && done.title) || trimmed),
          " is in review. You’ll hear back shortly."),
        React.createElement("div", { className: "index-dashboard__net-request-actions" },
          React.createElement(Button, { type: "button", size: "sm", onClick: props.onClose }, "Close"),
        ),
      );
    }

    function accessCard(id, title, sub) {
      const on = access === id;
      return React.createElement("button", {
        key: id, type: "button",
        className: "index-dashboard__net-size index-dashboard__net-access" + (on ? " index-dashboard__net-size--on" : ""),
        onClick: function () { setAccess(id); },
      },
        React.createElement("strong", null, title),
        React.createElement("span", null, sub),
      );
    }

    return React.createElement("div", { className: "index-dashboard__profile-section" },
      React.createElement("p", { className: "index-dashboard__net-request-intro" },
        "Network creation is still early. Fill this in and it gets reviewed before it goes live."),
      React.createElement("div", { className: "index-dashboard__net-request-identity" },
        React.createElement("label", { className: "index-dashboard__net-request-photo", title: "Change network picture" },
          React.createElement(NetworkAvatar, { className: "index-dashboard__net-request-photo-mark", imageUrl: photo, seed: trimmed || "network" }),
          React.createElement("input", {
            ref: photoFileRef,
            type: "file",
            accept: "image/*",
            className: "index-dashboard__profile-avatar-input",
            onChange: onPhotoFile,
          }),
        ),
        React.createElement("span", { className: "index-dashboard__net-request-photo-hint" }, "Picture optional"),
      ),
      React.createElement(ProfileField, { label: "Name" },
        React.createElement("input", { className: "index-dashboard__profile-input", value: name, placeholder: "Network name", onChange: function (e) { setName(e.target.value); } }),
      ),
      React.createElement(ProfileField, { label: "Description", hint: "Optional" },
        React.createElement("textarea", { className: "index-dashboard__textarea", rows: 3, value: desc, placeholder: "What people can share in this network…", onChange: function (e) { setDesc(e.target.value); } }),
      ),
      React.createElement(ProfileField, { label: "Access" },
        React.createElement("div", { className: "index-dashboard__net-size-grid" },
          accessCard("public", "Public", "Anyone can discover and join"),
          accessCard("private", "Private", "Only people with an invitation link"),
        ),
      ),
      React.createElement(ProfileField, { label: "How many people are you hoping to bring together?" },
        React.createElement("div", { className: "index-dashboard__net-size-grid" },
          NETWORK_SIZE_OPTIONS.map(function (opt) {
            const active = size === opt;
            return React.createElement("button", {
              key: opt, type: "button",
              className: "index-dashboard__net-size" + (active ? " index-dashboard__net-size--on" : ""),
              onClick: function () { setSize(active ? "" : opt); },
            }, opt);
          }),
        ),
      ),
      err ? React.createElement("div", { className: "index-dashboard__error" }, err) : null,
      React.createElement("div", { className: "index-dashboard__net-request-actions" },
        React.createElement(Button, { type: "button", outlined: true, size: "sm", onClick: props.onClose }, "Cancel"),
        React.createElement(Button, { type: "button", size: "sm", disabled: !canSend, onClick: submit }, sending ? "Sending…" : (isEdit ? "Resubmit" : "Request network")),
      ),
    );
  }

  // Create-a-network modal (early-access → submits a reviewed request). Opened
  // from the card's Create button, or prefilled from a needs-changes "Update".
  function NetworkCreateModal(props) {
    const isEdit = !!props.initial;
    return React.createElement("div", { className: "index-dashboard__profile-overlay", onClick: props.onClose },
      React.createElement("div", { className: "index-dashboard__profile-panel index-dashboard__net-modal", onClick: function (e) { e.stopPropagation(); } },
        React.createElement("div", { className: "index-dashboard__profile-header" },
          React.createElement("h2", { className: "index-dashboard__profile-title" }, isEdit ? "Update request" : "Create a network"),
          React.createElement("button", { type: "button", className: "index-dashboard__profile-close", "aria-label": "Close", onClick: props.onClose }, "×"),
        ),
        React.createElement("div", { className: "index-dashboard__net-modal-body" },
          React.createElement(RequestNetworkForm, { initial: props.initial, onSubmit: props.onSubmit, onClose: props.onClose }),
        ),
      ),
    );
  }

  function NewSignalModal(props) {
    return React.createElement("div", { className: "index-dashboard__profile-overlay", onClick: props.onClose },
      React.createElement("div", { className: "index-dashboard__profile-panel index-dashboard__signal-modal", onClick: function (e) { e.stopPropagation(); } },
        React.createElement("div", { className: "index-dashboard__profile-header" },
          React.createElement("h2", { className: "index-dashboard__profile-title" }, "New signal"),
          React.createElement("button", { type: "button", className: "index-dashboard__profile-close", "aria-label": "Close", onClick: props.onClose }, "×"),
        ),
        React.createElement("div", { className: "index-dashboard__signal-modal-body" },
          React.createElement(NewSignal, { onDone: props.onDone }),
        ),
      ),
    );
  }

  // A thread's result bucket, as the mac app's negotiation history reads it.
  function negoResult(thread) {
    if (thread.outcome === "agreed") return "won";
    if (thread.outcome === "declined" || thread.outcome === "closed") return "lost";
    return "open";
  }
  const NEGO_GLYPH = { won: "✓", lost: "✕", open: "●" };
  const NEGO_DETAIL = { won: "opportunity", lost: "no opportunity" };

  function negoFirstName(thread) {
    return ((thread.counterparty && thread.counterparty.name) || "unknown").split(/\s+/)[0].toLowerCase();
  }

  function negoClock(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return "--:--:--";
    const p = function (n) { return String(n).padStart(2, "0"); };
    return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
  }

  /**
   * Negotiation history, the mac app's stream: every turn from every thread
   * merged into one chronological tail -f, with a line where each thread
   * closed (or is still open). Pinned to the bottom unless scrolled up.
   */
  function NegotiationStream(props) {
    const userId = props.userId;
    const threadsState = React.useState(null); // null = loading
    const threads = threadsState[0];
    const setThreads = threadsState[1];
    const logsState = React.useState({}); // opportunityId -> { turnCount, turns }
    const logs = logsState[0];
    const setLogs = logsState[1];
    const awayState = React.useState(false);
    const away = awayState[0];
    const setAway = awayState[1];
    const failedState = React.useState(false);
    const failed = failedState[0];
    const setFailed = failedState[1];
    const logsRef = React.useRef({});
    const inflight = React.useRef({});
    const scrollRef = React.useRef(null);
    const pinned = React.useRef(true);
    logsRef.current = logs;

    React.useEffect(function () {
      if (!userId) return undefined;
      let dead = false;
      function load() {
        fetchPluginJSON(API + "/users/" + encodeURIComponent(userId) + "/negotiations")
          .then(function (payload) {
            if (dead) return;
            if (!payload || payload.success === false) throw new Error("unreadable");
            setFailed(false);
            setThreads(Array.isArray(payload.negotiations) ? payload.negotiations : []);
          })
          // Keep what is shown; only an empty card says the read failed.
          .catch(function () { if (!dead) setFailed(true); });
      }
      load();
      const timer = setInterval(load, 3000); // the mac app's cadence
      return function () { dead = true; clearInterval(timer); };
    }, [userId]);

    // Turns are not on the list. Read each thread once, and again when its
    // turn count moves.
    React.useEffect(function () {
      (threads || []).forEach(function (thread) {
        const id = thread.opportunityId;
        if (!id || !thread.turnCount || inflight.current[id]) return;
        const hit = logsRef.current[id];
        if (hit && hit.turnCount === thread.turnCount) return;
        inflight.current[id] = true;
        const turnCount = thread.turnCount;
        fetchPluginJSON(API + "/opportunities/" + encodeURIComponent(id) + "/negotiation")
          .then(function (payload) {
            const turns = (payload && payload.negotiation && payload.negotiation.turns) || [];
            setLogs(function (prev) {
              const next = Object.assign({}, prev);
              next[id] = { turnCount: turnCount, turns: turns };
              return next;
            });
          })
          .catch(function () { /* retried on the next count change */ })
          .then(function () { delete inflight.current[id]; });
      });
    }, [threads]);

    const all = threads || [];
    const counts = { won: 0, lost: 0, open: 0 };
    all.forEach(function (thread) { counts[negoResult(thread)] += 1; });

    const events = [];
    all.forEach(function (thread) {
      const log = logs[thread.opportunityId];
      ((log && log.turns) || []).forEach(function (turn) {
        events.push({ kind: "turn", t: Date.parse(turn.createdAt) || 0, thread: thread, turn: turn });
      });
      const at = thread.outcome ? (thread.settledAt || thread.updatedAt) : thread.updatedAt;
      events.push({ kind: thread.outcome ? "closed" : "open", t: Date.parse(at) || 0, thread: thread, at: at });
    });
    events.sort(function (a, b) { return a.t - b.t; });

    React.useLayoutEffect(function () {
      if (pinned.current && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [events.length, logs]);

    function onScroll(e) {
      const el = e.currentTarget;
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      pinned.current = atBottom;
      setAway(!atBottom);
    }

    function jumpLive() {
      pinned.current = true;
      setAway(false);
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }

    function line(ev, i) {
      const thread = ev.thread;
      const who = negoFirstName(thread);
      if (ev.kind !== "turn") {
        const result = negoResult(thread);
        const label = ev.kind === "open"
          ? who + " · open ● " + (thread.turnCount || 0) + "t"
          : who + " · closed " + NEGO_GLYPH[result] + " " + NEGO_DETAIL[result];
        return React.createElement("div", { key: ev.kind + thread.id + i, className: "index-dashboard__wire-event index-dashboard__wire-event--" + (ev.kind === "open" ? "open" : result) },
          React.createElement("span", { className: "index-dashboard__wire-clock" }, negoClock(ev.at)),
          React.createElement("span", null, "───"),
          React.createElement("strong", null, label),
          React.createElement("span", { className: "index-dashboard__wire-rule" }));
      }
      const turn = ev.turn;
      const roles = (turn.roles || []).filter(Boolean).join(" / ");
      return React.createElement("div", { key: "t" + thread.id + (turn.id || i), className: "index-dashboard__wire-turn" },
        React.createElement("div", { className: "index-dashboard__wire-turn-head" },
          React.createElement("span", { className: "index-dashboard__wire-clock" }, negoClock(turn.createdAt)),
          React.createElement("span", { className: "index-dashboard__wire-tag" }, who),
          React.createElement("strong", null, turn.mine ? "you.agent" : who + ".agent"),
          React.createElement("span", null, turn.mine ? "→" : "←"),
          React.createElement("span", { className: "index-dashboard__wire-action" + (turn.mine ? " index-dashboard__wire-action--mine" : "") }, turn.action || "unknown"),
          roles ? React.createElement("span", { className: "index-dashboard__wire-roles" }, "roles: " + roles) : null),
        turn.text ? React.createElement("p", { className: "index-dashboard__wire-text" }, "“" + turn.text + "”") : null);
    }

    return React.createElement("section", { className: "index-dashboard__wire-card" },
      React.createElement("div", { className: "index-dashboard__wire-head" },
        React.createElement("h2", { className: "index-dashboard__card-title" }, "Negotiation history"),
        React.createElement("span", { className: "index-dashboard__wire-counts" },
          React.createElement("b", null, all.length), " sessions · ",
          React.createElement("b", null, counts.won), " ✓ · ",
          React.createElement("b", null, counts.lost), " ✕ · ",
          React.createElement("b", null, counts.open), " open")),
      React.createElement("div", { className: "index-dashboard__wire-log-wrap" },
        React.createElement("div", { ref: scrollRef, onScroll: onScroll, className: "index-dashboard__wire-log" },
          React.createElement("div", { className: "index-dashboard__wire-lines" },
            threads === null
              ? React.createElement("p", { className: "index-dashboard__wire-note" }, failed ? "couldn't read the wire, retrying…" : "reading the wire…")
              : events.length === 0
                ? React.createElement("p", { className: "index-dashboard__wire-empty" }, "nothing on the wire yet, your agent logs every negotiation here as it happens.")
                : events.map(line),
            React.createElement("span", { className: "index-dashboard__wire-cursor", "aria-hidden": "true" }, "▌"))),
        away
          ? React.createElement("button", { type: "button", className: "index-dashboard__wire-jump", onClick: jumpLive }, "↓ jump to live")
          : null),
      React.createElement("div", { className: "index-dashboard__wire-foot" },
        React.createElement("span", { className: "index-dashboard__live-dot", "aria-hidden": "true" }),
        React.createElement("span", null, away ? "paused · scrolled into history" : "following"),
        React.createElement("span", null, "·"),
        React.createElement("span", null, counts.open + " open session" + (counts.open === 1 ? "" : "s"))));
  }

  // Networks card: "My networks" / "Discover" tabs on the left, a Create button
  // on the right. Create opens the (reviewed) request form as a modal. Owner
  // rows open a detail modal with Access-tab invite links (web parity).
  function NetworksMini(props) {
    const networks = props.networks || { items: [], count: 0, discover: [] };
    const items = Array.isArray(networks.items) ? networks.items : [];
    const discover = Array.isArray(networks.discover) ? networks.discover : [];
    const requests = Array.isArray(props.requests) ? props.requests : [];
    const tabState = React.useState("mine");
    const tab = tabState[0];
    const setTab = tabState[1];
    const openState = React.useState(null);
    const openNet = openState[0];
    const setOpenNet = openState[1];
    function tabButton(id, label, icon) {
      return React.createElement("button", {
        type: "button",
        className: "index-dashboard__profile-tab index-dashboard__net-tab" + (tab === id ? " index-dashboard__profile-tab--active" : ""),
        onClick: function () { setTab(id); },
      }, icon || null, React.createElement("span", null, label));
    }
    function onUpdated(merged) {
      setOpenNet(merged);
      if (props.onNetworkUpdated) props.onNetworkUpdated(merged);
    }
    function onRemoved(net) {
      setOpenNet(null);
      if (props.onNetworkRemoved) props.onNetworkRemoved(net);
    }
    return React.createElement("section", { className: "index-dashboard__net-card" },
      React.createElement("div", { className: "index-dashboard__net-head" },
        React.createElement("div", { className: "index-dashboard__profile-tabs index-dashboard__net-tabs" },
          tabButton("mine", "My networks (" + formatCount(networks.count || items.length) + ")"),
          tabButton("discover", "Discover", ICON_GLOBE()),
        ),
        React.createElement("div", { className: "index-dashboard__net-head-actions" },
          React.createElement(Button, {
            type: "button", outlined: true, size: "sm",
            className: "index-dashboard__net-create-btn",
            onClick: function () { if (props.onCreate) props.onCreate(); },
          }, ICON_PLUS(), "Create"),
        ),
      ),
      tab === "discover"
        ? React.createElement(NetworkRows, { items: discover, discover: true, error: networks.error, empty: "No public networks to discover right now.", onJoin: props.onJoin, joiningId: props.joiningId })
        : React.createElement("div", null,
          requests.length
            ? React.createElement("div", { className: "index-dashboard__net-list index-dashboard__net-request-list" },
              requests.map(function (req, index) {
                return React.createElement(NetworkRequestRow, { key: req.id || String(index), request: req, onEdit: props.onEditRequest, onDismiss: props.onDismissRequest });
              }),
            )
            : null,
          networks.error
            ? React.createElement("div", { className: "index-dashboard__error" }, networks.error)
            : items.length === 0
              ? React.createElement(EmptyState, null, "You are not joined to any networks yet.")
              : React.createElement("div", { className: "index-dashboard__net-list" },
                items.map(function (network, index) {
                  return React.createElement(NetworkMiniRow, {
                    key: network.id || String(index),
                    network: network,
                    onOpen: setOpenNet,
                  });
                }),
              ),
        ),
      openNet
        ? React.createElement(NetworkDetailModal, {
          network: openNet,
          webUrl: props.webUrl,
          apiUrl: props.apiUrl,
          currentUserId: props.currentUserId,
          onClose: function () { setOpenNet(null); },
          onUpdated: onUpdated,
          onDeleted: onRemoved,
          onLeft: onRemoved,
          onOpenUser: props.onOpenUser,
          onSelectIntent: props.onSelectIntent,
        })
        : null,
    );
  }

  const NEW_SIGNAL_PROMPT = "who are you trying to meet right now?";
  const NEW_SIGNAL_EXAMPLES = [
    "traveling soon, want to meet cool people in ai",
    "building something, want honest feedback on it",
    "just launched, want cool people to try it",
    "new in town, want to find my people",
    "raising soon, want to meet investors who get it",
    "hiring soon, want to meet great people early",
    "have an idea, want someone to build it with",
  ];
  const SIGNAL_MAX = 65536;
  const SIGNAL_CALIBRATING = [
    "compressing your edges into a signal…",
    "reaching out across the network…",
    "filtering people you'd rather not see…",
    "opening the field.",
  ];

  function WorkingDots() {
    return React.createElement("span", { className: "index-dashboard__dots", "aria-label": "Working" },
      React.createElement("span", null), React.createElement("span", null), React.createElement("span", null));
  }

  /**
   * New signal, the mac app's flow: opening → prepare → recovery (once) →
   * create. The summary only returns when a create fails, to edit and retry. `onDone(intentId, description)` fires once the signal exists.
   */
  function NewSignal(props) {
    const stageState = React.useState("opening");
    const stage = stageState[0];
    const setStage = stageState[1];
    const answerState = React.useState("");
    const answer = answerState[0];
    const setAnswer = answerState[1];
    const draftState = React.useState("");
    const draft = draftState[0];
    const setDraft = draftState[1];
    const thinkingState = React.useState(false);
    const thinking = thinkingState[0];
    const setThinking = thinkingState[1];
    const feedbackState = React.useState("");
    const feedback = feedbackState[0];
    const setFeedback = feedbackState[1];
    const fieldsState = React.useState([]);
    const recoveryFields = fieldsState[0];
    const setRecoveryFields = fieldsState[1];
    const descriptionState = React.useState("");
    const description = descriptionState[0];
    const setDescription = descriptionState[1];
    const creatingState = React.useState(false);
    const creating = creatingState[0];
    const setCreating = creatingState[1];
    const payloadRef = React.useRef("");
    const receiptRef = React.useRef("");
    const recoveryUsedRef = React.useRef(false);
    const aliveRef = React.useRef(true);
    React.useEffect(function () { return function () { aliveRef.current = false; }; }, []);

    function post(path, body) {
      return fetchPluginJSON(API + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then(function (payload) {
        if (!payload || payload.success === false) throw new Error((payload && payload.error) || "Request failed.");
        return payload;
      });
    }

    function runPrepare(answers) {
      setThinking(true);
      const body = { payload: payloadRef.current };
      if (answers && answers.length) body.answers = answers;
      post("/intents/prepare", body)
        .then(function (result) {
          if (!aliveRef.current) return;
          payloadRef.current = result.payload;
          setDescription(result.payload);
          // No approval step: a ready draft is created as it stands. After the
          // one recovery form it is created regardless, and the server's own
          // preparation has the last word.
          if (result.status === "ready") {
            receiptRef.current = result.preparationReceipt;
            create(result.payload);
          } else if (!recoveryUsedRef.current) {
            recoveryUsedRef.current = true;
            setFeedback(result.feedback || "");
            setRecoveryFields(Array.isArray(result.recovery) ? result.recovery : []);
            setStage("recovery");
          } else {
            receiptRef.current = "";
            create(result.payload);
          }
        })
        .catch(function () { if (aliveRef.current) setStage("retry"); })
        .then(function () { if (aliveRef.current) setThinking(false); });
    }

    function submitOpening(value) {
      const text = String(value != null ? value : draft).trim();
      if (!text) return;
      setAnswer(text);
      payloadRef.current = text;
      runPrepare();
    }

    function recheck() {
      payloadRef.current = description;
      receiptRef.current = "";
      runPrepare();
    }

    function create(text) {
      if (creating || !text.trim() || text.length > SIGNAL_MAX) return;
      const description = text;
      setCreating(true);
      post("/intents", { description: description, preparationReceipt: receiptRef.current })
        .then(function (created) { if (aliveRef.current) props.onDone(created.intentId, description); })
        .catch(function (err) {
          if (!aliveRef.current) return;
          setCreating(false);
          setStage("summary");
          setFeedback("that didn't go through — " + ((err && err.message) || "try again."));
        });
    }

    // Once the follow-up answers are in, the next thing is the signal itself,
    // so that wait goes straight to the creating card.
    if (creating || (thinking && recoveryUsedRef.current)) {
      return React.createElement(SettingUpScreen, { lines: SIGNAL_CALIBRATING });
    }

    const stepIdx = stage === "opening" ? 1 : 2;
    const agent = { label: "your agent", id: "" };
    let current;
    if (thinking) {
      current = React.createElement(AgentLine, { speaker: agent }, React.createElement(WorkingDots, null));
    } else if (stage === "retry") {
      current = React.createElement(AgentLine, { speaker: agent },
        React.createElement("p", null, "couldn't reach your agent."),
        React.createElement("div", null, React.createElement(Button, { type: "button", onClick: function () { runPrepare(); } }, "try again")));
    } else if (stage === "summary") {
      current = React.createElement(AgentLine, { speaker: agent },
        React.createElement("p", { className: "index-dashboard__signal-new-strong" }, "Here's your signal."),
        React.createElement("div", { className: "index-dashboard__signal-new-summary" },
          React.createElement("textarea", {
            className: "index-dashboard__textarea",
            "aria-label": "Signal description",
            value: description,
            maxLength: SIGNAL_MAX,
            rows: 6,
            onChange: function (e) {
              // An edited draft is no longer the one the receipt admitted.
              if (receiptRef.current && e.target.value !== payloadRef.current) receiptRef.current = "";
              setDescription(e.target.value);
            },
          }),
          feedback ? React.createElement("p", { className: "index-dashboard__signal-new-note" }, feedback) : null,
        ),
        React.createElement("div", null,
          receiptRef.current
            ? React.createElement(Button, { type: "button", disabled: !description.trim(), onClick: function () { create(description); } }, "create this signal")
            : React.createElement(Button, { type: "button", disabled: !description.trim(), onClick: recheck }, "check signal")));
    } else if (stage === "recovery") {
      current = React.createElement(SignalRecovery, { fields: recoveryFields, feedback: feedback, onSubmit: runPrepare });
    } else {
      current = React.createElement(AgentLine, { speaker: agent },
        React.createElement("p", { className: "index-dashboard__signal-new-strong" }, NEW_SIGNAL_PROMPT),
        React.createElement("form", {
          className: "index-dashboard__signal-new-compose",
          onSubmit: function (e) { e.preventDefault(); submitOpening(); },
        },
          React.createElement("textarea", {
            className: "index-dashboard__signal-new-input",
            autoFocus: true,
            value: draft,
            maxLength: SIGNAL_MAX,
            rows: 3,
            placeholder: "type what you're looking for…",
            "aria-label": "What you're looking for",
            onChange: function (e) { setDraft(e.target.value); },
            onKeyDown: function (e) {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitOpening(); }
            },
          }),
          React.createElement("div", { className: "index-dashboard__signal-new-compose-foot" },
            React.createElement(Button, { type: "submit", size: "sm", disabled: !draft.trim() }, "send →"))),
        React.createElement("div", { className: "index-dashboard__agent-q-options" },
          NEW_SIGNAL_EXAMPLES.map(function (example) {
            return React.createElement(Button, { key: example, type: "button", outlined: true, onClick: function () { submitOpening(example); } }, example);
          })));
    }

    const previewLines = [
      "getting a read on what you need…",
      answer ? "you're after: “" + (answer.length > 40 ? answer.slice(0, 39) + "…" : answer) + "”" : null,
      stepIdx >= 2 ? "sharpening the edges…" : null,
    ].filter(Boolean);

    return React.createElement("div", { className: "index-dashboard__signal-new" },
      React.createElement("section", { className: "index-dashboard__signal-new-main" },
        React.createElement("div", { className: "index-dashboard__signal-new-steps" },
          React.createElement("span", null, "step " + stepIdx + " of 2"),
          React.createElement("div", { className: "index-dashboard__signal-new-bars" },
            [0, 1].map(function (i) {
              const state = i < stepIdx - 1 ? "done" : i === stepIdx - 1 ? "current" : "todo";
              return React.createElement("span", { key: i, className: "index-dashboard__signal-new-bar index-dashboard__signal-new-bar--" + state });
            }))),
        React.createElement("div", { className: "index-dashboard__signal-new-thread" },
          answer
            ? React.createElement(React.Fragment, null,
              React.createElement(AgentLine, { speaker: agent }, React.createElement("p", null, NEW_SIGNAL_PROMPT)),
              React.createElement("div", { className: "index-dashboard__agent-mine" },
                React.createElement("div", { className: "index-dashboard__msg-bubble index-dashboard__msg-bubble--mine" }, answer)))
            : null,
          current)),
      React.createElement("aside", { className: "index-dashboard__signal-new-field" },
        React.createElement("p", { className: "index-dashboard__signal-new-field-title" }, "the field, warming"),
        previewLines.map(function (line, i) {
          return React.createElement("p", {
            key: i,
            className: "index-dashboard__signal-new-field-line" + (i === previewLines.length - 1 ? " index-dashboard__signal-new-field-line--last" : ""),
          }, React.createElement("span", { "aria-hidden": "true" }, "·"), line);
        }),
        answer
          ? React.createElement("div", { className: "index-dashboard__signal-new-orbit", "aria-hidden": "true" },
            React.createElement("span", { className: "index-dashboard__signal-new-core" }),
            [36, 56, 78].map(function (r, i) {
              return React.createElement("span", { key: r, className: "index-dashboard__signal-new-ring", style: { width: r * 2, height: r * 2, marginLeft: -r, marginTop: -r, animationDuration: (22 + i * 8) + "s" } });
            }))
          : null));
  }

  /** The one recovery form prepare may ask for: text, single and multi fields. */
  function SignalRecovery(props) {
    const valuesState = React.useState({});
    const values = valuesState[0];
    const setValues = valuesState[1];
    const writingState = React.useState({});
    const writing = writingState[0];
    const setWriting = writingState[1];
    function set(map, setMap, key, value) {
      const next = Object.assign({}, map);
      next[key] = value;
      setMap(next);
    }
    function pick(field, label) {
      const chosen = Array.isArray(values[field.id]) ? values[field.id] : [];
      if (field.kind === "multi") {
        set(values, setValues, field.id, chosen.indexOf(label) >= 0 ? chosen.filter(function (l) { return l !== label; }) : chosen.concat([label]));
      } else {
        // one answer: picking a chip replaces what was typed
        set(values, setValues, field.id, chosen[0] === label ? [] : [label]);
        set(writing, setWriting, field.id, false);
      }
    }
    function submit() {
      const answers = [];
      props.fields.forEach(function (field) {
        const own = String(values[field.id + ":own"] || "").trim();
        const chosen = Array.isArray(values[field.id]) ? values[field.id] : [];
        let text;
        if (field.kind === "text") text = own;
        else if (field.kind === "single") text = (writing[field.id] && own) || chosen[0] || "";
        else text = chosen.concat(writing[field.id] && own ? [own] : []).join(" — ");
        if (text) answers.push({ prompt: field.label, answer: text });
      });
      props.onSubmit(answers);
    }
    return React.createElement(AgentLine, { speaker: { label: "your agent", id: "" } },
      React.createElement("p", { className: "index-dashboard__signal-new-strong" }, props.feedback || "help me understand what you're looking for."),
      props.fields.map(function (field) {
        const chosen = Array.isArray(values[field.id]) ? values[field.id] : [];
        const ownKey = field.id + ":own";
        const own = values[ownKey] || "";
        return React.createElement("div", { key: field.id, className: "index-dashboard__signal-new-field-q" },
          React.createElement("p", { className: "index-dashboard__signal-new-strong" }, field.label),
          field.kind === "text"
            ? React.createElement("textarea", {
              className: "index-dashboard__textarea",
              rows: 2,
              value: own,
              placeholder: field.placeholder || "type your answer…",
              onChange: function (e) { set(values, setValues, ownKey, e.target.value); },
            })
            : React.createElement("div", { className: "index-dashboard__agent-q-options" },
              (Array.isArray(field.options) ? field.options : []).map(function (option) {
                const on = chosen.indexOf(option.label) >= 0 && !(field.kind === "single" && writing[field.id]);
                return React.createElement(Button, {
                  key: option.label, type: "button", outlined: !on, "aria-pressed": on ? "true" : "false",
                  onClick: function () { pick(field, option.label); },
                }, option.label);
              }),
              writing[field.id]
                ? React.createElement("input", {
                  className: "index-dashboard__agent-q-input",
                  autoFocus: true,
                  value: own,
                  placeholder: "write your own",
                  "aria-label": "Write your own answer",
                  onChange: function (e) { set(values, setValues, ownKey, e.target.value); },
                  onBlur: function (e) { if (!e.target.value.trim()) set(writing, setWriting, field.id, false); },
                  onKeyDown: function (e) { if (e.key === "Escape" && !e.target.value.trim()) set(writing, setWriting, field.id, false); },
                })
                : React.createElement("button", {
                  type: "button",
                  className: "index-dashboard__agent-q-write",
                  onClick: function () { set(writing, setWriting, field.id, true); },
                }, "write your own")));
      }),
      React.createElement("div", null, React.createElement(Button, { type: "button", onClick: submit }, "create signal")));
  }

  function IntentList(props) {
    const intents = Array.isArray(props.intents) ? props.intents : [];
    return React.createElement("div", { className: "index-dashboard__intent-list" },
      intents.length === 0
        ? React.createElement(EmptyState, null, "No active intents yet.")
        : intents.map(function (intent) {
          return React.createElement(IntentRow, { key: intent.id, intent: intent, selected: props.selectedId === intent.id, onSelect: props.onSelect });
        }),
    );
  }

  /**
   * The head of the signal pane: what the signal asks for, the controls that
   * hold or end it, and what its agent is doing — the mac app's signal window
   * header (apps/mac/src/ui/mainview/conversation.jsx).
   */
  function SignalHead(props) {
    return React.createElement("div", { className: "index-dashboard__signal-head" },
      React.createElement("div", { className: "index-dashboard__detail-title-row" },
        React.createElement("h2", { className: "index-dashboard__detail-title" }, props.title),
        props.actions ? React.createElement("div", { className: "flex items-center gap-1 shrink-0" }, props.actions) : null,
      ),
      React.createElement("div", { className: "index-dashboard__detail-live" },
        React.createElement("span", { className: "index-dashboard__live" + (props.paused ? " index-dashboard__live--paused" : "") },
          React.createElement("span", { className: "index-dashboard__live-dot" }),
          props.paused ? "paused" : "live",
        ),
        React.createElement("span", { className: "index-dashboard__detail-live-text" }, props.paused ? "agent on hold" : "agent is looking in the background"),
      ),
    );
  }

  /**
   * Whose agent is speaking. One named counterparty puts their name on the
   * turn, several share one line, and anything else is the owner's own agent.
   */
  function agentSpeaker(source) {
    const matches = Array.isArray(source.matches) ? source.matches : [];
    const people = matches
      .map(function (match) { return match && match.counterparty; })
      .filter(function (person) { return person && person.name; });
    if (people.length === 1) {
      return { label: people[0].name + "\u2019s agent", id: people[0].id || "" };
    }
    if (people.length > 1) {
      return {
        label: people.map(function (person) { return person.name; }).join(", ") + "\u2019s agents",
        id: "",
      };
    }
    return { label: source.scope === "match" ? "this match\u2019s agent" : "your agent", id: "" };
  }

  // What the agent writes down as it works, rather than something it is telling
  // the owner. The API marks each one with its own opening word; stalls are
  // dropped and the rest become the discovery trace.
  const AGENT_LOG_PREFIXES = ["Brief: ", "Decision: ", "Progress: ", "Stall: "];

  /** A working note and its kind, or null when the agent is speaking to you. */
  function agentLogEntry(text) {
    for (let i = 0; i < AGENT_LOG_PREFIXES.length; i++) {
      const prefix = AGENT_LOG_PREFIXES[i];
      if (text.indexOf(prefix) === 0) {
        return { kind: prefix.slice(0, -2).toLowerCase(), text: text.slice(prefix.length) };
      }
    }
    return null;
  }

  // ── Discovery trace: the mac app's reading of the agent's working notes.
  // A Progress note opens a run; the briefs and decisions after it are who
  // that run reached, keyed by opportunity.

  /** A Progress note's plan, queries and counts, or null for a plain sentence. */
  function parseDiscoveryProgress(text) {
    if (typeof text !== "string" || !text) return null;
    try {
      const data = JSON.parse(text);
      if (data && Array.isArray(data.queries)) {
        const queries = data.queries.filter(function (query) { return typeof query === "string" && query; });
        const counted = typeof data.discovered === "number";
        if (!queries.length && !counted) return null;
        return {
          plan: typeof data.plan === "string" ? data.plan : "",
          queries: queries,
          discovered: counted ? data.discovered : null,
          reached: counted ? (typeof data.reached === "number" ? data.reached : data.discovered) : null,
        };
      }
    } catch (e) { /* a plain progress sentence */ }
    const match = /^Discovered (\d+) people and reached out to (\d+)\.$/.exec(text);
    if (!match) return null;
    return { plan: "", queries: [], discovered: Number(match[1]), reached: Number(match[2]) };
  }

  function sameDiscovery(left, right) {
    return left.plan === right.plan
      && left.queries.length === right.queries.length
      && left.queries.every(function (query, index) { return query === right.queries[index]; });
  }

  function reachedDecision(decision) {
    return decision === "continue" || decision === "accept";
  }

  function discoverySummary(discovered, reached, items) {
    const pending = !items.length || items.some(function (item) { return !item.decision; });
    const promising = pending ? reached : items.filter(function (item) { return reachedDecision(item.decision); }).length;
    return "Discovered " + discovered + (discovered === 1 ? " person" : " people")
      + " with compatible intentions, and decided to reach out to " + promising
      + " promising " + (promising === 1 ? "one" : "ones");
  }

  // The looking note and the counted note are two rows. Once the count
  // arrives, the earlier one is the same run and drops out.
  function withoutSupersededLooking(entries) {
    const traces = entries.map(function (entry) { return entry.kind === "progress" ? parseDiscoveryProgress(entry.text) : null; });
    return entries.filter(function (entry, index) {
      const trace = traces[index];
      if (!trace || typeof trace.discovered === "number") return true;
      return !traces.some(function (other, otherIndex) {
        return otherIndex > index && other && typeof other.discovered === "number" && sameDiscovery(trace, other);
      });
    });
  }

  /**
   * Fold the agent's working notes into the feed: a Progress note with
   * decisions under it becomes one discovery section, decisions before any
   * run become one decision group, the rest passes through in order.
   */
  function buildDiscoveryFeed(entries) {
    entries = withoutSupersededLooking(entries);
    const runs = new Map();
    const progress = new Map();
    const planNote = new Map();
    let runId = "before-discovery";
    entries.forEach(function (entry, index) {
      if (entry.kind === "progress") {
        runId = entry.id;
        progress.set(runId, entry.text);
      }
      if (entry.kind === "note" && progress.has(runId) && !planNote.has(runId)) planNote.set(runId, index);
      if (entry.kind === "brief" || entry.kind === "decision") {
        const run = runs.get(runId) || { id: runId, at: index, decisions: new Map() };
        const key = entry.opportunityId || entry.counterpart || entry.id;
        const current = run.decisions.get(key) || { id: key, counterpart: entry.counterpart || "match", brief: "", decision: "" };
        current[entry.kind] = entry.text;
        run.decisions.set(key, current);
        runs.set(runId, run);
      }
    });
    if (!runs.size) return entries;

    const insertions = new Map();
    runs.forEach(function (run) {
      if (progress.has(run.id)) return;
      insertions.set(run.at, { kind: "decisions", id: "decisions-" + run.id, items: Array.from(run.decisions.values()) });
    });
    const planIndexes = new Set();
    planNote.forEach(function (index, id) {
      if (!runs.has(id)) return;
      const trace = parseDiscoveryProgress(progress.get(id));
      if (trace && trace.plan) return;
      planIndexes.add(index);
    });
    const feed = [];
    entries.forEach(function (entry, index) {
      if (insertions.has(index)) feed.push(insertions.get(index));
      if (entry.kind === "progress" && runs.has(entry.id)) {
        const trace = parseDiscoveryProgress(entry.text);
        feed.push({
          kind: "discovery",
          id: "discovery-" + entry.id,
          plan: trace ? trace.plan : "",
          queries: trace ? trace.queries : [],
          discovered: trace ? trace.discovered : null,
          reached: trace ? trace.reached : null,
          progress: trace ? "" : entry.text,
          items: Array.from(runs.get(entry.id).decisions.values()),
        });
        return;
      }
      if (planIndexes.has(index)) return;
      if (entry.kind !== "brief" && entry.kind !== "decision") feed.push(entry);
    });
    return feed;
  }

  function discoveryIcon(kind) {
    const shapes = {
      search: [
        React.createElement("circle", { key: "c", cx: 10.5, cy: 10.5, r: 6.5 }),
        React.createElement("line", { key: "l", x1: 15.5, y1: 15.5, x2: 21, y2: 21 }),
      ],
      query: [
        React.createElement("circle", { key: "c", cx: 12, cy: 12, r: 9 }),
        React.createElement("line", { key: "l", x1: 3, y1: 12, x2: 21, y2: 12 }),
      ],
      person: [
        React.createElement("circle", { key: "c", cx: 12, cy: 8, r: 4 }),
        React.createElement("path", { key: "p", d: "M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" }),
      ],
      reached: [React.createElement("path", { key: "p", d: "M3 11l18-8-8 18-2-8z" })],
    };
    return React.createElement("svg", {
      className: "index-dashboard__disc-icon index-dashboard__disc-icon--" + kind,
      viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, "aria-hidden": "true",
    }, shapes[kind]);
  }

  function DiscoveryRow(props) {
    const item = props.item;
    if (reachedDecision(item.decision)) {
      return React.createElement("div", { className: "index-dashboard__disc-row" },
        discoveryIcon("reached"),
        React.createElement("span", null,
          React.createElement("strong", { className: "index-dashboard__disc-name" }, item.counterpart),
          item.brief ? React.createElement("span", { className: "index-dashboard__disc-muted" }, " · " + item.brief) : null));
    }
    return React.createElement("div", { className: "index-dashboard__disc-row index-dashboard__disc-row--dropped" },
      React.createElement("span", { className: "index-dashboard__disc-dash", "aria-hidden": "true" }),
      React.createElement("span", null, item.brief ? item.counterpart + " · " + item.brief : item.counterpart));
  }

  /**
   * One discovery run, as the mac app draws it: the plan, the queries it ran,
   * and who it found, each a disclosure.
   */
  function DiscoveryTrace(props) {
    const items = props.items || [];
    const queries = props.queries || [];
    const queriesState = React.useState(true);
    const queriesOpen = queriesState[0];
    const setQueriesOpen = queriesState[1];
    const peopleState = React.useState(false);
    const peopleOpen = peopleState[0];
    const setPeopleOpen = peopleState[1];
    const shown = items.slice(0, 7);
    const rest = items.slice(7);
    const reaching = rest.filter(function (item) { return reachedDecision(item.decision); }).length;
    const counted = typeof props.discovered === "number";
    const summary = counted ? discoverySummary(props.discovered, props.reached, items) : props.progress;
    return React.createElement(AgentLine, { speaker: { label: "your agent", id: "" } },
      props.plan ? React.createElement("p", { className: "index-dashboard__disc-plan" }, props.plan) : null,
      React.createElement("div", { className: "index-dashboard__disc" },
        queries.length
          ? React.createElement(React.Fragment, null,
            React.createElement("button", {
              type: "button",
              className: "index-dashboard__disc-toggle",
              "aria-expanded": queriesOpen ? "true" : "false",
              onClick: function () { setQueriesOpen(!queriesOpen); },
            }, discoveryIcon("search"), React.createElement("span", null, "Ran " + queries.length + (queries.length === 1 ? " query" : " queries"))),
            queriesOpen
              ? React.createElement("div", { className: "index-dashboard__disc-rail" },
                queries.map(function (query, index) {
                  return React.createElement("div", { key: index, className: "index-dashboard__disc-row" },
                    discoveryIcon("query"),
                    React.createElement("span", null, "Looking for ",
                      React.createElement("span", { className: "index-dashboard__disc-query" }, query)));
                }))
              : null)
          : null,
        counted || props.progress
          ? React.createElement("button", {
            type: "button",
            className: "index-dashboard__disc-toggle",
            "aria-expanded": items.length ? (peopleOpen ? "true" : "false") : undefined,
            onClick: function () { if (items.length) setPeopleOpen(!peopleOpen); },
          }, discoveryIcon("person"), React.createElement("span", null, summary))
          : null,
        counted && peopleOpen && items.length
          ? React.createElement("div", { className: "index-dashboard__disc-rail" },
            shown.map(function (item) { return React.createElement(DiscoveryRow, { key: item.id, item: item }); }),
            rest.length
              ? React.createElement("span", { className: "index-dashboard__disc-more" },
                "+ " + rest.length + " more · " + reaching + " reaching out, " + (rest.length - reaching) + " dropped")
              : null)
          : null));
  }

  /** Decisions made before any discovery run, as one disclosure. */
  function DecisionGroup(props) {
    const items = props.items;
    const continued = items.filter(function (item) { return reachedDecision(item.decision); }).length;
    return React.createElement("details", { className: "index-dashboard__disc-decisions" },
      React.createElement("summary", null,
        "Discovery decisions · " + items.length + " reviewed · " + continued + " reaching out"),
      items.map(function (item) {
        return React.createElement("div", { key: item.id, className: "index-dashboard__disc-decision" },
          React.createElement("div", { className: "index-dashboard__disc-decision-head" },
            React.createElement("strong", null, item.counterpart),
            item.decision ? React.createElement("span", null, item.decision) : null),
          item.brief ? React.createElement(Markdown, { text: item.brief }) : null);
      }));
  }

  /** A Progress note with no run under it: a trace if it parses, else a status line. */
  function ProgressLine(props) {
    const trace = parseDiscoveryProgress(props.text);
    if (trace) {
      return React.createElement(DiscoveryTrace, { plan: trace.plan, queries: trace.queries, discovered: trace.discovered, reached: trace.reached, items: [] });
    }
    return React.createElement("div", { className: "index-dashboard__disc-status", role: "status" },
      React.createElement("span", { className: "index-dashboard__disc-status-dot", "aria-hidden": "true" }),
      React.createElement("span", null, props.text));
  }

  /**
   * One agent turn: who spoke, then what they said. Questions and plain notes
   * share it, so a question reads as the same conversation rather than a card
   * dropped into it.
   */
  function AgentLine(props) {
    const speaker = props.speaker;
    const openUser = props.onOpenUser && speaker.id
      ? function () { props.onOpenUser(speaker.id); }
      : null;
    return React.createElement("div", { className: "index-dashboard__agent-line" },
      React.createElement("div", { className: "index-dashboard__agent-line-body" },
        React.createElement("div", { className: "index-dashboard__agent-line-head" },
          props.tag
            ? React.createElement("span", { className: "index-dashboard__agent-tag" }, props.tag)
            : null,
          openUser
            ? React.createElement("button", {
              type: "button",
              className: "index-dashboard__agent-who index-dashboard__agent-who--link",
              onClick: openUser,
            }, speaker.label)
            : React.createElement("span", { className: "index-dashboard__agent-who" }, speaker.label),
        ),
        props.children,
      ),
    );
  }

  const MARKDOWN_INLINE = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*\n]+)\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

  /** Bold, italic, inline code, and http(s) links inside one block of text. */
  function markdownInline(text, key) {
    const nodes = [];
    let last = 0;
    let match;
    MARKDOWN_INLINE.lastIndex = 0;
    while ((match = MARKDOWN_INLINE.exec(text))) {
      if (match.index > last) nodes.push(text.slice(last, match.index));
      const nodeKey = key + ":" + match.index;
      if (match[1] != null) nodes.push(React.createElement("code", { key: nodeKey }, match[1]));
      else if (match[2] != null) nodes.push(React.createElement("strong", { key: nodeKey }, match[2]));
      else if (match[3] != null) nodes.push(React.createElement("em", { key: nodeKey }, match[3]));
      else if (/^https?:\/\/\S+$/i.test(match[5])) {
        nodes.push(React.createElement("a", {
          key: nodeKey, href: match[5], target: "_blank", rel: "noopener noreferrer",
        }, match[4]));
      } else {
        nodes.push(match[0]);
      }
      last = match.index + match[0].length;
    }
    if (last < text.length) nodes.push(text.slice(last));
    return nodes;
  }

  /**
   * The markdown a transcript actually carries, as React elements.
   *
   * Built from elements rather than an HTML string, so nothing the agent or the
   * owner writes can become markup. Paragraphs, bullet and numbered lists,
   * headings, fenced and inline code, bold, italic, and http(s) links; anything
   * else stays literal text. The bubble's `white-space: pre-wrap` keeps the
   * line breaks inside a paragraph.
   */
  function Markdown(props) {
    const lines = String(props.text || "").split("\n");
    const blocks = [];
    let paragraph = [];
    let items = null;
    let ordered = false;
    let code = null;

    function flushParagraph() {
      if (!paragraph.length) return;
      const key = "b" + blocks.length;
      blocks.push(React.createElement("p", { key: key }, markdownInline(paragraph.join("\n"), key)));
      paragraph = [];
    }

    function flushList() {
      if (!items) return;
      const key = "b" + blocks.length;
      blocks.push(React.createElement(ordered ? "ol" : "ul", { key: key }, items.map(function (item, i) {
        return React.createElement("li", { key: key + ":" + i }, markdownInline(item, key + ":" + i));
      })));
      items = null;
    }

    function flushCode() {
      if (!code) return;
      blocks.push(React.createElement("pre", { key: "b" + blocks.length },
        React.createElement("code", null, code.join("\n"))));
      code = null;
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*```/.test(line)) {
        if (code) { flushCode(); } else { flushParagraph(); flushList(); code = []; }
        continue;
      }
      if (code) { code.push(line); continue; }
      if (!line.trim()) { flushParagraph(); flushList(); continue; }

      const heading = line.match(/^ {0,3}#{1,6}\s+(.*)$/);
      if (heading) {
        flushParagraph();
        flushList();
        const key = "b" + blocks.length;
        blocks.push(React.createElement("h4", { key: key }, markdownInline(heading[1], key)));
        continue;
      }

      const item = line.match(/^\s*[-*]\s+(.*)$/) || line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (item) {
        flushParagraph();
        const isOrdered = !/^\s*[-*]\s/.test(line);
        if (items && ordered !== isOrdered) flushList();
        if (!items) { items = []; ordered = isOrdered; }
        items.push(item[1]);
        continue;
      }

      flushList();
      paragraph.push(line);
    }
    flushParagraph();
    flushList();
    flushCode();

    return React.createElement("div", { className: "index-dashboard__md" }, blocks);
  }

  /**
   * What the two agents said to each other about one match.
   *
   * The radar row says they are negotiating; this is the negotiation. Read
   * only — turns are the agents' to take, not the owner's.
   */
  function NegotiationModal(props) {
    const dataState = React.useState(null);
    const data = dataState[0];
    const setData = dataState[1];
    const errState = React.useState(null);
    const err = errState[0];
    const setErr = errState[1];
    const opportunityId = props.opportunity.opportunityId;

    React.useEffect(function () {
      let alive = true;
      setData(null);
      setErr(null);
      fetchPluginJSON(API + "/opportunities/" + encodeURIComponent(opportunityId) + "/negotiation")
        .then(function (payload) {
          if (!alive) return;
          if (!payload || payload.success === false) {
            setErr((payload && payload.error) || "Could not read this negotiation.");
            return;
          }
          setData(payload.negotiation || { turns: [] });
        })
        .catch(function () { if (alive) setErr("Could not read this negotiation."); });
      return function () { alive = false; };
    }, [opportunityId]);

    const turns = (data && Array.isArray(data.turns)) ? data.turns : [];
    return React.createElement("div", { className: "index-dashboard__profile-overlay", onClick: props.onClose },
      React.createElement("div", {
        className: "index-dashboard__profile-panel index-dashboard__a2a-modal",
        onClick: function (e) { e.stopPropagation(); },
      },
        React.createElement("div", { className: "index-dashboard__profile-header" },
          React.createElement("h2", { className: "index-dashboard__profile-title" },
            "your agent \u2194 " + ((data && data.name) || props.opportunity.name || "match") + "\u2019s agent"),
          React.createElement("button", {
            type: "button",
            className: "index-dashboard__profile-close",
            "aria-label": "Close",
            onClick: props.onClose,
          }, "\u00d7"),
        ),
        React.createElement("div", { className: "index-dashboard__a2a-body" },
          err
            ? React.createElement("div", { className: "index-dashboard__error" }, err)
            : !data
              ? React.createElement(EmptyState, null, "Reading the negotiation\u2026")
              : turns.length
                ? turns.map(function (turn) {
                  return React.createElement("div", {
                    key: turn.id,
                    className: "index-dashboard__a2a-turn" + (turn.mine ? " index-dashboard__a2a-turn--mine" : ""),
                  },
                    React.createElement("div", { className: "index-dashboard__a2a-who" },
                      React.createElement("span", { className: "index-dashboard__a2a-name" }, turn.name),
                      React.createElement("span", {
                        className: "index-dashboard__a2a-action index-dashboard__a2a-action--" + (turn.action || "turn"),
                      }, turn.action),
                      React.createElement("span", { className: "index-dashboard__a2a-time" },
                        timeStamp(turn.createdAt, true)),
                    ),
                    React.createElement("p", { className: "index-dashboard__a2a-text" }, turn.text),
                  );
                })
                : React.createElement(EmptyState, null, "No turns yet \u2014 the agents have not spoken."),
        ),
      ),
    );
  }

  /**
   * This intent's H2A conversation with the owner's personal agent.
   *
   * Lives in the signal pane, next to the radar. Transcript, questions still
   * waiting, and a composer for messaging the negotiator. Answers picked across
   * several questions are sent as one write.
   */
  function AgentChat(props) {
    const useState = React.useState;
    const useEffect = React.useEffect;
    const useRef = React.useRef;

    const messagesState = useState([]);
    const messages = messagesState[0];
    const setMessages = messagesState[1];
    const agentState = useState(null);
    const agent = agentState[0];
    const setAgent = agentState[1];
    const draftState = useState("");
    const draft = draftState[0];
    const setDraft = draftState[1];
    const selectionsState = useState({});
    const selections = selectionsState[0];
    const setSelections = selectionsState[1];
    const writingState = useState({});
    const writing = writingState[0];
    const setWriting = writingState[1];
    const sendingState = useState(false);
    const sending = sendingState[0];
    const setSending = sendingState[1];
    const rootRef = useRef(null);
    const threadRef = useRef(null);
    const aliveRef = useRef(true);
    const intentId = props.intentId;

    function read() {
      return fetchPluginJSON(API + "/agent/conversation?intentId=" + encodeURIComponent(intentId))
        .then(function (payload) {
          if (!aliveRef.current || !payload || payload.success === false) return;
          setMessages(payload.messages || []);
          setAgent(payload.agent || null);
        })
        .catch(function () { /* Keep the last good transcript; the next read is 5s away. */ });
    }

    useEffect(function () {
      aliveRef.current = true;
      read();
      const timer = setInterval(read, 5000);
      return function () { aliveRef.current = false; clearInterval(timer); };
    }, [intentId]);

    // The same stream the messages panel reads already carries this signal's
    // H2A: an agent message arrives as `message` tagged with the intent, a new
    // question as `question.pending`. The poll above stays as the backstop for
    // frames missed while disconnected, and is the only path in the desktop
    // host, whose REST bridge cannot stream.
    useEffect(function () {
      return subscribeUserEvents(function (data) {
        const forIntent = data.type === "message"
          ? (data.message && data.message.metadata && data.message.metadata.intentId)
          : data.type === "question.pending" && data.data && data.data.intentId;
        if (forIntent === intentId) read();
      });
    }, [intentId]);

    const questions = (agent && Array.isArray(agent.questions)) ? agent.questions : [];
    // Keyed by id so the transcript can render each pending question where it
    // was asked rather than dropping the message and stacking the cards last.
    const carded = {};
    for (let i = 0; i < questions.length; i++) carded[questions[i].id] = questions[i];
    const chosen = questions.filter(function (question) {
      const answer = selections[question.id];
      return typeof answer === "string" && answer.trim();
    });

    useEffect(function () {
      const node = threadRef.current;
      if (node) node.scrollTop = node.scrollHeight;
    }, [messages.length, questions.length]);

    useEffect(function () {
      if (!props.focusQuestion || !rootRef.current) return;
      rootRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }, [props.focusQuestion, questions.length]);

    function send() {
      const text = draft.trim();
      if (!text || sending) return;
      setDraft("");
      setSending(true);
      fetchPluginJSON(API + "/agent/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intentId: intentId, text: text }),
      })
        .catch(function () { /* Nothing to say: the read below is the transcript's only truth. */ })
        .then(read)
        .then(function () { if (aliveRef.current) setSending(false); });
    }

    function sendAnswers() {
      if (!chosen.length || sending) return;
      const answers = chosen.map(function (question) {
        return { questionId: question.id, text: selections[question.id].trim() };
      });
      setSelections({});
      setWriting({});
      setSending(true);
      fetchPluginJSON(API + "/agent/answers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intentId: intentId, answers: answers }),
      })
        .catch(function () { /* Nothing to say: the read below is the transcript's only truth. */ })
        .then(read)
        .then(function () { if (aliveRef.current) setSending(false); });
    }

    function choose(questionId, text) {
      setSelections(function (current) {
        const next = Object.assign({}, current);
        next[questionId] = current[questionId] === text ? "" : text;
        return next;
      });
      setWriting(function (current) {
        const next = Object.assign({}, current);
        next[questionId] = false;
        return next;
      });
    }

    // A question is a turn like any other, rendered where the agent asked it,
    // so anything you said afterwards still reads as the reply it was.
    function questionCard(question) {
      const options = Array.isArray(question.options) ? question.options : [];
      const answer = selections[question.id] || "";
      const own = options.indexOf(answer) < 0 && answer;
      const write = writing[question.id] || !options.length;
      function stopWriting() {
        setWriting(function (current) {
          const next = Object.assign({}, current);
          next[question.id] = false;
          return next;
        });
      }
      return React.createElement(AgentLine, {
        key: question.id,
        tag: "question",
        speaker: agentSpeaker(question),
        onOpenUser: props.onOpenUser,
      },
        React.createElement("p", { className: "index-dashboard__agent-q-text" }, question.question),
        options.length
          ? React.createElement("div", { className: "index-dashboard__agent-q-options" },
            options.map(function (option) {
              return React.createElement(Button, {
                key: option,
                type: "button",
                outlined: answer !== option,
                disabled: sending,
                "aria-pressed": answer === option ? "true" : "false",
                onClick: function () { choose(question.id, option); },
              }, option);
            }),
          )
          : null,
        // Writing your own is its own line under the options, and the field
        // takes the chip's place there, wearing the same box.
        React.createElement("div", { className: "index-dashboard__agent-q-write-row" },
          write
            ? React.createElement("input", {
              className: "index-dashboard__agent-q-input",
              autoFocus: !!options.length,
              value: own ? answer : "",
              placeholder: "write your own",
              "aria-label": "Write your own answer",
              disabled: sending,
              onChange: function (e) {
                const text = e.target.value;
                setSelections(function (current) {
                  const next = Object.assign({}, current);
                  next[question.id] = text;
                  return next;
                });
              },
              onBlur: function (e) { if (options.length && !e.target.value.trim()) stopWriting(); },
              onKeyDown: function (e) {
                if (e.key === "Escape" && options.length && !e.target.value.trim()) stopWriting();
              },
            })
            : React.createElement("button", {
              type: "button",
              className: "index-dashboard__agent-q-write",
              disabled: sending,
              onClick: function () {
                setSelections(function (current) {
                  const next = Object.assign({}, current);
                  next[question.id] = "";
                  return next;
                });
                setWriting(function (current) {
                  const next = Object.assign({}, current);
                  next[question.id] = true;
                  return next;
                });
              },
            }, "write your own"),
        ),
      );
    }

    // Questions the transcript carries are drawn in place; the rest close the
    // feed. Working notes fold into discovery sections, like the mac app.
    const placed = {};
    const entries = [];
    for (let i = 0; i < messages.length; i++) {
      const raw = messages[i];
      const content = extractContent(raw.parts);
      const provenance = (raw.metadata && raw.metadata.principalMessage) || {};
      if (!content.text) continue;
      if (provenance.kind === "question" && provenance.questionId && carded[provenance.questionId]) {
        placed[provenance.questionId] = true;
        entries.push({ id: raw.id, kind: "card", question: carded[provenance.questionId] });
        continue;
      }
      if (raw.role === "user") {
        entries.push({ id: raw.id, kind: "user", text: content.text });
        continue;
      }
      const work = agentLogEntry(content.text);
      if (work && work.kind === "stall") continue;
      const match = Array.isArray(provenance.matches) ? provenance.matches[0] : null;
      entries.push({
        id: raw.id,
        kind: work ? work.kind : "note",
        text: work ? work.text : content.text,
        provenance: provenance,
        opportunityId: match && match.opportunityId,
        counterpart: match && match.counterparty && match.counterparty.name,
      });
    }

    const bubbles = buildDiscoveryFeed(entries).map(function (entry) {
      if (entry.kind === "card") return questionCard(entry.question);
      if (entry.kind === "user") {
        return React.createElement("div", { key: entry.id, className: "index-dashboard__agent-mine" },
          React.createElement("div", { className: "index-dashboard__msg-bubble index-dashboard__msg-bubble--mine" },
            React.createElement(Markdown, { text: entry.text }),
          ),
        );
      }
      if (entry.kind === "discovery") return React.createElement(DiscoveryTrace, Object.assign({ key: entry.id }, entry));
      if (entry.kind === "decisions") return React.createElement(DecisionGroup, { key: entry.id, items: entry.items });
      if (entry.kind === "progress") return React.createElement(ProgressLine, { key: entry.id, text: entry.text });
      return React.createElement(AgentLine, {
        key: entry.id,
        speaker: agentSpeaker(entry.provenance),
        onOpenUser: props.onOpenUser,
      }, React.createElement(Markdown, { text: entry.text }));
    });

    const feed = bubbles.concat(questions.filter(function (question) {
      return !placed[question.id];
    }).map(questionCard));

    return React.createElement("div", { ref: rootRef, className: "index-dashboard__agent-chat" },
      React.createElement("div", { className: "index-dashboard__msg-thread index-dashboard__agent-thread", ref: threadRef },
        feed.length
          ? feed
          : React.createElement(EmptyState, null, "Ask about your matches, share a preference, or give your agent direction for this signal."),
      ),
      // The answer action rides above the composer rather than scrolling away
      // with the question it belongs to, and only once there is an answer to
      // send: a dead button is one more thing to read past.
      chosen.length
        ? React.createElement("div", { className: "index-dashboard__agent-send" },
          React.createElement(Button, {
            type: "button",
            disabled: sending,
            onClick: sendAnswers,
          }, chosen.length > 1 ? "send " + chosen.length + " answers" : "send answer"),
        )
        : null,
      React.createElement("div", { className: "index-dashboard__msg-composer index-dashboard__agent-composer" },
        React.createElement("textarea", {
          className: "index-dashboard__textarea index-dashboard__msg-input",
          rows: 1,
          value: draft,
          placeholder: "Message your personal agent…",
          "aria-label": "Message your personal agent",
          onChange: function (e) { setDraft(e.target.value); },
          onKeyDown: function (e) {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
          },
        }),
        // The arrow is the send key: Enter sends, and this is the same thing
        // for a pointer.
        React.createElement("button", {
          type: "button",
          className: "index-dashboard__agent-send-key",
          "aria-label": "Send message",
          title: "Send",
          disabled: !draft.trim() || sending,
          onClick: send,
        }, ICON_ARROW_UP()),
      ),
    );
  }

  function IntentDetail(props) {
    const intent = props.intent;
    // Opens on the whole radar, like the mac app: the accepted rows sit next to
    // the ones awaiting you instead of being a tab away.
    const bucketState = React.useState("all");
    const selectedBucket = bucketState[0];
    const setSelectedBucket = bucketState[1];
    // Armed archive: the first click arms the segment ("sure?"), the second
    // commits. Disarms itself after a few seconds, like the Mac app — this
    // replaces window.confirm, which the desktop host doesn't provide.
    const armedState = React.useState(false);
    const armed = armedState[0];
    const setArmed = armedState[1];
    React.useEffect(function () {
      if (!armed) return undefined;
      const timer = setTimeout(function () { setArmed(false); }, 4000);
      return function () { clearTimeout(timer); };
    }, [armed]);
    if (!intent) {
      return React.createElement("div", { className: "index-dashboard__detail" },
        React.createElement(EmptyState, null, "Select an intent to see its radar."),
      );
    }
    const paused = String(intent.lifecycleStatus || "").toLowerCase() === "paused";
    const allOpps = Array.isArray(intent.opportunities) ? intent.opportunities : [];
    const visibleOpps = allOpps.filter(function (opp) {
      const bucket = bucketForStatus(opp.status);
      if (!bucket) return false;
      return selectedBucket === "all" || bucket === selectedBucket;
    });
    const radarEmpty = "No matches here yet.";
    const radarLoading = !!props.radarLoading;
    const signalHead = React.createElement(SignalHead, {
      title: intent.title || "Untitled intent",
      paused: paused,
      actions: (function () {
        const archiving = props.archivingId === intent.id;
        return React.createElement("span", { className: "index-dashboard__action-group" },
          Tip("pause", paused ? "Resume" : "Pause", React.createElement("button", {
            type: "button",
            "aria-label": paused ? "Resume" : "Pause",
            className: "index-dashboard__action-seg "
              + (paused ? "index-dashboard__action-seg--resume index-dashboard__action-seg--filled" : "index-dashboard__action-seg--pause"),
            onClick: props.onPause ? function () { setArmed(false); props.onPause(intent.id, paused); } : undefined,
          }, paused ? ICON_PLAY() : ICON_PAUSE())),
          React.createElement("span", { key: "sep", className: "index-dashboard__action-sep", "aria-hidden": "true" }),
          Tip("archive", archiving ? "Archiving…" : armed ? "Confirm archive" : "Archive", React.createElement("button", {
            type: "button",
            "aria-label": armed ? "Confirm archive" : "Archive",
            className: "index-dashboard__action-seg index-dashboard__action-seg--archive"
              + (armed || archiving ? " index-dashboard__action-seg--filled" : ""),
            disabled: archiving,
            onClick: archiving ? undefined : function () {
              if (!armed) { setArmed(true); return; }
              setArmed(false);
              if (props.onArchive) props.onArchive(intent.id);
            },
          }, ICON_TRASH(), armed ? "sure?" : null)),
        );
      })(),
    });
    return React.createElement("div", { className: "index-dashboard__detail" },
      props.onBack
        ? React.createElement("button", { type: "button", className: "index-dashboard__back-pill", onClick: props.onBack }, ICON_ARROW_LEFT(), "Back")
        : null,
      // signal | radar, the two windows the mac app puts side by side.
      React.createElement("div", { className: "index-dashboard__detail-cols" },
        React.createElement(Panel, { title: "signal" },
          signalHead,
          React.createElement(AgentChat, { intentId: intent.id, focusQuestion: props.focusQuestion, onOpenUser: props.onOpenUser }),
        ),
        React.createElement(Panel, { title: "radar", primary: true, count: allOpps.length, titleAfter: RADAR_EYE(), description: "People the network surfaced for this intent." },
          props.actionError ? React.createElement("div", { className: "index-dashboard__error" }, props.actionError) : null,
          React.createElement(RadarStrip, { counts: intent.statusCounts, selected: selectedBucket, onSelect: setSelectedBucket }),
          radarLoading && !allOpps.length
            ? React.createElement("p", { className: "index-dashboard__net-invite-empty" }, "Loading radar…")
            : React.createElement(RadarList, { items: visibleOpps, empty: radarEmpty, onOpenUser: props.onOpenUser, onOpenNegotiation: props.onOpenNegotiation, onAccept: props.onAccept, onSkip: props.onSkipOpportunity, onStartChat: props.onStartChat, actingId: props.actingId, webUrl: props.webUrl }),
        ),
      ),
    );
  }

  function defaultTimezone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch (e) {
      return "UTC";
    }
  }

  function timezoneOptions() {
    try {
      if (typeof Intl.supportedValuesOf === "function") {
        return Intl.supportedValuesOf("timeZone");
      }
    } catch (e) { /* fall through */ }
    return [defaultTimezone(), "UTC"];
  }

  function socialUrl(label, raw) {
    return parseSocial({ id: label, handle: raw }).href;
  }

  function ProfileField(props) {
    return React.createElement("label", { className: "index-dashboard__profile-field" },
      React.createElement("span", { className: "index-dashboard__profile-label-row" },
        React.createElement("span", { className: "index-dashboard__profile-label" }, props.label),
        props.note ? React.createElement("span", { className: "index-dashboard__profile-label-note" }, props.note) : null,
      ),
      props.children,
      props.hint ? React.createElement("span", { className: "index-dashboard__profile-hint" }, props.hint) : null,
    );
  }

  // The caller can hand it its own lines: the profile fetch and the public
  // research pass both wait behind this card, and saying the same three things
  // twice would read as the loader repeating rather than as two pieces of work.
  function SettingUpScreen(props) {
    // Indeterminate bar + staggered status lines while enrichment runs.
    // No brand mark, loading gif, or live-dot — keep the Hermes card quiet.
    const lines = (props && props.lines) || [
      "Getting a sense of you…",
      "Working out what you're into…",
      "Almost there.",
    ];
    return React.createElement("div", { className: "index-dashboard__setting-up" },
      React.createElement("div", { className: "index-dashboard__setting-up-card" },
        React.createElement("div", { className: "index-dashboard__setting-up-bar", "aria-hidden": "true" },
          React.createElement("div", { className: "index-dashboard__setting-up-bar-fill" }),
        ),
        React.createElement("div", { className: "index-dashboard__setting-up-lines" },
          lines.map(function (line, i) {
            return React.createElement("p", {
              key: line,
              className: "index-dashboard__setting-up-line" + (i === lines.length - 1 ? " index-dashboard__setting-up-line--final" : ""),
              style: { animationDelay: (i * 350) + "ms" },
            },
              React.createElement("span", { className: "index-dashboard__setting-up-caret" }, "›"),
              line,
            );
          }),
        ),
      ),
    );
  }

  // Browser sign-in gate: runs the same /cli-auth loopback handshake as the
  // Index Mac app and CLI, persisting the minted key into the Hermes env.
  function LoginScreen(props) {
    const useState = React.useState;
    const useEffect = React.useEffect;
    const useRef = React.useRef;
    const waitingState = useState(false);
    const waiting = waitingState[0];
    const setWaiting = waitingState[1];
    const errorState = useState(null);
    const loginError = errorState[0];
    const setLoginError = errorState[1];
    const linkState = useState(null);
    const manualLink = linkState[0];
    const setManualLink = linkState[1];
    const pollRef = useRef(null);

    function stopPolling() {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    }

    useEffect(function () { return stopPolling; }, []);

    function poll() {
      fetchPluginJSON(API + "/auth/login/status")
        .then(function (payload) {
          const status = payload && payload.status;
          if (status === "success") {
            stopPolling();
            setWaiting(false);
            if (props.onAuthed) props.onAuthed();
          } else if (status === "failed") {
            stopPolling();
            setWaiting(false);
            setLoginError((payload && payload.error) || "Login failed. Please try again.");
          } else if (status === "idle") {
            stopPolling();
            setWaiting(false);
          }
        })
        .catch(function () { /* keep polling; transient host hiccup */ });
    }

    function start() {
      setLoginError(null);
      setManualLink(null);
      setWaiting(true);
      fetchPluginJSON(API + "/auth/login/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
        .then(function (payload) {
          if (!payload || payload.success === false) {
            throw new Error((payload && payload.error) || "Could not start login.");
          }
          // Headless/remote agent host: no browser to open, so surface the link.
          if (!payload.opened && payload.authUrl) setManualLink(payload.authUrl);
          stopPolling();
          pollRef.current = setInterval(poll, 1500);
        })
        .catch(function (err) {
          setWaiting(false);
          setLoginError(err && err.message ? err.message : String(err));
        });
    }

    return React.createElement("div", { className: "index-dashboard__login" },
      React.createElement("div", { className: "index-dashboard__login-card" },
        React.createElement("h1", {
          className: "index-dashboard__login-brand",
          dangerouslySetInnerHTML: { __html: INDEX_WORDMARK_SVG },
        }),
        React.createElement("p", { className: "index-dashboard__login-copy" },
          "index finds the right people for you, before you even think to look."),
        React.createElement(Button, {
          type: "button",
          className: "index-dashboard__login-btn",
          disabled: waiting,
          onClick: start,
        }, waiting ? "waiting for browser…" : "log in with browser"),
        manualLink
          ? React.createElement("p", { className: "index-dashboard__login-manual" },
            "No browser opened here — ",
            React.createElement("a", { href: manualLink, target: "_blank", rel: "noopener noreferrer" }, "open this link to continue"),
            ".")
          : null,
        loginError
          ? React.createElement("p", { className: "index-dashboard__login-error" }, loginError)
          : null,
        React.createElement("p", { className: "index-dashboard__login-foot" },
          "index only acts on what you tell it. you can stop any signal at any time."),
      ),
    );
  }

  // Mac AskName parity: the one thing the agent cannot work out on its own,
  // asked before it goes looking. A name is what the public research runs on,
  // and the account name from a browser handshake is often a handle or wrong.
  //
  // Deliberately the sign-in card's shape rather than the review form's: asking
  // one thing inside a form built to review a whole profile leaves a screen of
  // fields nobody can fill in yet.
  function AskNameCard(props) {
    const nameState = React.useState(props.initialName || "");
    const name = nameState[0];
    const setName = nameState[1];
    const ready = !!name.trim();
    return React.createElement("div", { className: "index-dashboard__login" },
      React.createElement("form", {
        className: "index-dashboard__login-card",
        onSubmit: function (e) { e.preventDefault(); if (ready) props.onSubmit(name.trim()); },
      },
        React.createElement("h1", { className: "index-dashboard__ask-name-title" }, "What's your name?"),
        React.createElement("p", { className: "index-dashboard__login-copy" },
          "I'll use it to find what's already public about you, so you don't have to type it all out."),
        React.createElement("input", {
          className: "index-dashboard__ask-name-input",
          value: name,
          autoFocus: true,
          placeholder: "Your name",
          "aria-label": "Your name",
          onChange: function (e) { setName(e.target.value); },
        }),
        React.createElement(Button, {
          type: "submit",
          className: "index-dashboard__login-btn",
          disabled: !ready,
        }, "Continue"),
      ),
    );
  }

  function usableEnriched(res) {
    const p = res && res["profile"];
    return !!(p && (String(p.intro || "").trim() || (p.socials && p.socials.length)));
  }

  // The runtime this Hermes registers as when it is chosen to negotiate.
  const HERMES_AGENT_NAME = "Hermes";

  /* Which agent negotiates for you — the same single choice as the web Agents
     page, offered here as an optional step rather than part of signing in.

     Hosted is not a row to bind: Index reads a cleared binding as "the hosted
     negotiator runs", so choosing it releases whichever agent holds the slot.
     Hermes is listed before it exists, because registering it is exactly what
     choosing it means; every row's checked state comes from the server, so a
     refused write leaves the previous selection standing. Choosing Hermes also
     starts this machine's runner; choosing any other row stops it. */
  function NegotiatorSettings() {
    const useState = React.useState;
    const useEffect = React.useEffect;
    const agentsState = useState(null);
    const agents = agentsState[0];
    const setAgents = agentsState[1];
    const loadingState = useState(true);
    const loading = loadingState[0];
    const setLoading = loadingState[1];
    const errorState = useState(null);
    const error = errorState[0];
    const setError = errorState[1];
    const busyState = useState(false);
    const busy = busyState[0];
    const setBusy = busyState[1];

    function load() {
      setLoading(true);
      fetchPluginJSON(API + "/agents")
        .then(function (payload) {
          if (!payload || payload.success === false) {
            throw new Error((payload && payload.error) || "Agents could not be loaded.");
          }
          setAgents(Array.isArray(payload.agents) ? payload.agents : []);
          setError(null);
        })
        .catch(function (err) { setError(err && err.message ? err.message : String(err)); })
        .finally(function () { setLoading(false); });
    }

    useEffect(function () { load(); }, []);

    function setBinding(agentId, handleNegotiations) {
      return fetchPluginJSON(API + "/agents/" + encodeURIComponent(agentId), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handleNegotiations: handleNegotiations }),
      });
    }

    const rows = agents || [];
    const selected = rows.filter(function (a) { return a.handleNegotiations; })[0] || null;

    // `row` is null for the hosted negotiator, and carries an empty id for a
    // runtime that still has to be registered before it can hold the slot.
    function select(row) {
      if (busy) return;
      setBusy(true);
      setError(null);
      let step;
      if (!row) {
        step = selected
          ? setBinding(selected.id, false)
          : Promise.resolve({ success: true });
      } else if (row.id) {
        step = setBinding(row.id, true);
      } else {
        step = fetchPluginJSON(API + "/agents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: row.name }),
        }).then(function (payload) {
          const created = (payload && payload.agent) || {};
          if (!payload || payload.success === false || !created.id) {
            throw new Error((payload && payload.error) || (row.name + " could not be registered."));
          }
          return setBinding(created.id, true);
        });
      }
      step
        .then(function (payload) {
          if (!payload || payload.success === false) {
            throw new Error((payload && payload.error) || "The negotiator could not be changed.");
          }
          load();
        })
        .catch(function (err) { setError(err && err.message ? err.message : String(err)); })
        .finally(function () { setBusy(false); });
    }

    function optionRow(key, name, sub, checked, onSelect) {
      return React.createElement("label", {
        key: key,
        className: "index-dashboard__agent-row" + (checked ? " index-dashboard__agent-row--selected" : ""),
      },
        React.createElement("input", {
          type: "radio",
          name: "index-negotiator",
          className: "index-dashboard__agent-radio",
          checked: checked,
          disabled: busy,
          onChange: onSelect,
        }),
        React.createElement("span", { className: "index-dashboard__agent-meta" },
          React.createElement("strong", { className: "index-dashboard__agent-name" }, name),
          React.createElement("span", { className: "index-dashboard__agent-sub" }, sub),
        ),
        checked ? React.createElement("span", { className: "index-dashboard__agent-active" }, "active") : null,
      );
    }

    if (loading && !agents) {
      return React.createElement("div", { className: "index-dashboard__loading" }, "Loading agents…");
    }

    const named = rows.some(function (a) {
      return String(a.name || "").toLowerCase() === HERMES_AGENT_NAME.toLowerCase();
    });
    const options = named ? rows : rows.concat([{ id: "", name: HERMES_AGENT_NAME, handleNegotiations: false }]);

    return React.createElement("div", { className: "index-dashboard__profile-section" },
      error ? React.createElement("div", { className: "index-dashboard__error" }, error) : null,
      React.createElement(ProfileField, {
        label: "Who negotiates for you",
        hint: "index negotiates for you until you choose one of your own agents.",
      },
        React.createElement("div", { className: "index-dashboard__agent-rows" },
          [optionRow(
            "hosted",
            "Index Negotiator",
            "Hosted by Index. Runs for your active signals.",
            !selected,
            function () { select(null); },
          )].concat(options.map(function (agent) {
            const here = String(agent.name || "").toLowerCase() === HERMES_AGENT_NAME.toLowerCase();
            return optionRow(
              agent.id || ("new-" + agent.name),
              agent.name,
              here
                ? "Runs in this Hermes. Keep the gateway running."
                : agent.id
                  ? (agent.description || "Your registered agent.")
                  : "Not registered yet. Choosing it registers it.",
              !!agent.handleNegotiations,
              function () { select(agent); },
            );
          })),
        ),
      ),
    );
  }

  function ProfilePanel(props) {
    const useState = React.useState;
    const useEffect = React.useEffect;
    const useRef = React.useRef;
    const loadingState = useState(true);
    const loading = loadingState[0];
    const setLoading = loadingState[1];
    const errorState = useState(null);
    const panelError = errorState[0];
    const setPanelError = errorState[1];
    const tabState = useState("profile");
    const tab = tabState[0];
    const setTab = tabState[1];
    const formState = useState(null);
    const form = formState[0];
    const setForm = formState[1];
    const dirtyState = useState(false);
    const dirty = dirtyState[0];
    const setDirty = dirtyState[1];
    const savingState = useState(false);
    const saving = savingState[0];
    const setSaving = savingState[1];
    const noteState = useState(null);
    const note = noteState[0];
    const setNote = noteState[1];
    const avatarPreviewState = useState(null);
    const avatarPreview = avatarPreviewState[0];
    const setAvatarPreview = avatarPreviewState[1];
    // First run only, in Mac's screen order: "name" → "looking-up" → "review".
    const stepState = useState("name");
    const step = stepState[0];
    const setStep = stepState[1];
    const assembledRef = useRef(null);

    const readOnly = !!props.readOnly;
    const gettingStarted = !!props.gettingStarted;
    // The negotiator pane owns the whole body: it does not edit the
    // profile, so the form's save bar has nothing to do while it is open.
    const paneTab = !readOnly && !gettingStarted && tab === "agents";

    function applyProfile(p) {
      const next = {
        id: p.id || "",
        name: p.name || "",
        intro: p.intro || "",
        location: p.location || "",
        email: p.email || "",
        avatar: p.avatar || "",
        context: p.context || "",
        timezone: p.timezone || defaultTimezone(),
        socials: Array.isArray(p.socials) ? p.socials.slice() : [],
        notificationPreferences: p.notificationPreferences || { connectionUpdates: true, weeklyNewsletter: true },
      };
      // The stored rows are bucketed by what each value resolves to, not by the
      // label it arrived under, so a linkedin URL stored as 'custom' still edits
      // in the linkedin row instead of showing up as a stray website.
      const split = splitProfileSocials(next.socials);
      next.socialHandles = split.handles;
      next.websites = split.websites;
      assembledRef.current = next;
      setForm(next);
      setDirty(false);
    }

    function adoptEnrichment(enriched, base) {
      const p = (enriched && enriched["profile"]) || {};
      const next = Object.assign({}, base || assembledRef.current || {}, {
        name: (base && base.name) || p.name || "",
        intro: (base && base.intro) || p.intro || "",
        location: (base && base.location) || p.location || "",
        avatar: (base && base.avatar) || p.avatar || "",
        socials: (p.socials && p.socials.length)
          ? p.socials.slice()
          : ((base && base.socials) || []),
        context: (base && base.context) || p.intro || "",
      });
      // Enrichment is the messiest source (packed multi-value fields, handles
      // labelled 'custom'), so its rows are re-bucketed the same way.
      const enrichedSplit = splitProfileSocials(next.socials);
      next.socialHandles = enrichedSplit.handles;
      next.websites = enrichedSplit.websites;
      assembledRef.current = next;
      setForm(next);
      setDirty(false);
    }

    function load() {
      setLoading(true);
      setPanelError(null);
      const profileUrl = props.userId ? API + "/profile/" + encodeURIComponent(props.userId) : API + "/profile";
      fetchPluginJSON(profileUrl)
        .then(function (payload) {
          if (!payload || payload.success === false) {
            throw new Error((payload && payload.error) || "Profile could not be loaded.");
          }
          applyProfile(payload["profile"] || {});
          return null;
        })
        .catch(function (err) {
          setPanelError(err && err.message ? err.message : String(err));
        })
        .finally(function () {
          setLoading(false);
        });
    }

    useEffect(function () { load(); }, []);

    // First run: the public research runs on the name just confirmed rather than
    // on whatever the handshake supplied, and the confirmed name then wins over
    // both the account record and whatever the lookup returns. Nothing found is
    // not a failure — the review just opens on the baseline profile.
    function continueFromName(confirmed) {
      assembledRef.current = Object.assign({}, assembledRef.current, { name: confirmed });
      setForm(assembledRef.current);
      setStep("looking-up");
      fetchPluginJSON(API + "/onboarding/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: confirmed }),
      })
        .then(function (enriched) {
          if (enriched && enriched.success !== false && usableEnriched(enriched)) {
            adoptEnrichment(enriched, Object.assign({}, assembledRef.current, { name: confirmed }));
          }
        })
        .catch(function () { /* keep the baseline profile */ })
        .finally(function () { setStep("review"); });
    }

    function patchForm(patch) {
      setForm(function (prev) { return Object.assign({}, prev, patch); });
      setDirty(true);
      setNote(null);
    }

    function getSocial(platform) {
      return (form.socialHandles || {})[platform] || "";
    }

    // The field holds whatever was typed, handle or pasted URL, and is only
    // resolved on save; resolving each keystroke would rewrite the text under
    // the cursor while someone is still typing it.
    function setSocial(platform, value) {
      setForm(function (prev) {
        const handles = Object.assign({}, prev.socialHandles || {});
        handles[platform] = value;
        return Object.assign({}, prev, { socialHandles: handles });
      });
      setDirty(true);
      setNote(null);
    }

    function customSocials() {
      return form.websites || [];
    }

    function updateCustom(index, value) {
      setForm(function (prev) {
        const next = (prev.websites || []).slice();
        next[index] = value;
        return Object.assign({}, prev, { websites: next });
      });
      setDirty(true);
      setNote(null);
    }

    function removeCustom(index) {
      setForm(function (prev) {
        const next = (prev.websites || []).filter(function (_, i) { return i !== index; });
        return Object.assign({}, prev, { websites: next });
      });
      setDirty(true);
      setNote(null);
    }

    function addCustom() {
      setForm(function (prev) {
        return Object.assign({}, prev, { websites: (prev.websites || []).concat([""]) });
      });
      setDirty(true);
      setNote(null);
    }

    function onAvatarFile(event) {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function (e) {
        setAvatarPreview(e.target ? e.target.result : null);
        setDirty(true);
        setNote(null);
      };
      reader.readAsDataURL(file);
    }

    function save() {
      setSaving(true);
      setNote(null);
      setPanelError(null);

      function persist(avatarUrl) {
        const body = {
          name: form.name,
          intro: form.intro,
          location: form.location,
          timezone: form.timezone,
          // The fields hold a handle or a pasted URL; buildProfileSocials turns
          // both into the API's {label, value} rows, drops what cannot resolve
          // to an openable address, and deduplicates.
          socials: buildProfileSocials(form.socialHandles, form.websites),
          notificationPreferences: form.notificationPreferences,
          context: form.context || "",
        };
        if (avatarUrl) body.avatar = avatarUrl;
        if (gettingStarted) {
          body.draft = {
            identity: { name: (form.name || "").trim(), bio: (form.intro || "").trim(), location: (form.location || "").trim() },
            narrative: { context: (form.context || form.intro || "").trim() },
            attributes: { skills: [], interests: [] },
          };
          return fetchPluginJSON(API + "/onboarding/confirm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }).then(function (payload) {
            if (!payload || payload.success === false) {
              throw new Error((payload && payload.error) || "Profile could not be confirmed.");
            }
            setDirty(false);
            setNote("Confirmed.");
            if (typeof props.onConfirmed === "function") props.onConfirmed();
          });
        }
        return fetchPluginJSON(API + "/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }).then(function (payload) {
          if (!payload || payload.success === false) {
            throw new Error((payload && payload.error) || "Profile could not be saved.");
          }
          if (avatarUrl) {
            setForm(function (prev) { return Object.assign({}, prev, { avatar: avatarUrl }); });
            setAvatarPreview(null);
          }
          setDirty(false);
          setNote("Saved.");
        });
      }

      const uploadStep = avatarPreview
        ? fetchPluginJSON(API + "/profile/avatar", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dataUrl: avatarPreview }),
          }).then(function (payload) {
            if (!payload || payload.success === false) {
              throw new Error((payload && payload.error) || "Avatar could not be uploaded.");
            }
            return payload.avatarUrl || "";
          })
        : Promise.resolve("");

      uploadStep
        .then(function (avatarUrl) { return persist(avatarUrl); })
        .catch(function (err) {
          setPanelError(err && err.message ? err.message : String(err));
        })
        .finally(function () {
          setSaving(false);
        });
    }

    function resetAssembled() {
      if (!assembledRef.current) return;
      setForm(Object.assign({}, assembledRef.current));
      setAvatarPreview(null);
      setDirty(false);
      setNote(null);
    }

    function tabButton(id, label) {
      const active = tab === id;
      return React.createElement("button", {
        type: "button",
        className: "index-dashboard__profile-tab" + (active ? " index-dashboard__profile-tab--active" : ""),
        onClick: function () { setTab(id); },
      }, label);
    }

    function socialRows() {
      return EDITABLE_PLATFORMS.map(function (platform) {
        return React.createElement("div", { key: platform, className: "index-dashboard__profile-social" },
          React.createElement("span", { className: "index-dashboard__profile-social-prefix" }, SOCIAL_PREFIX[platform]),
          React.createElement("input", {
            className: "index-dashboard__profile-input index-dashboard__profile-social-input",
            value: getSocial(platform),
            onChange: function (e) { setSocial(platform, e.target.value); },
          }),
        );
      }).concat(customSocials().map(function (site, index) {
        return React.createElement("div", { key: "custom-" + index, className: "index-dashboard__profile-social" },
          React.createElement("input", {
            className: "index-dashboard__profile-input index-dashboard__profile-social-input",
            value: site,
            placeholder: "https://example.com",
            onChange: function (e) { updateCustom(index, e.target.value); },
          }),
          React.createElement("button", {
            type: "button",
            className: "index-dashboard__profile-social-remove",
            "aria-label": "Remove link",
            onClick: function () { removeCustom(index); },
          }, "×"),
        );
      }));
    }

    function profileTab() {
      const avatarSrc = avatarPreview || form.avatar;
      return React.createElement("div", { className: "index-dashboard__profile-section" },
        React.createElement("div", { className: "index-dashboard__profile-identity" },
          React.createElement("label", { className: "index-dashboard__profile-avatar" },
            React.createElement(UserAvatar, {
              id: form.id,
              name: form.name,
              avatar: avatarSrc,
              className: "index-dashboard__avatar index-dashboard__profile-avatar-circle",
            }),
            React.createElement("input", { type: "file", accept: "image/*", className: "index-dashboard__profile-avatar-input", onChange: onAvatarFile }),
          ),
          React.createElement("div", { className: "index-dashboard__profile-identity-main" },
            React.createElement("strong", { className: "index-dashboard__profile-identity-name" }, form.name || "Your name"),
            form.location ? React.createElement("span", { className: "index-dashboard__profile-identity-sub" }, form.location) : null,
          ),
          React.createElement("label", { className: "index-dashboard__profile-photo-link" },
            "Change photo",
            React.createElement("input", { type: "file", accept: "image/*", className: "index-dashboard__profile-avatar-input", onChange: onAvatarFile }),
          ),
        ),
        React.createElement("div", { className: "index-dashboard__profile-grid" },
          React.createElement(ProfileField, { label: "Name" },
            React.createElement("input", { className: "index-dashboard__profile-input", value: form.name, placeholder: "John Doe", onChange: function (e) { patchForm({ name: e.target.value }); } }),
          ),
          React.createElement(ProfileField, { label: "Location" },
            React.createElement("input", { className: "index-dashboard__profile-input", value: form.location, placeholder: "Brooklyn, NY", onChange: function (e) { patchForm({ location: e.target.value }); } }),
          ),
        ),
        React.createElement(ProfileField, { label: "Introduction", note: "agents share this when negotiating" },
          React.createElement("textarea", { className: "index-dashboard__textarea", rows: 4, value: form.intro, placeholder: "Tell others about yourself…", onChange: function (e) { patchForm({ intro: e.target.value }); } }),
        ),
        React.createElement(ProfileField, { label: "Socials" },
          React.createElement("div", { className: "index-dashboard__profile-socials" }, socialRows()),
          customSocials().length < 3
            ? React.createElement("button", { type: "button", className: "index-dashboard__profile-add", onClick: addCustom }, "+ add website")
            : null,
        ),
      );
    }

    function notificationsTab() {
      const prefs = form.notificationPreferences || {};
      function setPref(key, value) {
        patchForm({ notificationPreferences: Object.assign({}, prefs, (function () { const o = {}; o[key] = value; return o; })()) });
      }
      return React.createElement("div", { className: "index-dashboard__profile-section" },
        React.createElement(ProfileField, { label: "Timezone" },
          React.createElement("select", {
            className: "index-dashboard__profile-input index-dashboard__profile-select",
            value: form.timezone,
            onChange: function (e) { patchForm({ timezone: e.target.value }); },
          }, timezoneOptions().map(function (tz) {
            return React.createElement("option", { key: tz, value: tz }, tz.replace(/_/g, " "));
          })),
        ),
        React.createElement(ProfileField, { label: "Email" },
          React.createElement("div", { className: "index-dashboard__profile-checks" },
          [["connectionUpdates", "Connection updates", "Email when someone connects with you"], ["weeklyNewsletter", "Weekly newsletter", "Weekly summary of new connections"]].map(function (row) {
            const key = row[0];
            return React.createElement("label", { key: key, className: "index-dashboard__profile-check" },
              React.createElement("div", null,
                React.createElement("p", { className: "index-dashboard__profile-check-label" }, row[1]),
                React.createElement("p", { className: "index-dashboard__profile-check-desc" }, row[2]),
              ),
              React.createElement("input", { type: "checkbox", checked: !!prefs[key], onChange: function (e) { setPref(key, e.target.checked); } }),
            );
          }),
          ),
        ),
      );
    }

    function readOnlyView() {
      const socials = displayProfileSocials(form.socials);
      return React.createElement("div", { className: "index-dashboard__profile-section" },
        React.createElement("div", { className: "index-dashboard__profile-identity" },
          React.createElement(UserAvatar, {
            id: form.id,
            name: form.name,
            avatar: form.avatar,
            className: "index-dashboard__avatar index-dashboard__profile-avatar-circle",
          }),
          React.createElement("div", { className: "index-dashboard__profile-identity-main" },
            React.createElement("strong", { className: "index-dashboard__profile-identity-name" }, form.name || "Profile"),
            form.location ? React.createElement("span", { className: "index-dashboard__profile-identity-sub" }, form.location) : null,
          ),
        ),
        form.intro
          ? React.createElement(ProfileField, { label: "Intro" }, React.createElement("p", { className: "index-dashboard__profile-read-text" }, form.intro))
          : null,
        form.context
          ? React.createElement(ProfileField, { label: "Context" }, React.createElement("p", { className: "index-dashboard__profile-read-text" }, form.context))
          : null,
        socials.length > 0
          ? React.createElement(ProfileField, { label: "Socials" },
            React.createElement("div", { className: "index-dashboard__profile-read-socials" },
              socials.map(function (s, index) {
                return React.createElement("a", {
                  key: String(index) + s.href,
                  className: "index-dashboard__profile-read-social",
                  href: s.href,
                  target: "_blank",
                  rel: "noopener noreferrer",
                }, s.text);
              }),
            ),
          )
          : null,
        !form.intro && !form.context && socials.length === 0
          ? React.createElement(EmptyState, null, "This person hasn't shared profile details yet.")
          : null,
      );
    }

    const title = gettingStarted
      ? "Getting started"
      : (readOnly ? ((form && form.name) || "Profile") : "settings");

    const panel = React.createElement("div", {
      className: "index-dashboard__profile-panel" + (gettingStarted ? " index-dashboard__profile-panel--getting-started" : ""),
      onClick: gettingStarted ? undefined : function (e) { e.stopPropagation(); },
    },
      React.createElement("div", { className: "index-dashboard__profile-header" },
        React.createElement("h2", { className: "index-dashboard__profile-title" }, title),
        React.createElement("div", { className: "index-dashboard__profile-header-actions" },
          (!gettingStarted && !readOnly && props.onSignOut)
            ? React.createElement("button", { type: "button", className: "index-dashboard__profile-signout", onClick: props.onSignOut }, "Sign out")
            : null,
          gettingStarted
            ? null
            : React.createElement("button", { type: "button", className: "index-dashboard__profile-close", "aria-label": "Close", onClick: props.onClose }, "×"),
        ),
      ),
      gettingStarted
        ? React.createElement("p", { className: "index-dashboard__getting-started-copy" },
          "Here's what I pulled together. Make sure it's right.")
        : null,
      (readOnly || gettingStarted) ? null : React.createElement("div", { className: "index-dashboard__profile-tabs" },
        tabButton("profile", "Profile"),
        tabButton("notifications", "Notifications"),
        tabButton("agents", "Negotiator"),
      ),
      panelError ? React.createElement("div", { className: "index-dashboard__error" }, panelError) : null,
      paneTab
        // The pane loads its own data, so it opens without waiting on the
        // profile fetch behind it.
        ? React.createElement("div", { className: "index-dashboard__profile-body" },
          React.createElement(NegotiatorSettings),
        )
        : (loading || (!form && !panelError)
          ? React.createElement("div", { className: "index-dashboard__loading" }, "Loading profile…")
          : React.createElement("div", { className: "index-dashboard__profile-body" },
            readOnly ? readOnlyView() : (tab === "notifications" && !gettingStarted ? notificationsTab() : profileTab()),
          )),
      (!readOnly && form && !paneTab)
        ? React.createElement("div", { className: "index-dashboard__profile-bar" },
          React.createElement("span", { className: "index-dashboard__profile-note" },
            note || (gettingStarted ? (dirty ? "Edit anything that looks off" : "") : (dirty ? "\u25cf unsaved changes" : ""))),
          React.createElement("div", { className: "index-dashboard__profile-bar-actions" },
            gettingStarted
              ? React.createElement(Button, {
                type: "button",
                outlined: true,
                className: "index-dashboard__getting-started-btn",
                disabled: saving || !dirty,
                onClick: resetAssembled,
              }, "Reset")
              : React.createElement("button", { type: "button", className: "index-dashboard__profile-discard", disabled: saving || !dirty, onClick: load }, "Discard"),
            React.createElement(Button, {
              type: "button",
              className: gettingStarted ? "index-dashboard__getting-started-btn" : "index-dashboard__profile-save",
              disabled: saving || (!gettingStarted && !dirty),
              onClick: save,
            }, saving
              ? (gettingStarted ? "Confirming…" : "Saving…")
              : (gettingStarted ? "Looks good" : "Save changes")),
          ),
        )
        : null,
    );

    // Mac parity: first run is three screens in sequence — confirm the name,
    // look the person up behind the loader, then review what came back. The
    // review form only ever appears filled.
    if (gettingStarted) {
      const wrap = function (child) {
        return React.createElement("div", { className: "index-dashboard__getting-started" }, child);
      };
      if (loading || !form) return wrap(React.createElement(SettingUpScreen));
      if (step === "name") {
        return wrap(React.createElement(AskNameCard, {
          initialName: form.name,
          onSubmit: continueFromName,
        }));
      }
      if (step === "looking-up") {
        return wrap(React.createElement(SettingUpScreen, {
          lines: [
            "Looking you up…",
            "Reading what's already public…",
            "Almost there.",
          ],
        }));
      }
      return wrap(panel);
    }
    return React.createElement("div", { className: "index-dashboard__profile-overlay", onClick: props.onClose }, panel);
  }

  function extractContent(parts) {
    // Mirrors the web app: message text lives either in a data part
    // (data.message / data.assessment.reasoning) or in a plain text part.
    // Parts use `kind` (agent A2A) or `type` (plain) as the discriminator.
    // A data part carrying only reasoning (no message, no plain text) is an
    // internal agent assessment and is styled distinctly.
    if (!Array.isArray(parts)) return { text: "", isInternal: false };
    let dataPart = null;
    let textPart = null;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (!p || typeof p !== "object") continue;
      if (!dataPart && (p.kind === "data" || p.type === "data") && p.data) dataPart = p;
      if (!textPart && typeof p.text === "string" && p.text.trim()) textPart = p;
    }
    let message = "";
    let reasoning = "";
    if (dataPart && dataPart.data) {
      if (typeof dataPart.data.message === "string") message = dataPart.data.message.trim();
      const assessment = dataPart.data.assessment;
      if (assessment && typeof assessment.reasoning === "string") reasoning = assessment.reasoning.trim();
    }
    const plain = textPart ? textPart.text.trim() : "";
    return {
      text: message || reasoning || plain,
      isInternal: !message && !plain && !!reasoning,
    };
  }

  function normalizeMessage(raw, currentUserId) {
    if (!raw || typeof raw !== "object") return null;
    const senderId = raw.senderId || "";
    const content = extractContent(raw.parts);
    // The user's own side may be either the bare userId (DMs) or the
    // `agent:<userId>` participant (negotiation/opportunity threads).
    const mine = !!currentUserId && (senderId === currentUserId || senderId === "agent:" + currentUserId);
    return {
      id: raw.id || (senderId + ":" + (raw.createdAt || "")),
      senderId: senderId,
      text: content.text,
      isInternal: content.isInternal,
      createdAt: raw.createdAt || "",
      mine: mine,
    };
  }

  function timeStamp(iso, coarse) {
    if (!iso) return "";
    const at = new Date(iso);
    if (isNaN(at.getTime())) return "";
    const clock = at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (!coarse) return clock;
    const days = (Date.now() - at.getTime()) / 86400000;
    if (days < 1) return clock;
    if (days < 7) return at.toLocaleDateString([], { weekday: "short" });
    return at.toLocaleDateString([], { month: "short", day: "numeric" });
  }

  function MessagesPanel(props) {
    const useState = React.useState;
    const useEffect = React.useEffect;
    const useRef = React.useRef;

    const convState = useState([]);
    const convs = convState[0];
    const setConvs = convState[1];
    const userIdState = useState("");
    const currentUserId = userIdState[0];
    const setCurrentUserId = userIdState[1];
    const activeState = useState(props.initialConversationId || null);
    const activeId = activeState[0];
    const setActiveId = activeState[1];
    const messagesState = useState([]);
    const messages = messagesState[0];
    const setMessages = messagesState[1];
    const listErrState = useState(null);
    const listErr = listErrState[0];
    const setListErr = listErrState[1];
    const listLoadingState = useState(true);
    const listLoading = listLoadingState[0];
    const setListLoading = listLoadingState[1];
    const threadLoadingState = useState(false);
    const threadLoading = threadLoadingState[0];
    const setThreadLoading = threadLoadingState[1];
    const inputState = useState("");
    const input = inputState[0];
    const setInput = inputState[1];
    const sendingState = useState(false);
    const sending = sendingState[0];
    const setSending = sendingState[1];
    const queryState = useState("");
    const query = queryState[0];
    const setQuery = queryState[1];
    const readState = useState(function () {
      try { return JSON.parse(window.localStorage.getItem("index_msg_read") || "{}") || {}; }
      catch (e) { return {}; }
    });
    const readMap = readState[0];
    const setReadMap = readState[1];

    const activeIdRef = useRef(props.initialConversationId || null);
    const userIdRef = useRef("");
    const threadRef = useRef(null);

    function markRead(id, at) {
      if (!id) return;
      setReadMap(function (prev) {
        const stamp = at || new Date().toISOString();
        if ((prev[id] || "") >= stamp) return prev;
        const next = Object.assign({}, prev);
        next[id] = stamp;
        try { window.localStorage.setItem("index_msg_read", JSON.stringify(next)); } catch (e) { /* noop */ }
        return next;
      });
    }
    activeIdRef.current = activeId;
    userIdRef.current = currentUserId;

    function appendMessage(msg) {
      if (!msg) return;
      setMessages(function (prev) {
        if (prev.some(function (m) { return m.id === msg.id; })) return prev;
        return prev.concat([msg]);
      });
    }

    function loadThread(id) {
      if (!id) return;
      setActiveId(id);
      setThreadLoading(true);
      setMessages([]);
      fetchPluginJSON(API + "/conversations/" + encodeURIComponent(id) + "/messages")
        .then(function (payload) {
          if (!payload || payload.success === false) {
            throw new Error((payload && payload.error) || "Messages could not be loaded.");
          }
          const uid = payload.currentUserId || userIdRef.current || "";
          if (payload.currentUserId) setCurrentUserId(payload.currentUserId);
          const list = (payload.messages || [])
            .map(function (m) { return normalizeMessage(m, uid); })
            .filter(Boolean);
          setMessages(list);
        })
        .catch(function (err) { setListErr(err && err.message ? err.message : String(err)); })
        .finally(function () { setThreadLoading(false); });
    }

    function loadList(selectId) {
      setListLoading(true);
      setListErr(null);
      fetchPluginJSON(API + "/conversations")
        .then(function (payload) {
          if (!payload || payload.success === false) {
            throw new Error((payload && payload.error) || "Conversations could not be loaded.");
          }
          setCurrentUserId(payload.currentUserId || "");
          setConvs(payload.conversations || []);
          const target = selectId || activeIdRef.current;
          if (target) loadThread(target);
        })
        .catch(function (err) { setListErr(err && err.message ? err.message : String(err)); })
        .finally(function () { setListLoading(false); });
    }

    // Re-fetch the conversation list (e.g. when a message arrives for a
    // conversation not yet in the local list, mirroring the web app).
    function refreshList() {
      fetchPluginJSON(API + "/conversations")
        .then(function (payload) {
          if (!payload || payload.success === false) return;
          if (payload.currentUserId) setCurrentUserId(payload.currentUserId);
          setConvs(payload.conversations || []);
        })
        .catch(function () { /* ignore transient refresh errors */ });
    }

    useEffect(function () { loadList(props.initialConversationId || null); }, []);

    // Authoritative realtime, mirroring the web app's ConversationContext:
    // dedup by message id, live conversation-summary updates, and
    // refresh-on-unknown.
    function applyIncoming(data) {
      if (data.type !== "message" || !data.message) return;
      const convId = data.conversationId || data.message.conversationId;
      if (!convId) return;
      const msg = normalizeMessage(data.message, userIdRef.current);
      if (convId === activeIdRef.current) appendMessage(msg);
      setConvs(function (prev) {
        if (!prev.some(function (c) { return c.id === convId; })) { refreshList(); return prev; }
        return prev.map(function (c) {
          if (c.id !== convId) return c;
          return Object.assign({}, c, { lastMessagePreview: msg ? msg.text : c.lastMessagePreview, lastMessageAt: msg ? msg.createdAt : c.lastMessageAt });
        });
      });
    }

    useEffect(function () {
      // Desktop host: the REST bridge buffers whole responses, so the SSE
      // relay can't stream — poll the list and the open thread instead.
      if (DESKTOP_ENV) {
        const pollId = setInterval(function () {
          refreshList();
          const active = activeIdRef.current;
          if (!active) return;
          fetchPluginJSON(API + "/conversations/" + encodeURIComponent(active) + "/messages")
            .then(function (payload) {
              if (!payload || payload.success === false) return;
              const uid = payload.currentUserId || userIdRef.current || "";
              const list = (payload.messages || [])
                .map(function (m) { return normalizeMessage(m, uid); })
                .filter(Boolean);
              if (activeIdRef.current === active) setMessages(list);
            })
            .catch(function () { /* transient poll errors */ });
        }, 15000);
        return function () { clearInterval(pollId); };
      }

      return subscribeUserEvents(applyIncoming);
    }, []);

    useEffect(function () {
      const node = threadRef.current;
      if (node) node.scrollTop = node.scrollHeight;
    }, [messages, threadLoading]);

    // Keep the open conversation marked as read up to its latest activity.
    useEffect(function () {
      if (!activeId) return;
      const conv = convs.filter(function (c) { return c.id === activeId; })[0];
      markRead(activeId, (conv && conv.lastMessageAt) || new Date().toISOString());
    }, [activeId, convs]);

    // Optimistic send, mirroring the web app: render the outgoing bubble and bump
    // the conversation summary immediately, then reconcile with the server row
    // (dedup by id in case SSE already delivered it), rolling back on failure.
    function send() {
      const text = input.trim();
      if (!text || !activeId || sending) return;
      const convId = activeId;
      const uid = userIdRef.current || "";
      const nowIso = new Date().toISOString();
      const optimisticId = (window.crypto && window.crypto.randomUUID)
        ? window.crypto.randomUUID()
        : ("optimistic-" + Date.now());
      const optimistic = { id: optimisticId, senderId: uid, text: text, isInternal: false, createdAt: nowIso, mine: true };
      setMessages(function (prev) { return prev.concat([optimistic]); });
      setConvs(function (prev) {
        return prev.map(function (c) {
          if (c.id !== convId) return c;
          return Object.assign({}, c, { lastMessagePreview: text, lastMessageAt: nowIso });
        });
      });
      setInput("");
      setSending(true);
      fetchPluginJSON(API + "/conversations/" + encodeURIComponent(convId) + "/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text }),
      })
        .then(function (payload) {
          if (!payload || payload.success === false) {
            throw new Error((payload && payload.error) || "Message could not be sent.");
          }
          const real = normalizeMessage(payload.message, userIdRef.current);
          setMessages(function (prev) {
            const withReal = prev.map(function (m) { return m.id === optimisticId ? (real || m) : m; });
            const seen = {};
            return withReal.filter(function (m) {
              if (seen[m.id]) return false;
              seen[m.id] = true;
              return true;
            });
          });
        })
        .catch(function (err) {
          setMessages(function (prev) { return prev.filter(function (m) { return m.id !== optimisticId; }); });
          setInput(text);
          setListErr(err && err.message ? err.message : String(err));
        })
        .finally(function () { setSending(false); });
    }

    function onComposerKey(event) {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        send();
      }
    }

    const activeConv = convs.filter(function (c) { return c.id === activeId; })[0] || null;

    const q = query.trim().toLowerCase();
    const filteredConvs = convs
      .filter(function (c) {
        if (!q) return true;
        return ((c.title || "") + " " + (c.counterpartName || "") + " " + (c.lastMessagePreview || "")).toLowerCase().indexOf(q) >= 0;
      })
      .sort(function (a, b) { return (b.lastMessageAt || "").localeCompare(a.lastMessageAt || ""); });

    function isUnread(c) {
      return c.id !== activeId && !!c.lastMessageAt && c.lastMessageAt > (readMap[c.id] || "");
    }

    return React.createElement("div", { className: "index-dashboard__profile-overlay", onClick: props.onClose },
      React.createElement("div", { className: "index-dashboard__profile-panel index-dashboard__msg-panel", onClick: function (e) { e.stopPropagation(); } },
        React.createElement("div", { className: "index-dashboard__profile-header" },
          React.createElement("h2", { className: "index-dashboard__profile-title" }, "messages"),
          React.createElement("button", { type: "button", className: "index-dashboard__profile-close", "aria-label": "Close", onClick: props.onClose }, "×"),
        ),
        listErr ? React.createElement("div", { className: "index-dashboard__error" }, listErr) : null,
        React.createElement("div", { className: "index-dashboard__msg-body" },
          React.createElement("div", { className: "index-dashboard__msg-list" },
            React.createElement("div", { className: "index-dashboard__msg-search-bar" },
              React.createElement("input", {
                type: "search",
                className: "index-dashboard__msg-search",
                placeholder: "\u2315 search conversations…",
                value: query,
                onChange: function (e) { setQuery(e.target.value); },
                "aria-label": "Search conversations",
              }),
            ),
            React.createElement("div", { className: "index-dashboard__msg-convs" },
            listLoading
              ? React.createElement("div", { className: "index-dashboard__loading" }, "Loading…")
              : (convs.length === 0
                ? React.createElement(EmptyState, null, "No conversations yet.")
                : (filteredConvs.length === 0
                  ? React.createElement(EmptyState, null, "No matches.")
                  : filteredConvs.map(function (c) {
                    const active = c.id === activeId;
                    const unread = isUnread(c);
                    return React.createElement("button", {
                      key: c.id,
                      type: "button",
                      className: "index-dashboard__msg-conv" + (active ? " index-dashboard__msg-conv--active" : "") + (unread ? " index-dashboard__msg-conv--unread" : ""),
                      onClick: function () { loadThread(c.id); },
                    },
                      React.createElement(UserAvatar, {
                        id: c.counterpartUserId,
                        name: c.counterpartName || c.title,
                        avatar: c.avatar,
                        className: "index-dashboard__avatar index-dashboard__msg-conv-avatar",
                      }),
                      React.createElement("span", { className: "index-dashboard__msg-conv-main" },
                        React.createElement("span", { className: "index-dashboard__msg-conv-top" },
                          React.createElement("span", { className: "index-dashboard__msg-conv-name" },
                            c.title || "Conversation",
                            c.kind === "negotiation" ? React.createElement("span", { className: "index-dashboard__msg-conv-badge" }, "Agent") : null,
                          ),
                          React.createElement("span", { className: "index-dashboard__msg-conv-time" }, timeStamp(c.lastMessageAt, true)),
                        ),
                        c.lastMessagePreview ? React.createElement("span", { className: "index-dashboard__msg-conv-preview" }, c.lastMessagePreview) : null,
                      ),
                      unread ? React.createElement("span", { className: "index-dashboard__msg-conv-dot", "aria-hidden": "true" }) : null,
                    );
                  }))),
            ),
          ),
          React.createElement("div", { className: "index-dashboard__msg-thread-col" },
            activeId
              ? React.createElement(React.Fragment, null,
                activeConv
                  ? React.createElement("div", { className: "index-dashboard__msg-thread-head" },
                    React.createElement(UserAvatar, {
                      id: activeConv.counterpartUserId,
                      name: activeConv.counterpartName || activeConv.title,
                      avatar: activeConv.avatar,
                      className: "index-dashboard__avatar index-dashboard__msg-thread-avatar",
                    }),
                    React.createElement("span", { className: "index-dashboard__msg-thread-name" }, activeConv.title || "Conversation"),
                  )
                  : null,
                React.createElement("div", { className: "index-dashboard__msg-thread", ref: threadRef },
                  threadLoading
                    ? React.createElement("div", { className: "index-dashboard__loading" }, "Loading messages…")
                    : (function () {
                        const visible = messages.filter(function (m) { return m.text && m.text.trim(); });
                        if (visible.length === 0) return React.createElement(EmptyState, null, "No messages yet. Say hello.");
                        return visible.map(function (m) {
                          let cls = "index-dashboard__msg-bubble";
                          if (m.mine) cls += " index-dashboard__msg-bubble--mine";
                          if (m.isInternal) cls += " index-dashboard__msg-bubble--internal";
                          return React.createElement("div", {
                            key: m.id,
                            className: "index-dashboard__msg-row" + (m.mine ? " index-dashboard__msg-row--mine" : ""),
                          },
                            m.isInternal
                              ? React.createElement("div", { className: cls },
                                React.createElement("span", { className: "index-dashboard__msg-internal-label" }, "Internal assessment"),
                                React.createElement("span", null, m.text),
                              )
                              : React.createElement("div", { className: cls }, m.text),
                            React.createElement("span", { className: "index-dashboard__msg-time" }, timeStamp(m.createdAt)),
                          );
                        });
                      })(),
                ),
                React.createElement("div", { className: "index-dashboard__msg-composer" },
                  React.createElement("textarea", {
                    className: "index-dashboard__textarea index-dashboard__msg-input",
                    rows: 1,
                    value: input,
                    placeholder: "write a message…",
                    onChange: function (e) { setInput(e.target.value); },
                    onKeyDown: onComposerKey,
                  }),
                  React.createElement("button", {
                    type: "button",
                    className: "index-dashboard__msg-send",
                    "aria-label": "Send",
                    disabled: sending || !input.trim(),
                    onClick: send,
                  }, "\u2191"),
                ),
              )
              : React.createElement("div", { className: "index-dashboard__msg-thread" },
                React.createElement(EmptyState, null, "Select a conversation to view messages."),
              ),
          ),
        ),
      ),
    );
  }

  function IndexNetworkDashboard() {
    const useState = React.useState;
    const useEffect = React.useEffect;
    const useRef = React.useRef;
    const initial = parseView();
    // Root node + host theme; every animated asset resolves against SCHEME.
    const rootRef = useRef(null);
    const scheme = useColorScheme(rootRef);
    SCHEME = scheme;
    const summaryState = useState(null);
    const summary = summaryState[0];
    const setSummary = summaryState[1];
    const networksState = useState(null);
    const networks = networksState[0];
    const setNetworks = networksState[1];
    const intentDetailsState = useState({});
    const intentDetails = intentDetailsState[0];
    const setIntentDetails = intentDetailsState[1];
    const radarLoadingState = useState(false);
    const radarLoading = radarLoadingState[0];
    const setRadarLoading = radarLoadingState[1];
    const needsOnboardingState = useState(false);
    const needsOnboarding = needsOnboardingState[0];
    const setNeedsOnboarding = needsOnboardingState[1];
    const loadingState = useState(true);
    const loading = loadingState[0];
    const setLoading = loadingState[1];
    const errorState = useState(null);
    const error = errorState[0];
    const setError = errorState[1];
    const actionErrorState = useState(null);
    const actionError = actionErrorState[0];
    const setActionError = actionErrorState[1];
    const actingState = useState(null);
    const actingId = actingState[0];
    const setActingId = actingState[1];
    const joiningState = useState(null);
    const joiningId = joiningState[0];
    const setJoiningId = joiningState[1];
    const networkRequestsState = useState([]);
    const networkRequests = networkRequestsState[0];
    const setNetworkRequests = networkRequestsState[1];
    const createOpenState = useState(false);
    const createOpen = createOpenState[0];
    const setCreateOpen = createOpenState[1];
    const newSignalState = useState(false);
    const newSignalOpen = newSignalState[0];
    const setNewSignalOpen = newSignalState[1];
    const editingRequestState = useState(null);
    const editingRequest = editingRequestState[0];
    const setEditingRequest = editingRequestState[1];
    const selectedState = useState(initial.intentId);
    const selectedId = selectedState[0];
    const setSelectedId = selectedState[1];
    const autoState = useState(true);
    const autoRefresh = autoState[0];
    const setAutoRefresh = autoState[1];
    const profileOpenState = useState(!!initial.profileOpen);
    const profileOpen = profileOpenState[0];
    const setProfileOpen = profileOpenState[1];
    // The radar row whose negotiation is open, if any.
    const negotiationState = useState(null);
    const negotiation = negotiationState[0];
    const setNegotiation = negotiationState[1];
    const viewUserState = useState(initial.viewUserId || null);
    const viewUserId = viewUserState[0];
    const setViewUserId = viewUserState[1];
    const messagesOpenState = useState(!!initial.messagesOpen);
    const messagesOpen = messagesOpenState[0];
    const setMessagesOpen = messagesOpenState[1];
    const messagesTargetState = useState(initial.messagesTarget || null);
    const messagesTarget = messagesTargetState[0];
    const setMessagesTarget = messagesTargetState[1];
    // Bumped by a question notification, so the card scrolls into view even
    // when its signal was already the selected one.
    const focusQuestionState = useState(0);
    const focusQuestion = focusQuestionState[0];
    const setFocusQuestion = focusQuestionState[1];
    const archivingState = useState(null);
    const archivingId = archivingState[0];
    const setArchivingId = archivingState[1];
    const unreadState = useState(false);
    const hasUnread = unreadState[0];
    const setHasUnread = unreadState[1];
    const inlineHdrState = useState(false);
    const inlineHdr = inlineHdrState[0];
    const setInlineHdr = inlineHdrState[1];
    // Auth gate: "checking" until /auth/status resolves, then "needsLogin"
    // (browser sign-in) or "authed" (load the dashboard).
    const authState = useState("checking");
    const auth = authState[0];
    const setAuth = authState[1];
    const loadRef = useRef(null);
    const loadIntentDetailRef = useRef(null);
    const selectedIdRef = useRef(selectedId);
    selectedIdRef.current = selectedId;
    const headerCtlRef = useRef(null);
    const toggleProfileRef = useRef(null);
    const openMessagesRef = useRef(null);
    const focusAppliedRef = useRef(null);

    function loadNetworks() {
      fetchPluginJSON(API + "/networks/home")
        .then(function (payload) {
          if (!payload || payload.success === false) return;
          setNetworks(payload.networks || { items: [], count: 0, discover: [] });
        })
        .catch(function () { /* noop */ });
    }

    function mergeIntentDetail(baseIntent, detail) {
      if (!baseIntent) return null;
      const opps = (detail && detail.opportunities) || [];
      const statusCounts = statusCountsFromOpportunities(opps);
      return Object.assign({}, baseIntent, {
        opportunities: opps,
        opportunityCount: statusCounts.pending || 0,
        totalOpportunityCount: opps.length,
        statusCounts: statusCounts,
      });
    }

    function loadIntentDetail(intentId, passive) {
      if (!intentId) return Promise.resolve();
      if (!passive) setRadarLoading(true);
      const seq = Date.now();
      const radarPath = API + "/intents/" + encodeURIComponent(intentId) + "/radar";

      function mergeDetail(patch) {
        if (selectedIdRef.current !== intentId) return;
        setIntentDetails(function (prev) {
          const existing = prev[intentId] || {};
          return Object.assign({}, prev, {
            [intentId]: Object.assign({}, existing, patch, { _seq: seq }),
          });
        });
      }

      const skeletonPromise = passive
        ? Promise.resolve(null)
        : fetchPluginJSON(radarPath + "?presentation=skeleton")
            .then(function (skeleton) {
              if (selectedIdRef.current !== intentId) return;
              if (skeleton && skeleton.success !== false && Array.isArray(skeleton.items)) {
                mergeDetail({ opportunities: skeleton.items });
              }
            })
            .catch(function () { return null; });

      const radarPromise = fetchPluginJSON(radarPath)
        .then(function (radarPayload) {
          if (selectedIdRef.current !== intentId) return;
          const opportunities = (radarPayload && radarPayload.items) || [];
          mergeDetail({ opportunities: opportunities });
        })
        .catch(function () { /* keep prior detail on failure */ })
        .finally(function () {
          if (selectedIdRef.current === intentId && !passive) setRadarLoading(false);
        });

      return Promise.all([skeletonPromise, radarPromise]);
    }

    function load() {
      setLoading(true);
      setError(null);
      if (!SDK.fetchJSON && !window.fetch) {
        setError("This Hermes dashboard host does not expose authenticated plugin fetches.");
        setLoading(false);
        return Promise.resolve();
      }
      return fetchPluginJSON(API + "/bootstrap")
        .then(function (payload) {
          if (!payload || payload.success === false) {
            throw new Error((payload && payload.error) || "Index dashboard data could not be loaded.");
          }
          setSummary(payload);
          setNeedsOnboarding(!!(payload.onboarding && payload.onboarding.needsProfileConfirm));
        })
        .catch(function (err) {
          setError(err && err.message ? err.message : String(err));
        })
        .finally(function () {
          setLoading(false);
        });
    }

    // Any conversation with a message newer than its stored read marker means
    // there's an unread message → show the notification dot on the header icon.
    function refreshUnread() {
      fetchPluginJSON(API + "/conversations")
        .then(function (payload) {
          const convs = (payload && payload.conversations) || [];
          let readMap = {};
          try { readMap = JSON.parse(window.localStorage.getItem("index_msg_read") || "{}") || {}; } catch (e) { readMap = {}; }
          const unread = convs.some(function (c) {
            return !!c.lastMessageAt && c.lastMessageAt > (readMap[c.id] || "");
          });
          setHasUnread(unread);
        })
        .catch(function () { /* noop */ });
    }

    useEffect(function () {
      if (auth !== "authed") return undefined;
      refreshUnread();
      const id = setInterval(refreshUnread, 30000);
      return function () { clearInterval(id); };
    }, [auth]);

    // Re-check when the messages panel closes (reading there updates the map).
    useEffect(function () {
      if (auth === "authed" && !messagesOpen) refreshUnread();
    }, [messagesOpen, auth]);

    useEffect(function () {
      const ctl = headerCtlRef.current;
      if (!ctl || !ctl.messages) return;
      ctl.messages.classList.toggle("index-dashboard__hdr-account--dot", !!hasUnread);
    }, [hasUnread]);

    // Open (or resolve) the in-dashboard DM for an opportunity via the same
    // start-chat endpoint the Mac app uses; the backend resolves the counterpart.
    function openOpportunityChat(opportunity) {
      const opportunityId = opportunity && opportunity.opportunityId;
      if (!opportunityId) return;
      const body = {};
      if (opportunity.intentScopeId) { body.scopeType = "intent"; body.scopeId = opportunity.intentScopeId; }
      setActingId(opportunityId);
      setActionError(null);
      fetchPluginJSON(API + "/opportunities/" + encodeURIComponent(opportunityId) + "/start-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
        .then(function (payload) {
          if (!payload || payload.success === false || !payload.conversationId) {
            throw new Error((payload && payload.error) || "That chat could not be opened.");
          }
          setMessagesTarget(payload.conversationId);
          setMessagesOpen(true);
        })
        .catch(function (err) { setActionError(err && err.message ? err.message : String(err)); })
        .finally(function () { setActingId(null); });
    }

    function opportunityAction(opportunity, action, onPayload) {
      const opportunityId = opportunity && opportunity.opportunityId;
      if (!opportunityId) return;
      const body = {};
      if (opportunity.intentScopeId) { body.scopeType = "intent"; body.scopeId = opportunity.intentScopeId; }
      setActingId(opportunityId);
      setActionError(null);
      fetchPluginJSON(API + "/opportunities/" + encodeURIComponent(opportunityId) + "/" + action, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
        .then(function (payload) {
          if (!payload || payload.success === false) {
            throw new Error((payload && payload.error) || "That action could not be completed.");
          }
          if (onPayload) onPayload(payload);
          load().then(function () {
            if (selectedIdRef.current) loadIntentDetail(selectedIdRef.current, true);
          });
        })
        .catch(function (err) {
          setActionError(err && err.message ? err.message : String(err));
        })
        .finally(function () {
          setActingId(null);
        });
    }

    function acceptOpportunity(opportunity) {
      opportunityAction(opportunity, "accept", function () {
        openOpportunityChat(opportunity);
      });
    }

    function skipOpportunity(opportunity) {
      opportunityAction(opportunity, "skip");
    }

    function startChatWithOpportunity(opportunity) {
      openOpportunityChat(opportunity);
    }

    // Optimistic lifecycle flip: rewrite the intent's lifecycleStatus and the
    // derived row status in place (same derivation the plugin API uses), so the
    // pause button, badge and list tag react instantly; load() reconciles order.
    function applyIntentLifecycle(intentId, lifecycle) {
      setSummary(function (prev) {
        if (!prev || !Array.isArray(prev.intents)) return prev;
        return Object.assign({}, prev, {
          intents: prev.intents.map(function (intent) {
            if (intent.id !== intentId) return intent;
            const counts = intent.statusCounts || {};
            const status = lifecycle === "PAUSED" ? "paused"
              : counts.accepted ? "matched"
                : counts.negotiating ? "negotiating" : "live";
            return Object.assign({}, intent, { lifecycleStatus: lifecycle, status: status });
          }),
        });
      });
    }

    function togglePauseIntent(intentId, paused) {
      if (!intentId) return;
      setActionError(null);
      applyIntentLifecycle(intentId, paused ? "ACTIVE" : "PAUSED");
      fetchPluginJSON(API + "/intents/" + encodeURIComponent(intentId) + "/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: paused ? "ACTIVE" : "PAUSED" }),
      })
        .then(function (payload) {
          if (!payload || payload.success === false) {
            throw new Error((payload && payload.error) || "Intent status could not be updated.");
          }
          load();
        })
        .catch(function (err) {
          applyIntentLifecycle(intentId, paused ? "PAUSED" : "ACTIVE");
          setActionError(err && err.message ? err.message : String(err));
        });
    }

    // No confirm dialog here: the archive segment in IntentDetail arms on the
    // first click and only calls this on the confirming second click.
    function archiveIntent(intentId) {
      if (!intentId) return;
      setArchivingId(intentId);
      setActionError(null);
      fetchPluginJSON(API + "/intents/" + encodeURIComponent(intentId) + "/archive", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
        .then(function (payload) {
          if (!payload || payload.success === false) {
            throw new Error((payload && payload.error) || "Intent could not be archived.");
          }
          goBack();
          load();
        })
        .catch(function (err) {
          setActionError(err && err.message ? err.message : String(err));
        })
        .finally(function () {
          setArchivingId(null);
        });
    }

    function joinNetwork(networkId) {
      if (!networkId) return;
      setJoiningId(networkId);
      setActionError(null);
      fetchPluginJSON(API + "/networks/" + encodeURIComponent(networkId) + "/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
        .then(function (payload) {
          if (!payload || payload.success === false) {
            throw new Error((payload && payload.error) || "Could not join that network.");
          }
          loadNetworks();
        })
        .catch(function (err) {
          setActionError(err && err.message ? err.message : String(err));
        })
        .finally(function () {
          setJoiningId(null);
        });
    }

    function loadNetworkRequests() {
      fetchPluginJSON(API + "/network-requests")
        .then(function (payload) {
          if (!payload || payload.success === false) return;
          setNetworkRequests(Array.isArray(payload.requests) ? payload.requests : []);
        })
        .catch(function () {});
    }

    // Submit or resubmit a network request; resolves the request so the modal
    // can show its confirmation. `editingRequest` selects create vs update.
    function submitNetworkRequest(input) {
      const editing = editingRequest;
      const path = editing
        ? API + "/network-requests/" + encodeURIComponent(editing.id)
        : API + "/network-requests";
      return fetchPluginJSON(path, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      }).then(function (payload) {
        if (!payload || payload.success === false) {
          throw new Error((payload && payload.error) || "Your request could not be submitted.");
        }
        loadNetworkRequests();
        return payload.request || { title: input.name };
      });
    }

    function dismissNetworkRequest(id) {
      if (!id) return;
      setNetworkRequests(function (prev) { return (prev || []).filter(function (r) { return r.id !== id; }); });
      fetchPluginJSON(API + "/network-requests/" + encodeURIComponent(id), { method: "DELETE" })
        .then(function () { loadNetworkRequests(); })
        .catch(function () {});
    }

    function openCreate() { setEditingRequest(null); setCreateOpen(true); }
    function editNetworkRequest(req) { setEditingRequest(req); setCreateOpen(true); }
    function closeCreate() { setCreateOpen(false); setEditingRequest(null); }

    loadRef.current = load;
    loadIntentDetailRef.current = loadIntentDetail;

    function enterDashboard() {
      setAuth("authed");
      load();
      loadNetworks();
      loadNetworkRequests();
      if (initial.intentId) loadIntentDetail(initial.intentId);
    }

    function checkAuth() {
      fetchPluginJSON(API + "/auth/status")
        .then(function (payload) {
          if (payload && payload.needsLogin) {
            setAuth("needsLogin");
            setLoading(false);
          } else {
            enterDashboard();
          }
        })
        .catch(function () {
          // Status uncertainty never admits the dashboard.
          setAuth("needsLogin");
          setLoading(false);
        });
    }

    function signOut() {
      setProfileOpen(false);
      fetchPluginJSON(API + "/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }).then(function () {
        setSummary(null);
        setNeedsOnboarding(false);
        setAuth("needsLogin");
      }).catch(function () {
        setSummary(null);
        setNeedsOnboarding(false);
        setAuth("needsLogin");
      });
    }

    useEffect(function () {
      checkAuth();
    }, []);

    useEffect(function () {
      if (auth !== "authed" || !selectedId) return undefined;
      loadIntentDetail(selectedId);
      return undefined;
    }, [auth, selectedId]);

    useEffect(function () {
      const header = document.querySelector('header[role="banner"]');
      if (!header) {
        setInlineHdr(true);
        return undefined;
      }
      const container = header.querySelector("div") || header;

      const wrap = document.createElement("div");
      wrap.className = "index-dashboard__hdr";

      const label = document.createElement("span");
      label.className = "index-dashboard__hdr-label";
      label.textContent = "AUTO-REFRESH";

      const sw = document.createElement("button");
      sw.type = "button";
      sw.className = "index-dashboard__switch";
      sw.setAttribute("role", "switch");
      sw.setAttribute("aria-label", "Auto-refresh");
      sw.appendChild(document.createElement("span")).className = "index-dashboard__switch-knob";
      const onToggle = function () {
        setAutoRefresh(function (v) { return !v; });
      };
      sw.addEventListener("click", onToggle);

      const refresh = document.createElement("button");
      refresh.type = "button";
      refresh.className = "index-dashboard__header-refresh";
      refresh.setAttribute("aria-label", "Refresh");
      refresh.title = "Refresh";
      refresh.innerHTML = REFRESH_ICON_SVG;
      const onRefresh = function () {
        if (loadRef.current) loadRef.current();
      };
      refresh.addEventListener("click", onRefresh);

      const messages = document.createElement("button");
      messages.type = "button";
      messages.className = "index-dashboard__hdr-account";
      messages.setAttribute("aria-label", "Messages");
      messages.title = "Messages";
      messages.innerHTML = MESSAGES_ICON_SVG;
      const onMessages = function () {
        if (openMessagesRef.current) openMessagesRef.current(null);
      };
      messages.addEventListener("click", onMessages);

      const account = document.createElement("button");
      account.type = "button";
      account.className = "index-dashboard__hdr-account";
      account.setAttribute("aria-label", "Profile & settings");
      account.title = "Profile & settings";
      account.innerHTML = ACCOUNT_ICON_SVG;
      const onAccount = function () {
        if (toggleProfileRef.current) toggleProfileRef.current();
      };
      account.addEventListener("click", onAccount);

      wrap.appendChild(label);
      wrap.appendChild(sw);
      wrap.appendChild(refresh);
      wrap.appendChild(messages);
      wrap.appendChild(account);
      container.appendChild(wrap);
      headerCtlRef.current = { sw: sw, refresh: refresh, account: account, messages: messages };

      return function () {
        sw.removeEventListener("click", onToggle);
        refresh.removeEventListener("click", onRefresh);
        messages.removeEventListener("click", onMessages);
        account.removeEventListener("click", onAccount);
        wrap.remove();
        headerCtlRef.current = null;
      };
    }, []);

    useEffect(function () {
      const ctl = headerCtlRef.current;
      if (!ctl) return;
      ctl.sw.setAttribute("aria-checked", autoRefresh ? "true" : "false");
      ctl.sw.classList.toggle("index-dashboard__switch--on", autoRefresh);
      ctl.refresh.style.display = autoRefresh ? "none" : "inline-flex";
      ctl.refresh.disabled = loading;
      if (loading) ctl.refresh.setAttribute("data-busy", "true");
      else ctl.refresh.removeAttribute("data-busy");
    }, [autoRefresh, loading]);

    useEffect(function () {
      // Only poll once signed in: firing bootstrap while the login gate (or the
      // initial auth check) is showing produces 401s that can land after the
      // login transition and clobber the fresh state, forcing a manual reload.
      if (!autoRefresh || auth !== "authed") return undefined;
      const id = setInterval(function () {
        if (loadRef.current) {
          loadRef.current().then(function () {
            if (selectedIdRef.current && loadIntentDetailRef.current) {
              loadIntentDetailRef.current(selectedIdRef.current, true);
            }
          });
        }
      }, 5000);
      return function () { clearInterval(id); };
    }, [autoRefresh, auth]);

    useEffect(function () {
      function applyView() {
        const view = parseView();
        setSelectedId(view.intentId);
        setMessagesOpen(view.messagesOpen);
        setMessagesTarget(view.messagesTarget);
        setProfileOpen(view.profileOpen);
        setViewUserId(view.viewUserId);
      }
      window.addEventListener("hashchange", applyView);
      window.addEventListener("popstate", applyView);
      return function () {
        window.removeEventListener("hashchange", applyView);
        window.removeEventListener("popstate", applyView);
      };
    }, []);

    useEffect(function () {
      writeView({
        intentId: selectedId,
        profileOpen: profileOpen,
        viewUserId: viewUserId,
        messagesOpen: messagesOpen,
        messagesTarget: messagesTarget,
      });
    }, [selectedId, profileOpen, viewUserId, messagesOpen, messagesTarget]);

    // A notification tap re-enters this page with its target on the URL. An
    // opportunity or a conversation opens as a panel over whatever was already
    // selected; only a question changes the selection, because it is answered
    // in its own signal and nowhere else.
    useEffect(function () {
      if (auth !== "authed") return undefined;
      function applyFocus() {
        const target = parseFocusTarget();
        if (!target) return;
        // The target stays on the URL after it is applied, so every later
        // navigation would otherwise re-open a panel the user has closed.
        const key = target.kind + ":" + target.id;
        if (focusAppliedRef.current === key) return;
        focusAppliedRef.current = key;
        if (target.kind === "opportunity") {
          fetchPluginJSON(API + "/opportunities/" + encodeURIComponent(target.id) + "/counterpart")
            .then(function (payload) {
              if (payload && payload.success !== false && payload.userId) setViewUserId(payload.userId);
            })
            .catch(function () { /* the page is open, which is most of the ask */ });
        } else if (target.kind === "conversation") {
          setMessagesTarget(target.id);
          setMessagesOpen(true);
        } else {
          setSelectedId(target.id);
          writeHash(target.id);
          if (selectedIdRef.current !== target.id) {
            setFocusQuestion(function (n) { return n + 1; });
          }
        }
      }
      applyFocus();
      window.addEventListener("hashchange", applyFocus);
      window.addEventListener("popstate", applyFocus);
      return function () {
        window.removeEventListener("hashchange", applyFocus);
        window.removeEventListener("popstate", applyFocus);
      };
    }, [auth]);

    const intents = (summary && summary.intents) || [];

    function selectIntent(id) {
      setSelectedId(id);
      writeHash(id);
    }

    toggleProfileRef.current = function () { setProfileOpen(function (open) { return !open; }); };
    openMessagesRef.current = function (conversationId) {
      setMessagesTarget(conversationId || null);
      setMessagesOpen(true);
    };

    function openUser(userId) {
      if (userId) setViewUserId(userId);
    }

    function goBack() {
      setSelectedId(null);
      writeHash(null);
    }

    const selectedIntent = selectedId
      ? mergeIntentDetail(
        intents.filter(function (intent) { return intent.id === selectedId; })[0],
        intentDetails[selectedId],
      )
      : null;

    // Open the new signal at once: put its row in the list the detail page
    // reads from, then let the reload bring the server's version.
    function finishNewSignal(intentId, description) {
      setNewSignalOpen(false);
      if (!intentId) { load(); return; }
      setSummary(function (prev) {
        if (!prev) return prev;
        const rest = (prev.intents || []).filter(function (intent) { return intent.id !== intentId; });
        const row = { id: intentId, title: description, lifecycleStatus: "ACTIVE", status: "live", pendingCount: 0 };
        return Object.assign({}, prev, { intents: [row].concat(rest) });
      });
      selectIntent(intentId);
      load();
    }

    const intentsView = selectedIntent
      ? React.createElement(IntentDetail, { key: selectedIntent.id, intent: selectedIntent, radarLoading: radarLoading, actionError: actionError, onBack: goBack, onOpenUser: openUser, onOpenNegotiation: setNegotiation, onAccept: acceptOpportunity, onSkipOpportunity: skipOpportunity, onStartChat: startChatWithOpportunity, actingId: actingId, webUrl: summary && summary.webUrl, onArchive: archiveIntent, archivingId: archivingId, onPause: togglePauseIntent, focusQuestion: focusQuestion })
      : React.createElement("div", { className: "index-dashboard__list-page" },
        React.createElement(IntentPitch, null),
        React.createElement("div", { className: "index-dashboard__list-cols" },
          React.createElement(Panel, {
            icon: ICON_SPARKLES(),
            title: "Intents",
            count: intents.length,
            action: React.createElement(Button, {
              type: "button", outlined: true, size: "sm",
              className: "index-dashboard__net-create-btn",
              onClick: function () { setNewSignalOpen(true); },
            }, ICON_PLUS(), "New signal"),
          },
            React.createElement(IntentList, { intents: intents, selectedId: selectedId, onSelect: selectIntent }),
          ),
          React.createElement("div", { className: "index-dashboard__list-side" },
            React.createElement(NetworksMini, {
              networks: networks,
              requests: networkRequests,
              webUrl: summary && summary.webUrl,
              apiUrl: summary && summary.apiUrl,
              currentUserId: summary && summary.currentUserId,
              onCreate: openCreate,
              onJoin: joinNetwork,
              joiningId: joiningId,
              onEditRequest: editNetworkRequest,
              onDismissRequest: dismissNetworkRequest,
              onOpenUser: openUser,
              onSelectIntent: selectIntent,
              onNetworkUpdated: function (merged) {
                if (!merged || !merged.id) return;
                setNetworks(function (prev) {
                  if (!prev || !Array.isArray(prev.items)) return prev;
                  return Object.assign({}, prev, {
                    items: prev.items.map(function (n) {
                      return n && n.id === merged.id ? Object.assign({}, n, merged) : n;
                    }),
                  });
                });
              },
              onNetworkRemoved: function (net) {
                if (!net || !net.id) return;
                setNetworks(function (prev) {
                  if (!prev || !Array.isArray(prev.items)) return prev;
                  const items = prev.items.filter(function (n) { return !n || n.id !== net.id; });
                  return Object.assign({}, prev, { items: items, count: items.length });
                });
              },
            }),
            summary && summary.currentUserId
              ? React.createElement(NegotiationStream, { userId: summary.currentUserId })
              : null,
          ),
        ),
      );

    return React.createElement("div", { className: "index-dashboard", ref: rootRef, "data-scheme": scheme },
      inlineHdr
        ? React.createElement(InlineHeaderControls, {
          autoRefresh: autoRefresh,
          loading: loading,
          hasUnread: hasUnread,
          onToggle: function () { setAutoRefresh(function (v) { return !v; }); },
          onRefresh: function () { if (loadRef.current) loadRef.current(); },
          onMessages: function () { if (openMessagesRef.current) openMessagesRef.current(null); },
          onAccount: function () { if (toggleProfileRef.current) toggleProfileRef.current(); },
        })
        : null,
      negotiation
        ? React.createElement(NegotiationModal, {
          opportunity: negotiation,
          onClose: function () { setNegotiation(null); },
        })
        : null,
      viewUserId
        ? React.createElement(ProfilePanel, { userId: viewUserId, readOnly: true, onClose: function () { setViewUserId(null); } })
        : (profileOpen ? React.createElement(ProfilePanel, { onClose: function () { setProfileOpen(false); }, onSignOut: signOut }) : null),
      messagesOpen
        ? React.createElement(MessagesPanel, { initialConversationId: messagesTarget, onClose: function () { setMessagesOpen(false); setMessagesTarget(null); } })
        : null,
      newSignalOpen
        ? React.createElement(NewSignalModal, { onDone: finishNewSignal, onClose: function () { setNewSignalOpen(false); } })
        : null,
      createOpen
        ? React.createElement(NetworkCreateModal, { initial: editingRequest, onSubmit: submitNetworkRequest, onClose: closeCreate })
        : null,
      error
        ? React.createElement("div", { className: "index-dashboard__error" }, error)
        : null,

      auth === "needsLogin"
        ? React.createElement(LoginScreen, { onAuthed: enterDashboard })
        : (auth === "checking"
          ? React.createElement("div", { className: "index-dashboard__loading index-dashboard__loading--hero" },
            LOADING_IMAGE()
              ? React.createElement("img", { className: "index-dashboard__loading-anim", src: LOADING_IMAGE(), alt: "Loading", loading: "eager" })
              : React.createElement("span", { className: "index-dashboard__loading-text" }, "Loading…"),
          )
          : (needsOnboarding
            ? React.createElement(ProfilePanel, {
              gettingStarted: true,
              onConfirmed: function () {
                setNeedsOnboarding(false);
                load();
              },
            })
            : (loading && !summary
              ? React.createElement("div", { className: "index-dashboard__loading index-dashboard__loading--hero" },
                LOADING_IMAGE()
                  ? React.createElement("img", { className: "index-dashboard__loading-anim", src: LOADING_IMAGE(), alt: "Loading", loading: "eager" })
                  : React.createElement("span", { className: "index-dashboard__loading-text" }, "Loading…"),
              )
              : React.createElement("div", { className: "index-dashboard__body" }, intentsView)))),
    );
  }

  if (DESKTOP_ENV) {
    // The separately installed Desktop copy is gated by register(ctx), which
    // removes it in restricted mode. Preserve its synchronous component seam.
    DESKTOP_ENV.onComponent(IndexNetworkDashboard);
  } else {
    // Web dashboard discovery is independent of Python register(ctx). Confirm
    // the separately mounted, full-only backend before activating this host
    // component. Restricted/unknown modes export no routes, so /mode is
    // unavailable and the web bundle deliberately registers nothing.
    fetchPluginJSON(API + "/mode")
      .then(function (payload) {
        if (!payload || payload.success !== true || payload.mode !== "full") return;
        window.__HERMES_PLUGINS__.register("index-network", IndexNetworkDashboard);
      })
      .catch(function () { /* Restricted mode or unavailable backend: stay inert. */ });
  }
})();
