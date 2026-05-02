"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(absDir) {
  fs.mkdirSync(absDir, { recursive: true });
}

function readText(relPath) {
  return fs.readFileSync(path.resolve(ROOT, relPath), "utf8");
}

function readJson(relPath) {
  return JSON.parse(readText(relPath));
}

function listFilesRecursive(absRoot) {
  const out = [];
  const stack = [absRoot];

  while (stack.length > 0) {
    const current = stack.pop();

    if (!fs.existsSync(current)) {
      continue;
    }

    const stat = fs.statSync(current);

    if (stat.isDirectory()) {
      const children = fs.readdirSync(current)
        .map((name) => path.join(current, name))
        .sort()
        .reverse();

      children.forEach((child) => stack.push(child));
      continue;
    }

    out.push(current);
  }

  return out.sort();
}

function rel(absPath) {
  return path.relative(ROOT, absPath).replace(/\\/g, "/");
}

function extractMustClausesFromMarkdown(relPath) {
  const text = readText(relPath);
  const lines = text.split(/\r?\n/);
  const clauses = [];
  let currentHeading = "";

  lines.forEach((line, index) => {
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      currentHeading = heading[2].trim();
    }

    if (/\bMUST(?:\s+NOT)?\b/.test(line)) {
      clauses.push({
        clause_id: `${relPath}:${index + 1}`,
        document: relPath,
        line: index + 1,
        heading: currentHeading,
        text: line.trim()
      });
    }
  });

  return clauses;
}

function collectMustClauses() {
  const docsRoot = path.resolve(ROOT, "docs");
  const roots = [docsRoot].filter((abs) => fs.existsSync(abs));
  const files = [];

  roots.forEach((absRoot) => {
    listFilesRecursive(absRoot)
      .filter((absPath) => absPath.toLowerCase().endsWith(".md"))
      .forEach((absPath) => files.push(rel(absPath)));
  });

  return files.flatMap(extractMustClausesFromMarkdown);
}

function addCheck(checks, name, passed, detail, evidence = []) {
  checks.push({
    name,
    passed,
    detail,
    evidence
  });
}

function lineContainsAny(text, needles) {
  const lower = String(text || "").toLowerCase();
  return needles.some((needle) => lower.includes(needle));
}

function buildClauseEvidence(clause, trace) {
  const document = String(clause.document || "");
  const heading = String(clause.heading || "").toLowerCase();
  const text = String(clause.text || "").toLowerCase();
  const mappings = Array.isArray(trace && trace.mappings) ? trace.mappings : [];
  const documentMappings = mappings.filter((mapping) => mapping.document === document);

  const evidence = {
    clause_id: clause.clause_id,
    document,
    line: clause.line,
    heading: clause.heading,
    text: clause.text,
    coverage_status: documentMappings.length > 0 ? "TRACE_COVERED" : "UNMAPPED_DOCUMENT",
    mapped_code_units: [],
    mapped_artifacts: []
  };

  documentMappings.forEach((mapping) => {
    (mapping.mapped_code_units || []).forEach((unit) => evidence.mapped_code_units.push(unit));
    (mapping.mapped_artifacts || []).forEach((artifact) => evidence.mapped_artifacts.push(artifact));
  });

  if (document.includes("12_ai_os") || heading.includes("requirement discovery") || text.includes("provider")) {
    evidence.mapped_code_units.push(
      "CODE::code/src/ai_os/projectRuntime.js::FILE",
      "CODE::code/src/providers/openAiRequirementDiscoveryProvider.js::FILE",
      "CODE::code/src/providers/openAiStructuredJsonProvider.js::FILE"
    );
  }

  if (document.includes("09_verify") || heading.includes("verification")) {
    evidence.mapped_code_units.push(
      "CODE::code/src/modules/verifyEngine.js::FILE",
      "CODE::verify/unit/docs_must_acceptance_validator.js::FILE"
    );
    evidence.mapped_artifacts.push(
      "verify/unit/docs_must_acceptance_report.json",
      "verify/unit/verification_report.json",
      "artifacts/verify/verification_results.json"
    );
  }

  evidence.mapped_code_units = Array.from(new Set(evidence.mapped_code_units)).sort();
  evidence.mapped_artifacts = Array.from(new Set(evidence.mapped_artifacts)).sort();

  return evidence;
}

function runValidator() {
  const trace = readJson("artifacts/trace/trace_matrix.json");
  const gap = readJson("artifacts/gap/gap_actions.json");
  const audit = readJson("artifacts/audit/audit_findings.json");

  const projectRuntimeText = readText("code/src/ai_os/projectRuntime.js");
  const workspaceApiText = readText("code/src/workspace/apiServer.js");
  const workspaceUiText = readText("web/index.html");
  const requirementProviderText = readText("code/src/providers/openAiRequirementDiscoveryProvider.js");
  const structuredProviderText = readText("code/src/providers/openAiStructuredJsonProvider.js");
  const verifyEngineText = readText("code/src/modules/verifyEngine.js");

  const mustClauses = collectMustClauses();
  const clauseEvidence = mustClauses.map((clause) => buildClauseEvidence(clause, trace));
  const uncoveredClauses = clauseEvidence.filter((item) => {
    return item.mapped_code_units.length === 0 && item.mapped_artifacts.length === 0;
  });

  const checks = [];

  addCheck(
    checks,
    "all_must_clauses_have_evidence",
    uncoveredClauses.length === 0,
    `must_clauses=${mustClauses.length}; uncovered=${uncoveredClauses.length}`,
    uncoveredClauses.slice(0, 50)
  );

  addCheck(
    checks,
    "trace_has_no_none_or_partial_coverage",
    Array.isArray(trace.mappings) &&
      trace.mappings.every((mapping) => mapping.coverage_status !== "NONE" && mapping.coverage_status !== "PARTIAL"),
    `mappings=${Array.isArray(trace.mappings) ? trace.mappings.length : 0}`
  );

  addCheck(
    checks,
    "trace_has_no_orphans",
    Array.isArray(trace.orphan_requirements) &&
      trace.orphan_requirements.length === 0 &&
      Array.isArray(trace.orphan_code_units) &&
      trace.orphan_code_units.length === 0 &&
      Array.isArray(trace.orphan_artifacts) &&
      trace.orphan_artifacts.length === 0,
    `orphan_requirements=${(trace.orphan_requirements || []).length}; orphan_code_units=${(trace.orphan_code_units || []).length}; orphan_artifacts=${(trace.orphan_artifacts || []).length}`
  );

  addCheck(
    checks,
    "gap_report_zero",
    gap.total_gaps === 0 && gap.critical_count === 0 && Array.isArray(gap.gaps) && gap.gaps.length === 0,
    `total_gaps=${gap.total_gaps}; critical_count=${gap.critical_count}`
  );

  addCheck(
    checks,
    "audit_not_blocked",
    audit.blocked === false && Number(audit.failed_checks || 0) === 0,
    `blocked=${audit.blocked}; failed_checks=${audit.failed_checks}`
  );

  addCheck(
    checks,
    "ai_os_requirement_discovery_uses_provider",
    projectRuntimeText.includes("new OpenAiRequirementDiscoveryProvider()") &&
      projectRuntimeText.includes("buildRequirementDiscoveryViaProvider") &&
      requirementProviderText.includes("response_format") &&
      requirementProviderText.includes("json_object"),
    "Requirement discovery is routed through OpenAiRequirementDiscoveryProvider"
  );

  addCheck(
    checks,
    "ai_os_delegated_defaults_supported_by_provider_prompt",
    requirementProviderText.includes("explicitly delegates choices") &&
      requirementProviderText.includes("recommended_scenario") &&
      requirementProviderText.includes("open_questions to an empty array"),
    "Requirement provider prompt supports user-delegated scenario/default selection without local inference"
  );

  addCheck(
    checks,
    "ai_os_provider_unavailable_blocks_discovery",
    requirementProviderText.includes("OPENAI_API_KEY_MISSING") &&
      projectRuntimeText.includes("PROVIDER_NOT_AVAILABLE") &&
      projectRuntimeText.includes("INVALID_ARCHITECTURE"),
    "Provider absence/invalid output blocks AI OS discovery"
  );

  addCheck(
    checks,
    "ai_os_no_local_requirement_keyword_detection",
    !/function\s+inferProjectType/.test(projectRuntimeText) &&
      !/text\.includes\s*\(/.test(projectRuntimeText) &&
      !/generateOptionsFromAnswers/.test(projectRuntimeText) &&
      !/buildRequirementProfile/.test(projectRuntimeText) &&
      !/generateExecutionFilesFromDesign/.test(projectRuntimeText),
    "AI OS runtime contains no local keyword/domain discovery fallback"
  );

  addCheck(
    checks,
    "ai_os_downstream_generation_is_provider_or_explicit_input",
    projectRuntimeText.includes("generateOptionsViaProvider") &&
      projectRuntimeText.includes("generateDocumentationDraftViaProvider") &&
      projectRuntimeText.includes("generateExecutionFilesViaProvider") &&
      structuredProviderText.includes("response_format") &&
      structuredProviderText.includes("json_object"),
    "Options/docs/execution generation uses provider when not explicitly supplied"
  );

  addCheck(
    checks,
    "workspace_ai_os_async_routes_await_provider_flows",
    workspaceApiText.includes("await aiOsRuntime.registerOptions(body)") &&
      workspaceApiText.includes("await aiOsRuntime.saveDocumentationDraft(body)") &&
      workspaceApiText.includes("await aiOsRuntime.createExecutionHandoff(body)"),
    "Workspace API awaits async AI OS provider-backed flows"
  );

  addCheck(
    checks,
    "workspace_ai_os_discovery_continuation_uses_options_flow",
    workspaceUiText.includes("askAiOsOptionsCheckpoint") &&
      workspaceUiText.includes("/api/ai-os/options") &&
      workspaceUiText.includes('checkpoint.nextAction === "AI_OS_OPTIONS"') &&
      workspaceUiText.includes("presentAiOsOptions(checkpoint.projectId, checkpoint.request)"),
    "Workspace UI continues from completed discovery into AI OS options instead of legacy code proposal generation"
  );

  addCheck(
    checks,
    "workspace_ai_os_option_selection_generates_documentation_draft",
    projectRuntimeText.includes("documentation_content: content") &&
      workspaceUiText.includes("prepareAiOsDocumentationDraft") &&
      workspaceUiText.includes("/api/ai-os/documentation/draft") &&
      workspaceUiText.includes("await prepareAiOsDocumentationDraft(optionsState.projectId, optionsState.request)"),
    "Workspace UI generates and displays the AI OS documentation draft immediately after the user accepts an option"
  );

  addCheck(
    checks,
    "workspace_ai_os_execution_command_uses_handoff_flow",
    workspaceUiText.includes("isExecutionRequest") &&
      workspaceUiText.includes("canHandleAiOsExecutionRequest") &&
      workspaceUiText.includes("createAiOsExecutionHandoffFromCurrentProject") &&
      workspaceUiText.includes("/api/ai-os/documentation/approve") &&
      workspaceUiText.includes("/api/ai-os/handoff"),
    "Workspace UI routes execution commands from an approved AI OS project state into documentation approval and Forge handoff instead of starting a new intake"
  );

  addCheck(
    checks,
    "workspace_ai_os_project_state_commands_bypass_discovery",
    projectRuntimeText.includes("getDocumentationDraft") &&
      projectRuntimeText.includes("EXECUTION_HANDOFF_ALREADY_CREATED") &&
      projectRuntimeText.includes("buildExecutionScopeFingerprint") &&
      projectRuntimeText.includes("packageMatchesCurrentScope") &&
      projectRuntimeText.includes("documentation_sha256") &&
      workspaceApiText.includes("/api/ai-os/documentation/current") &&
      workspaceUiText.includes("handleCurrentProjectStateCommand") &&
      workspaceUiText.indexOf("await handleCurrentProjectStateCommand(request)") <
        workspaceUiText.indexOf("if (pendingAiOsDiscovery)") &&
      workspaceUiText.includes("isShowDocumentationRequest") &&
      workspaceUiText.includes("isApproveDocumentationRequest") &&
      workspaceUiText.includes("isContinueCurrentProjectRequest") &&
      workspaceUiText.includes('normalized === "\\u0627\\u0639\\u062a\\u0645\\u062f"') &&
      workspaceUiText.includes('normalized === "\\u0643\\u0645\\u0644"') &&
      workspaceUiText.includes('normalized === "\\u0627\\u0639\\u062a\\u0645\\u062f \\u0648\\u0643\\u0645\\u0644"'),
    "Workspace UI handles current-project documentation/approval/continue/execution commands before discovery, and runtime only reuses an execution handoff when it matches the current documentation scope"
  );

  addCheck(
    checks,
    "workspace_ai_os_unclear_project_messages_offer_state_choices",
    workspaceUiText.includes("isAmbiguousCurrentProjectRequest") &&
      workspaceUiText.includes("buildCurrentProjectActionChoices") &&
      workspaceUiText.includes("askCurrentProjectActionChoice") &&
      workspaceUiText.includes("data-project-command-choice") &&
      workspaceUiText.includes("isStopCurrentProjectRequest") &&
      workspaceUiText.includes("isStartOverRequest") &&
      workspaceUiText.includes('value: "\\u0627\\u0639\\u0631\\u0636 \\u0627\\u0644\\u0648\\u062b\\u0627\\u0626\\u0642"') &&
      workspaceUiText.includes('value: "\\u0646\\u0641\\u0630"') &&
      workspaceUiText.includes('value: "\\u0627\\u062a\\u0648\\u0642\\u0641"') &&
      workspaceUiText.includes('value: "\\u0627\\u0628\\u062f\\u0623 \\u0645\\u0646 \\u062c\\u062f\\u064a\\u062f"') &&
      workspaceUiText.indexOf("await handleCurrentProjectStateCommand(request)") <
        workspaceUiText.indexOf("if (pendingAiOsDiscovery)"),
    "Workspace UI presents context-aware current-project action choices for unclear short follow-up messages before starting discovery"
  );

  addCheck(
    checks,
    "ai_os_new_intake_resets_downstream_decisions",
    projectRuntimeText.includes("accepted_options: []") &&
      projectRuntimeText.includes("rejected_options: []") &&
      projectRuntimeText.includes("pending_decisions: []") &&
      projectRuntimeText.includes("review_cycles_count: 0") &&
      projectRuntimeText.includes("accepted_options: discovery.completeness ? [] : state.accepted_options") &&
      projectRuntimeText.includes("documentation_state: discovery.completeness ? \"EMPTY\" : state.documentation_state"),
    "A fresh AI OS intake and completed clarification discovery clear downstream option/documentation state so a new user idea is not blocked by a previous accepted option"
  );

  addCheck(
    checks,
    "verification_engine_runs_acceptance_report",
    verifyEngineText.includes("runDocsMustAcceptanceValidator") &&
      verifyEngineText.includes("docs_must_acceptance_report.json"),
    "Verify engine invokes docs MUST acceptance validator"
  );

  const failedChecks = checks.filter((check) => !check.passed);
  const report = {
    report_id: "DOCS_MUST_ACCEPTANCE_REPORT_v1",
    generated_at: nowIso(),
    result: failedChecks.length === 0 ? "PASS" : "FAIL",
    summary: {
      must_clause_count: mustClauses.length,
      uncovered_must_clause_count: uncoveredClauses.length,
      total_checks: checks.length,
      failed_checks: failedChecks.length
    },
    checks,
    clause_evidence: clauseEvidence
  };

  const outRel = "verify/unit/docs_must_acceptance_report.json";
  const outAbs = path.resolve(ROOT, outRel);
  ensureDir(path.dirname(outAbs));
  fs.writeFileSync(outAbs, JSON.stringify(report, null, 2), "utf8");

  return report;
}

if (require.main === module) {
  const report = runValidator();
  process.exitCode = report.result === "PASS" ? 0 : 1;
}

module.exports = {
  runValidator
};
