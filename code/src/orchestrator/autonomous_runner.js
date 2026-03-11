const fs = require("fs");
const path = require("path");
const { resolveEntry } = require("./entry_resolver");
const { getNextModule, getModuleByTask } = require("./pipeline_definition");
const statusWriter = require("./status_writer");
const runner = require("./runner");

const ORCH_STATE = path.join(process.cwd(), "artifacts", "orchestration", "orchestration_state.json");

function ensureOrchestrationDir() {
  fs.mkdirSync(path.dirname(ORCH_STATE), { recursive: true });
}

function writeOrchestrationState(payload) {
  ensureOrchestrationDir();
  fs.writeFileSync(ORCH_STATE, JSON.stringify(payload, null, 2), "utf8");
}

const STATUS_PATH = path.resolve(__dirname, "../../..", "progress", "status.json");

const ORCHESTRATION_STATE_PATH = path.resolve(__dirname, "../../..", "artifacts", "orchestration", "orchestration_state.json");

function loadStatus() {
  const raw = fs.readFileSync(STATUS_PATH, { encoding: "utf8" });
  return JSON.parse(raw);
}

function ensureOrchestrationDir() {
  fs.mkdirSync(path.dirname(ORCHESTRATION_STATE_PATH), { recursive: true });
}

function writeOrchestrationState(payload) {
  ensureOrchestrationDir();
  fs.writeFileSync(ORCHESTRATION_STATE_PATH, JSON.stringify(payload, null, 2), { encoding: "utf8" });
}

const ORCHESTRATION_REPORT_PATH = path.resolve(__dirname, "../../..", "artifacts", "orchestration", "orchestration_run_report.md");

function writeOrchestrationReport(payload) {
  ensureOrchestrationDir();

  const lines = [];
  lines.push("# Forge Autonomous Orchestration Run Report");
  lines.push("");
  lines.push(`- started_at: ${payload.started_at || ""}`);
  lines.push(`- entry_type: ${payload.entry_type || ""}`);
  lines.push(`- next_task: ${payload.next_task || ""}`);
  lines.push(`- status: ${payload.status || ""}`);
  lines.push(`- reason: ${payload.reason || ""}`);
  lines.push("");

  fs.writeFileSync(ORCHESTRATION_REPORT_PATH, lines.join("\n"), { encoding: "utf8" });
}

async function runAutonomous() {
  const entry = resolveEntry();

  writeOrchestrationState({
    started_at: new Date().toISOString(),
    entry_type: entry.entry_type,
    next_task: entry.next_task,
    status: "RUNNING"
  });

  writeOrchestrationReport({
    started_at: new Date().toISOString(),
    entry_type: entry.entry_type,
    next_task: entry.next_task,
    status: "RUNNING"
  });

  if (entry.blocked) {
    writeOrchestrationState({
      started_at: new Date().toISOString(),
      entry_type: entry.entry_type,
      next_task: entry.next_task,
      status: "BLOCKED",
      reason: entry.reason
    });

    writeOrchestrationReport({
      started_at: new Date().toISOString(),
      entry_type: entry.entry_type,
      next_task: entry.next_task,
      status: "BLOCKED",
      reason: entry.reason
    });

    console.log("FORGE AUTONOMOUS STOPPED: BLOCKED");
    console.log(entry.reason);
    return;
  }

  if (entry.entry_type === "COMPLETE") {
    writeOrchestrationState({
      started_at: new Date().toISOString(),
      entry_type: entry.entry_type,
      next_task: entry.next_task,
      status: "COMPLETE",
      reason: "Pipeline already complete"
    });

    writeOrchestrationReport({
      started_at: new Date().toISOString(),
      entry_type: entry.entry_type,
      next_task: entry.next_task,
      status: "COMPLETE",
      reason: "Pipeline already complete"
    });

    console.log("FORGE AUTONOMOUS: Pipeline already complete.");
    return;
  }

  let currentTask = entry.next_task;

  while (currentTask) {
    console.log("AUTONOMOUS RUN →", currentTask);

    const beforeRunStatus = loadStatus();

    await statusWriter.writeStatus({
      ...beforeRunStatus,
      current_task: currentTask,
      next_step: "AUTONOMOUS EXECUTION"
    });

    await runner.run();

    const module = getModuleByTask(currentTask);

    if (!module) {
      console.log("AUTONOMOUS ERROR: module not found");
      return;
    }

    if (module.terminal_flag) {
    
      writeOrchestrationState({
        finished_at: new Date().toISOString(),
        last_task: currentTask,
        status: "COMPLETE"
      });

      writeOrchestrationReport({
        finished_at: new Date().toISOString(),
        last_task: currentTask,
        status: "COMPLETE"
      });

      console.log("AUTONOMOUS COMPLETE: Pipeline finished.");
      const finalStatus = loadStatus();

      await statusWriter.writeStatus({
        ...finalStatus,
        current_task: "",
        next_step: "READY — Autonomous pipeline complete"
      });
      return;
    }

    const nextModule = getNextModule(module.module_id);

    if (!nextModule) {
      console.log("AUTONOMOUS ERROR: next module missing");
      return;
    }

    currentTask = nextModule.task_name;
  }
}

module.exports = {
  runAutonomous
};