(function installProtocolAtlasCore(root) {
  "use strict";

  const RECOVERY_NOTICE = "That atlas location no longer exists. Returned to Orientation.";
  const LAYERS = new Set(["protocol", "implementation"]);
  const FILTER_KEYS = ["capabilities", "kinds", "edgeKinds"];

  function emptyFilters() {
    return { capabilities: [], kinds: [], edgeKinds: [] };
  }

  function defaultState() {
    return {
      chapterId: "orientation",
      stepId: null,
      layer: "protocol",
      selectedNodeId: null,
      query: "",
      filters: emptyFilters(),
      notice: null,
    };
  }

  function records(value) {
    return Array.isArray(value) ? value : [];
  }

  function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function stringArray(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
  }

  function normalizedFilters(filters) {
    const source = isRecord(filters) ? filters : {};
    return {
      capabilities: stringArray(source.capabilities),
      kinds: stringArray(source.kinds),
      edgeKinds: stringArray(source.edgeKinds),
    };
  }

  function chapterById(content, chapterId) {
    return records(content && content.chapters).find((chapter) => chapter && chapter.id === chapterId);
  }

  function flowStep(content, stepId) {
    for (const flow of records(content && content.flows)) {
      const step = records(flow && flow.steps).find((candidate) => candidate && candidate.id === stepId);
      if (step) return step;
    }
    return null;
  }

  function validSelectedNode(nodeId, content, generated) {
    if (nodeId === null) return true;
    if (typeof nodeId !== "string" || nodeId.length === 0) return false;
    return records(content && content.concepts).some((concept) => concept && concept.id === nodeId)
      || records(generated && generated.nodes).some((node) => node && node.id === nodeId);
  }

  function parseFilter(value) {
    if (value === null) return [];
    if (value.length === 0) return null;
    const parsed = value.split(",");
    return parsed.every((item) => item.length > 0) ? parsed : null;
  }

  function filtersAreValid(filters, generated) {
    const nodes = records(generated && generated.nodes);
    const edges = records(generated && generated.edges);
    const allowed = {
      capabilities: new Set(nodes.map((node) => node && node.capability).filter((value) => typeof value === "string")),
      kinds: new Set(nodes.map((node) => node && node.kind).filter((value) => typeof value === "string")),
      edgeKinds: new Set(edges.map((edge) => edge && edge.kind).filter((value) => typeof value === "string")),
    };
    return FILTER_KEYS.every((key) => Array.isArray(filters[key]) && filters[key].every((value) => allowed[key].has(value)));
  }

  function invalidLocation() {
    return { ...defaultState(), notice: RECOVERY_NOTICE };
  }

  function parseHash(hash, content, generated) {
    try {
      const raw = typeof hash === "string" ? hash.replace(/^#/, "") : "";
      const params = new root.URLSearchParams(raw);
      const state = defaultState();

      if (params.has("chapter")) state.chapterId = params.get("chapter");
      if (params.has("step")) state.stepId = params.get("step");
      if (params.has("layer")) state.layer = params.get("layer");
      if (params.has("node")) state.selectedNodeId = params.get("node");

      for (const key of FILTER_KEYS) {
        const parsed = parseFilter(params.get(key));
        if (parsed === null) return invalidLocation();
        state.filters[key] = parsed;
      }

      const chapter = chapterById(content, state.chapterId);
      const stepIsValid = state.stepId === null
        || (chapter && stringArray(chapter.stepIds).includes(state.stepId) && flowStep(content, state.stepId));
      if (!chapter || !stepIsValid || !LAYERS.has(state.layer)
        || !validSelectedNode(state.selectedNodeId, content, generated)
        || !filtersAreValid(state.filters, generated)) {
        return invalidLocation();
      }
      return state;
    } catch {
      return invalidLocation();
    }
  }

  function serializeHash(state) {
    const source = isRecord(state) ? state : defaultState();
    const filters = normalizedFilters(source.filters);
    const params = new root.URLSearchParams();

    if (typeof source.chapterId === "string" && source.chapterId !== "orientation") params.set("chapter", source.chapterId);
    if (typeof source.stepId === "string" && source.stepId.length > 0) params.set("step", source.stepId);
    if (typeof source.layer === "string" && source.layer !== "protocol") params.set("layer", source.layer);
    if (typeof source.selectedNodeId === "string" && source.selectedNodeId.length > 0) params.set("node", source.selectedNodeId);
    for (const key of FILTER_KEYS) {
      if (filters[key].length > 0) params.set(key, [...filters[key]].sort().join(","));
    }
    return `#${params.toString()}`;
  }

  function duplicateIdErrors(name, values) {
    const errors = [];
    const seen = new Set();
    for (const value of values) {
      if (!isRecord(value) || typeof value.id !== "string" || value.id.length === 0) {
        errors.push(`${name} records must have a non-empty id`);
      } else if (seen.has(value.id)) {
        errors.push(`duplicate ${name} id: ${value.id}`);
      } else {
        seen.add(value.id);
      }
    }
    return errors;
  }

  function collectCuratedNodeIds(value, found, visited) {
    if (value === null || typeof value !== "object" || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) {
      for (const item of value) collectCuratedNodeIds(item, found, visited);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (key === "nodeIds" && Array.isArray(child)) {
        for (const nodeId of child) found.push(nodeId);
      } else {
        collectCuratedNodeIds(child, found, visited);
      }
    }
  }

  function validateData(content, generated) {
    const errors = [];
    try {
      if (!isRecord(content)) errors.push("curated content must be an object");
      if (!isRecord(generated)) errors.push("generated data must be an object");
      if (!isRecord(content) || content.schemaVersion !== 1) errors.push("curated schemaVersion must be 1");
      if (!isRecord(generated) || generated.schemaVersion !== 1) errors.push("generated schemaVersion must be 1");

      const listNames = ["chapters", "flows", "concepts", "invariants"];
      for (const listName of listNames) {
        if (!isRecord(content) || !Array.isArray(content[listName])) errors.push(`curated ${listName} must be an array`);
      }
      if (!isRecord(generated) || !Array.isArray(generated.nodes)) errors.push("generated nodes must be an array");
      if (!isRecord(generated) || !Array.isArray(generated.edges)) errors.push("generated edges must be an array");

      const chapters = records(content && content.chapters);
      const flows = records(content && content.flows);
      const concepts = records(content && content.concepts);
      const invariants = records(content && content.invariants);
      const nodes = records(generated && generated.nodes);
      const edges = records(generated && generated.edges);

      errors.push(...duplicateIdErrors("chapter", chapters));
      errors.push(...duplicateIdErrors("flow", flows));
      errors.push(...duplicateIdErrors("concept", concepts));
      errors.push(...duplicateIdErrors("invariant", invariants));
      errors.push(...duplicateIdErrors("node", nodes));
      errors.push(...duplicateIdErrors("edge", edges));

      const chaptersById = new Map(chapters.filter(isRecord).map((chapter) => [chapter.id, chapter]));
      const stepOwners = new Map();
      for (const flow of flows) {
        if (!isRecord(flow)) continue;
        const chapter = chaptersById.get(flow.chapterId);
        if (!chapter) errors.push(`flow ${String(flow.id)} references missing chapter ${String(flow.chapterId)}`);
        if (!Array.isArray(flow.steps)) {
          errors.push(`flow ${String(flow.id)} steps must be an array`);
          continue;
        }
        for (const step of flow.steps) {
          if (!isRecord(step) || typeof step.id !== "string" || step.id.length === 0) {
            errors.push(`flow ${String(flow.id)} has a step without a non-empty id`);
            continue;
          }
          if (stepOwners.has(step.id)) errors.push(`duplicate step id: ${step.id}`);
          stepOwners.set(step.id, flow.chapterId);
          if (!chapter || !stringArray(chapter.stepIds).includes(step.id)) {
            errors.push(`step ${step.id} is not a member of chapter ${String(flow.chapterId)}`);
          }
        }
      }
      for (const chapter of chapters) {
        if (!isRecord(chapter)) continue;
        if (!Array.isArray(chapter.stepIds)) {
          errors.push(`chapter ${String(chapter.id)} stepIds must be an array`);
          continue;
        }
        for (const stepId of chapter.stepIds) {
          if (stepOwners.get(stepId) !== chapter.id) {
            errors.push(`chapter ${String(chapter.id)} references missing or foreign step ${String(stepId)}`);
          }
        }
      }

      const nodeIds = new Set(nodes.filter(isRecord).map((node) => node.id));
      for (const edge of edges) {
        if (!isRecord(edge)) continue;
        if (!nodeIds.has(edge.sourceId)) errors.push(`edge ${String(edge.id)} has missing source endpoint ${String(edge.sourceId)}`);
        if (!nodeIds.has(edge.targetId)) errors.push(`edge ${String(edge.id)} has missing target endpoint ${String(edge.targetId)}`);
      }

      const curatedNodeIds = [];
      collectCuratedNodeIds(content, curatedNodeIds, new WeakSet());
      for (const nodeId of curatedNodeIds) {
        if (typeof nodeId !== "string" || !nodeIds.has(nodeId)) {
          errors.push(`curated nodeIds references missing generated node ${String(nodeId)}`);
        }
      }
    } catch (error) {
      errors.push(`data validation failed safely: ${error instanceof Error ? error.message : String(error)}`);
    }
    return { ok: errors.length === 0, errors };
  }

  function cloneState(state) {
    const source = isRecord(state) ? state : defaultState();
    return { ...defaultState(), ...source, filters: normalizedFilters(source.filters) };
  }

  function transition(state, action, content, generated) {
    const next = cloneState(state);
    if (!isRecord(action) || typeof action.type !== "string") return next;

    if (action.type === "select-chapter") {
      const chapter = chapterById(content, action.chapterId);
      if (!chapter) return next;
      return {
        ...next,
        chapterId: chapter.id,
        stepId: stringArray(chapter.stepIds)[0] || null,
        selectedNodeId: null,
        notice: null,
      };
    }
    if (action.type === "select-step") {
      const chapter = chapterById(content, next.chapterId);
      if (!chapter || !stringArray(chapter.stepIds).includes(action.stepId)) return next;
      return { ...next, stepId: action.stepId, selectedNodeId: null, notice: null };
    }
    if (action.type === "set-layer") {
      return LAYERS.has(action.layer) ? { ...next, layer: action.layer, notice: null } : next;
    }
    if (action.type === "select-node") {
      return validSelectedNode(action.nodeId, content, generated)
        ? { ...next, selectedNodeId: action.nodeId, notice: null }
        : next;
    }
    if (action.type === "set-query") {
      return typeof action.query === "string" ? { ...next, query: action.query, notice: null } : next;
    }
    if (action.type === "set-filters") {
      return isRecord(action.filters)
        ? { ...next, filters: normalizedFilters(action.filters), notice: null }
        : next;
    }
    if (action.type === "reset-filters") {
      return { ...next, filters: emptyFilters(), notice: null };
    }
    if (action.type === "next-step" || action.type === "previous-step") {
      const chapter = chapterById(content, next.chapterId);
      const stepIds = stringArray(chapter && chapter.stepIds);
      const currentIndex = stepIds.indexOf(next.stepId);
      if (currentIndex < 0) return next;
      const current = flowStep(content, next.stepId);
      const direction = action.type === "next-step" ? 1 : -1;
      const declared = current && current[action.type === "next-step" ? "next" : "previous"];
      const target = typeof declared === "string" ? declared : stepIds[currentIndex + direction];
      return typeof target === "string" && stepIds.includes(target)
        ? { ...next, stepId: target, selectedNodeId: null, notice: null }
        : next;
    }
    return next;
  }

  function searchablePrimary(item) {
    return [item.label, item.title, item.symbol, item.name, item.term]
      .filter((value) => typeof value === "string");
  }

  function words(value) {
    return String(value).toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  }

  function searchRank(item, query) {
    const primary = searchablePrimary(item).map((value) => value.toLocaleLowerCase());
    if (primary.some((value) => value === query)) return 0;
    if (primary.some((value) => value.startsWith(query) || words(value).some((word) => word.startsWith(query)))) return 1;
    const queryWords = words(query);
    const summaryWords = words([item.summary, item.definition, item.description].filter(Boolean).join(" "));
    if (queryWords.length > 0 && queryWords.every((queryWord) => summaryWords.some((word) => word.startsWith(queryWord)))) return 2;
    return null;
  }

  function searchItems(query, content, generated) {
    if (typeof query !== "string" || query.trim().length === 0) return [];
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return [...records(content && content.concepts), ...records(generated && generated.nodes)]
      .map((item, index) => ({ item, index, rank: isRecord(item) ? searchRank(item, normalizedQuery) : null }))
      .filter((entry) => entry.rank !== null)
      .sort((left, right) => left.rank - right.rank || left.index - right.index)
      .map((entry) => entry.item);
  }

  function filterGraph(filters, generated) {
    const normalized = normalizedFilters(filters);
    const nodes = records(generated && generated.nodes).filter((node) => isRecord(node)
      && (normalized.capabilities.length === 0 || normalized.capabilities.includes(node.capability))
      && (normalized.kinds.length === 0 || normalized.kinds.includes(node.kind)));
    const nodeIds = new Set(nodes.map((node) => node.id));
    const edges = records(generated && generated.edges).filter((edge) => isRecord(edge)
      && (normalized.edgeKinds.length === 0 || normalized.edgeKinds.includes(edge.kind))
      && nodeIds.has(edge.sourceId)
      && nodeIds.has(edge.targetId));
    return { nodes, edges };
  }

  root.ProtocolAtlasCore = Object.freeze({
    defaultState,
    parseHash,
    serializeHash,
    transition,
    validateData,
    searchItems,
    filterGraph,
  });
}(globalThis));
