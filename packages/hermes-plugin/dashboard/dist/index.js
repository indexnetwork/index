/**
 * Index Network Hermes dashboard.
 *
 * Intent-centric layout: each intent owns its pending questions and
 * its opportunities ("radar"). A segmented control switches between the
 * Intents master-detail view and the Networks view. View + selected intent
 * are mirrored into the URL hash so browser Back/Forward navigate between
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

  function ICON_SHARE() {
    return svgIcon("h-4 w-4", [
      React.createElement("circle", { key: "a", cx: 18, cy: 5, r: 3 }),
      React.createElement("circle", { key: "b", cx: 6, cy: 12, r: 3 }),
      React.createElement("circle", { key: "c", cx: 18, cy: 19, r: 3 }),
      React.createElement("line", { key: "d", x1: 8.59, x2: 15.42, y1: 13.51, y2: 17.49 }),
      React.createElement("line", { key: "e", x1: 15.41, x2: 8.59, y1: 6.51, y2: 10.49 }),
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
      className: "font-mono group relative grid cursor-pointer items-center leading-0 font-bold tracking-[0.2em] p-2 aspect-square grid-cols-1 place-items-center [&>svg]:size-3.5 bg-transparent hover:bg-midground/10 shadow-none " + (props.tone || "text-current"),
      onClick: props.onClick,
    }, props.children);
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
    if (params.view === "networks") return { view: "networks", intentId: null };
    if (params.intent) return { view: "intents", intentId: params.intent };
    return { view: "intents", intentId: null };
  }

  function writeHash(view, intentId) {
    const next = view === "networks" ? "view=networks" : intentId ? "intent=" + encodeURIComponent(intentId) : "";
    const target = next ? "#" + next : "";
    if ((window.location.hash || "") !== target) {
      window.location.hash = target;
    }
  }

  function EmptyState(props) {
    return React.createElement("div", { className: "index-dashboard__empty" }, props.children || "Nothing to show yet.");
  }

  function ItemList(props) {
    const items = Array.isArray(props.items) ? props.items : [];
    if (props.error) {
      return React.createElement("div", { className: "index-dashboard__error" }, props.error);
    }
    if (items.length === 0) {
      return React.createElement(EmptyState, null, props.emptyMessage || props.empty || "Nothing to show yet.");
    }
    return React.createElement("div", { className: props.compact ? "index-dashboard__items index-dashboard__items--compact" : "index-dashboard__items" },
      items.map(function (item, index) {
        return React.createElement("article", { className: "index-dashboard__item", key: String(index) + (item.title || "") },
          React.createElement("div", { className: "index-dashboard__item-head" },
            React.createElement("h3", { className: "index-dashboard__item-title" }, item.title || "Untitled"),
            item.status ? React.createElement(BadgeText, { variant: item.status === "accepted" ? "default" : "outline" }, String(item.status).replace(/_/g, " ")) : null,
          ),
          item.detail ? React.createElement("p", { className: "index-dashboard__item-detail" }, item.detail) : null,
          Array.isArray(item.networks) && item.networks.length > 0
            ? React.createElement("div", { className: "index-dashboard__item-networks" },
              React.createElement("span", null, "Surfaced in"),
              item.networks.map(function (network) {
                return React.createElement(BadgeText, { key: String(network), variant: "outline" }, network);
              }),
            )
            : null,
          item.meta ? React.createElement("p", { className: "index-dashboard__item-meta" }, item.meta) : null,
        );
      }),
    );
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
    return React.createElement("div", { className: "index-dashboard__stat" },
      React.createElement("strong", null, formatCount(props.value)),
      React.createElement("span", null, props.label),
    );
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
        React.createElement("button", { type: "button", className: "index-dashboard__skip", disabled: submitting, onClick: function () { props.onSkip(question); } }, "Skip"),
        React.createElement(Button, { type: "submit", disabled: !canSubmit || submitting }, submitting ? "Saving…" : "Submit"),
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

  function RadarStrip(props) {
    const counts = props.counts || {};
    return React.createElement("div", { className: "index-dashboard__radar-strip" },
      React.createElement(StatPill, { value: counts.ready || 0, label: "ready" }),
      React.createElement(StatPill, { value: counts.negotiating || 0, label: "negotiating" }),
      React.createElement(StatPill, { value: counts.accepted || 0, label: "accepted" }),
      React.createElement(StatPill, { value: counts.expired || 0, label: "expired" }),
    );
  }

  const OPP_RESOLVED_LABEL = { accepted: "Connected", rejected: "Declined", expired: "Expired" };

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
    return React.createElement("article", { className: "index-dashboard__opp" },
      React.createElement("div", { className: "index-dashboard__opp-head" },
        React.createElement("div", { className: "index-dashboard__opp-id" },
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
        return React.createElement(OpportunityCard, { key: opportunity.opportunityId || String(index), opportunity: opportunity });
      }),
    );
  }

  const SEG_BASE_CLASS = "font-mondwest tracking-[0.1em] transition-colors cursor-pointer whitespace-nowrap border-r border-midground/15 last:border-r-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-midground/30 h-8 px-3 text-xs";
  const SEG_ACTIVE_CLASS = " bg-midground text-background";
  const SEG_INACTIVE_CLASS = " text-text-secondary hover:bg-midground/10 hover:text-midground";

  function Segmented(props) {
    function tab(id, label) {
      const active = props.view === id;
      return React.createElement("button", {
        type: "button",
        role: "radio",
        "aria-checked": active ? "true" : "false",
        className: SEG_BASE_CLASS + (active ? SEG_ACTIVE_CLASS : SEG_INACTIVE_CLASS),
        onClick: function () { props.onChange(id); },
      }, label);
    }
    return React.createElement("div", { className: "inline-flex border border-midground/15 bg-background/30 w-fit shrink-0", role: "radiogroup" },
      tab("intents", "Intents"),
      tab("networks", "Networks"),
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
        props.count ? React.createElement(BadgeText, { variant: "default" }, formatCount(props.count) + " Q") : null,
      ),
    );
  }

  function IntentList(props) {
    const intents = Array.isArray(props.intents) ? props.intents : [];
    return React.createElement("div", { className: "index-dashboard__intent-list" },
      props.generalCount > 0
        ? React.createElement(GeneralRow, { count: props.generalCount, selected: props.selectedId === "general", onSelect: props.onSelect })
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
      React.createElement("div", { className: "flex items-center justify-between gap-3" },
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
    );
  }

  function IntentDetail(props) {
    const intent = props.intent;
    if (!intent) {
      return React.createElement("div", { className: "index-dashboard__detail" },
        React.createElement(EmptyState, null, "Select an intent to see its questions and radar."),
      );
    }
    const questionSection = { items: intent.questions || [] };
    return React.createElement("div", { className: "index-dashboard__detail" },
      React.createElement(DetailHead, {
        title: intent.title || "Untitled intent",
        networks: intent.networks,
        onBack: props.onBack,
        actions: [
          React.createElement(HeaderActionButton, { key: "pause", title: "Pause", tone: "text-warning" }, ICON_PAUSE()),
          React.createElement(HeaderActionButton, { key: "edit", title: "Edit" }, ICON_PENCIL()),
          React.createElement(HeaderActionButton, { key: "remove", title: "Remove", tone: "text-destructive" }, ICON_TRASH()),
        ],
      }),
      React.createElement("div", { className: "index-dashboard__detail-cols" },
      React.createElement(Panel, { primary: true, title: "Questions", count: intent.questionCount, description: "Answer pending follow-ups for this intent." },
        React.createElement(QuestionList, { section: questionSection, actionError: props.actionError, submittingId: props.submittingId, onSubmit: props.onSubmit, onSkip: props.onSkip }),
      ),
        React.createElement(Panel, { title: "Radar", count: intent.opportunityCount, description: "People the network surfaced for this intent." },
          React.createElement(RadarStrip, { counts: intent.statusCounts }),
          React.createElement(RadarList, { items: intent.opportunities, empty: "No matches surfaced yet." }),
        ),
      ),
    );
  }

  function GeneralDetail(props) {
    const general = props.general || { questions: [] };
    const questionSection = { items: general.questions || [] };
    return React.createElement("div", { className: "index-dashboard__detail" },
      React.createElement(DetailHead, { title: "General", onBack: props.onBack }),
      React.createElement(Panel, { primary: true, title: "Questions", count: questionSection.items.length, description: "Onboarding and follow-ups not tied to an intent." },
        React.createElement(QuestionList, { section: questionSection, actionError: props.actionError, submittingId: props.submittingId, onSubmit: props.onSubmit, onSkip: props.onSkip }),
      ),
    );
  }

  function NetworksView(props) {
    const networks = props.networks || { items: [], count: 0 };
    return React.createElement(Panel, { cron: true, icon: ICON_SHARE(), title: "Networks", count: networks.count },
      React.createElement(ItemList, { items: networks.items, error: networks.error, empty: "You are not joined to any networks yet." }),
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
    const viewState = useState(initial.view);
    const view = viewState[0];
    const setView = viewState[1];
    const selectedState = useState(initial.intentId);
    const selectedId = selectedState[0];
    const setSelectedId = selectedState[1];
    const autoState = useState(true);
    const autoRefresh = autoState[0];
    const setAutoRefresh = autoState[1];
    const loadRef = useRef(null);
    const headerCtlRef = useRef(null);
    const changeViewRef = useRef(null);
    const segCtlRef = useRef(null);
    const segInHeaderState = useState(false);
    const segInHeader = segInHeaderState[0];
    const setSegInHeader = segInHeaderState[1];

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

    loadRef.current = load;

    useEffect(function () {
      load();
    }, []);

    useEffect(function () {
      const header = document.querySelector('header[role="banner"]');
      if (!header) return undefined;
      const container = header.querySelector("div") || header;

      const seg = document.createElement("div");
      seg.className = "inline-flex border border-midground/15 bg-background/30 w-fit shrink-0 index-dashboard__hdr-seg";
      seg.setAttribute("role", "radiogroup");
      const segButtons = {};
      [["intents", "Intents"], ["networks", "Networks"]].forEach(function (pair) {
        const b = document.createElement("button");
        b.type = "button";
        b.setAttribute("role", "radio");
        b.className = SEG_BASE_CLASS;
        b.textContent = pair[1];
        b.addEventListener("click", function () {
          if (changeViewRef.current) changeViewRef.current(pair[0]);
        });
        seg.appendChild(b);
        segButtons[pair[0]] = b;
      });
      const titleHeading = container.querySelector("h1");
      const titleGroup = (titleHeading && titleHeading.parentElement) || container.firstElementChild || container;
      titleGroup.appendChild(seg);
      segCtlRef.current = segButtons;
      setSegInHeader(true);

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

      wrap.appendChild(label);
      wrap.appendChild(sw);
      wrap.appendChild(live);
      wrap.appendChild(refresh);
      container.appendChild(wrap);
      headerCtlRef.current = { sw: sw, live: live, refresh: refresh };

      return function () {
        sw.removeEventListener("click", onToggle);
        refresh.removeEventListener("click", onRefresh);
        wrap.remove();
        seg.remove();
        headerCtlRef.current = null;
        segCtlRef.current = null;
        setSegInHeader(false);
      };
    }, []);

    useEffect(function () {
      const ctl = segCtlRef.current;
      if (!ctl) return;
      Object.keys(ctl).forEach(function (id) {
        const active = view === id;
        ctl[id].setAttribute("aria-checked", active ? "true" : "false");
        ctl[id].className = SEG_BASE_CLASS + (active ? SEG_ACTIVE_CLASS : SEG_INACTIVE_CLASS) + " index-dashboard__hdr-seg-btn";
      });
    }, [view, segInHeader]);

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
        const parsed = parseHash();
        setView(parsed.view);
        setSelectedId(parsed.intentId);
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
      setView("intents");
      writeHash("intents", id);
    }

    function changeView(nextView) {
      setView(nextView);
      writeHash(nextView, nextView === "networks" ? null : selectedId);
    }

    changeViewRef.current = changeView;

    function goBack() {
      setSelectedId(null);
      writeHash("intents", null);
    }

    const selectedIntent = selectedId && selectedId !== "general"
      ? intents.filter(function (intent) { return intent.id === selectedId; })[0]
      : null;
    const showDetail = selectedId === "general" || !!selectedIntent;

    const intentsView = showDetail
      ? (selectedId === "general"
        ? React.createElement(GeneralDetail, { general: general, actionError: actionError, submittingId: submittingId, onSubmit: submitQuestion, onSkip: skipQuestion, onBack: goBack })
        : React.createElement(IntentDetail, { intent: selectedIntent, actionError: actionError, submittingId: submittingId, onSubmit: submitQuestion, onSkip: skipQuestion, onBack: goBack }))
      : React.createElement("div", { className: "index-dashboard__list-page" },
        React.createElement(Panel, { cron: true, icon: ICON_TARGET(), title: "Intents", count: intents.length },
          React.createElement(IntentList, { intents: intents, generalCount: general.count, selectedId: selectedId, onSelect: selectIntent }),
        ),
      );

    return React.createElement("div", { className: "index-dashboard" },
      error
        ? React.createElement("div", { className: "index-dashboard__error" }, error)
        : null,

      loading && !summary
        ? React.createElement("div", { className: "index-dashboard__loading" }, "Loading Index Network data…")
        : React.createElement("div", { className: "index-dashboard__body" },
          segInHeader ? null : React.createElement(Segmented, { view: view, onChange: changeView }),
          view === "networks"
            ? React.createElement(NetworksView, { networks: summary && summary.networks })
            : intentsView,
        ),
    );
  }

  window.__HERMES_PLUGINS__.register("index-network", IndexNetworkDashboard);
})();
