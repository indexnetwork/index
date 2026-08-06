/**
 * Index Network Hermes dashboard.
 *
 * Intent-centric layout: each intent owns its pending questions and
 * its opportunities ("radar"), in a master-detail view. The selected intent
 * is mirrored into the URL hash so browser Back/Forward navigate between
 * intents. Data loads through the plugin backend, which reuses native Hermes
 * tool handlers so INDEX_API_KEY scoping and protocol visibility rules stay
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
  const SOCIAL_FIELDS = [["twitter", "x.com/"], ["linkedin", "linkedin.com/in/"], ["github", "github.com/"], ["telegram", "t.me/"]];
  const FIXED_SOCIAL_LABELS = ["twitter", "linkedin", "github", "telegram"];

  function fetchPluginJSON(path, options) {
    if (SDK.fetchJSON) {
      return SDK.fetchJSON(path, options);
    }
    return window.fetch(path, options).then(function (response) {
      return response.json();
    });
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
  function InlineHeaderControls(props) {
    return React.createElement("div", { className: "index-dashboard__hdr index-dashboard__hdr--inline" },
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

  function parseHash() {
    // The desktop app owns window.location.hash (its router routes on it) —
    // keep intent selection purely in component state there.
    if (DESKTOP_ENV) return { intentId: null };
    const raw = (window.location.hash || "").replace(/^#/, "");
    const params = {};
    raw.split("&").forEach(function (pair) {
      if (!pair) return;
      const idx = pair.indexOf("=");
      const key = idx >= 0 ? pair.slice(0, idx) : pair;
      params[key] = idx >= 0 ? decodeURIComponent(pair.slice(idx + 1)) : "";
    });
    if (params.intent) return { intentId: params.intent };
    return { intentId: null };
  }

  function writeHash(intentId) {
    if (DESKTOP_ENV) return;
    const target = intentId ? "#intent=" + encodeURIComponent(intentId) : "";
    if ((window.location.hash || "") !== target) {
      window.location.hash = target;
    }
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

  function letterFor(index) {
    return String.fromCharCode(65 + index);
  }

  function OptionRow(props) {
    const className = props.selected ? "index-dashboard__qopt index-dashboard__qopt--selected" : "index-dashboard__qopt";
    return React.createElement("button", { type: "button", className: className, onClick: props.onToggle },
      React.createElement("span", { className: "index-dashboard__qletter", "aria-hidden": "true" }, props.letter),
      React.createElement("span", { className: "index-dashboard__qopt-text" },
        React.createElement("span", { className: "index-dashboard__qopt-label" }, props.label),
        props.description ? React.createElement("span", { className: "index-dashboard__qopt-desc" }, " — " + props.description) : null,
      ),
    );
  }

  function QuestionCard(props) {
    const question = props.question;
    const options = Array.isArray(question.options) ? question.options : [];
    const hasOptions = options.length > 0;
    const selectedState = React.useState([]);
    const selected = selectedState[0];
    const setSelected = selectedState[1];
    const otherState = React.useState(false);
    const otherSelected = otherState[0];
    const setOtherSelected = otherState[1];
    const freeTextState = React.useState("");
    const freeText = freeTextState[0];
    const setFreeText = freeTextState[1];
    const showFreeText = otherSelected || !hasOptions;
    const canSubmit = hasOptions
      ? selected.length > 0 || (otherSelected && freeText.trim().length > 0)
      : freeText.trim().length > 0;

    function toggleOption(label) {
      setOtherSelected(false);
      setSelected(function (current) {
        if (question.multiSelect) {
          return current.indexOf(label) >= 0
            ? current.filter(function (item) { return item !== label; })
            : current.concat([label]);
        }
        return current.indexOf(label) >= 0 ? [] : [label];
      });
    }

    function toggleOther() {
      setOtherSelected(function (prev) {
        const next = !prev;
        if (next) setSelected([]);
        return next;
      });
    }

    function submit(event) {
      event.preventDefault();
      if (!canSubmit) return;
      const sendOther = otherSelected || !hasOptions;
      props.onSubmit(question, sendOther ? [] : selected, sendOther ? freeText : "");
    }

    return React.createElement("form", { className: "index-dashboard__question", onSubmit: submit },
      React.createElement("p", { className: "index-dashboard__question-prompt" }, question.prompt || question.title || "Question"),
      hasOptions
        ? React.createElement("div", { className: "index-dashboard__question-options" },
          options.map(function (option, index) {
            const label = String(option.label || "");
            return React.createElement(OptionRow, {
              key: label,
              letter: letterFor(index),
              label: label,
              description: option.description,
              selected: selected.indexOf(label) >= 0,
              onToggle: function () { toggleOption(label); },
            });
          }),
          React.createElement(OptionRow, {
            letter: letterFor(options.length),
            label: "Other…",
            description: "",
            selected: otherSelected,
            onToggle: toggleOther,
          }),
        )
        : null,
      showFreeText
        ? React.createElement("textarea", {
          className: "index-dashboard__textarea",
          onChange: function (event) { setFreeText(event.target.value); },
          placeholder: hasOptions ? "Type your own answer…" : "Write your answer…",
          rows: 3,
          value: freeText,
        })
        : null,
      React.createElement("div", { className: "index-dashboard__question-actions" },
        React.createElement(Button, { type: "button", ghost: true, size: "sm", className: "index-dashboard__btn-md", onClick: function () { props.onSkip(question); } }, "Skip"),
        React.createElement(Button, { type: "submit", size: "sm", className: "index-dashboard__btn-md", disabled: !canSubmit }, "Submit"),
      ),
    );
  }

  // Mac-app parity: an answered question stays visible as a settled record —
  // hairline frame, muted prompt, and the given answer quoted under a strong
  // rule — instead of vanishing (a dismissed one fades and keeps no quote).
  function AnsweredQuestionCard(props) {
    const record = props.record;
    const question = record.question || {};
    return React.createElement("div", {
      className: "index-dashboard__question index-dashboard__question--done"
        + (record.dismissed ? " index-dashboard__question--dismissed" : ""),
    },
      React.createElement("div", { className: "index-dashboard__qdone-status" }, record.dismissed ? "dismissed" : "✓ answered"),
      React.createElement("p", { className: "index-dashboard__question-prompt" }, question.prompt || question.title || "Question"),
      record.dismissed ? null : React.createElement("div", { className: "index-dashboard__qdone-answer" },
        React.createElement("span", { className: "index-dashboard__qdone-label" }, "you said"),
        React.createElement("span", { className: "index-dashboard__qdone-text" }, record.choice),
      ),
    );
  }

  function QuestionList(props) {
    const section = props.section || {};
    const answered = Array.isArray(props.answered) ? props.answered : [];
    const answeredIds = {};
    answered.forEach(function (record) { answeredIds[record.question.id] = true; });
    // A stale summary can still list an already-answered question as pending;
    // the local record wins so the form never resurfaces.
    const questions = (Array.isArray(section.items) ? section.items : []).filter(function (question) {
      return !answeredIds[question.id];
    });
    if (section.error) {
      return React.createElement("div", { className: "index-dashboard__error" }, section.error);
    }
    const cards = questions.map(function (question) {
      return React.createElement(QuestionCard, { key: question.id, question: question, onSubmit: props.onSubmit, onSkip: props.onSkip });
    }).concat(answered.map(function (record) {
      return React.createElement(AnsweredQuestionCard, { key: record.question.id, record: record });
    }));
    if (props.actionError) {
      return React.createElement("div", { className: "index-dashboard__stack" },
        React.createElement("div", { className: "index-dashboard__error" }, props.actionError),
        cards.length === 0 ? React.createElement(EmptyState, null, "No pending questions right now.") : null,
        cards,
      );
    }
    if (cards.length === 0) {
      return React.createElement(EmptyState, null, "No pending questions right now.");
    }
    return React.createElement("div", { className: "index-dashboard__stack" }, cards);
  }

  // Mirrors plugin_api.py _STATUS_BUCKET: raw status -> display bucket.
  // Rejected is hidden (null bucket), matching the mac app: those are mostly
  // agent-side filtering decisions, and listing them reads as user rejection.
  const STATUS_BUCKET = {
    latent: "pending",
    draft: "pending",
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

  function RadarStrip(props) {
    const counts = props.counts || {};
    return React.createElement("div", { className: "index-dashboard__radar-strip" },
      RADAR_BUCKETS.map(function (bucket) {
        return React.createElement(StatPill, {
          key: bucket.key,
          value: counts[bucket.key] || 0,
          label: bucket.label,
          active: props.selected === bucket.key,
          onSelect: props.onSelect ? function () { props.onSelect(bucket.key); } : null,
        });
      }),
    );
  }

  const OPP_RESOLVED_LABEL = { accepted: "Connected", expired: "Missed" };

  function initialsFor(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
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
        }, acting ? "Working…" : "Accept"),
        React.createElement(Button, {
          key: "pass", type: "button", ghost: true, size: "sm", className: "index-dashboard__btn-md",
          disabled: acting,
          onClick: function () { if (props.onSkip) props.onSkip(opportunity); },
        }, "Pass"),
      ];
    } else if (status === "accepted") {
      if (props.onStartChat && opportunity.counterpartUserId) {
        actionButtons = [React.createElement(Button, {
          key: "chat", type: "button", size: "sm", className: "index-dashboard__btn-md",
          disabled: acting,
          onClick: function () { props.onStartChat(opportunity); },
        }, acting ? "Working…" : "Open chat ›")];
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
          React.createElement("span", { className: "index-dashboard__avatar", "aria-hidden": "true" },
            initialsFor(opportunity.name),
            opportunity.avatar
              ? React.createElement("img", {
                className: "index-dashboard__avatar-img",
                src: opportunity.avatar,
                alt: "",
                loading: "lazy",
                onError: function (e) { e.target.style.display = "none"; },
              })
              : null,
          ),
          React.createElement("div", { className: "index-dashboard__opp-meta" },
            React.createElement("strong", { className: "index-dashboard__opp-name" }, opportunity.name || "New match"),
            React.createElement("span", { className: "index-dashboard__opp-sub" }, opportunity.subtitle || "Suggested connection"),
          ),
        ),
        // Mac-app parity: the head's right column shows the action buttons when
        // the card is actionable, otherwise the status label — never both.
        actionButtons
          ? React.createElement("div", { className: "index-dashboard__opp-btns" }, actionButtons)
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
    const className = props.selected ? "index-dashboard__intent-row index-dashboard__intent-row--selected" : "index-dashboard__intent-row";
    // Mirrors the mac app's signal rows: the beacon blinks while the signal
    // is live (real mac rows are only ever live or paused).
    const running = intent.status === "live";
    return React.createElement("button", { type: "button", className: className, onClick: function () { props.onSelect(intent.id); } },
      React.createElement("div", { className: "index-dashboard__intent-main" },
        React.createElement("span", { className: "index-dashboard__intent-title" }, intent.title || "Untitled intent"),
        intent.status
          ? React.createElement(BadgeText, { tone: statusTone(intent.status) },
            running ? React.createElement("span", { className: "index-dashboard__live-dot" }) : null,
            intent.status,
          )
          : null,
      ),
      React.createElement("div", { className: "index-dashboard__intent-counts" },
        PendingBadge(intent.pendingCount),
      ),
    );
  }

  // One consolidated, unlabeled number per row: pending questions + awaiting
  // opportunities. Every surface (Hermes web/desktop, mac app) shows this same
  // sum so counts stay consistent.
  function PendingBadge(count) {
    if (!count) return null;
    return React.createElement(BadgeText, null, formatCount(count));
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
          "meet the person your agent is already looking for.",
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

  // Faithful re-implementation of boring-avatars' "bauhaus" variant + default
  // palette, so dashboard network avatars match the Index web app exactly.
  const BORING_PALETTE = ["#92A1C6", "#146A7C", "#F0AB3D", "#C271B4", "#C20D90"];

  function baHash(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = (hash << 5) - hash + name.charCodeAt(i);
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

  function NetworkMiniRow(props) {
    const network = props.network;
    const count = typeof network.memberCount === "number" ? network.memberCount : null;
    const isOwner = network.role === "owner";
    return React.createElement("div", { className: "index-dashboard__net-row" },
      React.createElement("span", { className: "index-dashboard__net-avatar", "aria-hidden": "true" },
        network.imageUrl
          ? React.createElement("img", { className: "index-dashboard__net-avatar-img", src: network.imageUrl, alt: "", loading: "lazy" })
          : React.createElement(BoringAvatar, { seed: network.id || network.title }),
      ),
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
      React.createElement("span", { className: "index-dashboard__net-avatar", "aria-hidden": "true" },
        network.imageUrl
          ? React.createElement("img", { className: "index-dashboard__net-avatar-img", src: network.imageUrl, alt: "", loading: "lazy" })
          : React.createElement(BoringAvatar, { seed: network.id || network.title }),
      ),
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
          : React.createElement(NetworkMiniRow, { key: network.id || String(index), network: network });
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
      React.createElement("span", { className: "index-dashboard__net-avatar", "aria-hidden": "true" },
        React.createElement(BoringAvatar, { seed: req.id || req.title }),
      ),
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

  // Early-access "request a network" form body (no chrome of its own — it lives
  // inside the Manage modal's Request tab). Submits to /network-requests
  // (reviewed) rather than creating a live network, and ends on a confirmation.
  // `initial` (a needs-changes request) switches it into resubmit mode.
  function RequestNetworkForm(props) {
    const useState = React.useState;
    const initial = props.initial || null;
    const nameState = useState(initial ? (initial.title || "") : "");
    const name = nameState[0]; const setName = nameState[1];
    const purposeState = useState(initial ? (initial.purpose || "") : "");
    const purpose = purposeState[0]; const setPurpose = purposeState[1];
    const sizeState = useState(initial ? (initial.expectedSize || "") : "");
    const size = sizeState[0]; const setSize = sizeState[1];
    const notesState = useState(initial ? (initial.notes || "") : "");
    const notes = notesState[0]; const setNotes = notesState[1];
    const sendingState = useState(false);
    const sending = sendingState[0]; const setSending = sendingState[1];
    const errState = useState(null);
    const err = errState[0]; const setErr = errState[1];
    const doneState = useState(null);
    const done = doneState[0]; const setDone = doneState[1];

    const trimmed = (name || "").trim();
    const canSend = trimmed.length > 0 && !sending;
    const isEdit = !!initial;

    function submit() {
      if (!canSend) return;
      setSending(true);
      setErr(null);
      Promise.resolve(props.onSubmit({
        name: trimmed,
        purpose: (purpose || "").trim() || undefined,
        expectedSize: size || undefined,
        notes: (notes || "").trim() || undefined,
      }))
        .then(function (req) { setDone(req || { title: trimmed }); })
        .catch(function (e) { setErr(e && e.message ? e.message : String(e)); })
        .finally(function () { setSending(false); });
    }

    if (done) {
      return React.createElement("div", { className: "index-dashboard__profile-section" },
        React.createElement("p", { className: "index-dashboard__net-request-note" },
          "We’re reviewing ", React.createElement("strong", null, (done && done.title) || trimmed),
          " and will get back to you shortly."),
        React.createElement("div", { className: "index-dashboard__net-request-actions" },
          React.createElement(Button, { type: "button", size: "sm", onClick: props.onClose }, "Close"),
        ),
      );
    }

    return React.createElement("div", { className: "index-dashboard__profile-section" },
      React.createElement("p", { className: "index-dashboard__net-request-intro" },
        "Network creation is still early. Tell us what you’re hoping to build and we’ll get back to you."),
      React.createElement(ProfileField, { label: "Network name" },
        React.createElement("input", { className: "index-dashboard__profile-input", value: name, placeholder: "e.g. Edge City", onChange: function (e) { setName(e.target.value); } }),
      ),
      React.createElement(ProfileField, { label: "What are you hoping to build?" },
        React.createElement("textarea", { className: "index-dashboard__textarea", rows: 3, value: purpose, placeholder: "Who is it for, who do you expect to join, and what should people or agents be able to discover through it?", onChange: function (e) { setPurpose(e.target.value); } }),
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
      React.createElement(ProfileField, { label: "Anything else we should know?", hint: "Optional" },
        React.createElement("textarea", { className: "index-dashboard__textarea", rows: 2, value: notes, placeholder: "Links, timing, context, or what you’d like to experiment with.", onChange: function (e) { setNotes(e.target.value); } }),
      ),
      err ? React.createElement("div", { className: "index-dashboard__error" }, err) : null,
      React.createElement("div", { className: "index-dashboard__net-request-actions" },
        React.createElement(Button, { type: "button", outlined: true, size: "sm", onClick: props.onClose }, "Cancel"),
        React.createElement(Button, { type: "button", size: "sm", disabled: !canSend, onClick: submit }, sending ? "Sending…" : (isEdit ? "Resubmit" : "Create network")),
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

  // Networks card: "My networks" / "Discover" tabs on the left, a Create button
  // on the right. Create opens the (reviewed) request form as a modal.
  function NetworksMini(props) {
    const networks = props.networks || { items: [], count: 0, discover: [] };
    const items = Array.isArray(networks.items) ? networks.items : [];
    const discover = Array.isArray(networks.discover) ? networks.discover : [];
    const requests = Array.isArray(props.requests) ? props.requests : [];
    const tabState = React.useState("mine");
    const tab = tabState[0];
    const setTab = tabState[1];
    function tabButton(id, label, icon) {
      return React.createElement("button", {
        type: "button",
        className: "index-dashboard__profile-tab index-dashboard__net-tab" + (tab === id ? " index-dashboard__profile-tab--active" : ""),
        onClick: function () { setTab(id); },
      }, icon || null, React.createElement("span", null, label));
    }
    return React.createElement("section", { className: "index-dashboard__net-card" },
      React.createElement("div", { className: "index-dashboard__net-head" },
        React.createElement("div", { className: "index-dashboard__profile-tabs index-dashboard__net-tabs" },
          tabButton("mine", "My networks (" + formatCount(networks.count || items.length) + ")"),
          tabButton("discover", "Discover", ICON_GLOBE()),
        ),
        React.createElement("div", { className: "index-dashboard__net-head-actions" },
          React.createElement("button", { type: "button", className: "index-dashboard__net-discover-btn", onClick: function () { if (props.onCreate) props.onCreate(); } }, ICON_PLUS(), "Create"),
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
                  return React.createElement(NetworkMiniRow, { key: network.id || String(index), network: network });
                }),
              ),
        ),
    );
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

  function DetailHead(props) {
    return React.createElement("div", { className: "index-dashboard__detail-head" },
      props.onBack ? React.createElement("button", { type: "button", className: "index-dashboard__back-pill", onClick: props.onBack }, ICON_ARROW_LEFT(), "Back") : null,
      React.createElement("div", { className: "index-dashboard__detail-card" },
        React.createElement("div", { className: "index-dashboard__detail-title-row" },
          React.createElement("h2", { className: "index-dashboard__detail-title" }, props.title),
          props.actions ? React.createElement("div", { className: "flex items-center gap-1 shrink-0" }, props.actions) : null,
        ),
      props.live
        ? React.createElement("div", { className: "index-dashboard__detail-live" },
          React.createElement("span", { className: "index-dashboard__live" + (props.paused ? " index-dashboard__live--paused" : "") },
            React.createElement("span", { className: "index-dashboard__live-dot" }),
            props.paused ? "paused" : "live",
          ),
          React.createElement("span", { className: "index-dashboard__detail-live-text" }, props.paused ? "agent on hold" : "agent is looking in the background"),
        )
        : null,
      ),
    );
  }

  function IntentDetail(props) {
    const intent = props.intent;
    const bucketState = React.useState("pending");
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
        React.createElement(EmptyState, null, "Select an intent to see its questions and radar."),
      );
    }
    const paused = String(intent.lifecycleStatus || "").toLowerCase() === "paused";
    const questionSection = { items: intent.questions || [] };
    const allOpps = Array.isArray(intent.opportunities) ? intent.opportunities : [];
    const visibleOpps = allOpps.filter(function (opp) {
      return bucketForStatus(opp.status) === selectedBucket;
    });
    const radarEmpty = "No matches here yet.";
    return React.createElement("div", { className: "index-dashboard__detail" },
      React.createElement(DetailHead, {
        title: intent.title || "Untitled intent",
        live: true,
        paused: paused,
        onBack: props.onBack,
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
      }),
      React.createElement("div", { className: "index-dashboard__detail-cols" },
      React.createElement(Panel, { primary: true, title: "Questions", count: intent.questionCount, description: "Answer pending follow-ups for this intent." },
        React.createElement(QuestionList, { section: questionSection, answered: props.answered, actionError: props.actionError, onSubmit: props.onSubmit, onSkip: props.onSkip }),
      ),
        React.createElement(Panel, { title: "Radar", count: allOpps.length, titleAfter: RADAR_EYE(), description: "People the network surfaced for this intent." },
          React.createElement(RadarStrip, { counts: intent.statusCounts, selected: selectedBucket, onSelect: setSelectedBucket }),
          React.createElement(RadarList, { items: visibleOpps, empty: radarEmpty, onOpenUser: props.onOpenUser, onAccept: props.onAccept, onSkip: props.onSkipOpportunity, onStartChat: props.onStartChat, actingId: props.actingId, webUrl: props.webUrl }),
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
    const value = String(raw || "").trim();
    if (/^https?:\/\//i.test(value)) return value;
    const handle = value.replace(/^@/, "");
    if (label === "twitter") return "https://x.com/" + handle;
    if (label === "linkedin") return "https://linkedin.com/in/" + handle;
    if (label === "github") return "https://github.com/" + handle;
    if (label === "telegram") return "https://t.me/" + handle;
    return value.indexOf("http") === 0 ? value : "https://" + value;
  }

  function ProfileField(props) {
    return React.createElement("label", { className: "index-dashboard__profile-field" },
      React.createElement("span", { className: "index-dashboard__profile-label" }, props.label),
      props.children,
      props.hint ? React.createElement("span", { className: "index-dashboard__profile-hint" }, props.hint) : null,
    );
  }

  function ProfilePanel(props) {
    const useState = React.useState;
    const useEffect = React.useEffect;
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
    const generatingState = useState(false);
    const generating = generatingState[0];
    const setGenerating = generatingState[1];
    const avatarPreviewState = useState(null);
    const avatarPreview = avatarPreviewState[0];
    const setAvatarPreview = avatarPreviewState[1];

    const readOnly = !!props.readOnly;

    function load() {
      setLoading(true);
      setPanelError(null);
      fetchPluginJSON(props.userId ? API + "/profile/" + encodeURIComponent(props.userId) : API + "/profile")
        .then(function (payload) {
          if (!payload || payload.success === false) {
            throw new Error((payload && payload.error) || "Profile could not be loaded.");
          }
          const p = payload.profile || {};
          setForm({
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
          });
          setDirty(false);
        })
        .catch(function (err) {
          setPanelError(err && err.message ? err.message : String(err));
        })
        .finally(function () {
          setLoading(false);
        });
    }

    useEffect(function () { load(); }, []);

    function patchForm(patch) {
      setForm(function (prev) { return Object.assign({}, prev, patch); });
      setDirty(true);
      setNote(null);
    }

    function getSocial(label) {
      const found = (form.socials || []).filter(function (s) { return s.label === label; })[0];
      return found ? found.value : "";
    }

    function setSocial(label, value) {
      setForm(function (prev) {
        const without = (prev.socials || []).filter(function (s) { return s.label !== label; });
        const next = value ? without.concat([{ label: label, value: value }]) : without;
        return Object.assign({}, prev, { socials: next });
      });
      setDirty(true);
      setNote(null);
    }

    function customSocials() {
      return (form.socials || []).filter(function (s) { return FIXED_SOCIAL_LABELS.indexOf(s.label) < 0; });
    }

    function updateCustom(index, value) {
      setForm(function (prev) {
        let seen = -1;
        const next = (prev.socials || []).map(function (s) {
          if (FIXED_SOCIAL_LABELS.indexOf(s.label) < 0) {
            seen += 1;
            if (seen === index) return { label: "custom", value: value };
          }
          return s;
        });
        return Object.assign({}, prev, { socials: next });
      });
      setDirty(true);
      setNote(null);
    }

    function removeCustom(index) {
      setForm(function (prev) {
        let seen = -1;
        const next = (prev.socials || []).filter(function (s) {
          if (FIXED_SOCIAL_LABELS.indexOf(s.label) < 0) {
            seen += 1;
            return seen !== index;
          }
          return true;
        });
        return Object.assign({}, prev, { socials: next });
      });
      setDirty(true);
      setNote(null);
    }

    function addCustom() {
      setForm(function (prev) {
        return Object.assign({}, prev, { socials: (prev.socials || []).concat([{ label: "custom", value: "" }]) });
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
          socials: (form.socials || []).filter(function (s) { return s.value && s.value.trim(); }),
          notificationPreferences: form.notificationPreferences,
        };
        if (avatarUrl) body.avatar = avatarUrl;
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

    function generate() {
      setGenerating(true);
      setNote(null);
      setPanelError(null);
      fetchPluginJSON(API + "/profile/intro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
        .then(function (payload) {
          if (!payload || payload.success === false) {
            throw new Error((payload && payload.error) || "Intro could not be generated.");
          }
          if (typeof payload.intro === "string" && payload.intro) {
            patchForm({ intro: payload.intro });
            setNote("Intro regenerated from your Index profile.");
          } else {
            setNote("No intro was generated — add more about yourself first.");
          }
        })
        .catch(function (err) {
          setPanelError(err && err.message ? err.message : String(err));
        })
        .finally(function () {
          setGenerating(false);
        });
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
      return SOCIAL_FIELDS.map(function (pair) {
        const label = pair[0];
        const prefix = pair[1];
        return React.createElement("div", { key: label, className: "index-dashboard__profile-social" },
          React.createElement("span", { className: "index-dashboard__profile-social-prefix" }, prefix),
          React.createElement("input", {
            className: "index-dashboard__profile-input index-dashboard__profile-social-input",
            value: getSocial(label),
            onChange: function (e) { setSocial(label, e.target.value); },
          }),
        );
      }).concat(customSocials().map(function (social, index) {
        return React.createElement("div", { key: "custom-" + index, className: "index-dashboard__profile-social" },
          React.createElement("input", {
            className: "index-dashboard__profile-input index-dashboard__profile-social-input",
            value: social.value,
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
      })).concat([
        customSocials().length < 3
          ? React.createElement("button", { key: "add", type: "button", className: "index-dashboard__profile-add", onClick: addCustom }, "+ Add website")
          : null,
      ]);
    }

    function profileTab() {
      const initials = initialsFor(form.name);
      const avatarSrc = avatarPreview || form.avatar;
      return React.createElement("div", { className: "index-dashboard__profile-section" },
        React.createElement("div", { className: "index-dashboard__profile-identity" },
          React.createElement("label", { className: "index-dashboard__profile-avatar" },
            React.createElement("span", { className: "index-dashboard__avatar index-dashboard__profile-avatar-circle", "aria-hidden": "true" },
              initials,
              avatarSrc ? React.createElement("img", { className: "index-dashboard__avatar-img", src: avatarSrc, alt: "", loading: "lazy" }) : null,
            ),
            React.createElement("input", { type: "file", accept: "image/*", className: "index-dashboard__profile-avatar-input", onChange: onAvatarFile }),
          ),
          React.createElement("div", { className: "index-dashboard__profile-identity-main" },
            React.createElement("strong", { className: "index-dashboard__profile-identity-name" }, form.name || "Your name"),
            form.location ? React.createElement("span", { className: "index-dashboard__profile-identity-sub" }, form.location) : null,
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
        React.createElement(ProfileField, {
          label: "Introduction",
          hint: form.context ? "Index context: " + form.context : null,
        },
          React.createElement("div", { className: "index-dashboard__profile-intro-head" },
            React.createElement("button", { type: "button", className: "index-dashboard__profile-generate", disabled: generating, onClick: generate }, generating ? "Generating…" : (form.intro ? "Regenerate" : "Generate")),
          ),
          React.createElement("textarea", { className: "index-dashboard__textarea", rows: 4, value: form.intro, placeholder: "Tell others about yourself…", onChange: function (e) { patchForm({ intro: e.target.value }); } }),
        ),
        React.createElement(ProfileField, { label: "Socials" },
          React.createElement("div", { className: "index-dashboard__profile-socials" }, socialRows()),
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
      );
    }

    function readOnlyView() {
      const initials = initialsFor(form.name);
      const socials = (form.socials || []).filter(function (s) { return s.value && s.value.trim(); });
      return React.createElement("div", { className: "index-dashboard__profile-section" },
        React.createElement("div", { className: "index-dashboard__profile-identity" },
          React.createElement("span", { className: "index-dashboard__avatar index-dashboard__profile-avatar-circle", "aria-hidden": "true" },
            initials,
            form.avatar ? React.createElement("img", { className: "index-dashboard__avatar-img", src: form.avatar, alt: "", loading: "lazy" }) : null,
          ),
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
                return React.createElement("a", { key: String(index) + s.label, className: "index-dashboard__profile-read-social", href: socialUrl(s.label, s.value), target: "_blank", rel: "noopener noreferrer" }, s.label + ": " + s.value);
              }),
            ),
          )
          : null,
        !form.intro && !form.context && socials.length === 0
          ? React.createElement(EmptyState, null, "This person hasn't shared profile details yet.")
          : null,
      );
    }

    const title = readOnly ? ((form && form.name) || "Profile") : "Settings";

    return React.createElement("div", { className: "index-dashboard__profile-overlay", onClick: props.onClose },
      React.createElement("div", { className: "index-dashboard__profile-panel", onClick: function (e) { e.stopPropagation(); } },
        React.createElement("div", { className: "index-dashboard__profile-header" },
          React.createElement("h2", { className: "index-dashboard__profile-title" }, title),
          React.createElement("button", { type: "button", className: "index-dashboard__profile-close", "aria-label": "Close", onClick: props.onClose }, "×"),
        ),
        readOnly ? null : React.createElement("div", { className: "index-dashboard__profile-tabs" },
          tabButton("profile", "Profile Settings"),
          tabButton("notifications", "Notification Settings"),
        ),
        panelError ? React.createElement("div", { className: "index-dashboard__error" }, panelError) : null,
        loading || !form
          ? React.createElement("div", { className: "index-dashboard__loading" }, "Loading profile…")
          : React.createElement("div", { className: "index-dashboard__profile-body" },
            readOnly ? readOnlyView() : (tab === "notifications" ? notificationsTab() : profileTab()),
          ),
        (!readOnly && form)
          ? React.createElement("div", { className: "index-dashboard__profile-bar" },
            React.createElement("span", { className: "index-dashboard__profile-note" }, note || (dirty ? "You have unsaved changes" : "")),
            React.createElement("div", { className: "index-dashboard__profile-bar-actions" },
              React.createElement("button", { type: "button", className: "index-dashboard__profile-discard", disabled: saving || !dirty, onClick: load }, "Discard"),
              React.createElement(Button, { type: "button", disabled: saving || !dirty, onClick: save }, saving ? "Saving…" : "Save Changes"),
            ),
          )
          : null,
      ),
    );
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
    // dedup by message id, live conversation-summary updates, refresh-on-unknown,
    // and reconnect with exponential backoff (5s * 2^n, capped at 60s, 10 tries).
    //
    // The plugin backend relays the upstream Redis stream with its own API key.
    // We consume that relay with SDK.authedFetch (which injects the Hermes
    // dashboard session auth — the `X-Hermes-Session-Token` header in loopback
    // mode, cookies in gated mode) plus a streaming body reader, rather than a
    // raw EventSource: EventSource cannot set the session header and the host
    // does not accept a ?token= query param on plugin routes, so it would fail
    // to authenticate in the default desktop (loopback) mode.
    function applyIncoming(dataStr) {
      let data;
      try { data = JSON.parse(dataStr); } catch (e) { return; }
      if (!data || data.type !== "message" || !data.message) return;
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

      let retryTimer = null;
      let retries = 0;
      let stopped = false;
      let reader = null;

      function scheduleRetry() {
        if (stopped) return;
        retries += 1;
        if (retries > 10) return;
        const delay = Math.min(5000 * Math.pow(2, retries - 1), 60000);
        retryTimer = setTimeout(connect, delay);
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
                    if (lines[i].indexOf("data:") === 0) applyIncoming(lines[i].slice(5).trim());
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
          React.createElement("h2", { className: "index-dashboard__profile-title" }, "Messages"),
          React.createElement("button", { type: "button", className: "index-dashboard__profile-close", "aria-label": "Close", onClick: props.onClose }, "×"),
        ),
        listErr ? React.createElement("div", { className: "index-dashboard__error" }, listErr) : null,
        React.createElement("div", { className: "index-dashboard__msg-body" },
          React.createElement("div", { className: "index-dashboard__msg-list" },
            React.createElement("input", {
              type: "search",
              className: "index-dashboard__msg-search",
              placeholder: "Search conversations…",
              value: query,
              onChange: function (e) { setQuery(e.target.value); },
              "aria-label": "Search conversations",
            }),
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
                      React.createElement("span", { className: "index-dashboard__avatar index-dashboard__msg-conv-avatar", "aria-hidden": "true" },
                        initialsFor(c.counterpartName || c.title),
                        c.avatar ? React.createElement("img", { className: "index-dashboard__avatar-img", src: c.avatar, alt: "", loading: "lazy" }) : null,
                      ),
                      React.createElement("span", { className: "index-dashboard__msg-conv-main" },
                        React.createElement("span", { className: "index-dashboard__msg-conv-name" },
                          unread ? React.createElement("span", { className: "index-dashboard__msg-conv-dot", "aria-hidden": "true" }) : null,
                          c.title || "Conversation",
                          c.kind === "negotiation" ? React.createElement("span", { className: "index-dashboard__msg-conv-badge" }, "Agent") : null,
                        ),
                        c.lastMessagePreview ? React.createElement("span", { className: "index-dashboard__msg-conv-preview" }, c.lastMessagePreview) : null,
                      ),
                    );
                  }))),
          ),
          React.createElement("div", { className: "index-dashboard__msg-thread-col" },
            activeId
              ? React.createElement(React.Fragment, null,
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
                          if (m.isInternal) {
                            return React.createElement("div", { key: m.id, className: cls },
                              React.createElement("span", { className: "index-dashboard__msg-internal-label" }, "Internal assessment"),
                              React.createElement("span", null, m.text),
                            );
                          }
                          return React.createElement("div", { key: m.id, className: cls }, m.text);
                        });
                      })(),
                ),
                React.createElement("div", { className: "index-dashboard__msg-composer" },
                  React.createElement("textarea", {
                    className: "index-dashboard__textarea index-dashboard__msg-input",
                    rows: 1,
                    value: input,
                    placeholder: activeConv ? ("Message " + (activeConv.counterpartName || activeConv.title) + "…") : "Type a message…",
                    onChange: function (e) { setInput(e.target.value); },
                    onKeyDown: onComposerKey,
                  }),
                  React.createElement(Button, { type: "button", disabled: sending || !input.trim(), onClick: send }, sending ? "Sending…" : "Send"),
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
    const initial = parseHash();
    // Root node + host theme; every animated asset resolves against SCHEME.
    const rootRef = useRef(null);
    const scheme = useColorScheme(rootRef);
    SCHEME = scheme;
    const summaryState = useState(null);
    const summary = summaryState[0];
    const setSummary = summaryState[1];
    const loadingState = useState(true);
    const loading = loadingState[0];
    const setLoading = loadingState[1];
    const errorState = useState(null);
    const error = errorState[0];
    const setError = errorState[1];
    const actionErrorState = useState(null);
    const actionError = actionErrorState[0];
    const setActionError = actionErrorState[1];
    // Question id -> settled record ({ question, choice, dismissed, intentId }).
    // Session-local, like the Mac app's answered clarifiers in the feed.
    const answeredState = useState({});
    const answeredMap = answeredState[0];
    const setAnsweredMap = answeredState[1];
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
    const editingRequestState = useState(null);
    const editingRequest = editingRequestState[0];
    const setEditingRequest = editingRequestState[1];
    const selectedState = useState(initial.intentId);
    const selectedId = selectedState[0];
    const setSelectedId = selectedState[1];
    const autoState = useState(true);
    const autoRefresh = autoState[0];
    const setAutoRefresh = autoState[1];
    const profileOpenState = useState(false);
    const profileOpen = profileOpenState[0];
    const setProfileOpen = profileOpenState[1];
    const viewUserState = useState(null);
    const viewUserId = viewUserState[0];
    const setViewUserId = viewUserState[1];
    const messagesOpenState = useState(false);
    const messagesOpen = messagesOpenState[0];
    const setMessagesOpen = messagesOpenState[1];
    const messagesTargetState = useState(null);
    const messagesTarget = messagesTargetState[0];
    const setMessagesTarget = messagesTargetState[1];
    const archivingState = useState(null);
    const archivingId = archivingState[0];
    const setArchivingId = archivingState[1];
    const unreadState = useState(false);
    const hasUnread = unreadState[0];
    const setHasUnread = unreadState[1];
    const inlineHdrState = useState(false);
    const inlineHdr = inlineHdrState[0];
    const setInlineHdr = inlineHdrState[1];
    const loadRef = useRef(null);
    const headerCtlRef = useRef(null);
    const toggleProfileRef = useRef(null);
    const openMessagesRef = useRef(null);

    function load() {
      setLoading(true);
      setError(null);
      if (!SDK.fetchJSON && !window.fetch) {
        setError("This Hermes dashboard host does not expose authenticated plugin fetches.");
        setLoading(false);
        return;
      }
      fetchPluginJSON(API + "/summary")
        .then(function (payload) {
          if (!payload || payload.success === false) {
            throw new Error((payload && payload.error) || "Index dashboard data could not be loaded.");
          }
          setSummary(payload);
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
      refreshUnread();
      const id = setInterval(refreshUnread, 30000);
      return function () { clearInterval(id); };
    }, []);

    // Re-check when the messages panel closes (reading there updates the map).
    useEffect(function () {
      if (!messagesOpen) refreshUnread();
    }, [messagesOpen]);

    useEffect(function () {
      const ctl = headerCtlRef.current;
      if (!ctl || !ctl.messages) return;
      ctl.messages.classList.toggle("index-dashboard__hdr-account--dot", !!hasUnread);
    }, [hasUnread]);

    // Mac-app parity: the card flips into a settled record immediately (the
    // Mac app updates its feed before the API call returns); a failed write
    // restores the form and surfaces the error.
    function recordAnswer(question, extra) {
      setActionError(null);
      setAnsweredMap(function (prev) {
        const next = Object.assign({}, prev);
        next[question.id] = Object.assign({ question: question, intentId: selectedId }, extra);
        return next;
      });
    }

    function unrecordAnswer(questionId) {
      setAnsweredMap(function (prev) {
        const next = Object.assign({}, prev);
        delete next[questionId];
        return next;
      });
    }

    function submitQuestion(question, selectedOptions, freeText) {
      const choice = (selectedOptions && selectedOptions.length
        ? selectedOptions.join(", ")
        : String(freeText || "")).trim() || "answered";
      recordAnswer(question, { choice: choice, dismissed: false });
      fetchPluginJSON(API + "/questions/" + encodeURIComponent(question.id) + "/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedOptions: selectedOptions, freeText: freeText }),
      })
        .then(function (payload) {
          if (!payload || payload.success === false) {
            throw new Error((payload && payload.error) || "Question answer could not be saved.");
          }
          load();
        })
        .catch(function (err) {
          unrecordAnswer(question.id);
          setActionError(err && err.message ? err.message : String(err));
        });
    }

    function skipQuestion(question) {
      recordAnswer(question, { choice: "", dismissed: true });
      fetchPluginJSON(API + "/questions/" + encodeURIComponent(question.id) + "/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
        .then(function (payload) {
          if (!payload || payload.success === false) {
            throw new Error((payload && payload.error) || "Question could not be skipped.");
          }
          load();
        })
        .catch(function (err) {
          unrecordAnswer(question.id);
          setActionError(err && err.message ? err.message : String(err));
        });
    }

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

    function opportunityAction(opportunity, action, onPayload, acknowledgedIds) {
      const opportunityId = opportunity && opportunity.opportunityId;
      if (!opportunityId) return;
      const body = {};
      if (opportunity.intentScopeId) { body.scopeType = "intent"; body.scopeId = opportunity.intentScopeId; }
      if (acknowledgedIds && acknowledgedIds.length) body.acknowledgedUptakeQuestionIds = acknowledgedIds;
      setActingId(opportunityId);
      setActionError(null);
      fetchPluginJSON(API + "/opportunities/" + encodeURIComponent(opportunityId) + "/" + action, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
        .then(function (payload) {
          if (payload && payload.success === false && payload.advisory && payload.advisory.code === "unresolved_uptake_questions") {
            var questions = Array.isArray(payload.advisory.questions) ? payload.advisory.questions : [];
            var warning = questions.map(function (question) {
              return (question.title ? question.title + ": " : "") + (question.prompt || "Question " + question.id);
            }).join("\n\n");
            var proceed = window.confirm(
              "Please answer or dismiss these questions before connecting:\n\n" + warning +
              "\n\nContinue anyway without answering?"
            );
            if (proceed) {
              opportunityAction(opportunity, action, onPayload, questions.map(function (question) { return question.id; }));
            } else {
              setActionError("Acceptance is still pending. Answer or dismiss the listed questions, or choose Continue anyway.");
            }
            return;
          }
          if (!payload || payload.success === false) {
            throw new Error((payload && payload.error) || "That action could not be completed.");
          }
          if (onPayload) onPayload(payload);
          load();
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
          load();
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

    useEffect(function () {
      load();
      loadNetworkRequests();
    }, []);

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
      if (!autoRefresh) return undefined;
      const id = setInterval(function () {
        if (loadRef.current) loadRef.current();
      }, 5000);
      return function () { clearInterval(id); };
    }, [autoRefresh]);

    useEffect(function () {
      if (DESKTOP_ENV) return undefined;
      function onHashChange() {
        setSelectedId(parseHash().intentId);
      }
      window.addEventListener("hashchange", onHashChange);
      return function () {
        window.removeEventListener("hashchange", onHashChange);
      };
    }, []);

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
      ? intents.filter(function (intent) { return intent.id === selectedId; })[0]
      : null;

    // Settled records = the server-backed answered questions from the summary
    // (server-scoped per intent, oldest first — identical to the Mac app),
    // then this session's local flips the summary hasn't caught up with yet
    // (skips and just-given answers), appended as the newest records.
    const answeredForSelected = (function () {
      if (!selectedIntent) return [];
      const server = (selectedIntent.answeredQuestions || []).map(function (question) {
        return { question: question, choice: question.answerText || "answered", dismissed: false };
      });
      const seen = {};
      server.forEach(function (record) { seen[record.question.id] = true; });
      const local = Object.keys(answeredMap).map(function (id) { return answeredMap[id]; })
        .filter(function (record) {
          return record.intentId === selectedIntent.id && !seen[record.question.id];
        });
      return server.concat(local);
    })();

    const intentsView = selectedIntent
      ? React.createElement(IntentDetail, { key: selectedIntent.id, intent: selectedIntent, answered: answeredForSelected, actionError: actionError, onSubmit: submitQuestion, onSkip: skipQuestion, onBack: goBack, onOpenUser: openUser, onAccept: acceptOpportunity, onSkipOpportunity: skipOpportunity, onStartChat: startChatWithOpportunity, actingId: actingId, webUrl: summary && summary.webUrl, onArchive: archiveIntent, archivingId: archivingId, onPause: togglePauseIntent })
      : React.createElement("div", { className: "index-dashboard__list-page" },
        React.createElement(IntentPitch, null),
        React.createElement("div", { className: "index-dashboard__list-cols" },
          React.createElement(Panel, { icon: ICON_SPARKLES(), title: "Intents", count: intents.length },
            React.createElement(IntentList, { intents: intents, selectedId: selectedId, onSelect: selectIntent }),
          ),
          React.createElement("div", { className: "index-dashboard__list-side" },
            React.createElement(NetworksMini, { networks: summary && summary.networks, requests: networkRequests, onCreate: openCreate, onJoin: joinNetwork, joiningId: joiningId, onEditRequest: editNetworkRequest, onDismissRequest: dismissNetworkRequest }),
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
      viewUserId
        ? React.createElement(ProfilePanel, { userId: viewUserId, readOnly: true, onClose: function () { setViewUserId(null); } })
        : (profileOpen ? React.createElement(ProfilePanel, { onClose: function () { setProfileOpen(false); } }) : null),
      messagesOpen
        ? React.createElement(MessagesPanel, { initialConversationId: messagesTarget, onClose: function () { setMessagesOpen(false); setMessagesTarget(null); } })
        : null,
      createOpen
        ? React.createElement(NetworkCreateModal, { initial: editingRequest, onSubmit: submitNetworkRequest, onClose: closeCreate })
        : null,
      error
        ? React.createElement("div", { className: "index-dashboard__error" }, error)
        : null,

      loading && !summary
        ? React.createElement("div", { className: "index-dashboard__loading index-dashboard__loading--hero" },
          LOADING_IMAGE()
            ? React.createElement("img", { className: "index-dashboard__loading-anim", src: LOADING_IMAGE(), alt: "Loading", loading: "eager" })
            : React.createElement("span", { className: "index-dashboard__loading-text" }, "Loading…"),
        )
        : React.createElement("div", { className: "index-dashboard__body" }, intentsView),
    );
  }

  if (DESKTOP_ENV) DESKTOP_ENV.onComponent(IndexNetworkDashboard);
  else window.__HERMES_PLUGINS__.register("index-network", IndexNetworkDashboard);
})();
