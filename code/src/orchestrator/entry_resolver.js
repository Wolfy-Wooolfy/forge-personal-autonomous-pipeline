const fs = require("fs");
const path = require("path");
const { getPipeline } = require("./pipeline_definition");

const TASKS_DIR = path.join(process.cwd(), "artifacts", "tasks");

const FORGE_STATE_PATH = path.join(process.cwd(), "artifacts", "forge", "forge_state.json");

function readForgeState() {
  const raw = fs.readFileSync(FORGE_STATE_PATH, "utf8");
  return JSON.parse(raw);
}

function getClosureFiles() {
  if (!fs.existsSync(TASKS_DIR)) {
    return [];
  }

  return fs
    .readdirSync(TASKS_DIR)
    .filter((f) => f.endsWith(".execution.closure.md"))
    .map((f) => String(f || "").toUpperCase());
}

function extractTaskId(taskName) {
  const match = String(taskName || "").match(/TASK-\d+/i);
  return match ? match[0].toUpperCase() : "";
}

function isTaskClosed(taskName, closureFiles) {
  const taskId = extractTaskId(taskName);

  if (!taskId) {
    return false;
  }

  return closureFiles.includes(`${taskId}.EXECUTION.CLOSURE.MD`);
}

function getContiguousClosedIndex(pipeline, closureFiles) {
  let lastClosedIndex = -1;

  for (let i = 0; i < pipeline.length; i += 1) {
    if (!isTaskClosed(pipeline[i].task_name, closureFiles)) {
      break;
    }
    lastClosedIndex = i;
  }

  return lastClosedIndex;
}

function hasLaterClosureAfterGap(pipeline, closureFiles, contiguousClosedIndex) {
  for (let i = contiguousClosedIndex + 1; i < pipeline.length; i += 1) {
    if (isTaskClosed(pipeline[i].task_name, closureFiles)) {
      return true;
    }
  }

  return false;
}

function resolveEntry() {
  const forgeState = readForgeState();
  const pipeline = getPipeline();
  const closureFiles = getClosureFiles();

  const contiguousClosedIndex = getContiguousClosedIndex(pipeline, closureFiles);
  const laterClosureAfterGap = hasLaterClosureAfterGap(pipeline, closureFiles, contiguousClosedIndex);



  if (laterClosureAfterGap) {
    return {
      entry_type: "BLOCKED",
      next_module: null,
      next_task: null,
      blocked: true,
      reason: "Invalid pipeline state: closure sequence contains a gap"
    };
  }

  const allClosed = contiguousClosedIndex === pipeline.length - 1;
  const forgeTask = String(forgeState.current_task || "").trim();

  if (allClosed) {
    return {
      entry_type: "COMPLETE",
      next_module: null,
      next_task: null,
      blocked: false,
      reason: "Pipeline already complete"
    };
  }

  if (contiguousClosedIndex === -1) {
    if (forgeTask !== "" && extractTaskId(forgeTask) !== extractTaskId(pipeline[0].task_name)) {
      return {
        entry_type: "BLOCKED",
        next_module: null,
        next_task: null,
        blocked: true,
        reason: "Invalid pipeline state: forge_state current_task does not match fresh pipeline start"
      };
    }

    return {
      entry_type: "FRESH",
      next_module: pipeline[0].module_id,
      next_task: pipeline[0].task_name,
      blocked: false,
      reason: "Fresh pipeline start"
    };
  }

  const nextModule = pipeline[contiguousClosedIndex + 1];

  if (!nextModule) {
    return {
      entry_type: "BLOCKED",
      next_module: null,
      next_task: null,
      blocked: true,
      reason: "Invalid pipeline state: next module could not be resolved"
    };
  }

  if (
    forgeTask !== "" &&
    extractTaskId(forgeTask) !== extractTaskId(nextModule.task_name)
  ) {
    return {
      entry_type: "BLOCKED",
      next_module: null,
      next_task: null,
      blocked: true,
      reason: "Invalid pipeline state: forge_state current_task does not match next deterministic task"
    };
  }

  return {
    entry_type: "RESUME",
    next_module: nextModule.module_id,
    next_task: nextModule.task_name,
    blocked: false,
    reason: "Resume from next incomplete module"
  };
}

module.exports = {
  resolveEntry
};
