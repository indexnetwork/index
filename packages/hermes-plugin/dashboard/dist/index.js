/**
 * Index Network Hermes dashboard.
 *
 * Registers a static, read-only dashboard tab. Live Python dashboard routes are
 * deliberately deferred until route authentication is explicit for this plugin
 * source, so this bundle performs no network fetches.
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

  function BadgeText(props) {
    return React.createElement(Badge, { variant: "outline", className: "index-dashboard__badge" }, props.children);
  }

  function GuidanceCard(props) {
    return React.createElement(Card, { className: "index-dashboard__card" },
      React.createElement(CardHeader, { className: "index-dashboard__card-header" },
        React.createElement("div", { className: "index-dashboard__card-title-row" },
          React.createElement(CardTitle, { className: "index-dashboard__card-title" }, props.title),
          props.badge ? React.createElement(BadgeText, null, props.badge) : null,
        ),
      ),
      React.createElement(CardContent, { className: "index-dashboard__card-content" }, props.children),
    );
  }

  function BulletList(props) {
    return React.createElement("ul", { className: "index-dashboard__list" },
      props.items.map(function (item) {
        return React.createElement("li", { key: item }, item);
      }),
    );
  }

  function StatusPanel() {
    return React.createElement("div", { className: "index-dashboard__status-card" },
      React.createElement(BadgeText, null, "Static read-only"),
      React.createElement("p", null,
        "This dashboard version does not mount Python routes or call live Index APIs. Use the bundled Hermes tools and skills for authenticated work.",
      ),
    );
  }

  function IndexNetworkDashboard() {
    return React.createElement("div", { className: "index-dashboard" },
      React.createElement("section", { className: "index-dashboard__hero" },
        React.createElement("div", null,
          React.createElement("p", { className: "index-dashboard__eyebrow" }, "Index Network"),
          React.createElement("h1", { className: "index-dashboard__title" }, "Signals and autonomous negotiation"),
          React.createElement("p", { className: "index-dashboard__subtitle" },
            "A static read-only overview for the Index Network Hermes plugin. It keeps protocol guidance close to the native Hermes tools while avoiding unauthenticated dashboard backend routes.",
          ),
          React.createElement("p", { className: "index-dashboard__agent" },
            "Load index-network:index-orchestrator in Hermes chat for authenticated signal review and discovery preparation.",
          ),
        ),
        React.createElement(StatusPanel, null),
      ),

      React.createElement("div", { className: "index-dashboard__grid" },
        React.createElement(GuidanceCard, { title: "Signals", badge: "Guidance" },
          React.createElement("p", null,
            "Use signal language in user-facing copy and keep communities' visibility bounded by the configured Index agent key.",
          ),
          React.createElement(BulletList, { items: [
            "Summarize the top few relevant points instead of displaying raw records.",
            "Prefer community names and concise descriptions over internal identifiers.",
            "Use the native Hermes tools when authenticated live data is needed.",
          ] }),
        ),

        React.createElement(GuidanceCard, { title: "Protocol guide", badge: "Static" },
          React.createElement("p", null,
            "Explain Index results as short prose or bullets. Do not surface internal identifiers unless the user can act on them, and never expose tokens, raw messages, or assistant reasoning.",
          ),
          React.createElement("p", { className: "index-dashboard__muted" },
            "For interactive work, load the bundled skill index-network:index-orchestrator in Hermes.",
          ),
        ),

        React.createElement(GuidanceCard, { title: "Autonomous negotiator", badge: "Scheduled" },
          React.createElement("p", null,
            "Autonomous negotiation is handled by the bundled index-network:index-negotiator skill on a schedule. A frequent scheduled run keeps the personal-agent heartbeat fresh.",
          ),
          React.createElement(BulletList, { items: [
            "No claim button is shown here; claiming a pending turn is an authenticated tool action.",
            "No response controls are shown here; submitted negotiation actions must remain tool-confirmed.",
            "Use the schedule/gateway configuration in Hermes for autonomous operation.",
          ] }),
        ),

        React.createElement(GuidanceCard, { title: "Dashboard status", badge: "Static-only" },
          React.createElement("p", null,
            "Live dashboard routes are deferred until route authentication is documented for this plugin source. The tab remains useful without backend route mounting.",
          ),
          React.createElement(BulletList, { items: [
            "Static assets load through the Hermes dashboard plugin registry.",
            "Authenticated Index access stays in the native Hermes tools and bundled skills.",
            "Future live routes should reuse tools.py instead of adding a second Index client.",
          ] }),
        ),
      ),
    );
  }

  window.__HERMES_PLUGINS__.register("index-network", IndexNetworkDashboard);
})();