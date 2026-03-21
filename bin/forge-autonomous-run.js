#!/usr/bin/env node

const { runAutonomous } = require("../code/src/orchestrator/autonomous_runner");
const { writeForgeState } = require("../code/src/forge/forge_state_writer");

const fs = require("fs");
const path = require("path");
const { writeStatus } = require("../code/src/orchestrator/status_writer");

const FORGE_STATE_PATH = path.resolve(__dirname, "..", "artifacts", "forge", "forge_state.json");

function syncLiveStatusFromForgeState() {
  if (!fs.existsSync(FORGE_STATE_PATH)) {
    return;
  }

  const forgeState = JSON.parse(fs.readFileSync(FORGE_STATE_PATH, "utf8"));
  const isComplete =
    String(forgeState.execution_integrity || "").toUpperCase() === "CONSISTENT" &&
    String(forgeState.next_allowed_step || "").trim().toUpperCase() === "COMPLETE";

  if (!isComplete) {
    return;
  }

  writeStatus({
    status_type: "LIVE",
    current_stage: "D",
    overall_progress_percent: 100,
    stage_progress_percent: 100,
    last_completed_artifact: String(forgeState.last_completed_artifact || ""),
    current_task: "",
    issues: [],
    blocking_questions: [],
    next_step: ""
  });
}

function finalizeAndExit(error) {
  try {
    writeForgeState();
  } catch (stateError) {
    console.error("FORGE BUILD STATE WRITE ERROR:");
    console.error(stateError && stateError.message ? stateError.message : String(stateError));
  }

  if (error) {
    console.error("FORGE AUTONOMOUS RUN ERROR:");
    console.error(error && error.message ? error.message : String(error));
    process.exit(1);
  }
}

Promise.resolve()
  .then(() => {
    const forgeState = writeForgeState();

    if (String(forgeState.execution_integrity || "").toUpperCase() === "BLOCKED") {
      throw new Error(
        `FORGE GOVERNANCE BLOCK: ${forgeState.reason || "UNKNOWN REASON"}`
      );
    }

    return runAutonomous();
  })
  .then(() => {
    writeForgeState();
    syncLiveStatusFromForgeState();
  })
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    finalizeAndExit(error);
  });