/**
 * Index Network Hermes dashboard.
 *
 * Registers a dashboard tab that loads user-scoped Index data through the
 * plugin backend. The backend reuses native Hermes tool handlers so
 * INDEX_API_KEY scoping and protocol visibility rules stay centralized.
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

  function getSection(summary, key) {
    return (summary && summary.sections && summary.sections[key]) || { items: [], count: 0, summary: {} };
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
            item.status ? React.createElement(BadgeText, { variant: item.status === "waiting_for_agent" ? "default" : "outline" }, String(item.status).replace(/_/g, " ")) : null,
          ),
          item.detail ? React.createElement("p", { className: "index-dashboard__item-detail" }, item.detail) : null,
          Array.isArray(item.networks) && item.networks.length > 0
            ? React.createElement("div", { className: "index-dashboard__item-networks" },
              React.createElement("span", null, "Assigned to"),
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
    return React.createElement(Card, { className: props.primary ? "index-dashboard__card index-dashboard__card--primary" : "index-dashboard__card" },
      React.createElement(CardHeader, { className: "index-dashboard__card-header" },
        React.createElement("div", { className: "index-dashboard__card-title-row" },
          React.createElement("div", null,
            React.createElement(CardTitle, { className: "index-dashboard__card-title" }, props.title),
            props.description ? React.createElement("p", { className: "index-dashboard__card-description" }, props.description) : null,
          ),
          props.count !== undefined ? React.createElement(BadgeText, null, formatCount(props.count)) : null,
        ),
      ),
      React.createElement(CardContent, { className: "index-dashboard__card-content" }, props.children),
    );
  }

  function StatPill(props) {
    return React.createElement("div", { className: "index-dashboard__stat" },
      React.createElement("strong", null, formatCount(props.value)),
      React.createElement("span", null, props.label),
    );
  }

  function StatusPanel(props) {
    return React.createElement("div", { className: "index-dashboard__status-card" },
      React.createElement("div", null,
        React.createElement(BadgeText, { variant: props.error ? "destructive" : "outline" }, props.error ? "Needs attention" : "Question answers enabled"),
        React.createElement("p", null,
          props.error
            ? props.error
            : "Reads and question-answer writes go through the Hermes dashboard backend with the configured Index agent key.",
        ),
      ),
      React.createElement(Button, { type: "button", onClick: props.onRefresh, disabled: props.loading, className: "index-dashboard__refresh" },
        props.loading ? "Refreshing…" : "Refresh",
      ),
    );
  }

  function QuestionCard(props) {
    const question = props.question;
    const options = Array.isArray(question.options) ? question.options : [];
    const selectedState = React.useState([]);
    const selected = selectedState[0];
    const setSelected = selectedState[1];
    const freeTextState = React.useState("");
    const freeText = freeTextState[0];
    const setFreeText = freeTextState[1];
    const submitting = props.submittingId === question.id;
    const canSubmit = selected.length > 0 || freeText.trim().length > 0;

    function toggleOption(label) {
      setSelected(function (current) {
        if (question.multiSelect) {
          return current.indexOf(label) >= 0
            ? current.filter(function (item) { return item !== label; })
            : current.concat([label]);
        }
        return current.indexOf(label) >= 0 ? [] : [label];
      });
    }

    function submit(event) {
      event.preventDefault();
      if (!canSubmit || submitting) return;
      props.onSubmit(question, selected, freeText);
    }

    return React.createElement("form", { className: "index-dashboard__question", onSubmit: submit },
      React.createElement("div", { className: "index-dashboard__question-head" },
        React.createElement("div", null,
          React.createElement("h3", { className: "index-dashboard__item-title" }, question.title || "Question"),
          question.meta ? React.createElement("p", { className: "index-dashboard__item-meta" }, question.meta) : null,
        ),
        question.multiSelect ? React.createElement(BadgeText, null, "Multi-select") : null,
      ),
      question.prompt ? React.createElement("p", { className: "index-dashboard__question-prompt" }, question.prompt) : null,
      options.length > 0
        ? React.createElement("div", { className: "index-dashboard__question-options" },
          options.map(function (option) {
            const label = String(option.label || "");
            const checked = selected.indexOf(label) >= 0;
            return React.createElement("label", { className: checked ? "index-dashboard__option index-dashboard__option--selected" : "index-dashboard__option", key: label },
              React.createElement("input", {
                checked: checked,
                onChange: function () { toggleOption(label); },
                type: question.multiSelect ? "checkbox" : "radio",
              }),
              React.createElement("span", null,
                React.createElement("strong", null, label),
                option.description ? React.createElement("em", null, option.description) : null,
              ),
            );
          }),
        )
        : null,
      React.createElement("textarea", {
        className: "index-dashboard__textarea",
        onChange: function (event) { setFreeText(event.target.value); },
        placeholder: options.length > 0 ? "Optional context…" : "Write your answer…",
        rows: 3,
        value: freeText,
      }),
      React.createElement("div", { className: "index-dashboard__question-actions" },
        React.createElement(Button, { type: "submit", disabled: !canSubmit || submitting }, submitting ? "Saving…" : "Submit answer"),
      ),
    );
  }

  function QuestionList(props) {
    const section = props.section || {};
    const questions = Array.isArray(section.items) ? section.items : [];
    if (section.error) {
      return React.createElement("div", { className: "index-dashboard__error" }, section.error);
    }
    if (props.actionError) {
      return React.createElement("div", { className: "index-dashboard__stack" },
        React.createElement("div", { className: "index-dashboard__error" }, props.actionError),
        questions.length === 0 ? React.createElement(EmptyState, null, "No pending questions right now.") : null,
        questions.map(function (question) {
          return React.createElement(QuestionCard, { key: question.id, question: question, onSubmit: props.onSubmit, submittingId: props.submittingId });
        }),
      );
    }
    if (questions.length === 0) {
      return React.createElement(EmptyState, null, "No pending questions right now.");
    }
    return React.createElement("div", { className: "index-dashboard__stack" },
      questions.map(function (question) {
        return React.createElement(QuestionCard, { key: question.id, question: question, onSubmit: props.onSubmit, submittingId: props.submittingId });
      }),
    );
  }

  function NegotiationActivity(props) {
    const section = props.section || {};
    const summary = section.summary || {};
    const total = section.count || 0;
    const active = summary.active || 0;
    const waiting = summary.waitingForAgent || 0;
    const completed = summary.completed || 0;
    const needsAttention = summary.needsAttention || waiting;
    if (section.error) {
      return React.createElement("div", { className: "index-dashboard__error" }, section.error);
    }
    return React.createElement("div", { className: "index-dashboard__activity" },
      React.createElement("div", { className: "index-dashboard__activity-main" },
        React.createElement("span", null, formatCount(needsAttention)),
        React.createElement("p", null, "need attention"),
      ),
      React.createElement("p", { className: "index-dashboard__activity-summary" },
        "Index summarizes this automatically from negotiation statuses: ",
        formatCount(total), " total, ",
        formatCount(active), " active, ",
        formatCount(waiting), " waiting for an agent, and ",
        formatCount(completed), " completed.",
      ),
      React.createElement("div", { className: "index-dashboard__activity-grid" },
        React.createElement(StatPill, { value: active, label: "active" }),
        React.createElement(StatPill, { value: waiting, label: "waiting" }),
        React.createElement(StatPill, { value: completed, label: "completed" }),
        React.createElement(StatPill, { value: total, label: "total" }),
      ),
      React.createElement("p", { className: "index-dashboard__activity-note" }, section.note || "No negotiation conversations are rendered in this dashboard."),
    );
  }

  function IndexNetworkDashboard() {
    const useState = React.useState;
    const useEffect = React.useEffect;
    const state = useState(null);
    const summary = state[0];
    const setSummary = state[1];
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

    useEffect(function () {
      load();
    }, []);

    const intents = getSection(summary, "intents");
    const questions = getSection(summary, "questions");
    const opportunities = getSection(summary, "opportunities");
    const negotiations = getSection(summary, "negotiations");
    const networks = getSection(summary, "networks");

    return React.createElement("div", { className: "index-dashboard" },
      React.createElement("section", { className: "index-dashboard__hero" },
        React.createElement("div", null,
          React.createElement("p", { className: "index-dashboard__eyebrow" }, "Index Network"),
          React.createElement("h1", { className: "index-dashboard__title" }, "Your network radar"),
          React.createElement("p", { className: "index-dashboard__subtitle" },
            "A live brief of what you are looking for, which questions need your input, who the network has surfaced, and which communities shape the search.",
          ),
          React.createElement("div", { className: "index-dashboard__stats" },
            React.createElement(StatPill, { value: questions.count, label: "questions" }),
            React.createElement(StatPill, { value: intents.count, label: "intents" }),
            React.createElement(StatPill, { value: opportunities.count, label: "opportunities" }),
            React.createElement(StatPill, { value: networks.count, label: "networks" }),
          ),
        ),
        React.createElement(StatusPanel, { loading: loading, error: error, onRefresh: load }),
      ),

      loading && !summary
        ? React.createElement("div", { className: "index-dashboard__loading" }, "Loading Index Network data…")
        : React.createElement("div", { className: "index-dashboard__shell" },
          React.createElement("main", { className: "index-dashboard__main" },
            React.createElement(Panel, { primary: true, title: "Questions", count: questions.count, description: "Answer pending Index follow-ups without leaving Hermes." },
              React.createElement(QuestionList, { section: questions, actionError: actionError, submittingId: submittingId, onSubmit: submitQuestion }),
            ),
            React.createElement(Panel, { title: "Opportunities", count: opportunities.count, description: "Actionable matches currently visible to you." },
              React.createElement(ItemList, { items: opportunities.items, error: opportunities.error, emptyMessage: opportunities.emptyMessage, empty: "No actionable opportunities yet." }),
            ),
            React.createElement(Panel, { title: "Negotiation activity", count: negotiations.count, description: "Counts only — conversation threads are not rendered in this dashboard." },
              React.createElement(NegotiationActivity, { section: negotiations }),
            ),
          ),
          React.createElement("aside", { className: "index-dashboard__sidebar" },
            React.createElement(Panel, { title: "Intents", count: intents.count, description: "Your active signals." },
              React.createElement(ItemList, { compact: true, items: intents.items, error: intents.error, empty: "No active intents yet." }),
            ),
            React.createElement(Panel, { title: "Networks", count: networks.count, description: "Joined communities and personal networks." },
              React.createElement(ItemList, { compact: true, items: networks.items, error: networks.error, empty: "You are not joined to any networks yet." }),
            ),
          ),
        ),
    );
  }

  window.__HERMES_PLUGINS__.register("index-network", IndexNetworkDashboard);
})();
