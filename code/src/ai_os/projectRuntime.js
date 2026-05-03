"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const OpenAiRequirementDiscoveryProvider = require("../providers/openAiRequirementDiscoveryProvider");
const OpenAiStructuredJsonProvider = require("../providers/openAiStructuredJsonProvider");

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
    return deriveCleanEnglishProjectName(value);
  }

  function deriveCleanEnglishProjectName(value) {
    const raw = String(value || "").trim().replace(/\s+/g, " ");

    if (!raw) {
      return "New Project";
    }

    const normalized = raw
      .toLowerCase()
      .replace(/[\u064b-\u065f]/g, "")
      .replace(/\u0623|\u0625|\u0622/g, "\u0627")
      .replace(/\u0649/g, "\u064a")
      .replace(/\u0629/g, "\u0647");

    if (/\bcrm\b/i.test(raw)) return "CRM System";
    if (/\bhr\b/i.test(raw)) return "HR System";
    if (normalized.includes("\u062e\u062f\u0645\u0647 \u0639\u0645\u0644\u0627\u0621") || normalized.includes("customer service")) return "Customer Service System";
    if (normalized.includes("\u0627\u062f\u0627\u0631\u0647 \u0645\u0627\u0644\u064a\u0647") || normalized.includes("\u0645\u0627\u0644\u064a") || normalized.includes("financial")) return "Financial Management System";
    if (normalized.includes("\u062d\u0633\u0627\u0628\u0627\u062a") || normalized.includes("accounting")) return "Accounting System";

    const cleaned = raw
      .replace(/\u0627\u0639\u0645\u0644|\u0639\u0627\u064a\u0632|\u0627\u0631\u064a\u062f|\u0623\u0631\u064a\u062f|\u0625\u0639\u0645\u0644|\u0627\u0628\u0646\u064a|\u0635\u0645\u0645|\u0645\u0642\u062a\u0631\u062d|\u0643\u0627\u0645\u0644|\u0627\u0639\u0631\u0636\u0647 \u0639\u0644\u064a\u0627|\u0627\u0639\u0631\u0636\u0647|\u0627\u0634\u0631\u062d|\u0646\u0641\u0630|\u062d\u0648\u0651\u0644|\u062d\u0648\u0644|\u0645\u0646 \u0641\u0636\u0644\u0643/gi, " ")
      .replace(/\b(create|build|make|proposal|complete|full|show|explain|execute|run|please)\b/gi, " ")
      .replace(/\b(system|\u0633\u064a\u0633\u062a\u0645|\u0646\u0638\u0627\u0645)\b/gi, " ")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!cleaned) return "New Project";

    const words = cleaned.split(/\s+/).filter(Boolean).slice(0, 5);
    const title = words.map((word) => {
      if (/^[A-Z0-9]{2,}$/i.test(word) && word.length <= 5) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    }).join(" ");

    return /\bSystem$/i.test(title) ? title : `${title} System`;
  }

  function projectRoot(projectId) {
    return path.join(projectsRoot, normalizeProjectId(projectId));
  }

  function projectOutputRoot(projectId) {
    return path.join(projectRoot(projectId), "output");
  }

  function projectOutputArchiveRoot(projectId) {
    return path.join(projectRoot(projectId), "output_archive");
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

  function buildHandoffResponseFromPackage(projectId, executionPackage) {
    const handoffId = String(executionPackage && executionPackage.handoff_id || "");
    const executionId = String(executionPackage && executionPackage.execution_id || "");
    const packageId = String(executionPackage && executionPackage.package_id || "");

    return {
      handoff_id: handoffId,
      execution_id: executionId,
      package_id: packageId,
      execution_package_path: `artifacts/projects/${projectId}/execute/execution_package.json`,
      response_artifact_path: executionId ? `artifacts/llm/responses/${executionId}.response.json` : "",
      handoff_artifact_path: `artifacts/projects/${projectId}/ai_os/handoff/execution_handoff.json`,
      handoff_report_path: `artifacts/projects/${projectId}/ai_os/handoff/execution_handoff.md`
    };
  }

  function buildExecutionScopeFingerprint(state) {
    return sha256Text(JSON.stringify({
      user_goal: String(state.user_goal || ""),
      requirement_domain: String(state.requirement_domain || ""),
      requirement_model: state.requirement_model && typeof state.requirement_model === "object"
        ? state.requirement_model
        : {},
      accepted_options: Array.isArray(state.accepted_options) ? state.accepted_options : [],
      documentation_sha256: String(state.documentation_sha256 || "")
    }));
  }

  function packageMatchesCurrentScope(executionPackage, state) {
    const storedFingerprint =
      executionPackage &&
      executionPackage.execution_approval_reference &&
      typeof executionPackage.execution_approval_reference.scope_fingerprint === "string"
        ? executionPackage.execution_approval_reference.scope_fingerprint
        : "";

    return storedFingerprint !== "" && storedFingerprint === buildExecutionScopeFingerprint(state);
  }

  function packageTargetsScopedToOutput(projectId, executionPackage) {
    const outputBase = `artifacts/projects/${normalizeProjectId(projectId)}/output/`;
    const proposedFiles =
      executionPackage &&
      executionPackage.execution_plan &&
      Array.isArray(executionPackage.execution_plan.proposed_files)
        ? executionPackage.execution_plan.proposed_files
        : [];

    return proposedFiles.length > 0 && proposedFiles.every((file) => {
      const relPath = String(file && file.path ? file.path : "").trim().replace(/\\/g, "/");
      return relPath.startsWith(outputBase);
    });
  }

  function safePathSegment(value, fallback) {
    const cleaned = String(value || "")
      .trim()
      .replace(/[<>:"|?*\x00-\x1F]/g, "_")
      .replace(/[\\/]+/g, "_")
      .replace(/^\.+$/g, "")
      .slice(0, 140);

    return cleaned || fallback;
  }

  function safeFileNameFromPath(inputPath, index, state) {
    const normalized = String(inputPath || "").trim().replace(/\\/g, "/");
    const baseName = path.posix.basename(normalized);
    const projectName = safePathSegment(state.project_name || state.user_goal || "project", "project");
    return safePathSegment(baseName, `${projectName}_file_${index + 1}.txt`);
  }

  function safeOutputFolderNameFromProject(state) {
    return safePathSegment(
      deriveCleanEnglishProjectName(
        state.project_name || state.original_user_goal || state.user_goal || "project"
      ).replace(/\s+/g, "_"),
      "project"
    );
  }

  function normalizeOutputRelativePath(projectId, state, inputPath, index) {
    const outputBase = `artifacts/projects/${projectId}/output`;
    const raw = String(inputPath || "").trim().replace(/\\/g, "/");
    const withoutRootPrefix = raw.replace(/^[A-Za-z]:\//, "").replace(/^\/+/, "");
    const relativeInsideOutput =
      withoutRootPrefix === outputBase
        ? ""
        : withoutRootPrefix.startsWith(`${outputBase}/`)
          ? withoutRootPrefix.slice(outputBase.length + 1)
          : "";

    if (relativeInsideOutput) {
      const safeSegments = relativeInsideOutput
        .split("/")
        .filter((segment) => segment && segment !== "." && segment !== "..")
        .map((segment, segmentIndex) => safePathSegment(segment, `part_${segmentIndex + 1}`));

      if (safeSegments.length > 0) {
        const reservedOutputFolders = new Set(["app", "src", "dist", "build"]);

        if (safeSegments.length > 1 && !reservedOutputFolders.has(safeSegments[0].toLowerCase())) {
          safeSegments[0] = safeOutputFolderNameFromProject(state);
        }

        return `${outputBase}/${safeSegments.join("/")}`;
      }
    }

    return `${outputBase}/${safeFileNameFromPath(raw, index, state)}`;
  }

  function archiveExistingOutput(projectId) {
    const outputAbs = projectOutputRoot(projectId);

    if (!fs.existsSync(outputAbs)) {
      ensureDir(outputAbs);
      return null;
    }

    const entries = fs.readdirSync(outputAbs);

    if (entries.length === 0) {
      return null;
    }

    const stamp = nowIso().replace(/[:.]/g, "-");
    const archiveAbs = path.join(projectOutputArchiveRoot(projectId), stamp);
    ensureDir(archiveAbs);

    entries.forEach((entryName) => {
      fs.renameSync(path.join(outputAbs, entryName), path.join(archiveAbs, entryName));
    });

    return toArtifactRelPath(archiveAbs);
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

  function normalizeProviderDomain(value) {
    const normalized = String(value || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");

    return normalized || "UNCLASSIFIED";
  }

  function detectPrimaryLanguage(text) {
    return /[\u0600-\u06FF]/.test(String(text || "")) ? "AR" : "EN";
  }

  async function buildRequirementDiscoveryViaProvider(userInput, previousModel = null) {
    const provider = new OpenAiRequirementDiscoveryProvider();

    const providerResult = await provider.executeTask({
      task_id: `requirement_discovery_${Date.now()}`,
      request: String(userInput || ""),
      context: {
        previous_requirement_model: previousModel || null,
        contract: "docs/12_ai_os/20_REQUIREMENT_DISCOVERY_LOOP.md",
        constraints: [
          "Requirement discovery must be provider-driven",
          "Do not use keyword matching",
          "Do not assume missing requirements",
          "Return valid JSON only",
          "Do not wrap output in markdown"
        ]
      },
      expected_output: {
        type: "REQUIREMENT_DISCOVERY_JSON",
        format: "structured_json",
        schema: {
          domain: "string",
          requirement_model: "object",
          completeness: "boolean",
          open_questions: "array",
          reasoning_summary: "string"
        }
      }
    });

    if (
      providerResult.status !== "SUCCESS" ||
      !providerResult.output ||
      typeof providerResult.output !== "object"
    ) {
      return {
        ok: false,
        mode: "BLOCKED",
        reason: "PROVIDER_NOT_AVAILABLE",
        requirement_model: previousModel || {},
        completeness: false,
        open_questions: [],
        reasoning_summary: ""
      };
    }

    const output = providerResult.output;

    if (
      typeof output.domain !== "string" ||
      !output.requirement_model ||
      typeof output.requirement_model !== "object" ||
      typeof output.completeness !== "boolean" ||
      !Array.isArray(output.open_questions)
    ) {
      return {
        ok: false,
        mode: "BLOCKED",
        reason: "INVALID_PROVIDER_OUTPUT",
        requirement_model: previousModel || {},
        completeness: false,
        open_questions: [],
        reasoning_summary: ""
      };
    }

    return {
      ok: true,
      domain: output.domain,
      requirement_model: output.requirement_model,
      completeness: output.completeness,
      open_questions: output.open_questions,
      reasoning_summary: typeof output.reasoning_summary === "string" ? output.reasoning_summary : ""
    };
  }

  function assertRequirementDiscoveryComplete(state) {
    const openQuestions = Array.isArray(state.open_questions) ? state.open_questions : [];

    if (state.requirement_completeness !== true || openQuestions.length > 0) {
      return {
        ok: false,
        mode: "BLOCKED",
        reason: "DISCOVERY_NOT_COMPLETE",
        blocking_questions: openQuestions
      };
    }

    return {
      ok: true
    };
  }

  async function intakeProject(body = {}) {
    const message = String(body.message || body.request || "").trim();
    const projectName = normalizeProjectName(body.project_name || message || "New Project");
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
    const discovery = await buildRequirementDiscoveryViaProvider(message);

    if (!discovery.ok) {
      const blockedState = saveProjectState({
        ...state,
        project_name: projectName,
        project_type: "UNCLASSIFIED",
        primary_language: detectPrimaryLanguage(message),
        user_goal: message,
        original_user_goal: message,
        latest_requested_action: "",
        active_followup_action: "",
        current_phase: "DISCOVERY",
        active_runtime_state: "INVALID_ARCHITECTURE",
        documentation_state: "EMPTY",
        execution_package_state: "NOT_READY",
        execution_state: "NOT_STARTED",
        open_questions: [],
        clarification_answers: {},
        requirement_model: {},
        requirement_domain: "",
        requirement_completeness: false,
        provider_error: discovery.reason
      });

      return {
        ok: false,
        mode: "BLOCKED",
        reason: discovery.reason,
        project: blockedState
      };
    }

    const clarificationQuestions = discovery.open_questions;

    const updatedState = saveProjectState({
      ...state,
      project_name: projectName,
      project_type: normalizeProviderDomain(discovery.domain),
      primary_language: detectPrimaryLanguage(message),
      user_goal: message,
      original_user_goal: message,
      latest_requested_action: "",
      active_followup_action: "",
      current_phase: "DISCOVERY",
      active_runtime_state: clarificationQuestions.length > 0 ? "DISCOVERY_REQUIRED" : "IDEATION",
      documentation_state: "EMPTY",
      execution_package_state: "NOT_READY",
      execution_state: "NOT_STARTED",
      verification_state: "NOT_READY",
      delivery_state: "NOT_READY",
      open_questions: clarificationQuestions,
      accepted_options: [],
      rejected_options: [],
      pending_decisions: [],
      review_cycles_count: 0,
      clarification_answers: {},
      requirement_model: discovery.requirement_model,
      requirement_domain: discovery.domain,
      requirement_completeness: discovery.completeness,
      requirement_reasoning_summary: discovery.reasoning_summary
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
      requirement_model: discovery.requirement_model,
      requirement_domain: discovery.domain,
      requirement_completeness: discovery.completeness,
      requirement_reasoning_summary: discovery.reasoning_summary,
      created_at: nowIso()
    });

    return {
      ok: true,
      mode: clarificationQuestions.length > 0 ? "CLARIFICATION_REQUIRED" : "IDEATION_READY",
      project: updatedState,
      blocking_questions: clarificationQuestions
    };
  }

  async function answerClarification(body = {}) {
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

    const mergedAnswers = {
      ...(state.clarification_answers && typeof state.clarification_answers === "object" ? state.clarification_answers : {}),
      ...answers
    };

    const discovery = await buildRequirementDiscoveryViaProvider(
      JSON.stringify({
        user_goal: state.user_goal || "",
        new_answers: answers,
        all_answers: mergedAnswers
      }),
      state.requirement_model && typeof state.requirement_model === "object"
        ? state.requirement_model
        : {}
    );

    if (!discovery.ok) {
      const blockedState = saveProjectState({
        ...state,
        current_phase: "DISCOVERY",
        active_runtime_state: "INVALID_ARCHITECTURE",
        open_questions: Array.isArray(state.open_questions) ? state.open_questions : [],
        clarification_answers: mergedAnswers,
        requirement_model: state.requirement_model || {},
        requirement_completeness: false,
        provider_error: discovery.reason
      });

      return {
        ok: false,
        mode: "BLOCKED",
        reason: discovery.reason,
        project: blockedState
      };
    }

    appendArrayJson(path.join(aiOsRoot(projectId), "ideation_log.json"), {
      entry_type: discovery.completeness ? "DISCOVERY_COMPLETED" : "DISCOVERY_ITERATION_REQUIRED",
      open_questions_answered: state.open_questions,
      answers,
      merged_answers: mergedAnswers,
      requirement_domain: discovery.domain,
      requirement_model: discovery.requirement_model,
      completeness: discovery.completeness,
      next_open_questions: discovery.open_questions,
      requirement_reasoning_summary: discovery.reasoning_summary,
      created_at: nowIso()
    });

    const updatedState = saveProjectState({
      ...state,
      current_phase: discovery.completeness ? "DISCOVERY_COMPLETE" : "DISCOVERY",
      active_runtime_state: discovery.completeness ? "IDEATION" : "DISCOVERY_REQUIRED",
      documentation_state: discovery.completeness ? "EMPTY" : state.documentation_state,
      execution_package_state: discovery.completeness ? "NOT_READY" : state.execution_package_state,
      execution_state: discovery.completeness ? "NOT_STARTED" : state.execution_state,
      verification_state: discovery.completeness ? "NOT_READY" : state.verification_state,
      delivery_state: discovery.completeness ? "NOT_READY" : state.delivery_state,
      open_questions: discovery.open_questions,
      accepted_options: discovery.completeness ? [] : state.accepted_options,
      rejected_options: discovery.completeness ? [] : state.rejected_options,
      pending_decisions: discovery.completeness ? [] : state.pending_decisions,
      review_cycles_count: discovery.completeness ? 0 : state.review_cycles_count,
      clarification_answers: mergedAnswers,
      requirement_model: discovery.requirement_model,
      requirement_domain: discovery.domain,
      requirement_completeness: discovery.completeness,
      requirement_reasoning_summary: discovery.reasoning_summary
    });

    return {
      ok: true,
      mode: discovery.completeness ? "IDEATION_READY" : "CLARIFICATION_REQUIRED",
      project: updatedState,
      blocking_questions: discovery.open_questions
    };
  }

  async function generateOptionsViaProvider(state) {
    const provider = new OpenAiStructuredJsonProvider();
    const result = await provider.executeTask({
      system: "You generate option candidates for a governed Companion AI OS. Use only the supplied provider-derived requirement model. Do not infer missing requirements.",
      request: "Generate 2-3 clear project options for user decision.",
      context: {
        requirement_domain: state.requirement_domain || "",
        requirement_model: state.requirement_model || {},
        user_goal: state.user_goal || "",
        user_language: state.primary_language || detectPrimaryLanguage(state.user_goal || ""),
        previous_decisions: state.accepted_options || []
      },
      constraints: [
        "Return option titles and descriptions in the same language as user_language.",
        "If user_language is AR, all user-facing option text must be Arabic.",
        "Do not switch to English unless the user goal is English."
      ],
      expected_output: {
        options: [
          {
            option_id: "string",
            title: "string",
            description: "string",
            impact_level: "LOW | MEDIUM | HIGH",
            risk_level: "LOW | MEDIUM | HIGH"
          }
        ],
        recommendation: "string"
      }
    });

    if (result.status !== "SUCCESS" || !result.output || !Array.isArray(result.output.options)) {
      return {
        ok: false,
        reason: "OPTIONS_PROVIDER_UNAVAILABLE",
        provider_metadata: result.metadata || {}
      };
    }

    return {
      ok: true,
      options: result.output.options,
      recommendation: String(result.output.recommendation || ""),
      provider_metadata: result.metadata || {}
    };
  }

  async function registerOptions(body = {}) {
    const projectId = normalizeProjectId(body.project_id);
    const state = loadProjectState(projectId, body.project_name);

    const discoveryGate = assertRequirementDiscoveryComplete(state);

    if (!discoveryGate.ok) {
      return discoveryGate;
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
    let providerRecommendation = "";
    let providerMetadata = null;

    if (options.length === 0) {
      const providerOptions = await generateOptionsViaProvider(state);

      if (!providerOptions.ok) {
        return {
          ok: false,
          mode: "BLOCKED",
          reason: providerOptions.reason,
          provider_metadata: providerOptions.provider_metadata || {},
          blocking_question: "AI Provider is required to generate project options. Configure the provider and retry."
        };
      }

      options = providerOptions.options;
      providerRecommendation = providerOptions.recommendation;
      providerMetadata = providerOptions.provider_metadata;
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
      recommendation: String(body.recommendation || providerRecommendation || ""),
      provider_metadata: providerMetadata,
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

    const discoveryGate = assertRequirementDiscoveryComplete(state);

    if (!discoveryGate.ok) {
      return discoveryGate;
    }

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

async function generateDocumentationDraftViaProvider(state, selectedOption = {}) {
  const provider = new OpenAiStructuredJsonProvider();
  const result = await provider.executeTask({
    system: "You build user-facing project documentation for a governed Companion AI OS. Use only supplied provider-derived state and selected option.",
    request: "Create a complete documentation draft as Markdown.",
    context: {
      project_name: state.project_name || "Project",
      user_goal: state.user_goal || "",
      requirement_domain: state.requirement_domain || "",
      requirement_model: state.requirement_model || {},
      selected_option: selectedOption || {},
      business_goal: state.business_goal || "",
      technical_goal: state.technical_goal || ""
    },
    expected_output: {
      content: "markdown string"
    }
  });

  if (result.status !== "SUCCESS" || !result.output || typeof result.output.content !== "string") {
    return {
      ok: false,
      reason: "DOCUMENTATION_PROVIDER_UNAVAILABLE",
      provider_metadata: result.metadata || {}
    };
  }

  return {
    ok: true,
    content: result.output.content,
    provider_metadata: result.metadata || {}
  };
}

async function generateExecutionFilesViaProvider(projectId, state) {
  const provider = new OpenAiStructuredJsonProvider();
  const outputBase = `artifacts/projects/${projectId}/output`;
  const result = await provider.executeTask({
    system: "You generate execution-ready project files for a governed AI OS handoff. Use only approved documentation and provider-derived requirement model. Do not execute anything.",
    request: "Generate the files required for the approved execution package.",
    context: {
      output_base: outputBase,
      project_name: state.project_name || "Project",
      user_goal: state.user_goal || "",
      requirement_domain: state.requirement_domain || "",
      requirement_model: state.requirement_model || {},
      accepted_options: state.accepted_options || [],
      documentation_state: state.documentation_state || ""
    },
    expected_output: {
      files: [
        {
          path: "string under output_base",
          content: "string",
          allow_overwrite: false
        }
      ]
    }
  });

  if (result.status !== "SUCCESS" || !result.output || !Array.isArray(result.output.files)) {
    return {
      ok: false,
      reason: "EXECUTION_FILES_PROVIDER_UNAVAILABLE",
      provider_metadata: result.metadata || {}
    };
  }

  return {
    ok: true,
    files: result.output.files,
    provider_metadata: result.metadata || {}
  };
}

  async function saveDocumentationDraft(body = {}) {
    const projectId = normalizeProjectId(body.project_id);
    const state = loadProjectState(projectId, body.project_name);
    const discoveryGate = assertRequirementDiscoveryComplete(state);

    if (!discoveryGate.ok) {
      return discoveryGate;
    }
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

      const providerDraft = await generateDocumentationDraftViaProvider(state, selectedOption);

      if (!providerDraft.ok) {
        return {
          ok: false,
          mode: "BLOCKED",
          reason: providerDraft.reason,
          provider_metadata: providerDraft.provider_metadata || {},
          blocking_question: "AI Provider is required to create documentation from approved requirements. Configure the provider and retry."
        };
      }

      content = providerDraft.content;
    }
    const docsDir = path.join(aiOsRoot(projectId), "documentation");
    const draftPath = path.join(docsDir, "draft.md");

    ensureDir(docsDir);
    fs.writeFileSync(draftPath, content, "utf8");
    const documentationSha256 = sha256Text(content);

    const updatedState = saveProjectState({
      ...state,
      current_phase: "DOCS_REVIEW",
      active_runtime_state: "DOCUMENTATION_REVIEW",
      documentation_state: "DRAFT_READY",
      documentation_sha256: documentationSha256,
      execution_package_state: "NOT_READY",
      execution_state: "NOT_STARTED",
      verification_state: "NOT_READY",
      review_cycles_count: Number.isInteger(state.review_cycles_count) ? state.review_cycles_count + 1 : 1
    });

    return {
      ok: true,
      mode: "DOCUMENTATION_DRAFT_SAVED",
      project: updatedState,
      documentation_path: `artifacts/projects/${projectId}/ai_os/documentation/draft.md`,
      documentation_content: content
    };
  }

  function getDocumentationDraft(body = {}) {
    const projectId = normalizeProjectId(body.project_id);
    const state = loadProjectState(projectId, body.project_name);
    const draftPath = path.join(aiOsRoot(projectId), "documentation", "draft.md");

    if (!fs.existsSync(draftPath)) {
      return {
        ok: false,
        mode: "BLOCKED",
        reason: "DOCUMENTATION_DRAFT_MISSING",
        project: state,
        blocking_question: "Documentation draft is not available for the active project."
      };
    }

    return {
      ok: true,
      mode: "DOCUMENTATION_DRAFT_LOADED",
      project: state,
      documentation_path: `artifacts/projects/${projectId}/ai_os/documentation/draft.md`,
      documentation_content: fs.readFileSync(draftPath, "utf8")
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

    const discoveryGate = assertRequirementDiscoveryComplete(state);

    if (!discoveryGate.ok) {
      return discoveryGate;
    }

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

  async function createExecutionHandoff(body = {}) {
    const projectId = normalizeProjectId(body.project_id);
    const state = loadProjectState(projectId, body.project_name);
    const packageAbs = path.join(projectRoot(projectId), "execute", "execution_package.json");
    const handoffAbs = path.join(aiOsRoot(projectId), "handoff", "execution_handoff.json");
    const handoffMdAbs = path.join(aiOsRoot(projectId), "handoff", "execution_handoff.md");
    const existingPackage = readJsonSafe(packageAbs, null);

    if (
      existingPackage &&
      packageMatchesCurrentScope(existingPackage, state) &&
      packageTargetsScopedToOutput(projectId, existingPackage)
    ) {
      return {
        ok: true,
        mode: "EXECUTION_HANDOFF_ALREADY_CREATED",
        project: state,
        handoff: buildHandoffResponseFromPackage(projectId, existingPackage)
      };
    }

    const discoveryGate = assertRequirementDiscoveryComplete(state);

    if (!discoveryGate.ok) {
      return discoveryGate;
    }

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

    let files = Array.isArray(body.files) ? body.files : [];

    if (files.length === 0) {
      const providerFiles = await generateExecutionFilesViaProvider(projectId, state);

      if (!providerFiles.ok) {
        return {
          ok: false,
          mode: "BLOCKED",
          reason: providerFiles.reason,
          provider_metadata: providerFiles.provider_metadata || {},
          blocking_question: "AI Provider is required to generate execution files from the approved package. Configure the provider and retry."
        };
      }

      files = providerFiles.files;
    }

    if (files.length === 0) {
      return {
        ok: false,
        mode: "BLOCKED",
        reason: "NO_EXECUTION_FILES",
        blocking_question: "لازم يتم تحديد ملف واحد على الأقل داخل files قبل إنشاء execution package."
      };
    }

    const archivedOutputPath = archiveExistingOutput(projectId);

    const normalizedFiles = files.map((file, index) => {
      const relPath = normalizeOutputRelativePath(
        projectId,
        state,
        file && file.path ? file.path : "",
        index
      );
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

    const responsePayload = {
      execution_id: executionId,
      source: "AI_OPERATING_SYSTEM",
      project_id: projectId,
      package_id: packageId,
      created_at: createdAt,
      summary: String(body.summary || "AI OS execution handoff response artifact."),
      files: normalizedFiles.map((file) => ({
        path: file.path,
        content: file.content,
        execution_id: executionId,
        package_id: packageId
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
      output_path: `artifacts/projects/${projectId}/output`,
      output_archive_path: archivedOutputPath || "",
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
        documentation_sha256: String(state.documentation_sha256 || ""),
        scope_fingerprint: buildExecutionScopeFingerprint(state),
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
    getDocumentationDraft,
    approveDocumentation,
    createExecutionHandoff,
    getProject
  };
}

module.exports = {
  createAiOsRuntime
};
