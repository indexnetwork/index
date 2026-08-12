/* global Element, console, document */
(function installProtocolAtlasRenderer(root) {
  "use strict";

  const HOST_BOUNDARY_TEXT = "Required from host; implementation intentionally not shown.";
  const PROTOCOL_PREFIX = "packages/protocol/";

  let core;
  let content;
  let generated;
  let state;
  let generatedAvailable = false;
  let generatedWarning = null;
  let explicitSelection = false;
  let searchSurface = null;
  let searchReturnFocus = null;

  function records(value) {
    return Array.isArray(value) ? value : [];
  }

  function element(tagName, className, text) {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function appendText(parent, tagName, className, text) {
    if (typeof text !== "string" || text.length === 0) return null;
    const child = element(tagName, className, text);
    parent.append(child);
    return child;
  }

  function byId(items, id) {
    return records(items).find((item) => item && item.id === id) || null;
  }

  function currentFlow(atlasState, atlasContent) {
    return records(atlasContent && atlasContent.flows)
      .find((flow) => flow && flow.chapterId === atlasState.chapterId) || null;
  }

  function currentStep(atlasState, atlasContent) {
    const flow = currentFlow(atlasState, atlasContent);
    return flow && records(flow.steps).find((step) => step && step.id === atlasState.stepId) || null;
  }

  function safeProtocolPath(path) {
    if (typeof path !== "string" || !path.startsWith(PROTOCOL_PREFIX) || path.includes("\\")) return null;
    const segments = path.split("/");
    return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..") ? path : null;
  }

  function sanitizeGeneratedEdges(value) {
    if (!value || typeof value !== "object" || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) return value;
    const isRecord = (entry) => entry !== null && typeof entry === "object" && !Array.isArray(entry);
    if (value.nodes.some((node) => !isRecord(node)) || value.edges.some((edge) => !isRecord(edge))) return value;
    const nodeIds = new Set(value.nodes.map((node) => node && node.id).filter((id) => typeof id === "string"));
    const edgeIds = new Set();
    const omitted = [];
    const edges = value.edges.filter((edge, index) => {
      const valid = edge && typeof edge === "object" && !Array.isArray(edge)
        && typeof edge.id === "string" && edge.id.length > 0 && !edgeIds.has(edge.id)
        && typeof edge.sourceId === "string" && nodeIds.has(edge.sourceId)
        && typeof edge.targetId === "string" && nodeIds.has(edge.targetId)
        && typeof edge.kind === "string" && edge.kind.length > 0;
      if (!valid) {
        omitted.push(edge && typeof edge === "object"
          ? `${edge.id || `edge at index ${index}`} (${String(edge.sourceId)} -> ${String(edge.targetId)})`
          : `edge at index ${index}`);
        return false;
      }
      edgeIds.add(edge.id);
      return true;
    });
    if (omitted.length > 0) {
      console.error("Protocol Atlas omitted malformed generated edge records:", omitted);
      generatedWarning = `${omitted.length} malformed generated edge${omitted.length === 1 ? " was" : "s were"} omitted. Remaining implementation evidence is available.`;
    }
    return { ...value, edges };
  }

  function syntheticGenerated(atlasContent) {
    const ids = new Set();
    const visit = (value) => {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      for (const [key, child] of Object.entries(value)) {
        if (key === "nodeIds" && Array.isArray(child)) {
          child.forEach((id) => {
            if (typeof id === "string") ids.add(id);
          });
        } else {
          visit(child);
        }
      }
    };
    visit(atlasContent);
    return {
      schemaVersion: 1,
      nodes: [...ids].map((id) => ({
        id,
        label: id,
        kind: "public-symbol",
        layer: "implementation",
        capability: "curated-validation",
        sourcePath: "packages/protocol/README.md",
        summary: "Synthetic node used only to validate curated references before generated evidence loads.",
      })),
      edges: [],
    };
  }

  function fatalMessage(message, errors) {
    const main = document.getElementById("atlas-main");
    if (!main) return;
    main.replaceChildren();
    const panel = element("section", "atlas-empty atlas-fatal");
    const heading = element("h1", null, "Protocol Atlas unavailable");
    heading.id = "atlas-title";
    panel.append(heading, element("p", null, message));
    if (records(errors).length > 0) {
      panel.append(element("p", null, "The atlas data did not pass its local validation checks."));
    }
    const links = element("p");
    const readme = element("a", null, "Read the protocol model");
    readme.href = "../../packages/protocol/README.md";
    const implementation = element("a", null, "Read the implementation guide");
    implementation.href = "../../packages/protocol/IMPLEMENTATION.md";
    links.append(readme, document.createTextNode(" or "), implementation, document.createTextNode("."));
    panel.append(links);
    main.append(panel);
  }

  function bootstrapAtlas() {
    core = root.ProtocolAtlasCore;
    content = root.ProtocolAtlasContent;
    const suppliedGenerated = sanitizeGeneratedEdges(root.ProtocolAtlasGenerated);

    if (!core || typeof core.validateData !== "function") {
      fatalMessage("The atlas interaction core could not be loaded.", []);
      return;
    }

    const curatedValidation = core.validateData(content, syntheticGenerated(content));
    if (!curatedValidation.ok) {
      console.error("Protocol Atlas curated content validation failed:", curatedValidation.errors);
      fatalMessage("Curated protocol guidance is invalid, so the atlas cannot render it safely.", curatedValidation.errors);
      return;
    }

    const fullValidation = core.validateData(content, suppliedGenerated);
    generatedAvailable = fullValidation.ok;
    generated = generatedAvailable ? suppliedGenerated : { schemaVersion: 1, nodes: [], edges: [] };
    if (!generatedAvailable) {
      console.error("Protocol Atlas generated data validation failed:", fullValidation.errors);
    } else {
      const configuration = core.configurationAvailability(generated, content);
      if (configuration.errors.length > 0 && generated.schemaVersion === 2) {
        console.error("Protocol Atlas omitted malformed configuration experiments:", configuration.errors);
        generatedWarning = [generatedWarning, ...configuration.errors].filter(Boolean).join(" ");
      }
      if (generated.schemaVersion === 2) generated = { ...generated, configurationExperiments: configuration.experiments };
    }

    state = restoredState(root.location ? root.location.hash : "");

    document.addEventListener("keydown", handleKeyboard);
    if (typeof root.addEventListener === "function") root.addEventListener("hashchange", restoreFromHash);
    setupSearch();
    render(state);
  }

  function restoredState(hash) {
    let restored = core.parseHash(hash, content, generated);
    if (!generatedAvailable && restored.layer !== "protocol") {
      restored = core.transition(restored, { type: "set-layer", layer: "protocol" }, content, generated);
    }
    const chapter = byId(content.chapters, restored.chapterId);
    if (chapter && !restored.stepId && records(chapter.stepIds).length > 0) {
      restored = core.transition(restored, { type: "select-step", stepId: chapter.stepIds[0] }, content, generated);
    }
    return restored;
  }

  function restoreFromHash() {
    const restored = restoredState(root.location ? root.location.hash : "");
    const normalized = core.serializeHash(restored);
    const current = root.location && root.location.hash || "#";
    const priorNormalized = state && core.serializeHash(state);
    if (!restored.notice && current === normalized && priorNormalized === normalized) return;
    state = restored;
    render(state);
    if (root.location && !restored.notice && current !== normalized) {
      if (root.history && typeof root.history.replaceState === "function") {
        root.history.replaceState(root.history.state, "", normalized);
      } else if (typeof root.location.replace === "function") {
        root.location.replace(normalized);
      }
    }
  }

  function syncHash() {
    if (!root.location) return;
    const nextHash = core.serializeHash(state);
    const currentHash = root.location.hash || "#";
    if (currentHash !== nextHash) root.location.hash = nextHash;
  }

  function dispatch(action) {
    const priorState = state;
    explicitSelection = action && action.type === "select-node" && typeof action.nodeId === "string";
    state = core.transition(state, action, content, generated);
    syncHash();
    render(state);

    const status = document.getElementById("atlas-status");
    if (status && action && (action.type === "next-step" || action.type === "previous-step")) {
      const step = currentStep(state, content);
      status.textContent = state.stepId === priorState.stepId
        ? "End of this guided flow."
        : `Step changed to ${step ? step.title : "the selected step"}.`;
    } else if (status && action && (action.type === "set-filters" || action.type === "reset-filters")) {
      const activeCount = Object.values(state.filters).reduce((total, values) => total + values.length, 0);
      status.textContent = activeCount === 0 ? "Filters reset." : `${activeCount} graph filter${activeCount === 1 ? "" : "s"} active.`;
    } else if (status && state.announcement) {
      status.textContent = state.announcement;
    }
  }

  function render(atlasState) {
    renderNavigation(atlasState, content);
    renderLayerControls(atlasState);
    renderChapter(atlasState, content, generated);
    renderInspector(atlasState.selectedNodeId, content, generated);
    renderFilters(atlasState);

    if (atlasState.focusIntent) {
      const selector = `input[name="configuration-mode"][data-experiment-id="${atlasState.focusIntent.experimentId}"][value="${atlasState.focusIntent.modeId}"]`;
      const replacement = document.querySelector(selector);
      if (replacement && typeof replacement.focus === "function") replacement.focus();
    }

    const notice = document.getElementById("atlas-notice");
    if (notice) {
      const messages = [];
      if (!generatedAvailable) messages.push("Implementation evidence is unavailable. Curated protocol chapters remain available; Explore and code disclosures are disabled.");
      else if (generatedWarning) messages.push(generatedWarning);
      if (atlasState.notice) messages.push(atlasState.notice);
      notice.textContent = messages.join(" ");
    }

    if (explicitSelection && root.matchMedia && root.matchMedia("(max-width: 900px)").matches) {
      const heading = document.getElementById("atlas-inspector-heading");
      if (heading) root.requestAnimationFrame(() => heading.focus());
    }
    explicitSelection = false;
  }

  function setupSearch() {
    const trigger = document.getElementById("atlas-search");
    if (!trigger) return;
    trigger.disabled = false;
    trigger.removeAttribute("title");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-controls", "atlas-search-dialog");
    trigger.addEventListener("click", openSearch);
  }

  function ensureSearchSurface() {
    if (searchSurface) return searchSurface;
    const dialogCandidate = document.createElement("dialog");
    const native = typeof root.HTMLDialogElement === "function" && typeof dialogCandidate.showModal === "function";
    const surface = native ? dialogCandidate : element("section");
    surface.className = "atlas-search-dialog";
    surface.id = "atlas-search-dialog";
    surface.dataset.atlasSearch = "";
    if (!native) {
      surface.hidden = true;
      surface.setAttribute("role", "dialog");
    }
    const heading = element("h2", null, "Search the Protocol Atlas");
    heading.id = "atlas-search-heading";
    surface.setAttribute("aria-labelledby", heading.id);
    const input = document.createElement("input");
    input.type = "search";
    input.setAttribute("aria-label", "Search atlas concepts and components");
    input.autocomplete = "off";
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "Close search";
    close.addEventListener("click", () => closeSearch(true));
    const header = element("div", "atlas-search-header");
    header.append(heading, close);
    const results = element("div", "atlas-search-results-region");
    input.addEventListener("input", () => {
      state = core.transition(state, { type: "set-query", query: input.value }, content, generated);
      renderSearchResults(input.value, results);
    });
    surface.append(header, input, results);
    if (native) surface.addEventListener("close", () => finishSearchClose(true));
    document.body.append(surface);
    searchSurface = { surface, input, results, native };
    return searchSurface;
  }

  function openSearch() {
    const search = ensureSearchSurface();
    const trigger = document.getElementById("atlas-search");
    searchReturnFocus = trigger;
    if (trigger) trigger.setAttribute("aria-expanded", "true");
    search.input.value = state.query || "";
    renderSearchResults(search.input.value, search.results);
    if (search.native && typeof search.surface.showModal === "function") search.surface.showModal();
    else search.surface.hidden = false;
    search.input.focus();
  }

  function finishSearchClose(returnFocus) {
    const trigger = document.getElementById("atlas-search");
    if (trigger) trigger.setAttribute("aria-expanded", "false");
    if (returnFocus && searchReturnFocus && typeof searchReturnFocus.focus === "function") searchReturnFocus.focus();
    searchReturnFocus = null;
  }

  function closeSearch(returnFocus) {
    if (!searchSurface) return false;
    const { surface, native } = searchSurface;
    const isOpen = native ? surface.hasAttribute("open") : !surface.hidden;
    if (!isOpen) return false;
    if (native && typeof surface.close === "function") surface.close();
    else {
      surface.hidden = true;
      finishSearchClose(returnFocus);
    }
    return true;
  }

  function primaryLocation(item, implementation) {
    if (implementation) {
      for (const flow of records(content.flows)) {
        const step = records(flow.steps).find((candidate) => records(candidate.nodeIds).includes(item.id));
        if (step) return { chapterId: flow.chapterId, stepId: step.id };
      }
      const chapterId = records(item.chapterIds).find((id) => byId(content.chapters, id));
      return { chapterId: chapterId || "explore", stepId: null };
    }
    for (const flow of records(content.flows)) {
      const step = records(flow.steps).find((candidate) => records(candidate.conceptIds).includes(item.id));
      if (step) return { chapterId: flow.chapterId, stepId: step.id };
    }
    return { chapterId: "orientation", stepId: null };
  }

  function selectSearchResult(item) {
    const implementation = Boolean(byId(generated.nodes, item.id));
    const location = primaryLocation(item, implementation);
    state = core.transition(state, { type: "select-chapter", chapterId: location.chapterId }, content, generated);
    if (location.stepId) state = core.transition(state, { type: "select-step", stepId: location.stepId }, content, generated);
    if (implementation) state = core.transition(state, { type: "set-layer", layer: "implementation" }, content, generated);
    state = core.transition(state, { type: "select-node", nodeId: item.id }, content, generated);
    syncHash();
    render(state);
    closeSearch(true);
    const status = document.getElementById("atlas-status");
    if (status) status.textContent = `Navigated to ${item.label || item.title || item.id}.`;
  }

  function renderSearchResults(query, target) {
    target.replaceChildren();
    const matches = core.searchItems(query, content, generated);
    if (typeof query === "string" && query.trim() && matches.length === 0) {
      const empty = element("div", "atlas-search-empty");
      empty.append(element("p", null, "No atlas concepts or components match this query."));
      const reset = document.createElement("button");
      reset.type = "button";
      reset.textContent = "Reset query";
      reset.addEventListener("click", () => {
        searchSurface.input.value = "";
        state = core.transition(state, { type: "set-query", query: "" }, content, generated);
        renderSearchResults("", target);
        searchSurface.input.focus();
      });
      empty.append(reset);
      target.append(empty);
      return;
    }
    const list = element("ol", "atlas-search-results");
    for (const item of matches) {
      const implementation = Boolean(byId(generated.nodes, item.id));
      const location = primaryLocation(item, implementation);
      const button = document.createElement("button");
      button.type = "button";
      appendText(button, "strong", null, item.label || item.title || item.id);
      appendText(button, "span", "atlas-search-symbol", item.symbol);
      const kind = item.kind || (implementation ? "component" : "protocol concept");
      appendText(button, "span", "atlas-search-meta", [location.chapterId, item.capability, kind].filter(Boolean).join(" · "));
      button.addEventListener("click", () => selectSearchResult(item));
      const entry = element("li");
      entry.append(button);
      list.append(entry);
    }
    target.append(list);
  }

  function renderLayerControls(atlasState) {
    const target = document.getElementById("atlas-layer-toggle");
    if (!target) return;
    target.replaceChildren();
    for (const layer of ["protocol", "implementation"]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = layer;
      button.setAttribute("aria-pressed", String(atlasState.layer === layer));
      if (layer === "implementation" && !generatedAvailable) {
        button.disabled = true;
        button.title = "Generated implementation evidence is unavailable.";
      }
      button.addEventListener("click", () => dispatch({ type: "set-layer", layer }));
      target.append(button);
    }
  }

  function renderNavigation(atlasState, atlasContent) {
    const target = document.getElementById("atlas-nav");
    if (!target) return;
    target.replaceChildren();
    const list = element("ol");
    for (const chapter of records(atlasContent.chapters)) {
      const item = element("li");
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = chapter.title;
      if (chapter.id === atlasState.chapterId) button.setAttribute("aria-current", "page");
      if (chapter.id === "explore" && !generatedAvailable) {
        button.disabled = true;
        button.title = "Explore requires generated implementation evidence.";
      }
      button.addEventListener("click", () => dispatch({ type: "select-chapter", chapterId: chapter.id }));
      item.append(button);
      list.append(item);
    }
    target.append(list);
  }

  function facetValues(key) {
    const source = key === "edgeKinds" ? generated.edges : generated.nodes;
    const property = key === "edgeKinds" ? "kind" : (key === "kinds" ? "kind" : "capability");
    return [...new Set(records(source).map((item) => item && item[property]).filter((value) => typeof value === "string"))].sort();
  }

  function renderFilters(atlasState) {
    const target = document.getElementById("atlas-filters");
    if (!target) return;
    target.replaceChildren();
    if (!generatedAvailable || (atlasState.layer !== "implementation" && atlasState.chapterId !== "explore")) return;
    if (atlasState.configurationExperimentId) {
      target.append(element("p", "configuration-filter-note", "Explore filters are preserved but inactive while a Configuration Lab experiment is focused."));
      return;
    }
    const labels = { capabilities: "Capability", kinds: "Component kind", edgeKinds: "Edge kind" };
    for (const key of ["capabilities", "kinds", "edgeKinds"]) {
      const fieldset = element("fieldset", "atlas-filter-group");
      fieldset.append(element("legend", null, labels[key]));
      for (const value of facetValues(key)) {
        const label = element("label", "atlas-filter-option");
        const input = document.createElement("input");
        input.type = "checkbox";
        input.name = key;
        input.value = value;
        input.checked = records(atlasState.filters[key]).includes(value);
        input.addEventListener("change", () => {
          const restoreFocus = document.activeElement === input;
          const filters = {
            capabilities: [...atlasState.filters.capabilities],
            kinds: [...atlasState.filters.kinds],
            edgeKinds: [...atlasState.filters.edgeKinds],
          };
          filters[key] = input.checked
            ? [...new Set([...filters[key], value])]
            : filters[key].filter((candidate) => candidate !== value);
          dispatch({ type: "set-filters", filters });
          if (restoreFocus) {
            const replacement = [...target.querySelectorAll("input")]
              .find((candidate) => candidate.name === key && candidate.value === value);
            if (replacement) replacement.focus();
          }
        });
        label.append(input, document.createTextNode(value));
        fieldset.append(label);
      }
      target.append(fieldset);
    }
    const reset = document.createElement("button");
    reset.type = "button";
    reset.textContent = "Reset filters";
    reset.disabled = !Object.values(atlasState.filters).some((values) => values.length > 0);
    reset.addEventListener("click", () => dispatch({ type: "reset-filters" }));
    target.append(reset);
  }

  function renderChapter(atlasState, atlasContent, atlasGenerated) {
    const target = document.getElementById("atlas-diagram");
    if (!target) return;
    target.replaceChildren();
    const chapter = byId(atlasContent.chapters, atlasState.chapterId) || atlasContent.chapters[0];
    if (!chapter) return;

    const heading = element("h1", null, chapter.title);
    heading.id = "atlas-title";
    target.append(heading);
    appendText(target, "p", "atlas-lede", chapter.summary);
    renderChapterTeaching(target, chapter);

    const flow = currentFlow(atlasState, atlasContent);
    if (!flow) {
      renderChapterOverview(target, chapter, atlasState, atlasContent, atlasGenerated);
      return;
    }

    const step = records(flow.steps).find((candidate) => candidate.id === atlasState.stepId) || flow.steps[0];
    target.append(renderStepper(flow, step, atlasState));
    const stepHeader = element("header", "atlas-step-header");
    appendText(stepHeader, "p", "atlas-eyebrow", flow.title);
    appendText(stepHeader, "h2", null, step.title);
    appendText(stepHeader, "p", "atlas-step-summary", step.summary);
    target.append(stepHeader, renderDiagram(step, atlasState, atlasContent, atlasGenerated));

    const actions = element("div", "atlas-step-actions");
    const previousButton = document.createElement("button");
    previousButton.type = "button";
    previousButton.textContent = "Previous";
    previousButton.disabled = !step.previous;
    previousButton.addEventListener("click", () => dispatch({ type: "previous-step" }));
    const nextButton = document.createElement("button");
    nextButton.type = "button";
    nextButton.textContent = "Next";
    nextButton.disabled = !step.next;
    nextButton.addEventListener("click", () => dispatch({ type: "next-step" }));
    actions.append(previousButton, nextButton);
    target.append(actions);
  }

  function renderChapterTeaching(target, chapter) {
    const sections = records(chapter.sections);
    if (sections.length === 0) return;
    const teaching = element("section", "atlas-chapter-teaching");
    teaching.setAttribute("aria-label", `${chapter.title} chapter briefing`);
    appendText(teaching, "h2", null, "Chapter briefing");
    const grid = element("div", "atlas-teaching-grid");
    for (const section of sections) {
      const card = element("article", "atlas-card atlas-teaching-card");
      appendText(card, "h3", null, section.title);
      appendText(card, "p", null, section.summary);
      const items = element("ul", "atlas-teaching-items");
      for (const item of records(section.items)) items.append(element("li", null, item));
      card.append(items);
      grid.append(card);
    }
    teaching.append(grid);
    target.append(teaching);
  }

  function renderCuratedNotes(target, atlasContent) {
    const groups = [
      { kind: "discrepancy", title: "Source discrepancies", className: "atlas-discrepancies" },
      { kind: "reference-concept", title: "Reference-implementation concepts", className: "atlas-reference-notes" },
    ];
    for (const group of groups) {
      const notes = records(atlasContent.relationships).filter((record) => record.kind === group.kind);
      if (notes.length === 0) continue;
      const section = element("section", `atlas-curated-notes ${group.className}`);
      appendText(section, "h2", null, group.title);
      const list = element("ul", "atlas-note-list");
      for (const note of notes) {
        const item = element("li", "atlas-note-callout");
        appendText(item, "h3", null, note.title);
        appendText(item, "p", null, note.summary);
        list.append(item);
      }
      section.append(list);
      target.append(section);
    }
  }

  function renderChapterOverview(target, chapter, atlasState, atlasContent, atlasGenerated) {
    if (chapter.id === "orientation") {
      const grid = element("div", "atlas-overview-grid");
      const protocolCard = element("article", "atlas-card");
      appendText(protocolCard, "h2", null, "Protocol layer");
      appendText(protocolCard, "p", null, "Normative concepts, trust boundaries, and invariants describe what every conforming implementation must preserve.");
      const implementationCard = element("article", "atlas-card");
      appendText(implementationCard, "h2", null, "Implementation layer");
      appendText(implementationCard, "p", null, "Generated evidence points only into packages/protocol and marks host obligations as explicit boundaries.");
      grid.append(protocolCard, implementationCard);
      target.append(grid);
      renderCuratedNotes(target, atlasContent);
      return;
    }

    if (chapter.id === "explore" && generatedAvailable) {
      const exploreStep = {
        id: "explore-evidence",
        title: "Package implementation evidence",
        summary: "A static overview of reviewed protocol package surfaces. Use the filters below to focus the generated graph.",
        conceptIds: [],
        nodeIds: records(atlasGenerated.nodes).map((node) => node.id),
        invariantIds: ["host-boundary"],
        sourcePaths: [],
        notes: { protocol: chapter.summary, implementation: chapter.summary },
      };
      appendText(target, "h2", null, exploreStep.title);
      appendText(target, "p", null, exploreStep.summary);
      renderConfigurationLab(target, atlasState, atlasContent, atlasGenerated);
      target.append(renderDiagram(exploreStep, { ...atlasState, layer: "implementation" }, atlasContent, atlasGenerated));
      return;
    }

    target.append(element("p", "atlas-empty", "This chapter has no guided flow."));
  }

  function configurationEffectLabel(effect) {
    return { activated: "+ activated", bypassed: "− bypassed", changed: "~ changed", unresolved: "? unresolved" }[effect] || "? unresolved";
  }

  function renderConfigurationLab(target, atlasState, atlasContent, atlasGenerated) {
    const section = element("section", "configuration-lab");
    section.setAttribute("aria-labelledby", "configuration-lab-title");
    const heading = element("h2", null, "Configuration Lab");
    heading.id = "configuration-lab-title";
    section.append(heading, element("p", "configuration-disclaimer", atlasContent.configurationDisclaimer || "Configuration comparisons use package fallbacks only."));
    section.append(element("p", "configuration-coverage", "Coverage: reviewed non-secret behavior gates only. Credentials, provider tuning, ordinary timeouts, and throughput settings are excluded. Unresolved paths are not deprecated."));

    const availability = core.configurationAvailability(atlasGenerated, atlasContent);
    if (!availability.available) {
      section.append(element("p", "atlas-empty configuration-unavailable", availability.errors[0]));
      target.append(section);
      return;
    }
    if (availability.errors.length > 0) section.append(element("p", "configuration-warning", availability.errors.join(" ")));

    const experimentFieldset = element("fieldset", "configuration-experiments");
    experimentFieldset.append(element("legend", null, "Behavior experiment"));
    for (const experiment of availability.experiments) {
      const label = element("label", "configuration-experiment-option");
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "configuration-experiment";
      input.value = experiment.id;
      input.checked = atlasState.configurationExperimentId === experiment.id;
      input.addEventListener("change", () => dispatch({ type: "select-configuration-experiment", experimentId: experiment.id }));
      label.append(input, document.createTextNode(experiment.title));
      experimentFieldset.append(label);
    }
    section.append(experimentFieldset);

    const experiment = availability.experiments.find((candidate) => candidate.id === atlasState.configurationExperimentId);
    if (!experiment) {
      section.append(element("p", "configuration-empty", "Choose one experiment to compare a named mode with package fallback behavior."));
      target.append(section);
      return;
    }

    const modeFieldset = element("fieldset", "configuration-modes");
    modeFieldset.append(element("legend", null, `${experiment.title} modes`));
    for (const mode of records(experiment.modes)) {
      const label = element("label", "configuration-mode-option");
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "configuration-mode";
      input.value = mode.id;
      input.dataset.experimentId = experiment.id;
      input.checked = atlasState.configurationModeId === mode.id;
      input.addEventListener("change", () => dispatch({ type: "select-configuration-mode", experimentId: experiment.id, modeId: mode.id }));
      label.append(input, document.createTextNode(mode.id === experiment.fallbackModeId ? `${mode.id} (package fallback)` : mode.id));
      modeFieldset.append(label);
    }
    const reset = document.createElement("button");
    reset.type = "button";
    reset.textContent = "Reset to package fallback";
    reset.disabled = atlasState.configurationModeId === experiment.fallbackModeId;
    reset.addEventListener("click", () => dispatch({ type: "reset-configuration" }));
    modeFieldset.append(reset);
    section.append(modeFieldset);

    const comparison = core.deriveConfigurationComparison(experiment.id, atlasState.configurationModeId, atlasContent, atlasGenerated);
    if (!comparison) {
      section.append(element("p", "atlas-empty", "No reviewed comparison is available for this mode."));
      target.append(section);
      return;
    }
    const panel = element("section", "configuration-comparison");
    appendText(panel, "h3", null, "Fallback versus selected mode");
    appendText(panel, "p", "configuration-explanation", comparison.mode.explanation);
    const assignments = element("dl", "configuration-assignments");
    const selectedAssignments = new Map(records(comparison.assignments).map((entry) => [entry.key, entry.value]));
    const selectedResolved = new Map(records(comparison.resolvedValues).map((entry) => [entry.key, entry.value]));
    const fallbackMode = records(experiment.modes).find((candidate) => candidate.id === experiment.fallbackModeId);
    const fallbackAssignments = new Map(records(fallbackMode && fallbackMode.assignments).map((entry) => [entry.key, entry.value]));
    const fallbackResolved = new Map(records(fallbackMode && fallbackMode.resolvedValues).map((entry) => [entry.key, entry.value]));
    for (const setting of records(experiment.settings)) {
      const selectedValue = selectedAssignments.get(setting.key);
      const fallbackValue = fallbackAssignments.get(setting.key);
      const detail = element("dd", null);
      detail.append(
        element("span", "configuration-assignment-fallback", `Package fallback: ${fallbackValue === null ? "unset" : fallbackValue} → ${fallbackResolved.get(setting.key)}`),
        element("span", "configuration-assignment-selected", `Selected mode: ${selectedValue === null ? "unset" : selectedValue} → ${selectedResolved.get(setting.key)}`),
      );
      assignments.append(element("dt", null, setting.key), detail);
    }
    panel.append(assignments);

    appendText(panel, "h3", null, "Setting evidence");
    const settingEvidence = element("ul", "configuration-setting-evidence");
    for (const setting of records(experiment.settings)) {
      const item = element("li", null);
      appendText(item, "strong", null, `${setting.key} — ${setting.readTiming}`);
      for (const site of records(setting.readSites)) appendText(item, "code", "configuration-evidence", `Read: ${site.path}#${site.symbol}`);
      for (const hop of records(setting.accessorClosure)) appendText(item, "code", "configuration-evidence", `Accessor: ${hop.path}#${hop.symbol}`);
      settingEvidence.append(item);
    }
    panel.append(settingEvidence);
    appendText(panel, "p", "configuration-associations", `Affected chapters: ${records(comparison.affectedChapterIds).join(", ") || "none"}`);
    appendText(panel, "p", "configuration-associations", `Affected steps: ${records(comparison.affectedStepIds).join(", ") || "none"}`);

    if (records(comparison.prerequisites).length > 0) {
      appendText(panel, "h3", null, "Prerequisites");
      const list = element("ul", "configuration-prerequisites");
      for (const prerequisite of comparison.prerequisites) list.append(element("li", `configuration-prerequisite--${prerequisite.status}`, `${prerequisite.kind}: ${prerequisite.key || prerequisite.nodeId} — ${prerequisite.status}`));
      panel.append(list);
    }

    appendText(panel, "h3", null, "Visible behavior delta");
    const deltas = element("ul", "configuration-deltas");
    if (comparison.deltas.length === 0) {
      const emptyText = comparison.mode.id === comparison.experiment.fallbackModeId
        ? "Package fallback selected: no counterfactual delta is applied."
        : "No reviewed visual delta is available for this mode; the atlas shows the assignment without inventing a topology effect.";
      deltas.append(element("li", "configuration-delta-empty", emptyText));
    }
    for (const delta of comparison.deltas) {
      const item = element("li", `configuration-delta configuration-delta--${delta.effect}`);
      appendText(item, "strong", "configuration-delta__label", configurationEffectLabel(delta.effect));
      appendText(item, "span", null, `${delta.targetKind}: ${delta.targetId}`);
      if (delta.consumerPath) appendText(item, "code", "configuration-evidence", `Consumer: ${delta.consumerPath}#${delta.consumerSymbol}`);
      if (records(delta.referenceChain).length > 0) {
        const chain = element("ol", "configuration-reference-chain");
        for (const hop of delta.referenceChain) chain.append(element("li", null, `${hop.path}#${hop.symbol}`));
        item.append(chain);
      }
      if (delta.behaviorTest) appendText(item, "code", "configuration-evidence", `Behavior test: ${delta.behaviorTest.path} — ${delta.behaviorTest.testName}`);
      if (delta.effect === "unresolved") appendText(item, "span", "configuration-caveat", "No direct protocol behavior consumer is established; no effect is invented.");
      deltas.append(item);
    }
    panel.append(deltas);
    if (records(comparison.mode.caveats).length > 0) {
      appendText(panel, "h3", null, "Caveats");
      const caveats = element("ul", "configuration-caveats");
      for (const caveat of comparison.mode.caveats) caveats.append(element("li", null, caveat));
      panel.append(caveats);
    }
    section.append(panel);
    target.append(section);
  }

  function activeConfigurationComparison(atlasState, atlasContent, atlasGenerated) {
    return atlasState.configurationExperimentId && atlasState.configurationModeId
      ? core.deriveConfigurationComparison(atlasState.configurationExperimentId, atlasState.configurationModeId, atlasContent, atlasGenerated)
      : null;
  }

  function diagramRecords(step, atlasState, atlasContent, atlasGenerated) {
    if (atlasState.layer === "implementation") {
      const appliedFilters = atlasState.configurationExperimentId ? { capabilities: [], kinds: [], edgeKinds: [] } : atlasState.filters;
      const filteredIds = new Set(core.filterGraph(appliedFilters, atlasGenerated).nodes.map((node) => node.id));
      return records(step.nodeIds).map((id) => byId(atlasGenerated.nodes, id)).filter((node) => node && filteredIds.has(node.id));
    }
    return records(step.conceptIds).map((id) => byId(atlasContent.concepts, id)).filter(Boolean);
  }

  function diagramEdges(step, atlasState, atlasContent, atlasGenerated, visibleIds) {
    if (atlasState.layer === "implementation") {
      const appliedFilters = atlasState.configurationExperimentId ? { capabilities: [], kinds: [], edgeKinds: [] } : atlasState.filters;
      return core.filterGraph(appliedFilters, atlasGenerated).edges
        .filter((edge) => visibleIds.has(edge.sourceId) && visibleIds.has(edge.targetId));
    }
    return records(atlasContent.relationships)
      .filter((edge) => visibleIds.has(edge.sourceConceptId) && visibleIds.has(edge.targetConceptId))
      .map((edge) => ({ ...edge, sourceId: edge.sourceConceptId, targetId: edge.targetConceptId }));
  }

  function renderDiagram(step, atlasState, atlasContent, atlasGenerated) {
    const wrapper = element("section", "atlas-flow-map");
    wrapper.setAttribute("aria-label", `${step.title} ${atlasState.layer} diagram`);
    const nodes = diagramRecords(step, atlasState, atlasContent, atlasGenerated);

    const comparison = activeConfigurationComparison(atlasState, atlasContent, atlasGenerated);
    if (comparison) wrapper.classList.add("configuration-comparison-active");
    const deltaByTarget = new Map(records(comparison && comparison.deltas).map((delta) => [delta.targetId, delta]));
    const visibleIds = new Set(nodes.map((node) => node.id));
    const visibleEdges = diagramEdges(step, atlasState, atlasContent, atlasGenerated, visibleIds);

    const relationshipSection = element("section", "atlas-relationship-fallback");
    appendText(relationshipSection, "h3", null, "Relationships");
    const relationshipList = element("ul", "atlas-diagram-relations");
    relationshipList.setAttribute("aria-label", `${step.title} relationships`);
    for (const edge of visibleEdges) {
      const source = byId(nodes, edge.sourceId);
      const target = byId(nodes, edge.targetId);
      if (!source || !target) continue;
      const edgeDelta = deltaByTarget.get(edge.id);
      const item = element("li", `atlas-relationship atlas-relationship--${edge.kind || "conceptual"}${edgeDelta ? ` configuration-delta--${edgeDelta.effect}` : ""}`);
      item.setAttribute("data-edge-kind", edge.kind || "conceptual");
      appendText(item, "strong", "atlas-relationship__source", source.label || source.title || source.id);
      appendText(item, "span", "atlas-relationship__kind", `${edge.kind || "conceptual"}: ${edge.label || edge.kind || "relationship"}`);
      appendText(item, "strong", "atlas-relationship__target", target.label || target.title || target.id);
      if (edgeDelta) appendText(item, "span", "configuration-delta__label", configurationEffectLabel(edgeDelta.effect));
      relationshipList.append(item);
    }
    relationshipSection.append(relationshipList);

    const overlay = element("ol", "atlas-node-grid");
    if (nodes.length === 0) {
      const filtersActive = atlasState.layer === "implementation"
        && Object.values(atlasState.filters).some((values) => values.length > 0);
      const empty = element("li", `atlas-empty${filtersActive ? " atlas-filter-empty" : ""}`);
      empty.append(element("p", null, filtersActive
        ? "No components match these filters. Reset filters or broaden the selection."
        : (atlasState.layer === "implementation"
          ? "No generated implementation nodes are declared for this step."
          : "No protocol concepts are declared for this step.")));
      if (filtersActive) {
        const reset = document.createElement("button");
        reset.type = "button";
        reset.textContent = "Reset filters";
        reset.addEventListener("click", () => dispatch({ type: "reset-filters" }));
        empty.append(reset);
      }
      overlay.append(empty);
    }
    for (const node of nodes) {
      const item = element("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "atlas-node";
      if (node.id === atlasState.selectedNodeId) button.classList.add("is-selected");
      const nodeDelta = deltaByTarget.get(node.id);
      if (nodeDelta) {
        button.classList.add(`configuration-delta--${nodeDelta.effect}`);
        appendText(button, "span", "configuration-delta__label", configurationEffectLabel(nodeDelta.effect));
      }
      button.setAttribute("aria-pressed", String(node.id === atlasState.selectedNodeId));
      appendText(button, "span", "atlas-node__kind", node.kind || (node.normative ? "normative concept" : "reference concept"));
      appendText(button, "strong", null, node.label || node.title || node.id);
      appendText(button, "span", "atlas-node__meta", node.capability || node.definition || node.summary);
      if (node.kind === "host-requirement") {
        button.classList.add("atlas-node--boundary");
        appendText(button, "span", "atlas-boundary-callout", HOST_BOUNDARY_TEXT);
      }
      button.addEventListener("click", () => dispatch({ type: "select-node", nodeId: node.id }));
      item.append(button);
      overlay.append(item);
    }
    wrapper.append(overlay, relationshipSection);
    return wrapper;
  }

  function renderStepper(flow, step, atlasState) {
    const list = element("ol", "atlas-stepper");
    list.setAttribute("aria-label", `${flow.title} steps`);
    for (const candidate of records(flow.steps)) {
      const item = element("li");
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = candidate.title;
      if (candidate.id === ((step && step.id) || atlasState.stepId)) button.setAttribute("aria-current", "step");
      button.addEventListener("click", () => dispatch({ type: "select-step", stepId: candidate.id }));
      item.append(button);
      list.append(item);
    }
    return list;
  }

  function vocabularyFor(item, step, atlasContent) {
    const concepts = records(step && step.conceptIds).map((id) => byId(atlasContent.concepts, id)).filter(Boolean);
    const terms = [item && item.title, item && item.label, item && item.symbol, item && item.sourcePath]
      .concat(concepts.map((concept) => concept.title))
      .filter(Boolean).join(" ").toLocaleLowerCase();
    return records(atlasContent.vocabulary).filter((entry) => [entry.protocolTerm, entry.productTerm, entry.implementationTerm]
      .some((term) => typeof term === "string" && terms.includes(term.toLocaleLowerCase())));
  }

  function appendDefinitionList(parent, entries) {
    const available = entries.filter(([, value]) => typeof value === "string" && value.length > 0);
    if (available.length === 0) return;
    const list = element("dl", "atlas-metadata");
    for (const [label, value] of available) {
      list.append(element("dt", null, label), element("dd", null, value));
    }
    parent.append(list);
  }

  function renderInspector(selectedNodeId, atlasContent, atlasGenerated) {
    const target = document.getElementById("atlas-inspector");
    if (!target) return;
    target.replaceChildren();
    if (!selectedNodeId) return;

    const concept = byId(atlasContent.concepts, selectedNodeId);
    const implementation = byId(atlasGenerated.nodes, selectedNodeId);
    const selected = concept || implementation;
    if (!selected) return;
    const step = currentStep(state, atlasContent);

    const panel = element("section", "atlas-inspector");
    const heading = element("h2", null, selected.title || selected.label || selected.id);
    heading.id = "atlas-inspector-heading";
    heading.tabIndex = -1;
    panel.append(heading);
    appendText(panel, "p", "atlas-inspector__definition", selected.definition || selected.summary);

    if (step) {
      appendText(panel, "h3", null, "Role in this step");
      appendText(panel, "p", null, step.notes && step.notes[state.layer] || step.summary);
      const invariants = records(step.invariantIds).map((id) => byId(atlasContent.invariants, id)).filter(Boolean);
      if (invariants.length > 0) {
        appendText(panel, "h3", null, "Invariants");
        const list = element("ul", "atlas-inspector-list");
        for (const invariant of invariants) {
          const item = element("li");
          appendText(item, "strong", null, invariant.title || invariant.id);
          item.append(document.createTextNode(` — ${invariant.text}`));
          list.append(item);
        }
        panel.append(list);
      }
    }

    const vocabulary = vocabularyFor(selected, step, atlasContent);
    if (vocabulary.length > 0) {
      appendText(panel, "h3", null, "Vocabulary mapping");
      const list = element("ul", "atlas-inspector-list");
      for (const mapping of vocabulary) {
        list.append(element("li", null, `${mapping.protocolTerm} / ${mapping.productTerm} / ${mapping.implementationTerm}`));
      }
      panel.append(list);
    }

    const sourcePath = safeProtocolPath(selected.sourcePath);
    appendDefinitionList(panel, [
      ["Kind", selected.kind || (selected.normative ? "normative concept" : "reference concept")],
      ["Capability", selected.capability],
      ["Source path", sourcePath],
      ["Symbol", selected.symbol],
      ["Stability", selected.stability],
    ]);

    if (selected.kind === "host-requirement") {
      panel.append(element("p", "atlas-boundary-callout", HOST_BOUNDARY_TEXT));
    }
    if (generatedAvailable && sourcePath) panel.append(renderCodeDisclosure(sourcePath, selected.symbol));
    target.append(panel);
  }

  function renderCodeDisclosure(path, symbol) {
    const details = element("details", "atlas-disclosure");
    const disclosureId = `atlas-code-${Math.random().toString(36).slice(2)}`;
    const summary = element("summary", null, "Show code");
    summary.setAttribute("aria-controls", disclosureId);
    summary.setAttribute("aria-expanded", "false");
    details.addEventListener("toggle", () => summary.setAttribute("aria-expanded", String(details.open)));
    details.append(summary);
    const body = element("div", "atlas-code-evidence");
    body.id = disclosureId;
    appendText(body, "p", null, "Protocol package evidence");
    const code = element("code", null, symbol ? `${path}#${symbol}` : path);
    code.dataset.copyPath = path;
    const copy = document.createElement("button");
    copy.type = "button";
    copy.textContent = "Copy path";
    copy.addEventListener("click", () => copyPath(path, code, copy));
    body.append(code, copy);
    details.append(body);
    return details;
  }

  async function copyPath(path, code, button) {
    let copied = false;
    try {
      if (root.navigator && root.navigator.clipboard && typeof root.navigator.clipboard.writeText === "function") {
        await root.navigator.clipboard.writeText(path);
        copied = true;
      }
    } catch {
      copied = false;
    }

    if (!copied) {
      const textarea = element("textarea", "visually-hidden");
      textarea.value = path;
      textarea.readOnly = true;
      document.body.append(textarea);
      textarea.select();
      try {
        copied = typeof document.execCommand === "function" && document.execCommand("copy");
      } catch {
        copied = false;
      }
      textarea.remove();
    }

    if (!copied && root.getSelection && document.createRange) {
      const range = document.createRange();
      range.selectNodeContents(code);
      const selection = root.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }

    const status = document.getElementById("atlas-status");
    if (status) status.textContent = copied ? "Path copied." : "Path selected. Copy it with your system copy command.";
    button.textContent = copied ? "Copied" : "Path selected";
  }

  function keyboardIsExcluded(target) {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest("input, textarea, select, summary, details, [role='search'], [role='dialog'], #atlas-search"));
  }

  function handleKeyboard(event) {
    if (event.key === "Escape") {
      if (closeSearch(true)) {
        event.preventDefault();
      } else if (state.selectedNodeId) {
        event.preventDefault();
        dispatch({ type: "select-node", nodeId: null });
      }
      return;
    }
    if (keyboardIsExcluded(event.target)) return;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      dispatch({ type: "next-step" });
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      dispatch({ type: "previous-step" });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrapAtlas, { once: true });
  } else {
    bootstrapAtlas();
  }
}(globalThis));
