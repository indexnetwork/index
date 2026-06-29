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

  const SDK = window.__HERMES_PLUGIN_SDK__;
  if (!SDK || !window.__HERMES_PLUGINS__) {
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
  const REFRESH_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>';
  const ACCOUNT_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
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
    return React.createElement(Badge, { variant: props.variant || "outline", className: "index-dashboard__badge" }, props.children);
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

  function ICON_TARGET() {
    return svgIcon("h-4 w-4", [
      React.createElement("circle", { key: "a", cx: 12, cy: 12, r: 10 }),
      React.createElement("circle", { key: "b", cx: 12, cy: 12, r: 6 }),
      React.createElement("circle", { key: "c", cx: 12, cy: 12, r: 2 }),
    ]);
  }

  function ICON_PAUSE() {
    return svgIcon("", [
      React.createElement("rect", { key: "a", x: 14, y: 3, width: 5, height: 18, rx: 1 }),
      React.createElement("rect", { key: "b", x: 5, y: 3, width: 5, height: 18, rx: 1 }),
    ]);
  }

  function ICON_PENCIL() {
    return svgIcon("", [
      svgPath("M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"),
      svgPath("m15 5 4 4"),
    ]);
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

  function parseHash() {
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
    const target = intentId ? "#intent=" + encodeURIComponent(intentId) : "";
    if ((window.location.hash || "") !== target) {
      window.location.hash = target;
    }
  }

  function EmptyState(props) {
    return React.createElement("div", { className: "index-dashboard__empty" }, props.children || "Nothing to show yet.");
  }

  function Panel(props) {
    const header = props.cron
      ? React.createElement(CardHeader, { className: "index-dashboard__card-header" },
        React.createElement("h2", { className: "font-sans text-[.9375rem] tracking-[0.1875rem] font-bold flex items-center gap-2 text-muted-foreground" },
          props.icon || null,
          props.count !== undefined ? props.title + " (" + formatCount(props.count) + ")" : props.title,
        ),
      )
      : React.createElement(CardHeader, { className: "index-dashboard__card-header" },
        React.createElement("div", { className: "index-dashboard__card-title-row" },
          React.createElement("div", null,
            React.createElement(CardTitle, { className: "index-dashboard__card-title" }, props.title),
            props.description ? React.createElement("p", { className: "index-dashboard__card-description" }, props.description) : null,
          ),
          props.count !== undefined ? React.createElement(BadgeText, null, formatCount(props.count)) : null,
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
    const submitting = props.submittingId === question.id;
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
      if (!canSubmit || submitting) return;
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
        React.createElement(Button, { type: "button", ghost: true, size: "sm", className: "index-dashboard__btn-md", disabled: submitting, onClick: function () { props.onSkip(question); } }, "Skip"),
        React.createElement(Button, { type: "submit", size: "sm", className: "index-dashboard__btn-md", disabled: !canSubmit || submitting }, submitting ? "Saving…" : "Submit"),
      ),
    );
  }

  function QuestionList(props) {
    const section = props.section || {};
    const questions = Array.isArray(section.items) ? section.items : [];
    if (section.error) {
      return React.createElement("div", { className: "index-dashboard__error" }, section.error);
    }
    const cards = questions.map(function (question) {
      return React.createElement(QuestionCard, { key: question.id, question: question, onSubmit: props.onSubmit, onSkip: props.onSkip, submittingId: props.submittingId });
    });
    if (props.actionError) {
      return React.createElement("div", { className: "index-dashboard__stack" },
        React.createElement("div", { className: "index-dashboard__error" }, props.actionError),
        questions.length === 0 ? React.createElement(EmptyState, null, "No pending questions right now.") : null,
        cards,
      );
    }
    if (questions.length === 0) {
      return React.createElement(EmptyState, null, "No pending questions right now.");
    }
    return React.createElement("div", { className: "index-dashboard__stack" }, cards);
  }

  // Mirrors plugin_api.py _STATUS_BUCKET: raw status -> display bucket.
  const STATUS_BUCKET = {
    latent: "pending",
    draft: "pending",
    pending: "pending",
    negotiating: "negotiating",
    stalled: "negotiating",
    accepted: "accepted",
    rejected: "rejected",
    expired: "expired",
  };

  const RADAR_BUCKETS = [
    { key: "pending", label: "Awaiting you" },
    { key: "negotiating", label: "negotiating" },
    { key: "accepted", label: "accepted" },
    { key: "rejected", label: "rejected" },
    { key: "expired", label: "Missed" },
  ];

  function bucketForStatus(status) {
    return STATUS_BUCKET[String(status || "")] || "pending";
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

  const OPP_RESOLVED_LABEL = { accepted: "Connected", rejected: "Declined", expired: "Missed" };

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
    const networks = Array.isArray(opportunity.networks) ? opportunity.networks : [];
    const acting = !!props.actingId && props.actingId === opportunity.opportunityId;
    let actions = null;
    if (props.onAccept && bucketForStatus(status) === "pending") {
      actions = React.createElement("div", { className: "index-dashboard__opp-actions" },
        React.createElement(Button, {
          type: "button", ghost: true, size: "sm", className: "index-dashboard__btn-md",
          disabled: acting,
          onClick: function () { if (props.onSkip) props.onSkip(opportunity.opportunityId); },
        }, "Skip"),
        React.createElement(Button, {
          type: "button", outlined: true, size: "sm", className: "index-dashboard__btn-md",
          disabled: acting,
          onClick: function () { props.onAccept(opportunity.opportunityId); },
        }, acting ? "Working…" : "Start chat"),
      );
    } else if (status === "accepted") {
      const chatHref = opportunity.chatUrl || null;
      if (chatHref) {
        actions = React.createElement("div", { className: "index-dashboard__opp-actions" },
          React.createElement("a", {
            className: "index-dashboard__opp-openchat",
            href: chatHref,
            target: "_blank",
            rel: "noopener noreferrer",
          }, "Open chat ↗"),
        );
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
        resolved
          ? React.createElement("span", { className: "index-dashboard__opp-status index-dashboard__opp-status--" + status }, resolved)
          : status ? React.createElement(BadgeText, { variant: "outline" }, String(status).replace(/_/g, " ")) : null,
      ),
      opportunity.mainText ? React.createElement("p", { className: "index-dashboard__opp-text" }, opportunity.mainText) : null,
      networks.length > 0 || (typeof opportunity.score === "number" && opportunity.score > 0)
        ? React.createElement("div", { className: "index-dashboard__opp-foot" },
          networks.length > 0
            ? React.createElement("div", { className: "index-dashboard__item-networks" },
              React.createElement("span", null, "Surfaced in"),
              networks.map(function (network) {
                return React.createElement(BadgeText, { key: String(network), variant: "outline" }, network);
              }),
            )
            : React.createElement("span", null),
          typeof opportunity.score === "number" && opportunity.score > 0
            ? React.createElement("span", { className: "index-dashboard__opp-score" }, Math.round(opportunity.score * 100) + "% match")
            : null,
        )
        : null,
      actions,
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
          actingId: props.actingId,
          webUrl: props.webUrl,
        });
      }),
    );
  }

  function IntentRow(props) {
    const intent = props.intent;
    const className = props.selected ? "index-dashboard__intent-row index-dashboard__intent-row--selected" : "index-dashboard__intent-row";
    return React.createElement("button", { type: "button", className: className, onClick: function () { props.onSelect(intent.id); } },
      React.createElement("div", { className: "index-dashboard__intent-main" },
        React.createElement("span", { className: "index-dashboard__intent-title" }, intent.title || "Untitled intent"),
        intent.status ? React.createElement(BadgeText, { variant: intent.status === "running" ? "default" : "outline" }, intent.status) : null,
      ),
      React.createElement("div", { className: "index-dashboard__intent-counts" },
        React.createElement(BadgeText, null, formatCount(intent.opportunityCount) + " opps"),
        intent.questionCount ? React.createElement(BadgeText, { variant: "default" }, formatCount(intent.questionCount) + " Q") : null,
      ),
    );
  }

  function GeneralRow(props) {
    const className = props.selected ? "index-dashboard__intent-row index-dashboard__intent-row--selected" : "index-dashboard__intent-row";
    return React.createElement("button", { type: "button", className: className, onClick: function () { props.onSelect("general"); } },
      React.createElement("div", { className: "index-dashboard__intent-main" },
        React.createElement("span", { className: "index-dashboard__intent-title" }, "General"),
        React.createElement("span", { className: "index-dashboard__intent-sub" }, "Not tied to an intent"),
      ),
      React.createElement("div", { className: "index-dashboard__intent-counts" },
        props.opportunityCount ? React.createElement(BadgeText, null, formatCount(props.opportunityCount) + " opps") : null,
        props.questionCount ? React.createElement(BadgeText, { variant: "default" }, formatCount(props.questionCount) + " Q") : null,
      ),
    );
  }

  function IntentPitch() {
    return React.createElement("aside", { className: "index-dashboard__pitch" },
      React.createElement("h2", { className: "index-dashboard__pitch-title" },
        "meet the person your agent is ",
        React.createElement("mark", { className: "index-dashboard__pitch-mark" }, "already"),
        " looking for.",
      ),
      React.createElement("p", { className: "index-dashboard__pitch-text" },
        "tell index what you're after. agents negotiate quietly in the background, and let you know if there's an alignment.",
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
    const isEvent = network.type === "event";
    const isOwner = network.role === "owner";
    return React.createElement("button", { type: "button", className: "index-dashboard__net-row", onClick: function () { if (props.onOpen) props.onOpen(network); } },
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
      isEvent ? React.createElement("span", { className: "index-dashboard__net-event" }, "Event") : null,
      React.createElement("span", { className: "index-dashboard__net-role index-dashboard__net-role--" + (isOwner ? "owner" : "member") }, isOwner ? "Owner" : "Member"),
    );
  }

  function NetworkDiscoverRow(props) {
    const network = props.network;
    const count = typeof network.memberCount === "number" ? network.memberCount : null;
    const isEvent = network.type === "event";
    const joining = props.joiningId === network.id;
    return React.createElement("div", { className: "index-dashboard__net-row index-dashboard__net-row--static" },
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
      isEvent ? React.createElement("span", { className: "index-dashboard__net-event" }, "Event") : null,
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

  function ICON_COMPASS() {
    return svgIcon("index-dashboard__net-discover-icon", [
      React.createElement("circle", { key: "c", cx: 12, cy: 12, r: 10 }),
      React.createElement("polygon", { key: "n", points: "16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" }),
    ]);
  }

  function NetworkDiscoverModal(props) {
    return React.createElement("div", { className: "index-dashboard__profile-overlay", onClick: props.onClose },
      React.createElement("div", { className: "index-dashboard__profile-panel index-dashboard__net-modal", onClick: function (e) { e.stopPropagation(); } },
        React.createElement("div", { className: "index-dashboard__profile-header" },
          React.createElement("h2", { className: "index-dashboard__profile-title" }, "Discover networks"),
          React.createElement("button", { type: "button", className: "index-dashboard__profile-close", "aria-label": "Close", onClick: props.onClose }, "×"),
        ),
        React.createElement("div", { className: "index-dashboard__net-modal-body" },
          React.createElement(NetworkRows, { items: props.discover, discover: true, error: props.error, empty: "No public networks to discover right now.", onJoin: props.onJoin, joiningId: props.joiningId }),
        ),
      ),
    );
  }

  function NetworksMini(props) {
    const networks = props.networks || { items: [], count: 0, discover: [] };
    const items = Array.isArray(networks.items) ? networks.items : [];
    const discover = Array.isArray(networks.discover) ? networks.discover : [];
    const openState = React.useState(false);
    const open = openState[0];
    const setOpen = openState[1];
    return React.createElement("section", { className: "index-dashboard__net-card" },
      React.createElement("div", { className: "index-dashboard__net-head" },
        React.createElement("span", { className: "index-dashboard__net-heading" }, "Networks"),
        React.createElement("div", { className: "index-dashboard__net-head-actions" },
          items.length > 0 ? React.createElement(BadgeText, null, formatCount(networks.count || items.length)) : null,
          React.createElement("button", { type: "button", className: "index-dashboard__net-discover-btn", onClick: function () { setOpen(true); } }, ICON_COMPASS(), "Discover"),
        ),
      ),
      networks.error
        ? React.createElement("div", { className: "index-dashboard__error" }, networks.error)
        : items.length === 0
          ? React.createElement(EmptyState, null, "You are not joined to any networks yet.")
          : React.createElement("div", { className: "index-dashboard__net-list" },
            items.map(function (network, index) {
              return React.createElement(NetworkMiniRow, { key: network.id || String(index), network: network, onOpen: props.onOpen });
            }),
          ),
      open ? React.createElement(NetworkDiscoverModal, { discover: discover, error: networks.error, onJoin: props.onJoin, joiningId: props.joiningId, onClose: function () { setOpen(false); } }) : null,
    );
  }

  function IntentList(props) {
    const intents = Array.isArray(props.intents) ? props.intents : [];
    const general = props.general || {};
    const generalCount = general.count || 0;
    return React.createElement("div", { className: "index-dashboard__intent-list" },
      generalCount > 0
        ? React.createElement(GeneralRow, { questionCount: general.questionCount, opportunityCount: general.opportunityCount, selected: props.selectedId === "general", onSelect: props.onSelect })
        : null,
      intents.length === 0
        ? React.createElement(EmptyState, null, "No active intents yet.")
        : intents.map(function (intent) {
          return React.createElement(IntentRow, { key: intent.id, intent: intent, selected: props.selectedId === intent.id, onSelect: props.onSelect });
        }),
    );
  }

  function DetailHead(props) {
    return React.createElement("div", { className: "index-dashboard__detail-head" },
      props.onBack ? React.createElement("button", { type: "button", className: "index-dashboard__back", onClick: props.onBack }, "← back") : null,
      React.createElement("div", { className: "index-dashboard__detail-card" },
        React.createElement("div", { className: "index-dashboard__detail-title-row" },
          React.createElement("h2", { className: "index-dashboard__detail-title" }, props.title),
          props.actions ? React.createElement("div", { className: "flex items-center gap-1 shrink-0" }, props.actions) : null,
        ),
        Array.isArray(props.networks) && props.networks.length > 0
          ? React.createElement("div", { className: "index-dashboard__item-networks" },
            React.createElement("span", null, "Networks"),
            props.networks.map(function (network) {
              return React.createElement(BadgeText, { key: String(network), variant: "outline" }, network);
            }),
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
    if (!intent) {
      return React.createElement("div", { className: "index-dashboard__detail" },
        React.createElement(EmptyState, null, "Select an intent to see its questions and radar."),
      );
    }
    const questionSection = { items: intent.questions || [] };
    const allOpps = Array.isArray(intent.opportunities) ? intent.opportunities : [];
    const visibleOpps = allOpps.filter(function (opp) {
      return bucketForStatus(opp.status) === selectedBucket;
    });
    const radarEmpty = "No matches here yet.";
    return React.createElement("div", { className: "index-dashboard__detail" },
      React.createElement(DetailHead, {
        title: intent.title || "Untitled intent",
        networks: intent.networks,
        onBack: props.onBack,
        actions: [
          React.createElement(HeaderActionButton, { key: "pause", title: "Pause", label: "Pause", tone: "text-warning" }, ICON_PAUSE()),
          React.createElement(HeaderActionButton, { key: "edit", title: "Edit" }, ICON_PENCIL()),
          React.createElement(HeaderActionButton, { key: "remove", title: "Remove", tone: "text-destructive" }, ICON_TRASH()),
        ],
      }),
      React.createElement("div", { className: "index-dashboard__detail-cols" },
      React.createElement(Panel, { primary: true, title: "Questions", count: intent.questionCount, description: "Answer pending follow-ups for this intent." },
        React.createElement(QuestionList, { section: questionSection, actionError: props.actionError, submittingId: props.submittingId, onSubmit: props.onSubmit, onSkip: props.onSkip }),
      ),
        React.createElement(Panel, { title: "Radar", count: intent.opportunityCount, description: "People the network surfaced for this intent." },
          React.createElement(RadarStrip, { counts: intent.statusCounts, selected: selectedBucket, onSelect: setSelectedBucket }),
          React.createElement(RadarList, { items: visibleOpps, empty: radarEmpty, onOpenUser: props.onOpenUser, onAccept: props.onAccept, onSkip: props.onSkipOpportunity, actingId: props.actingId, webUrl: props.webUrl }),
        ),
      ),
    );
  }

  function GeneralDetail(props) {
    const general = props.general || { questions: [], opportunities: [] };
    const bucketState = React.useState("pending");
    const selectedBucket = bucketState[0];
    const setSelectedBucket = bucketState[1];
    const questionSection = { items: general.questions || [] };
    const allOpps = Array.isArray(general.opportunities) ? general.opportunities : [];
    const visibleOpps = allOpps.filter(function (opp) {
      return bucketForStatus(opp.status) === selectedBucket;
    });
    return React.createElement("div", { className: "index-dashboard__detail" },
      React.createElement(DetailHead, { title: "General", onBack: props.onBack }),
      React.createElement("div", { className: "index-dashboard__detail-cols" },
        React.createElement(Panel, { primary: true, title: "Questions", count: questionSection.items.length, description: "Onboarding and follow-ups not tied to an intent." },
          React.createElement(QuestionList, { section: questionSection, actionError: props.actionError, submittingId: props.submittingId, onSubmit: props.onSubmit, onSkip: props.onSkip }),
        ),
        React.createElement(Panel, { title: "Radar", count: general.opportunityCount || 0, description: "People surfaced outside a specific intent." },
          React.createElement(RadarStrip, { counts: general.statusCounts || {}, selected: selectedBucket, onSelect: setSelectedBucket }),
          React.createElement(RadarList, { items: visibleOpps, empty: "No general matches here yet.", onOpenUser: props.onOpenUser, onAccept: props.onAccept, onSkip: props.onSkipOpportunity, actingId: props.actingId, webUrl: props.webUrl }),
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
      reader.onload = function (e) { setAvatarPreview(e.target ? e.target.result : null); };
      reader.readAsDataURL(file);
    }

    function save() {
      setSaving(true);
      setNote(null);
      setPanelError(null);
      fetchPluginJSON(API + "/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          intro: form.intro,
          location: form.location,
          timezone: form.timezone,
          socials: (form.socials || []).filter(function (s) { return s.value && s.value.trim(); }),
          notificationPreferences: form.notificationPreferences,
        }),
      })
        .then(function (payload) {
          if (!payload || payload.success === false) {
            throw new Error((payload && payload.error) || "Profile could not be saved.");
          }
          setDirty(false);
          setNote(payload.mock ? "Saved as preview — not yet persisted to Index." : "Saved.");
        })
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
      fetchPluginJSON(API + "/profile/intro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intro: form.intro }),
      })
        .then(function (payload) {
          if (payload && typeof payload.intro === "string" && payload.intro) {
            patchForm({ intro: payload.intro });
          }
          setNote(payload && payload.mock ? "AI intro generation isn't available from the dashboard yet." : null);
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

  function IndexNetworkDashboard() {
    const useState = React.useState;
    const useEffect = React.useEffect;
    const useRef = React.useRef;
    const initial = parseHash();
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
    const submittingState = useState(null);
    const submittingId = submittingState[0];
    const setSubmittingId = submittingState[1];
    const actingState = useState(null);
    const actingId = actingState[0];
    const setActingId = actingState[1];
    const joiningState = useState(null);
    const joiningId = joiningState[0];
    const setJoiningId = joiningState[1];
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
    const loadRef = useRef(null);
    const headerCtlRef = useRef(null);
    const toggleProfileRef = useRef(null);

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

    function submitQuestion(question, selectedOptions, freeText) {
      setSubmittingId(question.id);
      setActionError(null);
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
          setActionError(err && err.message ? err.message : String(err));
        })
        .finally(function () {
          setSubmittingId(null);
        });
    }

    function skipQuestion(question) {
      setSubmittingId(question.id);
      setActionError(null);
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
          setActionError(err && err.message ? err.message : String(err));
        })
        .finally(function () {
          setSubmittingId(null);
        });
    }

    function opportunityAction(opportunityId, action, onPayload) {
      if (!opportunityId) return;
      setActingId(opportunityId);
      setActionError(null);
      fetchPluginJSON(API + "/opportunities/" + encodeURIComponent(opportunityId) + "/" + action, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
        .then(function (payload) {
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

    function acceptOpportunity(opportunityId) {
      opportunityAction(opportunityId, "accept", function (payload) {
        if (payload.chatUrl) {
          try { window.open(payload.chatUrl, "_blank", "noopener"); } catch (e) { /* popup blocked */ }
        }
      });
    }

    function skipOpportunity(opportunityId) {
      opportunityAction(opportunityId, "skip");
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

    function openNetworkInWeb(network) {
      const base = summary && summary.webUrl;
      if (base && network && network.id) {
        try { window.open(base + "/networks/" + encodeURIComponent(network.id), "_blank", "noopener"); } catch (e) { /* popup blocked */ }
      }
    }

    loadRef.current = load;

    useEffect(function () {
      load();
    }, []);

    useEffect(function () {
      const header = document.querySelector('header[role="banner"]');
      if (!header) return undefined;
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

      const live = document.createElement("span");
      live.className = "index-dashboard__live";
      live.innerHTML = '<span class="index-dashboard__live-dot"></span>Live';

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
      wrap.appendChild(live);
      wrap.appendChild(refresh);
      wrap.appendChild(account);
      container.appendChild(wrap);
      headerCtlRef.current = { sw: sw, live: live, refresh: refresh, account: account };

      return function () {
        sw.removeEventListener("click", onToggle);
        refresh.removeEventListener("click", onRefresh);
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
      ctl.live.style.display = autoRefresh ? "inline-flex" : "none";
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
      function onHashChange() {
        setSelectedId(parseHash().intentId);
      }
      window.addEventListener("hashchange", onHashChange);
      return function () {
        window.removeEventListener("hashchange", onHashChange);
      };
    }, []);

    const intents = (summary && summary.intents) || [];
    const general = (summary && summary.general) || { count: 0, questions: [] };

    function selectIntent(id) {
      setSelectedId(id);
      writeHash(id);
    }

    toggleProfileRef.current = function () { setProfileOpen(function (open) { return !open; }); };

    function openUser(userId) {
      if (userId) setViewUserId(userId);
    }

    function goBack() {
      setSelectedId(null);
      writeHash(null);
    }

    const selectedIntent = selectedId && selectedId !== "general"
      ? intents.filter(function (intent) { return intent.id === selectedId; })[0]
      : null;
    const showDetail = selectedId === "general" || !!selectedIntent;

    const intentsView = showDetail
      ? (selectedId === "general"
        ? React.createElement(GeneralDetail, { general: general, actionError: actionError, submittingId: submittingId, onSubmit: submitQuestion, onSkip: skipQuestion, onBack: goBack, onOpenUser: openUser, onAccept: acceptOpportunity, onSkipOpportunity: skipOpportunity, actingId: actingId, webUrl: summary && summary.webUrl })
        : React.createElement(IntentDetail, { key: selectedIntent.id, intent: selectedIntent, actionError: actionError, submittingId: submittingId, onSubmit: submitQuestion, onSkip: skipQuestion, onBack: goBack, onOpenUser: openUser, onAccept: acceptOpportunity, onSkipOpportunity: skipOpportunity, actingId: actingId, webUrl: summary && summary.webUrl }))
      : React.createElement("div", { className: "index-dashboard__list-page" },
        React.createElement(IntentPitch, null),
        React.createElement("div", { className: "index-dashboard__list-cols" },
          React.createElement(Panel, { cron: true, icon: ICON_TARGET(), title: "Intents", count: intents.length },
            React.createElement(IntentList, { intents: intents, general: general, selectedId: selectedId, onSelect: selectIntent }),
          ),
          React.createElement("div", { className: "index-dashboard__list-side" },
            React.createElement(NetworksMini, { networks: summary && summary.networks, onOpen: openNetworkInWeb, onJoin: joinNetwork, joiningId: joiningId }),
          ),
        ),
      );

    return React.createElement("div", { className: "index-dashboard" },
      viewUserId
        ? React.createElement(ProfilePanel, { userId: viewUserId, readOnly: true, onClose: function () { setViewUserId(null); } })
        : (profileOpen ? React.createElement(ProfilePanel, { onClose: function () { setProfileOpen(false); } }) : null),
      error
        ? React.createElement("div", { className: "index-dashboard__error" }, error)
        : null,

      loading && !summary
        ? React.createElement("div", { className: "index-dashboard__loading" }, "Loading Index Network data…")
        : React.createElement("div", { className: "index-dashboard__body" }, intentsView),
    );
  }

  window.__HERMES_PLUGINS__.register("index-network", IndexNetworkDashboard);
})();
