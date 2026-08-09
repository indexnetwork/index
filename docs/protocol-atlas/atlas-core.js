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
      configurationExperimentId: null,
      configurationModeId: null,
      focusIntent: null,
      announcement: null,
    };
  }

  function records(value) {
    return Array.isArray(value) ? value : [];
  }

  function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function stringArray(value) {
    return Array.isArray(value) ? [...new Set(value.filter((item) => typeof item === "string"))] : [];
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

  function nonEmptyString(value) {
    return typeof value === "string" && value.length > 0;
  }

  function validProtocolPath(value) {
    return nonEmptyString(value) && value.startsWith("packages/protocol/") && !value.includes("\\") && !value.split("/").includes("..");
  }

  function validEvidenceRecord(value) {
    return isRecord(value) && validProtocolPath(value.path) && nonEmptyString(value.symbol);
  }

  function acceptedValues(setting) {
    return isRecord(setting) && Array.isArray(setting.acceptedValues)
      && setting.acceptedValues.length > 0 && setting.acceptedValues.every(nonEmptyString)
      ? setting.acceptedValues
      : [];
  }

  function configurationExperimentErrors(candidate, generated, content, seen) {
    const errors = [];
    if (!isRecord(candidate) || !nonEmptyString(candidate.id) || seen.has(candidate.id)) return ["experiment id must be unique and non-empty"];
    for (const field of ["title", "summary", "capability", "fallbackModeId", "coverage"]) {
      if (!nonEmptyString(candidate[field])) errors.push(`${field} must be non-empty`);
    }
    if (!["definitive", "unresolved"].includes(candidate.coverage)) errors.push("coverage must be definitive or unresolved");
    const stepIds = new Set(records(content && content.flows).filter(isRecord)
      .flatMap((flow) => records(flow.steps).filter(isRecord).map((step) => step.id)));
    for (const field of ["affectedChapterIds", "affectedStepIds"]) {
      if (!Array.isArray(candidate[field]) || candidate[field].some((value) => !nonEmptyString(value))) errors.push(`${field} must be a string array`);
    }

    if (!Array.isArray(candidate.settings) || candidate.settings.length === 0) errors.push("settings must be a non-empty array");
    const settings = records(candidate.settings);
    const settingsByKey = new Map();
    for (const setting of settings) {
      if (!isRecord(setting) || !nonEmptyString(setting.key) || settingsByKey.has(setting.key)) {
        errors.push("setting keys must be unique and non-empty");
        continue;
      }
      settingsByKey.set(setting.key, setting);
      if (acceptedValues(setting).length === 0) errors.push(`setting ${setting.key} acceptedValues must be non-empty strings`);
      if (!Array.isArray(setting.readSites) || setting.readSites.length === 0 || setting.readSites.some((site) => !validEvidenceRecord(site))) errors.push(`setting ${setting.key} readSites are malformed`);
      if (!nonEmptyString(setting.entryAccessorSymbol)) errors.push(`setting ${setting.key} entryAccessorSymbol is malformed`);
      if (!Array.isArray(setting.accessorClosure) || setting.accessorClosure.some((hop) => !validEvidenceRecord(hop))) errors.push(`setting ${setting.key} accessorClosure is malformed`);
      if (!["module-load", "invocation"].includes(setting.readTiming)) errors.push(`setting ${setting.key} readTiming is malformed`);
    }

    if (!Array.isArray(candidate.modes) || candidate.modes.length === 0) errors.push("modes must be a non-empty array");
    const modeIds = new Set();
    const nodeIds = new Set(records(generated.nodes).filter(isRecord).map((node) => node.id));
    const edgeIds = new Set(records(generated.edges).filter(isRecord).map((edge) => edge.id));
    for (const mode of records(candidate.modes)) {
      if (!isRecord(mode) || !nonEmptyString(mode.id) || modeIds.has(mode.id)) {
        errors.push("mode ids must be unique and non-empty");
        continue;
      }
      modeIds.add(mode.id);
      if (!nonEmptyString(mode.explanation)) errors.push(`mode ${mode.id} explanation is malformed`);
      if (!Array.isArray(mode.caveats) || mode.caveats.some((value) => typeof value !== "string")) errors.push(`mode ${mode.id} caveats are malformed`);
      const assignments = mode.assignments;
      const assignmentKeys = new Set();
      if (!Array.isArray(assignments) || assignments.length !== settingsByKey.size) errors.push(`mode ${mode.id} assignments are malformed`);
      for (const assignment of records(assignments)) {
        if (!isRecord(assignment)) {
          errors.push(`mode ${mode.id} assignment is malformed`);
          continue;
        }
        const setting = settingsByKey.get(assignment.key);
        const allowed = acceptedValues(setting);
        if (!setting || allowed.length === 0 || assignmentKeys.has(assignment.key)
          || !(assignment.value === null || allowed.includes(assignment.value))) errors.push(`mode ${mode.id} assignment is malformed`);
        else assignmentKeys.add(assignment.key);
      }
      if (Array.isArray(assignments) && assignments.some((assignment) => !isRecord(assignment))) errors.push(`mode ${mode.id} assignment is malformed`);
      const resolvedKeys = new Set();
      if (!Array.isArray(mode.resolvedValues) || mode.resolvedValues.length !== settingsByKey.size) errors.push(`mode ${mode.id} resolved values are malformed`);
      for (const resolved of records(mode.resolvedValues)) {
        if (!isRecord(resolved)) {
          errors.push(`mode ${mode.id} resolved value is malformed`);
          continue;
        }
        const setting = settingsByKey.get(resolved.key);
        const allowed = acceptedValues(setting);
        if (!setting || allowed.length === 0 || resolvedKeys.has(resolved.key) || !allowed.includes(resolved.value)) errors.push(`mode ${mode.id} resolved value is malformed`);
        else resolvedKeys.add(resolved.key);
      }
      if (Array.isArray(mode.resolvedValues) && mode.resolvedValues.some((resolved) => !isRecord(resolved))) errors.push(`mode ${mode.id} resolved value is malformed`);
      if (!Array.isArray(mode.prerequisites)) errors.push(`mode ${mode.id} prerequisites are malformed`);
      for (const prerequisite of records(mode.prerequisites)) {
        if (!isRecord(prerequisite)) {
          errors.push(`mode ${mode.id} prerequisite is malformed`);
          continue;
        }
        if (prerequisite.kind === "setting") {
          const setting = settingsByKey.get(prerequisite.key);
          const allowed = acceptedValues(setting);
          if (!setting || allowed.length === 0 || !(prerequisite.value === null || allowed.includes(prerequisite.value))) errors.push(`mode ${mode.id} prerequisite is malformed`);
        } else if (prerequisite.kind === "injected-capability") {
          if (!nonEmptyString(prerequisite.nodeId) || !nodeIds.has(prerequisite.nodeId)) errors.push(`mode ${mode.id} prerequisite is malformed`);
        } else errors.push(`mode ${mode.id} prerequisite is malformed`);
      }
      if (Array.isArray(mode.prerequisites) && mode.prerequisites.some((prerequisite) => !isRecord(prerequisite))) errors.push(`mode ${mode.id} prerequisite is malformed`);
      if (!Array.isArray(mode.deltas)) errors.push(`mode ${mode.id} deltas are malformed`);
      const deltaIds = new Set();
      for (const delta of records(mode.deltas)) {
        if (!isRecord(delta)) {
          errors.push(`mode ${mode.id} delta is malformed`);
          continue;
        }
        if (!nonEmptyString(delta.id) || deltaIds.has(delta.id) || !["activated", "bypassed", "changed", "unresolved"].includes(delta.effect)
          || !["node", "edge", "step"].includes(delta.targetKind) || !nonEmptyString(delta.targetId)) {
          errors.push(`mode ${mode.id} delta is malformed`);
          continue;
        }
        deltaIds.add(delta.id);
        if (delta.targetKind === "node" && !nodeIds.has(delta.targetId)) errors.push(`mode ${mode.id} delta node target is missing`);
        if (delta.targetKind === "edge" && !edgeIds.has(delta.targetId)) errors.push(`mode ${mode.id} delta edge target is missing`);
        if (delta.targetKind === "step" && !stepIds.has(delta.targetId)) errors.push(`mode ${mode.id} delta step target is missing`);
        if (!Array.isArray(delta.settingKeys) || delta.settingKeys.length === 0 || delta.settingKeys.some((key) => !settingsByKey.has(key))) errors.push(`mode ${mode.id} delta settingKeys are malformed`);
        if (delta.effect === "unresolved") {
          if (delta.noDirectProtocolConsumer !== true || ["consumerPath", "consumerSymbol", "referenceChain", "behaviorTest"].some((field) => delta[field] !== undefined)) errors.push(`mode ${mode.id} unresolved delta evidence is malformed`);
        } else if (!validProtocolPath(delta.consumerPath) || !nonEmptyString(delta.consumerSymbol)
          || !Array.isArray(delta.referenceChain) || delta.referenceChain.length === 0 || delta.referenceChain.some((hop) => !validEvidenceRecord(hop))
          || !isRecord(delta.behaviorTest) || !validProtocolPath(delta.behaviorTest.path) || !nonEmptyString(delta.behaviorTest.testName)) {
          errors.push(`mode ${mode.id} definitive delta evidence is malformed`);
        }
      }
      if (Array.isArray(mode.deltas) && mode.deltas.some((delta) => !isRecord(delta))) errors.push(`mode ${mode.id} delta is malformed`);
    }
    if (!modeIds.has(candidate.fallbackModeId)) errors.push("fallback mode must exist");
    return [...new Set(errors)];
  }

  function configurationAvailability(generated, content) {
    const unavailable = { available: false, experiments: [], errors: ["Configuration Lab unavailable for this artifact."] };
    if (!isRecord(generated) || generated.schemaVersion !== 2 || !Array.isArray(generated.configurationExperiments)) return unavailable;
    const experiments = [];
    const errors = [];
    const seen = new Set();
    for (const candidate of generated.configurationExperiments) {
      const localErrors = configurationExperimentErrors(candidate, generated, content, seen);
      if (localErrors.length > 0) {
        errors.push(`Configuration experiment ${isRecord(candidate) && candidate.id || "at unknown index"} omitted: ${localErrors.join(", ")}.`);
        continue;
      }
      seen.add(candidate.id);
      experiments.push(candidate);
    }
    return { available: true, experiments, errors };
  }

  function configurationExperiment(generated, experimentId, content) {
    return configurationAvailability(generated, content).experiments.find((experiment) => experiment.id === experimentId) || null;
  }

  function configurationMode(experiment, modeId) {
    return records(experiment && experiment.modes).find((mode) => mode && mode.id === modeId) || null;
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
      const hasExperiment = params.has("experiment");
      const hasMode = params.has("mode");
      if (hasExperiment !== hasMode) return invalidLocation();
      if (hasExperiment) {
        state.configurationExperimentId = params.get("experiment");
        state.configurationModeId = params.get("mode");
      }

      for (const key of FILTER_KEYS) {
        const parsed = parseFilter(params.get(key));
        if (parsed === null) return invalidLocation();
        state.filters[key] = parsed;
      }

      const chapter = chapterById(content, state.chapterId);
      const stepIsValid = state.stepId === null
        || (chapter && stringArray(chapter.stepIds).includes(state.stepId) && flowStep(content, state.stepId));
      const experiment = state.configurationExperimentId === null ? null : configurationExperiment(generated, state.configurationExperimentId, content);
      const configurationIsValid = state.configurationExperimentId === null
        ? state.configurationModeId === null
        : state.chapterId === "explore" && state.layer === "implementation" && Boolean(configurationMode(experiment, state.configurationModeId));
      if (!chapter || !stepIsValid || !LAYERS.has(state.layer)
        || !validSelectedNode(state.selectedNodeId, content, generated)
        || !filtersAreValid(state.filters, generated)
        || !configurationIsValid) {
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
    if (typeof source.configurationExperimentId === "string" && typeof source.configurationModeId === "string") {
      params.set("experiment", source.configurationExperimentId);
      params.set("mode", source.configurationModeId);
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

  function collectCuratedNodeIds(value, found, errors, visited) {
    if (value === null || typeof value !== "object" || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) {
      for (const item of value) collectCuratedNodeIds(item, found, errors, visited);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (key === "nodeIds") {
        if (!Array.isArray(child)) {
          errors.push("curated nodeIds must be an array");
        } else {
          for (const nodeId of child) found.push(nodeId);
        }
      } else {
        collectCuratedNodeIds(child, found, errors, visited);
      }
    }
  }

  function validateData(content, generated) {
    const errors = [];
    try {
      if (!isRecord(content)) errors.push("curated content must be an object");
      if (!isRecord(generated)) errors.push("generated data must be an object");
      if (!isRecord(content) || content.schemaVersion !== 1) errors.push("curated schemaVersion must be 1");
      if (!isRecord(generated) || (generated.schemaVersion !== 1 && generated.schemaVersion !== 2)) errors.push("generated schemaVersion must be 1 or 2");

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
      collectCuratedNodeIds(content, curatedNodeIds, errors, new WeakSet());
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

  function deriveConfigurationComparison(experimentId, modeId, content, generated) {
    const experiment = configurationExperiment(generated, experimentId, content);
    const mode = configurationMode(experiment, modeId);
    if (!experiment || !mode) return null;
    const assignments = new Map(records(mode.assignments).filter(isRecord).map((assignment) => [assignment.key, assignment.value]));
    const resolvedValues = new Map(records(mode.resolvedValues).filter(isRecord).map((value) => [value.key, value.value]));
    const prerequisites = records(mode.prerequisites).filter(isRecord).map((prerequisite) => {
      if (prerequisite.kind === "setting") {
        const actual = assignments.has(prerequisite.key) ? assignments.get(prerequisite.key) : resolvedValues.get(prerequisite.key);
        return { ...prerequisite, status: actual === prerequisite.value ? "satisfied" : "unmet" };
      }
      return { ...prerequisite, status: "protocol-boundary" };
    });
    const deltas = records(mode.deltas).filter(isRecord).map((delta) => ({ ...delta }));
    const counts = { activated: 0, bypassed: 0, changed: 0, unresolved: 0 };
    for (const delta of deltas) if (Object.prototype.hasOwnProperty.call(counts, delta.effect)) counts[delta.effect] += 1;
    return {
      experiment,
      mode,
      assignments: records(mode.assignments),
      resolvedValues: records(mode.resolvedValues),
      prerequisites,
      deltas,
      counts,
      affectedChapterIds: stringArray(experiment.affectedChapterIds),
      affectedStepIds: stringArray(experiment.affectedStepIds),
      disclaimer: content && content.configurationDisclaimer,
    };
  }

  function comparisonAnnouncement(comparison) {
    if (!comparison) return null;
    const { activated, bypassed, changed, unresolved } = comparison.counts;
    return `${comparison.experiment.title}, ${comparison.mode.id}: ${activated} activated, ${bypassed} bypassed, ${changed} changed, ${unresolved} unresolved.`;
  }

  function cloneState(state) {
    const source = isRecord(state) ? state : defaultState();
    return { ...defaultState(), ...source, filters: normalizedFilters(source.filters) };
  }

  function withoutConfiguration(next) {
    return { ...next, configurationExperimentId: null, configurationModeId: null, focusIntent: null, announcement: null };
  }

  function transition(state, action, content, generated) {
    const next = { ...cloneState(state), focusIntent: null, announcement: null };
    if (!isRecord(action) || typeof action.type !== "string") return next;

    if (action.type === "select-chapter") {
      const chapter = chapterById(content, action.chapterId);
      if (!chapter) return next;
      const selected = {
        ...next,
        chapterId: chapter.id,
        stepId: stringArray(chapter.stepIds)[0] || null,
        selectedNodeId: null,
        notice: null,
      };
      return chapter.id === "explore" ? selected : withoutConfiguration(selected);
    }
    if (action.type === "select-step") {
      const chapter = chapterById(content, next.chapterId);
      if (!chapter || !stringArray(chapter.stepIds).includes(action.stepId)) return next;
      return { ...next, stepId: action.stepId, selectedNodeId: null, notice: null };
    }
    if (action.type === "set-layer") {
      if (!LAYERS.has(action.layer)) return next;
      const selected = { ...next, layer: action.layer, notice: null };
      return action.layer === "protocol" ? withoutConfiguration(selected) : selected;
    }
    if (action.type === "select-configuration-experiment") {
      const experiment = configurationExperiment(generated, action.experimentId, content);
      if (!experiment) return next;
      const comparison = deriveConfigurationComparison(experiment.id, experiment.fallbackModeId, content, generated);
      return {
        ...next,
        chapterId: "explore",
        stepId: null,
        layer: "implementation",
        selectedNodeId: null,
        configurationExperimentId: experiment.id,
        configurationModeId: experiment.fallbackModeId,
        focusIntent: { experimentId: experiment.id, modeId: experiment.fallbackModeId },
        announcement: comparisonAnnouncement(comparison),
        notice: null,
      };
    }
    if (action.type === "select-configuration-mode") {
      const experiment = configurationExperiment(generated, action.experimentId, content);
      const requestedMode = configurationMode(experiment, action.modeId);
      if (!experiment || !requestedMode || next.chapterId !== "explore" || next.layer !== "implementation") return next;
      const mode = next.configurationExperimentId === experiment.id
        ? requestedMode
        : configurationMode(experiment, experiment.fallbackModeId);
      if (!mode) return next;
      const comparison = deriveConfigurationComparison(experiment.id, mode.id, content, generated);
      return {
        ...next,
        configurationExperimentId: experiment.id,
        configurationModeId: mode.id,
        focusIntent: { experimentId: experiment.id, modeId: mode.id },
        announcement: comparisonAnnouncement(comparison),
        notice: null,
      };
    }
    if (action.type === "reset-configuration") {
      const experiment = configurationExperiment(generated, next.configurationExperimentId, content);
      if (!experiment) return next;
      const comparison = deriveConfigurationComparison(experiment.id, experiment.fallbackModeId, content, generated);
      return {
        ...next,
        configurationModeId: experiment.fallbackModeId,
        focusIntent: { experimentId: experiment.id, modeId: experiment.fallbackModeId },
        announcement: comparisonAnnouncement(comparison),
        notice: null,
      };
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
    return String(value).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  }

  function searchRank(item, query) {
    const primary = searchablePrimary(item).map((value) => value.toLowerCase());
    if (primary.some((value) => value === query)) return 0;
    if (primary.some((value) => value.startsWith(query) || words(value).some((word) => word.startsWith(query)))) return 1;
    const queryWords = words(query);
    const summaryWords = words([item.summary, item.definition, item.description].filter(Boolean).join(" "));
    if (queryWords.length > 0 && queryWords.every((queryWord) => summaryWords.some((word) => word.startsWith(queryWord)))) return 2;
    return null;
  }

  function searchItems(query, content, generated) {
    if (typeof query !== "string" || query.trim().length === 0) return [];
    const normalizedQuery = query.trim().toLowerCase();
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
    configurationAvailability,
    deriveConfigurationComparison,
  });
}(globalThis));
