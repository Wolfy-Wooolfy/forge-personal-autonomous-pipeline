const fs = require("fs");
const path = require("path");

const { validateTransition } = require("./stage_transitions");
const { writeStatus } = require("./status_writer");
const { executeTask } = require("../execution/task_executor");

const STATUS_PATH = path.resolve(__dirname, "../../..", "progress", "status.json");

const TASKS_DIR = path.resolve(__dirname, "../../..", "artifacts", "tasks");

function hasExecutionClosureForTask(taskName) {
  if (typeof taskName !== "string" || !taskName.trim().startsWith("TASK-")) {
    return false;
  }

  const taskId = taskName.split(":")[0].trim();
  const closurePath = path.join(TASKS_DIR, `${taskId}.execution.closure.md`);
  return fs.existsSync(closurePath);
}

function loadStatus() {
  const raw = fs.readFileSync(STATUS_PATH, { encoding: "utf8" });
  return JSON.parse(raw);
}

function writeStatusAndRun(taskName) {
  const current = loadStatus();

  writeStatus({
    ...current,
    current_task: taskName,
    next_step: ""
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

function run() {
  const status = loadStatus();

  if (typeof status.current_task !== "string") {
    throw new Error("current_task must be string");
  }

  if (status.current_task.trim() === "") {
    console.log("[FORGE] No task to execute.");
    return;
  }

  assertIdempotency(status);

  if (isDryRun()) {
    console.log("[FORGE DRY-RUN]");
    console.log(`Would execute task: ${status.current_task}`);
    console.log("No state was written.");
    return;
  }

  const result = executeTask(status.current_task, status);

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

  console.log(`[FORGE] ${status.current_task} progressed stage to ${result.stage_progress_percent}%`);

  if (result.closure_artifact) {
    console.log(`[FORGE] ${status.current_task} execution closure artifact created.`);
  }

  const targetStage = extractTargetStage(status.next_step);
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