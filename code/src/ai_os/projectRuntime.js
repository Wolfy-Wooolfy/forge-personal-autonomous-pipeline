"use strict";

const fs = require("fs");
const path = require("path");

function createAiOsRuntime(options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const projectsRoot = path.resolve(root, "artifacts/projects");

  function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  function readJsonSafe(filePath, fallback) {
    try {
      if (!fs.existsSync(filePath)) {
        return fallback;
      }

      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (err) {
      return fallback;
    }
  }

  function writeJson(filePath, payload) {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
  }

  function normalizeProjectId(value) {
    const raw = String(value || "").trim().toLowerCase();

    const normalized = raw
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");

    return normalized || `project_${Date.now()}`;
  }

  function normalizeProjectName(value) {
    return String(value || "").trim() || "New Project";
  }

  function projectRoot(projectId) {
    return path.join(projectsRoot, normalizeProjectId(projectId));
  }

  function aiOsRoot(projectId) {
    return path.join(projectRoot(projectId), "ai_os");
  }

  function projectStatePath(projectId) {
    return path.join(projectRoot(projectId), "project_state.json");
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function appendArrayJson(filePath, entry) {
    const current = readJsonSafe(filePath, []);
    const list = Array.isArray(current) ? current : [];
    list.push(entry);
    writeJson(filePath, list);
    return list;
  }

  function buildDefaultState(projectId, projectName) {
    return {
      project_id: normalizeProjectId(projectId),
      project_name: normalizeProjectName(projectName),
      project_type: "UNCLASSIFIED",
      project_mode: "BUILD_NEW",
      project_status: "ACTIVE",
      primary_language: "MIXED",
      current_phase: "DISCOVERY",
      active_runtime_state: "DISCUSSION",
      documentation_state: "EMPTY",
      execution_package_state: "NOT_READY",
      execution_state: "NOT_STARTED",
      verification_state: "NOT_READY",
      delivery_state: "NOT_READY",
      memory_state: "ACTIVE",
      accepted_options: [],
      rejected_options: [],
      open_questions: [],
      pending_decisions: [],
      review_cycles_count: 0,
      artifact_registry: {
        project_root: `artifacts/projects/${normalizeProjectId(projectId)}`,
        project_state: `artifacts/projects/${normalizeProjectId(projectId)}/project_state.json`,
        ai_os_conversation_log: `artifacts/projects/${normalizeProjectId(projectId)}/ai_os/conversation_log.json`,
        ai_os_ideation_log: `artifacts/projects/${normalizeProjectId(projectId)}/ai_os/ideation_log.json`,
        ai_os_options_log: `artifacts/projects/${normalizeProjectId(projectId)}/ai_os/options_log.json`,
        ai_os_decisions_log: `artifacts/projects/${normalizeProjectId(projectId)}/ai_os/decisions_log.json`,
        ai_os_documentation_draft: `artifacts/projects/${normalizeProjectId(projectId)}/ai_os/documentation/draft.md`
      },
      active_project_flag: true,
      last_updated_at: nowIso()
    };
  }

  function loadProjectState(projectId, projectName) {
    const existing = readJsonSafe(projectStatePath(projectId), null);

    if (existing && typeof existing === "object") {
      return {
        ...buildDefaultState(projectId, existing.project_name || projectName),
        ...existing,
        active_project_flag: true,
        last_updated_at: nowIso()
      };
    }

    return buildDefaultState(projectId, projectName);
  }

  function saveProjectState(state) {
    const projectId = normalizeProjectId(state.project_id);
    const finalState = {
      ...state,
      project_id: projectId,
      active_project_flag: true,
      last_updated_at: nowIso()
    };

    writeJson(projectStatePath(projectId), finalState);
    return finalState;
  }

  function inferProjectType(text) {
    const value = String(text || "").toLowerCase();

    if (value.includes("game") || value.includes("لعبة")) {
      return "SOFTWARE_APP";
    }

    if (value.includes("mobile") || value.includes("app") || value.includes("تطبيق")) {
      return "SOFTWARE_APP";
    }

    if (value.includes("website") || value.includes("web")) {
      return "WEB_APP";
    }

    return "UNCLASSIFIED";
  }

  function detectPrimaryLanguage(text) {
    return /[\u0600-\u06FF]/.test(String(text || "")) ? "AR" : "EN";
  }

  function buildClarificationQuestion(text) {
    const value = String(text || "").trim();

    if (value.length < 20) {
      return "محتاج أعرف الفكرة الأساسية للمشروع: هو تطبيق، موقع، لعبة، ولا نظام داخلي؟";
    }

    return "";
  }

  function intakeProject(body = {}) {
    const message = String(body.message || body.request || "").trim();
    const projectName = normalizeProjectName(body.project_name || "New Project");
    const projectId = normalizeProjectId(body.project_id || projectName);

    if (!message) {
      return {
        ok: false,
        mode: "BLOCKED",
        reason: "EMPTY_MESSAGE",
        blocking_question: "اكتب فكرة المشروع أو الهدف المطلوب بناؤه."
      };
    }

    const state = loadProjectState(projectId, projectName);
    const clarificationQuestion = buildClarificationQuestion(message);

    const updatedState = saveProjectState({
      ...state,
      project_name: projectName,
      project_type: inferProjectType(message),
      primary_language: detectPrimaryLanguage(message),
      user_goal: message,
      current_phase: "DISCOVERY",
      active_runtime_state: clarificationQuestion ? "DISCUSSION" : "IDEATION",
      documentation_state: "EMPTY",
      execution_package_state: "NOT_READY",
      execution_state: "NOT_STARTED",
      open_questions: clarificationQuestion ? [clarificationQuestion] : []
    });

    appendArrayJson(path.join(aiOsRoot(projectId), "conversation_log.json"), {
      entry_type: "USER_MESSAGE",
      message,
      created_at: nowIso()
    });

    appendArrayJson(path.join(aiOsRoot(projectId), "ideation_log.json"), {
      entry_type: "IDEATION_INTAKE",
      message,
      inferred_project_type: updatedState.project_type,
      needs_clarification: Boolean(clarificationQuestion),
      clarification_question: clarificationQuestion,
      created_at: nowIso()
    });

    return {
      ok: true,
      mode: clarificationQuestion ? "CLARIFICATION_REQUIRED" : "IDEATION_READY",
      project: updatedState,
      blocking_question: clarificationQuestion
    };
  }

  function registerOptions(body = {}) {
    const projectId = normalizeProjectId(body.project_id);
    const state = loadProjectState(projectId, body.project_name);

    const options = Array.isArray(body.options) ? body.options : [];

    if (options.length === 0) {
      return {
        ok: false,
        mode: "BLOCKED",
        reason: "NO_OPTIONS",
        blocking_question: "لازم يكون فيه Option واحد على الأقل قبل تسجيل القرار."
      };
    }

    const normalizedOptions = options.map((option, index) => ({
      option_id: String(option.option_id || `OPTION-${index + 1}`),
      title: String(option.title || `Option ${index + 1}`),
      description: String(option.description || ""),
      impact_level: String(option.impact_level || "MEDIUM").toUpperCase(),
      risk_level: String(option.risk_level || "MEDIUM").toUpperCase()
    }));

    const updatedState = saveProjectState({
      ...state,
      current_phase: "PLANNING",
      active_runtime_state: "OPTION_DECISION",
      pending_decisions: normalizedOptions.map((option) => option.option_id)
    });

    appendArrayJson(path.join(aiOsRoot(projectId), "options_log.json"), {
      entry_type: "OPTIONS_PRESENTED",
      options: normalizedOptions,
      recommendation: String(body.recommendation || ""),
      created_at: nowIso()
    });

    return {
      ok: true,
      mode: "OPTIONS_REGISTERED",
      project: updatedState,
      options: normalizedOptions
    };
  }

  function decideOption(body = {}) {
    const projectId = normalizeProjectId(body.project_id);
    const selectedOptionId = String(body.selected_option_id || "").trim();

    if (!selectedOptionId) {
      return {
        ok: false,
        mode: "BLOCKED",
        reason: "NO_SELECTED_OPTION",
        blocking_question: "حدد option_id المطلوب اعتماده."
      };
    }

    const state = loadProjectState(projectId, body.project_name);

    const acceptedOptions = Array.from(new Set([
      ...(Array.isArray(state.accepted_options) ? state.accepted_options : []),
      selectedOptionId
    ]));

    const updatedState = saveProjectState({
      ...state,
      current_phase: "DOCS_DRAFTING",
      active_runtime_state: "DOCUMENTATION",
      documentation_state: "DRAFTING",
      accepted_options: acceptedOptions,
      pending_decisions: []
    });

    appendArrayJson(path.join(aiOsRoot(projectId), "decisions_log.json"), {
      entry_type: "OPTION_DECISION",
      selected_option_id: selectedOptionId,
      decision_owner: String(body.decision_owner || "USER"),
      rationale: String(body.rationale || ""),
      created_at: nowIso()
    });

    return {
      ok: true,
      mode: "OPTION_ACCEPTED",
      project: updatedState
    };
  }

  function saveDocumentationDraft(body = {}) {
    const projectId = normalizeProjectId(body.project_id);
    const content = String(body.content || "").trim();

    if (!content) {
      return {
        ok: false,
        mode: "BLOCKED",
        reason: "EMPTY_DOCUMENTATION",
        blocking_question: "محتوى الوثيقة مطلوب قبل حفظ Draft."
      };
    }

    const state = loadProjectState(projectId, body.project_name);
    const docsDir = path.join(aiOsRoot(projectId), "documentation");
    const draftPath = path.join(docsDir, "draft.md");

    ensureDir(docsDir);
    fs.writeFileSync(draftPath, content, "utf8");

    const updatedState = saveProjectState({
      ...state,
      current_phase: "DOCS_REVIEW",
      active_runtime_state: "DOCUMENTATION_REVIEW",
      documentation_state: "DRAFT_READY",
      review_cycles_count: Number.isInteger(state.review_cycles_count) ? state.review_cycles_count + 1 : 1
    });

    return {
      ok: true,
      mode: "DOCUMENTATION_DRAFT_SAVED",
      project: updatedState,
      documentation_path: `artifacts/projects/${projectId}/ai_os/documentation/draft.md`
    };
  }

  function approveDocumentation(body = {}) {
    const projectId = normalizeProjectId(body.project_id);
    const draftPath = path.join(aiOsRoot(projectId), "documentation", "draft.md");

    if (!fs.existsSync(draftPath)) {
      return {
        ok: false,
        mode: "BLOCKED",
        reason: "DOCUMENTATION_DRAFT_MISSING",
        blocking_question: "لازم يوجد Documentation Draft قبل الاعتماد."
      };
    }

    const state = loadProjectState(projectId, body.project_name);

    const updatedState = saveProjectState({
      ...state,
      current_phase: "EXECUTION_PREPARATION",
      active_runtime_state: "EXECUTION_HANDOFF_READY",
      documentation_state: "APPROVED",
      execution_package_state: "READY_FOR_HANDOFF",
      execution_state: "NOT_STARTED"
    });

    return {
      ok: true,
      mode: "DOCUMENTATION_APPROVED",
      project: updatedState,
      next_required_boundary: "Execution must be handed off through Forge Core only."
    };
  }

  function getProject(body = {}) {
    const projectId = normalizeProjectId(body.project_id);
    return {
      ok: true,
      project: loadProjectState(projectId, body.project_name)
    };
  }

  return {
    intakeProject,
    registerOptions,
    decideOption,
    saveDocumentationDraft,
    approveDocumentation,
    getProject
  };
}

module.exports = {
  createAiOsRuntime
};