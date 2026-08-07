/* global Element, console, document */
(function installProtocolAtlasRenderer(root) {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const HOST_BOUNDARY_TEXT = "Required from host; implementation intentionally not shown.";
  const PROTOCOL_PREFIX = "packages/protocol/";

  let core;
  let content;
  let generated;
  let state;
  let generatedAvailable = false;
  let explicitSelection = false;

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
    return typeof path === "string" && path.startsWith(PROTOCOL_PREFIX) ? path : null;
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
      nodes: [...ids].map((id) => ({ id })),
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
    const suppliedGenerated = root.ProtocolAtlasGenerated;

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
    }

    state = core.parseHash(root.location ? root.location.hash : "", content, generated);
    if (!generatedAvailable && state.layer !== "protocol") {
      state = core.transition(state, { type: "set-layer", layer: "protocol" }, content, generated);
    }
    const chapter = byId(content.chapters, state.chapterId);
    if (chapter && !state.stepId && records(chapter.stepIds).length > 0) {
      state = core.transition(state, { type: "select-step", stepId: chapter.stepIds[0] }, content, generated);
    }

    document.addEventListener("keydown", handleKeyboard);
    render(state);
  }

  function dispatch(action) {
    const priorState = state;
    explicitSelection = action && action.type === "select-node" && typeof action.nodeId === "string";
    state = core.transition(state, action, content, generated);
    render(state);

    const status = document.getElementById("atlas-status");
    if (status && action && (action.type === "next-step" || action.type === "previous-step")) {
      const step = currentStep(state, content);
      status.textContent = state.stepId === priorState.stepId
        ? "End of this guided flow."
        : `Step changed to ${step ? step.title : "the selected step"}.`;
    }
  }

  function render(atlasState) {
    renderNavigation(atlasState, content);
    renderLayerControls(atlasState);
    renderChapter(atlasState, content, generated);
    renderInspector(atlasState.selectedNodeId, content, generated);

    const notice = document.getElementById("atlas-notice");
    if (notice) {
      notice.textContent = !generatedAvailable
        ? "Implementation evidence is unavailable. Curated protocol chapters remain available; Explore and code disclosures are disabled."
        : (atlasState.notice || "");
    }

    const searchButton = document.getElementById("atlas-search");
    if (searchButton) {
      searchButton.disabled = true;
      searchButton.title = "Search is not part of this guided rendering task.";
    }

    if (explicitSelection && root.matchMedia && root.matchMedia("(max-width: 900px)").matches) {
      const heading = document.getElementById("atlas-inspector-heading");
      if (heading) root.requestAnimationFrame(() => heading.focus());
    }
    explicitSelection = false;
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
      return;
    }

    if (chapter.id === "explore" && generatedAvailable) {
      const exploreStep = {
        id: "explore-evidence",
        title: "Package implementation evidence",
        summary: "A static overview of reviewed protocol package surfaces. Search and filtering are intentionally not included here.",
        conceptIds: [],
        nodeIds: records(atlasGenerated.nodes).map((node) => node.id),
        invariantIds: ["host-boundary"],
        sourcePaths: [],
        notes: { protocol: chapter.summary, implementation: chapter.summary },
      };
      appendText(target, "h2", null, exploreStep.title);
      appendText(target, "p", null, exploreStep.summary);
      target.append(renderDiagram(exploreStep, { ...atlasState, layer: "implementation" }, atlasContent, atlasGenerated));
      return;
    }

    target.append(element("p", "atlas-empty", "This chapter has no guided flow."));
  }

  function diagramRecords(step, atlasState, atlasContent, atlasGenerated) {
    if (atlasState.layer === "implementation") {
      return records(step.nodeIds).map((id) => byId(atlasGenerated.nodes, id)).filter(Boolean);
    }
    return records(step.conceptIds).map((id) => byId(atlasContent.concepts, id)).filter(Boolean);
  }

  function diagramEdges(step, atlasState, atlasContent, atlasGenerated, visibleIds) {
    if (atlasState.layer === "implementation") {
      return records(atlasGenerated.edges).filter((edge) => visibleIds.has(edge.sourceId) && visibleIds.has(edge.targetId));
    }
    return records(atlasContent.relationships)
      .filter((edge) => visibleIds.has(edge.sourceConceptId) && visibleIds.has(edge.targetConceptId))
      .map((edge) => ({ ...edge, sourceId: edge.sourceConceptId, targetId: edge.targetConceptId }));
  }

  function renderDiagram(step, atlasState, atlasContent, atlasGenerated) {
    const wrapper = element("section", "atlas-diagram-canvas");
    wrapper.setAttribute("aria-label", `${step.title} ${atlasState.layer} diagram`);
    const nodes = diagramRecords(step, atlasState, atlasContent, atlasGenerated);
    const width = Math.max(nodes.length, 1) * 200;
    wrapper.style.setProperty("--atlas-node-count", String(Math.max(nodes.length, 1)));
    wrapper.style.setProperty("--atlas-diagram-width", `${width}px`);

    const svg = document.createElementNS(SVG_NS, "svg");
    const titleId = `atlas-svg-title-${step.id}-${atlasState.layer}`;
    const descId = `atlas-svg-desc-${step.id}-${atlasState.layer}`;
    svg.setAttribute("viewBox", `0 0 ${width} 160`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-labelledby", `${titleId} ${descId}`);
    const title = document.createElementNS(SVG_NS, "title");
    title.id = titleId;
    title.textContent = `${step.title}: ${atlasState.layer} layer`;
    const description = document.createElementNS(SVG_NS, "desc");
    description.id = descId;
    description.textContent = `${nodes.length} ordered nodes. Select a node button to inspect its evidence.`;
    svg.append(title, description);

    const positions = new Map(nodes.map((node, index) => [node.id, { x: 100 + index * 200, y: 80 }]));
    const visibleIds = new Set(positions.keys());
    for (const edge of diagramEdges(step, atlasState, atlasContent, atlasGenerated, visibleIds)) {
      const source = positions.get(edge.sourceId);
      const target = positions.get(edge.targetId);
      if (!source || !target) continue;
      const group = document.createElementNS(SVG_NS, "g");
      group.setAttribute("class", `atlas-edge atlas-edge--${edge.kind || "conceptual"}`);
      group.setAttribute("data-edge-kind", edge.kind || "conceptual");
      const line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("x1", String(source.x));
      line.setAttribute("y1", String(source.y));
      line.setAttribute("x2", String(target.x));
      line.setAttribute("y2", String(target.y));
      const edgeTitle = document.createElementNS(SVG_NS, "title");
      edgeTitle.textContent = edge.label || edge.kind || "relationship";
      group.append(edgeTitle, line);
      svg.append(group);
    }

    const overlay = element("ol", "atlas-diagram-nodes");
    if (nodes.length === 0) {
      const empty = element("li", "atlas-empty", atlasState.layer === "implementation"
        ? "No generated implementation nodes are declared for this step."
        : "No protocol concepts are declared for this step.");
      overlay.append(empty);
    }
    for (const node of nodes) {
      const item = element("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "atlas-node";
      if (node.id === atlasState.selectedNodeId) button.classList.add("is-selected");
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
    wrapper.append(svg, overlay);
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
    details.append(element("summary", null, "Show code"));
    const body = element("div", "atlas-code-evidence");
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

  function closeSearch() {
    const search = document.querySelector("dialog[data-atlas-search][open]");
    if (search && typeof search.close === "function") {
      search.close();
      return true;
    }
    return false;
  }

  function handleKeyboard(event) {
    if (event.key === "Escape") {
      if (state.selectedNodeId) {
        event.preventDefault();
        dispatch({ type: "select-node", nodeId: null });
      } else if (closeSearch()) {
        event.preventDefault();
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
