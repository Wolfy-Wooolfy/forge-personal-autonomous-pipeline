"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

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

  function sha256Text(text) {
    return crypto.createHash("sha256").update(String(text), "utf8").digest("hex");
  }

  function toArtifactRelPath(absPath) {
    return path.relative(root, absPath).replace(/\\/g, "/");
  }

  function renderExecutionHandoffMd(payload) {
    const lines = [];

    lines.push("# AI OS Execution Handoff");
    lines.push("");
    lines.push(`- handoff_id: ${payload.handoff_id}`);
    lines.push(`- execution_id: ${payload.execution_id}`);
    lines.push(`- package_id: ${payload.package_id}`);
    lines.push(`- project_id: ${payload.project_id}`);
    lines.push(`- created_at: ${payload.created_at}`);
    lines.push(`- handoff_status: ${payload.handoff_status}`);
    lines.push("");
    lines.push("## Approved Scope");
    lines.push(payload.approved_scope.summary || "");
    lines.push("");
    lines.push("## Targets");

    payload.execution_plan.proposed_files.forEach((file) => {
      lines.push(`- ${file.path}`);
      lines.push(`  - allow_overwrite: ${file.allow_overwrite ? "true" : "false"}`);
      lines.push(`  - sha256: ${file.sha256}`);
    });

    lines.push("");
    lines.push("## Boundary");
    lines.push("Execution is allowed only through Forge Core.");

    return lines.join("\n");
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

function buildClarificationQuestions(text) {
  const value = String(text || "").toLowerCase();

  // لو الطلب واضح ومحدد نعدّي
  if (value.length > 40 && !value.includes("game") && !value.includes("لعبة")) {
    return [];
  }

  // لو لعبة → نحتاج Discovery كامل
  if (value.includes("game") || value.includes("لعبة")) {
    return [
      "نوع اللعبة؟ (Puzzle / Action / Strategy / Casual / RPG)",
      "الفئة المستهدفة؟ (أطفال / شباب / عام)",
      "هتكون Offline ولا Online؟",
      "هل فيها مراحل ولا Endless؟",
      "هل فيها نظام نقاط (Score)؟",
      "هل فيها تسجيل دخول؟",
      "هتشتغل على Android بس ولا Android و iOS؟",
      "هتكسب منها ازاي؟ (Ads / In-App Purchases / Subscription)",
      "هل في لعبة مشابهة في بالك؟",
      "عايز تبدأ بـ MVP بسيط ولا لعبة كاملة؟"
    ];
  }

  // Default fallback
  return [
    "محتاج توضيح تفاصيل أكتر عن المشروع عشان أقدر أبدأ التخطيط."
  ];
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
    const clarificationQuestions = buildClarificationQuestions(message);

    const updatedState = saveProjectState({
      ...state,
      project_name: projectName,
      project_type: inferProjectType(message),
      primary_language: detectPrimaryLanguage(message),
      user_goal: message,
      current_phase: "DISCOVERY",
      active_runtime_state: clarificationQuestions.length > 0 ? "DISCOVERY_REQUIRED" : "IDEATION",
      documentation_state: "EMPTY",
      execution_package_state: "NOT_READY",
      execution_state: "NOT_STARTED",
      open_questions: clarificationQuestions
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
      needs_clarification: clarificationQuestions.length > 0,
      clarification_questions: clarificationQuestions,
      created_at: nowIso()
    });

    return {
      ok: true,
      mode: clarificationQuestions.length > 0 ? "CLARIFICATION_REQUIRED" : "IDEATION_READY",
      project: updatedState,
      blocking_questions: clarificationQuestions
    };
  }

  function answerClarification(body = {}) {
    const projectId = normalizeProjectId(body.project_id);
    const answers = body.answers;

    if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
      return {
        ok: false,
        mode: "BLOCKED",
        reason: "INVALID_CLARIFICATION_ANSWERS",
        blocking_question: "لازم تبعت answers object يحتوي على إجابات الأسئلة المطلوبة."
      };
    }

    const state = loadProjectState(projectId, body.project_name);

    if (!Array.isArray(state.open_questions) || state.open_questions.length === 0) {
      return {
        ok: false,
        mode: "BLOCKED",
        reason: "NO_OPEN_CLARIFICATION_QUESTIONS",
        blocking_question: "لا توجد أسئلة مفتوحة تحتاج إجابات."
      };
    }

    appendArrayJson(path.join(aiOsRoot(projectId), "conversation_log.json"), {
      entry_type: "CLARIFICATION_ANSWERS",
      answers,
      created_at: nowIso()
    });

    appendArrayJson(path.join(aiOsRoot(projectId), "ideation_log.json"), {
      entry_type: "DISCOVERY_COMPLETED",
      open_questions_answered: state.open_questions,
      answers,
      created_at: nowIso()
    });

    const updatedState = saveProjectState({
      ...state,
      current_phase: "DISCOVERY_COMPLETE",
      active_runtime_state: "IDEATION",
      open_questions: [],
      clarification_answers: answers
    });

    return {
      ok: true,
      mode: "IDEATION_READY",
      project: updatedState
    };
  }

function generateOptionsFromAnswers(answers = {}) {
  const gameType = answers.game_type || "Game";
  const platform = answers.platform || "Mobile";
  const mode = answers.mode || "Offline";
  const monetization = answers.monetization || "Ads";
  const scope = answers.scope || "MVP";

  return [
    {
      option_id: "OPTION-1",
      title: `${gameType} ${scope}`,
      description: `${mode} ${platform} ${gameType} with ${monetization} monetization based on user requirements.`,
      impact_level: "HIGH",
      risk_level: "LOW"
    },
    {
      option_id: "OPTION-2",
      title: `Advanced ${gameType}`,
      description: `Extended version with scalable features, future online support, and advanced monetization options.`,
      impact_level: "HIGH",
      risk_level: "MEDIUM"
    }
  ];
}

  function registerOptions(body = {}) {
    const projectId = normalizeProjectId(body.project_id);
    const state = loadProjectState(projectId, body.project_name);

    if (Array.isArray(state.open_questions) && state.open_questions.length > 0) {
      return {
        ok: false,
        mode: "BLOCKED",
        reason: "DISCOVERY_NOT_COMPLETE",
        blocking_questions: state.open_questions
      };
    }

    const hasAcceptedOptions =
      Array.isArray(state.accepted_options) && state.accepted_options.length > 0;

    const reopenDecision = body.reopen_decision === true;

    if (hasAcceptedOptions && !reopenDecision) {
      return {
        ok: false,
        mode: "BLOCKED",
        reason: "DECISION_ALREADY_ACCEPTED",
        blocking_question: "يوجد Option معتمد بالفعل. لا يمكن إعادة توليد أو تسجيل Options جديدة إلا بإرسال reopen_decision=true."
      };
    }

    let options = Array.isArray(body.options) ? body.options : [];

    if (options.length === 0) {
      const answers = state.clarification_answers || {};
      options = generateOptionsFromAnswers(answers);
    }

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
      documentation_state: "EMPTY",
      execution_package_state: "NOT_READY",
      execution_state: "NOT_STARTED",
      accepted_options: reopenDecision ? [] : state.accepted_options,
      pending_decisions: normalizedOptions.map((option) => option.option_id)
    });

    appendArrayJson(path.join(aiOsRoot(projectId), "options_log.json"), {
      entry_type: reopenDecision ? "OPTIONS_REOPENED" : "OPTIONS_PRESENTED",
      options: normalizedOptions,
      recommendation: String(body.recommendation || ""),
      created_at: nowIso()
    });

    return {
      ok: true,
      mode: reopenDecision ? "DECISION_REOPENED_OPTIONS_REGISTERED" : "OPTIONS_REGISTERED",
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

  function getLatestOptions(projectId) {
    const optionsLogPath = path.join(aiOsRoot(projectId), "options_log.json");
    const entries = readJsonSafe(optionsLogPath, []);
    const optionsEntries = Array.isArray(entries)
      ? entries.filter((entry) => Array.isArray(entry.options))
      : [];

    if (optionsEntries.length === 0) {
      return [];
    }

    return optionsEntries[optionsEntries.length - 1].options;
  }

function generateDocumentationDraftContent(state, selectedOption) {
  const answers = state.clarification_answers || {};

  return [
    `# ${state.project_name || "Project"} Documentation Draft`,
    "",
    "## Overview",
    String(state.user_goal || ""),
    "",
    "## Discovery Summary",
    `- Game Type: ${answers.game_type || "Not specified"}`,
    `- Target Audience: ${answers.target_audience || "Not specified"}`,
    `- Mode: ${answers.mode || "Not specified"}`,
    `- Progression: ${answers.progression || "Not specified"}`,
    `- Score System: ${answers.score_system || "Not specified"}`,
    `- Login: ${answers.login || "Not specified"}`,
    `- Platform: ${answers.platform || "Not specified"}`,
    `- Monetization: ${answers.monetization || "Not specified"}`,
    `- Reference Game: ${answers.reference_game || "Not specified"}`,
    `- Scope: ${answers.scope || "Not specified"}`,
    "",
    "## Selected Option",
    `- Option ID: ${selectedOption.option_id || "Not specified"}`,
    `- Title: ${selectedOption.title || "Not specified"}`,
    `- Description: ${selectedOption.description || "Not specified"}`,
    "",
    "## Core Gameplay Mechanics",
    ...(answers.game_type === "Casual Puzzle"
      ? [
          "- Player interacts with a match-3 style grid.",
          "- Player swaps adjacent tiles to form matches.",
          "- Matching 3+ tiles removes them from the board.",
          "- New tiles fall dynamically from the top.",
          "- Chain reactions (combos) increase score multiplier."
        ]
      : [
          "- Core gameplay mechanics will be defined based on selected game type."
        ]),
    "",
    "## Game Loop",
    ...(answers.game_type === "Casual Puzzle"
      ? [
          "1. Load puzzle grid with random tiles",
          "2. Player swaps two adjacent tiles",
          "3. System checks for valid match (3+)",
          "4. Matched tiles are removed",
          "5. Tiles above fall down to fill gaps",
          "6. New tiles spawn from top",
          "7. Combo chains are evaluated",
          "8. Score is updated with multiplier",
          "9. Check win/lose condition",
          "10. Continue level or end"
        ]
      : [
          "1. Start level",
          "2. Player performs action",
          "3. System processes logic",
          "4. Update state",
          "5. Check completion condition",
          "6. Continue or end level"
        ]),
    "",
    "## Player Actions",
    "- Tap or swipe to swap elements",
    "- Retry level",
    "- Navigate between levels",
    "",
    "## Win / Lose Conditions",
    "- Win: Reach target score within allowed moves",
    "- Lose: Moves reach zero before target",
    "",
    "## UI Structure",
    "- Main Menu",
    "- Level Selection Screen",
    "- Game Screen (Grid + Score + Moves)",
    "- Result Screen (Win / Lose)",
    "",
    "## Technical Structure (MVP)",
    "- Frontend: HTML5 Canvas or simple game engine",
    "- Game Logic: JavaScript-based loop",
    "- State Management: In-memory (no backend)",
    "- Storage: Local (optional)",
    "",
    "## MVP Scope",
    "- Single gameplay mode",
    "- Limited levels",
    "- Basic UI",
    "- Ads integration placeholder",
    "",
    "## Execution Boundary",
    "No direct execution is allowed from AI OS. Execution must be handed off to Forge Core only."
  ].join("\n");
}

  function saveDocumentationDraft(body = {}) {
    const projectId = normalizeProjectId(body.project_id);
    const state = loadProjectState(projectId, body.project_name);
    let content = String(body.content || "").trim();

    if (!content) {
      const latestOptions = getLatestOptions(projectId);
      const selectedOptionId = Array.isArray(state.accepted_options)
        ? state.accepted_options[state.accepted_options.length - 1]
        : "";

      const selectedOption = latestOptions.find((option) => {
        return String(option.option_id || "") === String(selectedOptionId || "");
      });

      if (!selectedOption) {
        return {
          ok: false,
          mode: "BLOCKED",
          reason: "NO_SELECTED_OPTION_FOR_DOCUMENTATION",
          blocking_question: "لازم يتم اختيار Option قبل توليد وثيقة تلقائية."
        };
      }

      content = generateDocumentationDraftContent(state, selectedOption);
    }
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
      documentation_state: "DOCS_APPROVED",
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

  function createExecutionHandoff(body = {}) {
    const projectId = normalizeProjectId(body.project_id);
    const state = loadProjectState(projectId, body.project_name);

    const docsApproved =
      state.current_phase === "EXECUTION_PREPARATION" &&
      state.active_runtime_state === "EXECUTION_HANDOFF_READY" &&
      state.documentation_state === "DOCS_APPROVED" &&
      state.execution_package_state === "READY_FOR_HANDOFF";

    if (!docsApproved) {
      return {
        ok: false,
        mode: "BLOCKED",
        reason: "DOCUMENTATION_NOT_APPROVED_FOR_HANDOFF",
        blocking_question: "لازم تكون الوثائق معتمدة والحالة EXECUTION_HANDOFF_READY قبل إنشاء handoff إلى Forge."
      };
    }

    const files = Array.isArray(body.files) ? body.files : [];

    if (files.length === 0) {
      return {
        ok: false,
        mode: "BLOCKED",
        reason: "NO_EXECUTION_FILES",
        blocking_question: "لازم يتم تحديد ملف واحد على الأقل داخل files قبل إنشاء execution package."
      };
    }

    const normalizedFiles = files.map((file, index) => {
      const relPath = String(file && file.path ? file.path : "").trim().replace(/\\/g, "/");
      const content = typeof (file && file.content) === "string" ? file.content : "";

      if (!relPath) {
        throw new Error(`AI OS handoff blocked: file path missing at index ${index}`);
      }

      return {
        path: relPath,
        content,
        allow_overwrite: file && file.allow_overwrite === true,
        sha256: sha256Text(content)
      };
    });

    const createdAt = nowIso();
    const executionId = `ai_os_execution_${Date.now()}`;
    const packageId = `ai_os_package_${Date.now()}`;
    const handoffId = `ai_os_handoff_${Date.now()}`;

    const responseAbs = path.resolve(root, "artifacts", "llm", "responses", `${executionId}.response.json`);
    const packageAbs = path.join(projectRoot(projectId), "execute", "execution_package.json");
    const handoffAbs = path.join(aiOsRoot(projectId), "handoff", "execution_handoff.json");
    const handoffMdAbs = path.join(aiOsRoot(projectId), "handoff", "execution_handoff.md");

    const responsePayload = {
      execution_id: executionId,
      source: "AI_OPERATING_SYSTEM",
      project_id: projectId,
      created_at: createdAt,
      summary: String(body.summary || "AI OS execution handoff response artifact."),
      files: normalizedFiles.map((file) => ({
        path: file.path,
        content: file.content
      }))
    };

    writeJson(responseAbs, responsePayload);

    const executionPackage = {
      package_id: packageId,
      handoff_id: handoffId,
      created_at: createdAt,
      source: "EXTERNAL_AI_WORKSPACE",
      source_layer: "AI_OPERATING_SYSTEM",
      handoff_status: "APPROVED_PENDING_FORGE",
      project_id: projectId,
      execution_id: executionId,
      artifact_path: toArtifactRelPath(packageAbs),
      approved_scope: {
        summary: String(body.approved_scope || body.summary || "AI OS approved execution scope."),
        operation_mode: normalizedFiles.length > 1 ? "MULTI_FILE" : "SINGLE_FILE",
        file_count: normalizedFiles.length
      },
      target_project_path: String(body.target_project_path || `artifacts/projects/${projectId}`),
      requested_outputs: Array.isArray(body.requested_outputs)
        ? body.requested_outputs.map((item) => String(item))
        : normalizedFiles.map((file) => `Apply approved AI OS change to ${file.path}`),
      file_or_artifact_targets: normalizedFiles.map((file) => file.path),
      dependency_assumptions: Array.isArray(body.dependency_assumptions)
        ? body.dependency_assumptions.map((item) => String(item))
        : [],
      risk_notes: Array.isArray(body.risk_notes)
        ? body.risk_notes.map((item) => String(item))
        : [],
      execution_approval_reference: {
        approved_by_role: String(body.approved_by_role || "CTO"),
        approved_at: createdAt,
        documentation_state: state.documentation_state,
        project_state_path: `artifacts/projects/${projectId}/project_state.json`
      },
      finalized_documentation_set: [
        `artifacts/projects/${projectId}/project_state.json`,
        `artifacts/projects/${projectId}/ai_os/documentation/draft.md`
      ],
      execution_plan: {
        mode: normalizedFiles.length > 1 ? "MULTI_FILE" : "SINGLE_FILE",
        file_count: normalizedFiles.length,
        proposed_files: normalizedFiles.map((file) => ({
          path: file.path,
          allow_overwrite: file.allow_overwrite,
          sha256: file.sha256,
          required_roles: ["cto"],
          diff: ""
        }))
      },
      business_and_scope_decisions: {
        accepted_options: Array.isArray(state.accepted_options) ? state.accepted_options : [],
        user_goal: String(state.user_goal || ""),
        documentation_state: state.documentation_state
      }
    };

    writeJson(packageAbs, executionPackage);
    writeJson(handoffAbs, executionPackage);
    fs.writeFileSync(handoffMdAbs, renderExecutionHandoffMd(executionPackage), "utf8");

    const updatedState = saveProjectState({
      ...state,
      current_phase: "EXECUTION_READY",
      active_runtime_state: "EXECUTION_HANDOFF_CREATED",
      execution_package_state: "APPROVED_PENDING_FORGE",
      execution_state: "PENDING_FORGE",
      verification_state: "NOT_READY"
    });

    return {
      ok: true,
      mode: "EXECUTION_HANDOFF_CREATED",
      project: updatedState,
      handoff: {
        handoff_id: handoffId,
        execution_id: executionId,
        package_id: packageId,
        execution_package_path: toArtifactRelPath(packageAbs),
        response_artifact_path: toArtifactRelPath(responseAbs),
        handoff_artifact_path: toArtifactRelPath(handoffAbs),
        handoff_report_path: toArtifactRelPath(handoffMdAbs)
      }
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
    answerClarification,
    registerOptions,
    decideOption,
    saveDocumentationDraft,
    approveDocumentation,
    createExecutionHandoff,
    getProject
  };
}

module.exports = {
  createAiOsRuntime
};