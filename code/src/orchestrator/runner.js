const fs = require("fs");
const path = require("path");

const { resolveEntry } = require("./entry_resolver");
const { validateTransition } = require("./stage_transitions");
const { writeStatus } = require("./status_writer");
const { executeTask } = require("../execution/task_executor");

const STATUS_PATH = path.resolve(__dirname, "../../..", "progress", "status.json");

const TASKS_DIR = path.resolve(__dirname, "../../..", "artifacts", "tasks");

const AUDIT_FINDINGS_PATH = path.resolve(__dirname, "../../..", "artifacts", "audit", "audit_findings.json");

const ROOT = path.resolve(__dirname, "../../..");

const RELEASE_MANIFEST_PATH = path.join(ROOT, "artifacts", "release", "RELEASE_MANIFEST_v1.json");
const REPOSITORY_HASH_SNAPSHOT_PATH = path.join(ROOT, "artifacts", "release", "repository_hash_snapshot.json");
const CLOSURE_REPORT_PATH = path.join(ROOT, "artifacts", "closure", "closure_report.md");
const VERIFY_RESULTS_PATH = path.join(ROOT, "artifacts", "verify", "verification_results.json");

function safeReadJson(absPath) {
  try {
    if (!fs.existsSync(absPath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(absPath, "utf8"));
  } catch (error) {
    return null;
  }
}

function isAuthoritativeClosureArtifact(taskName) {
  const taskId = String(taskName || "").split(":")[0];

  if (taskId === "TASK-054") {
    const executePlanPath = path.join(ROOT, "artifacts", "execute", "execute_plan.json");
    const executeDiffPath = path.join(ROOT, "artifacts", "execute", "execute_diff.md");
    const executeLogPath = path.join(ROOT, "artifacts", "execute", "execute_log.md");

    return (
      fs.existsSync(executePlanPath) &&
      fs.existsSync(executeDiffPath) &&
      fs.existsSync(executeLogPath)
    );
  }

  if (taskId === "TASK-061") {
    const verifyReportPath = path.join(ROOT, "artifacts", "verify", "verification_report.md");
    const verifyResultsPath = path.join(ROOT, "artifacts", "verify", "verification_results.json");

    if (!fs.existsSync(verifyReportPath) || !fs.existsSync(verifyResultsPath)) {
      return false;
    }

    const verifyResults = safeReadJson(verifyResultsPath);

    if (!verifyResults) {
      return false;
    }

    const verifyOutcome = String(
      verifyResults.final_outcome ||
      verifyResults.outcome ||
      verifyResults.status ||
      verifyResults.verification_status ||
      ""
    ).toUpperCase();

    const verifyPassed =
      verifyResults.blocked !== true &&
      (verifyOutcome === "PASS" || verifyOutcome === "PASSED" || verifyOutcome === "OK");

    const verifyContractReady =
      verifyResults.closure_gate &&
      verifyResults.closure_gate.closure_contract_ready === true;

    return verifyPassed === true && verifyContractReady === true;
  }

  if (taskId !== "TASK-055") {
    return true;
  }

  if (
    !fs.existsSync(CLOSURE_REPORT_PATH) ||
    !fs.existsSync(RELEASE_MANIFEST_PATH) ||
    !fs.existsSync(REPOSITORY_HASH_SNAPSHOT_PATH) ||
    !fs.existsSync(VERIFY_RESULTS_PATH)
  ) {
    return false;
  }

  const releaseManifest = safeReadJson(RELEASE_MANIFEST_PATH);
  const verifyResults = safeReadJson(VERIFY_RESULTS_PATH);

  if (!releaseManifest || !verifyResults) {
    return false;
  }

  const verifyOutcome = String(
    verifyResults.final_outcome ||
    verifyResults.outcome ||
    verifyResults.status ||
    verifyResults.verification_status ||
    ""
  ).toUpperCase();

  const verifyPassed =
    verifyResults.blocked !== true &&
    (verifyOutcome === "PASS" || verifyOutcome === "PASSED" || verifyOutcome === "OK");

  const verifyContractReady =
    verifyResults.closure_gate &&
    verifyResults.closure_gate.closure_contract_ready === true;

  return (
    Number(releaseManifest.gap_count) === 0 &&
    Number(releaseManifest.critical_violations) === 0 &&
    releaseManifest.deterministic_confirmation === true &&
    verifyPassed === true &&
    verifyContractReady === true
  );
}

function hasExecutionClosureForTask(taskName) {
  if (typeof taskName !== "string" || !taskName.trim().startsWith("TASK-")) {
    return false;
  }

  const taskId = taskName.split(":")[0].trim();
  const closurePath = path.join(TASKS_DIR, `${taskId}.execution.closure.md`);

  if (!fs.existsSync(closurePath)) {
    return false;
  }

  if (!isAuthoritativeClosureArtifact(taskName)) {
    return false;
  }

  return true;
}

function loadStatus() {
  const raw = fs.readFileSync(STATUS_PATH, { encoding: "utf8" });
  return JSON.parse(raw);
}

function loadAuditFindings() {
  if (!fs.existsSync(AUDIT_FINDINGS_PATH)) {
    return null;
  }

  const raw = fs.readFileSync(AUDIT_FINDINGS_PATH, { encoding: "utf8" });
  return JSON.parse(raw);
}

async function writeStatusAndRun(taskName) {
  const current = loadStatus();

  writeStatus({
    ...current,
    current_task: taskName
  });

  return run();
}

function extractTargetStage(nextStep) {
  if (typeof nextStep !== "string") {
    return null;
  }

  const match = nextStep.match(/Stage\s+([A-D])/i);
  if (!match) {
    return null;
  }

  return match[1].toUpperCase();
}

function isDryRun() {
  const v =
    process.env.FORGE_DRY_RUN !== undefined
      ? process.env.FORGE_DRY_RUN
      : process.env.HALO_DRY_RUN;

  return String(v || "").toLowerCase() === "true";
}

function allowPostStageCompletion(status) {
  const t = String(status.current_task || "");
  const ns = String(status.next_step || "");
  if (/\bTASK-040\b/.test(t) || /\bTASK-040\b/.test(ns)) {
    return true;
  }

  if (
    status.current_stage === "D" &&
    status.stage_progress_percent === 100 &&
    String(process.env.HALO_ALLOW_POST_STAGE_TASKS || "") === "1" &&
    String(status.current_task || "").trim() !== ""
  ) {
    return true;
  }

  return false;
}

function assertIdempotency(status) {
  if (allowPostStageCompletion(status)) {
    return;
  }

  if (
    typeof status.current_task === "string" &&
    status.current_task.trim() !== "" &&
    hasExecutionClosureForTask(status.current_task)
  ) {
    throw new Error("Task already completed (idempotency guard)");
  }
}

async function run() {
  const status = loadStatus();

  const entry = resolveEntry();

  if (entry.blocked) {
    throw new Error(`[ENTRY BLOCKED] ${entry.reason}`);
  }

  if (!entry.next_task) {
    console.log("[FORGE] No task resolved from entry.");
    return;
  }

  const auditFindings = loadAuditFindings();
  const isAuditModule = entry.next_module === "AUDIT";
  const isIntakeModule = entry.next_module === "INTAKE";

  if (
    auditFindings &&
    auditFindings.blocked === true &&
    !isAuditModule &&
    !isIntakeModule
  ) {
    throw new Error(`[AUDIT BLOCKED] ${entry.next_module} blocked because artifacts/audit/audit_findings.json reports blocked=true`);
  }

  if (typeof status.current_task !== "string") {
    throw new Error("current_task must be string");
  }

  assertIdempotency({
  ...status,
  current_task: entry.next_task
});

  if (isDryRun()) {
    console.log("[FORGE DRY-RUN]");
    console.log(`Would execute task: ${entry.next_task}`);
    console.log("No state was written.");
    return;
  }

  const result = executeTask(entry.next_task, status);

  if (result && result.closure_artifact === true && result.artifact) {
    const ROOT = path.resolve(__dirname, "../../..");
    const artifactPath = path.resolve(ROOT, result.artifact);

    const dir = path.dirname(artifactPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const content = `# ${entry.next_task} Execution Closure

  Status: COMPLETED
  Generated at: ${new Date().toISOString()}

  This artifact confirms that the task has been fully executed and closed.
  `;

    fs.writeFileSync(artifactPath, content, "utf-8");

    console.log(`[FORGE] Execution closure artifact persisted at: ${result.artifact}`);
  }

  if (!result || typeof result !== "object") {
    throw new Error("Task handler must return execution result object");
  }

  if (typeof status.stage_progress_percent !== "number") {
    throw new Error("stage_progress_percent must be number in status");
  }

  if (result.stage_progress_percent < status.stage_progress_percent) {
    throw new Error("Monotonicity violation: stage_progress_percent cannot decrease");
  }

  let updated = {
    ...status,
    stage_progress_percent: result.stage_progress_percent,
    last_completed_artifact: result.artifact || status.last_completed_artifact
  };

  if (result.status_patch && typeof result.status_patch === "object") {
    updated = {
      ...updated,
      ...result.status_patch
    };
  }

  const patchHasBlockingQuestion =
    !!(
      result.status_patch &&
      Array.isArray(result.status_patch.blocking_questions) &&
      result.status_patch.blocking_questions.length > 0
    );

  if (result.blocked !== true && !patchHasBlockingQuestion) {
    updated = {
      ...updated,
      issues: [],
      blocking_questions: []
    };
  }

  const hasBlockingQuestion =
    Array.isArray(updated.blocking_questions) &&
    updated.blocking_questions.length > 0;

  if (result.blocked === true || hasBlockingQuestion) {
    updated = {
      ...updated,
      overall_progress_percent: Math.min(
        Number(updated.overall_progress_percent || 0),
        99
      ),
      stage_progress_percent: Math.min(
        Number(updated.stage_progress_percent || 0),
        99
      )
    };
  }

  if (result.clear_current_task === true) {
    updated = {
      ...updated,
      current_task: "",
      issues: [],
      blocking_questions: [],
      next_step: ""
    };
  }

  writeStatus(updated);

  console.log(`[FORGE] ${entry.next_task} progressed stage to ${result.stage_progress_percent}%`);

  if (result.closure_artifact) {
    console.log(`[FORGE] ${entry.next_task} execution closure artifact created.`);
  }

  const targetStage = extractTargetStage(updated.next_step);
  if (targetStage && targetStage !== status.current_stage) {
    validateTransition(status.current_stage, targetStage);

    const stageUpdated = {
      ...updated,
      current_stage: targetStage,
      stage_progress_percent: 0
    };

    writeStatus(stageUpdated);

    return {
      ...result,
      updated_status: stageUpdated
    };
  }

  return {
    ...result,
    updated_status: updated
  };
}

module.exports = {
  run,
  runTaskByName: writeStatusAndRun
};