const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..", "..");
const TASKS_DIR = path.join(ROOT, "artifacts", "tasks");
const REGISTRY_PATH = path.join(ROOT, "code", "src", "execution", "task_registry.js");

function loadRegistryModule() {
  delete require.cache[require.resolve(REGISTRY_PATH)];
  const registryModule = require(REGISTRY_PATH);

  if (!registryModule || typeof registryModule !== "object" || Array.isArray(registryModule)) {
    throw new Error("INVALID TASK REGISTRY MODULE EXPORT");
  }

  if (!registryModule.registry || typeof registryModule.registry !== "object" || Array.isArray(registryModule.registry)) {
    throw new Error("INVALID TASK REGISTRY OBJECT");
  }

  return registryModule.registry;
}

function extractOrderedTaskNamesFromRegistry() {
  const registry = loadRegistryModule();
  const taskNames = Object.keys(registry).filter((key) => key.startsWith("TASK-"));

  if (taskNames.length === 0) {
    throw new Error("NO TASKS FOUND IN TASK REGISTRY");
  }

  return taskNames.sort((a, b) => extractTaskNumber(a) - extractTaskNumber(b));
}

function extractTaskNumber(value) {
  const match = String(value).match(/TASK-(\d+)/);

  if (!match) {
    throw new Error(`INVALID TASK IDENTIFIER: ${value}`);
  }

  return Number(match[1]);
}

function listTaskArtifactFiles() {
  if (!fs.existsSync(TASKS_DIR)) {
    throw new Error("TASKS DIRECTORY NOT FOUND");
  }

  return fs.readdirSync(TASKS_DIR);
}

function extractTaskIdFromArtifact(fileName) {
  const match = String(fileName).match(/^(TASK-\d+)/);

  if (!match) {
    throw new Error(`INVALID TASK ARTIFACT NAME: ${fileName}`);
  }

  return match[1];
}

function buildClosureMap(closureFiles) {
  const closureMap = new Map();

  for (const file of closureFiles) {
    const taskId = extractTaskIdFromArtifact(file);

    if (closureMap.has(taskId)) {
      throw new Error(`DUPLICATE CLOSURE ARTIFACT FOR ${taskId}`);
    }

    closureMap.set(taskId, file);
  }

  return closureMap;
}

function findStageArtifactForTask(taskId, allFiles) {
  const preferredOrder = [".stageA.", ".stageB.", ".stageC.", ".stageD."];

  for (const marker of preferredOrder) {
    const found = allFiles.find((file) => file.startsWith(`${taskId}${marker}`));
    if (found) {
      return found;
    }
  }

  return null;
}

function deriveStageFromTask(taskId, allFiles) {
  if (!taskId) {
    return null;
  }

  const artifactFile = findStageArtifactForTask(taskId, allFiles);

  if (!artifactFile) {
    return null;
  }

  if (artifactFile.includes(".stageA.")) return "A";
  if (artifactFile.includes(".stageB.")) return "B";
  if (artifactFile.includes(".stageC.")) return "C";
  if (artifactFile.includes(".stageD.")) return "D";

  return null;
}

function buildTaskFacts(taskNames, closureMap, allFiles) {
  return taskNames.map((taskName) => {
    const taskId = extractTaskIdFromArtifact(taskName);
    const stageArtifact = findStageArtifactForTask(taskId, allFiles);
    const closureArtifact = closureMap.get(taskId) || null;

    return {
      task_id: taskId,
      has_stage_artifact: Boolean(stageArtifact),
      stage_artifact: stageArtifact ? `artifacts/tasks/${stageArtifact}` : "",
      has_closure_artifact: Boolean(closureArtifact),
      closure_artifact: closureArtifact ? `artifacts/tasks/${closureArtifact}` : "",
      stage: deriveStageFromTask(taskId, allFiles)
    };
  });
}

function buildConsistentState(taskFacts, closureMap) {
  const closedTasks = [];
  const openTasks = [];
  const pendingGaps = [];

  for (const fact of taskFacts) {
    if (fact.has_closure_artifact) {
      closedTasks.push(fact.task_id);
      continue;
    }

    openTasks.push(fact.task_id);

    if (fact.has_stage_artifact) {
      pendingGaps.push(`${fact.task_id}: OPEN_WITHOUT_EXECUTION_CLOSURE`);
    } else {
      pendingGaps.push(`${fact.task_id}: MISSING_STAGE_ARTIFACTS_AND_CLOSURE`);
    }
  }

  const lastCompletedTaskId = closedTasks.length > 0 ? closedTasks[closedTasks.length - 1] : null;
  const currentTask = openTasks.length > 0 ? openTasks[0] : null;
  const currentStage = deriveStageFromTask(currentTask, taskFacts.map((item) => path.basename(item.stage_artifact || "")));

  return {
    status_type: "FORGE_BUILD_STATE",
    current_stage: currentStage,
    current_task: currentTask || "",
    last_completed_artifact: lastCompletedTaskId
      ? `artifacts/tasks/${lastCompletedTaskId}.execution.closure.md`
      : "",
    closed_tasks: closedTasks,
    open_tasks: openTasks,
    pending_gaps: pendingGaps,
    build_progress_percent:
      taskFacts.length === 0 ? 0 : Math.round((closedTasks.length / taskFacts.length) * 100),
    execution_integrity: "CONSISTENT",
    next_allowed_step: currentTask
      ? `artifacts/tasks/${currentTask}.stageA.*`
      : "COMPLETE",
    derived_from: {
      registry: "code/src/execution/task_registry.js",
      task_artifacts_directory: "artifacts/tasks",
      closure_artifacts: Array.from(closureMap.values()).map(
        (file) => `artifacts/tasks/${file}`
      )
    },
    derived_at: new Date().toISOString()
  };
}

function buildInconsistentState(taskFacts, firstBrokenClosedTaskId) {
  const closedTasks = [];
  const openTasksBeforeBreak = [];
  const closedTasksAfterBreak = [];
  const pendingGaps = [];

  let firstOpenEncountered = false;

  for (const fact of taskFacts) {
    if (fact.has_closure_artifact && !firstOpenEncountered) {
      closedTasks.push(fact.task_id);
      continue;
    }

    if (!fact.has_closure_artifact) {
      firstOpenEncountered = true;
      openTasksBeforeBreak.push(fact.task_id);

      if (fact.has_stage_artifact) {
        pendingGaps.push(`${fact.task_id}: OPEN_WITHOUT_EXECUTION_CLOSURE`);
      } else {
        pendingGaps.push(`${fact.task_id}: MISSING_STAGE_ARTIFACTS_AND_CLOSURE`);
      }

      continue;
    }

    if (fact.has_closure_artifact && firstOpenEncountered) {
      closedTasksAfterBreak.push(fact.task_id);
    }
  }

  const currentTask = openTasksBeforeBreak.length > 0 ? openTasksBeforeBreak[0] : "";
  const currentStage = currentTask
    ? (taskFacts.find((fact) => fact.task_id === currentTask)?.stage || null)
    : null;

  return {
    status_type: "FORGE_BUILD_STATE",
    current_stage: currentStage,
    current_task: currentTask,
    last_completed_artifact:
      closedTasks.length > 0
        ? `artifacts/tasks/${closedTasks[closedTasks.length - 1]}.execution.closure.md`
        : "",
    closed_tasks: closedTasks,
    open_tasks: openTasksBeforeBreak,
    pending_gaps: pendingGaps,
    build_progress_percent:
      taskFacts.length === 0 ? 0 : Math.round((closedTasks.length / taskFacts.length) * 100),
    execution_integrity: "INCONSISTENT",
    next_allowed_step: currentTask
      ? `artifacts/tasks/${currentTask}.stageA.*`
      : "",
    inconsistency_code: "CLOSURE_CONTINUITY_BROKEN",
    reason: `Closed task found after open task: ${firstBrokenClosedTaskId}`,
    inconsistent_closed_tasks_after_gap: closedTasksAfterBreak,
    derived_from: {
      registry: "code/src/execution/task_registry.js",
      task_artifacts_directory: "artifacts/tasks"
    },
    derived_at: new Date().toISOString()
  };
}

function deriveState() {
  try {
    const taskNames = extractOrderedTaskNamesFromRegistry();
    const allFiles = listTaskArtifactFiles();
    const closureFiles = allFiles.filter((file) => file.endsWith(".execution.closure.md"));
    const closureMap = buildClosureMap(closureFiles);
    const taskFacts = buildTaskFacts(taskNames, closureMap, allFiles);

    let firstOpenEncountered = false;

    for (const fact of taskFacts) {
      if (!fact.has_closure_artifact) {
        firstOpenEncountered = true;
        continue;
      }

      if (fact.has_closure_artifact && firstOpenEncountered) {
        return buildInconsistentState(taskFacts, fact.task_id);
      }
    }

    return buildConsistentState(taskFacts, closureMap);
  } catch (error) {
    return {
      status_type: "FORGE_BUILD_STATE",
      current_stage: null,
      current_task: "",
      last_completed_artifact: "",
      closed_tasks: [],
      open_tasks: [],
      pending_gaps: [],
      build_progress_percent: 0,
      execution_integrity: "BLOCKED",
      next_allowed_step: "",
      reason: error && error.message ? error.message : String(error),
      derived_from: {
        registry: "code/src/execution/task_registry.js",
        task_artifacts_directory: "artifacts/tasks"
      },
      derived_at: new Date().toISOString()
    };
  }
}

module.exports = {
  deriveState
};