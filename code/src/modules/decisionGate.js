const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "../../..");

function readJson(absPath) {
  const raw = fs.readFileSync(absPath, { encoding: "utf8" });
  return JSON.parse(raw);
}

function sha256Text(text) {
  return crypto.createHash("sha256").update(String(text), "utf8").digest("hex");
}

function ensureDir(absDir) {
  fs.mkdirSync(absDir, { recursive: true });
}

function parseDecisionFromStatus(status) {
  const ns = String(status && status.next_step ? status.next_step : "");
  const m = ns.match(/\(([^)]+)\)\s*$/);
  const suffix = m ? String(m[1]).trim().toUpperCase() : "";
  if (suffix === "APPROVE ALL") return { mode: "APPROVE_ALL" };
  if (suffix === "REJECT") return { mode: "REJECT" };
  return { mode: "UNSPECIFIED" };
}

function runDecisionGate(context) {
  const status = context && context.status ? context.status : context;

  const gapActionsAbs = path.resolve(ROOT, "artifacts", "gap", "gap_actions.json");
  if (!fs.existsSync(gapActionsAbs)) {
    return {
      stage_progress_percent: 100,
      blocked: true,
      status_patch: {
        next_step: "",
        blocking_questions: [
          "Decision Gate BLOCKED: artifacts/gap/gap_actions.json missing. Run Gap first."
        ]
      }
    };
  }

  const decision = parseDecisionFromStatus(status);

  if (decision.mode === "UNSPECIFIED") {
    return {
      stage_progress_percent: 100,
      blocked: true,
      status_patch: {
        next_step: "",
        blocking_questions: [
          "Decision required: set next_step to include (APPROVE ALL) or (REJECT) then re-run Decision Gate."
        ]
      }
    };
  }

  const actionsObj = readJson(gapActionsAbs);
  const actionsText = JSON.stringify(actionsObj, null, 2);
  const actionsHash = sha256Text(actionsText);

  const decisionsDirAbs = path.resolve(ROOT, "artifacts", "decisions");
  ensureDir(decisionsDirAbs);

  const relDecisionJson = "artifacts/decisions/module_flow_decision_gate.json";
  const relDecisionMd = "artifacts/decisions/module_flow_decision_gate.md";

  const decisionJsonAbs = path.resolve(ROOT, relDecisionJson);
  const decisionMdAbs = path.resolve(ROOT, relDecisionMd);

  const stamp = new Date().toISOString();

  const decisionPayload = {
    decision_id: "MODULE_FLOW_DECISION_GATE",
    timestamp: stamp,
    task: "TASK-052",
    mode: decision.mode,
    source: {
      gap_actions_path: "artifacts/gap/gap_actions.json",
      gap_actions_sha256: actionsHash
    },
    counts: {
      top_level_keys: actionsObj && typeof actionsObj === "object" ? Object.keys(actionsObj).length : 0
    }
  };

  fs.writeFileSync(decisionJsonAbs, JSON.stringify(decisionPayload, null, 2), { encoding: "utf8" });

  const md = [
    "# MODULE FLOW — Decision Gate",
    "",
    `- timestamp: ${stamp}`,
    `- decision: ${decision.mode}`,
    "",
    "## Source",
    `- gap_actions_path: artifacts/gap/gap_actions.json`,
    `- gap_actions_sha256: ${actionsHash}`,
    "",
    "## Outcome",
    decision.mode === "REJECT"
      ? "- REJECT: execution halted. Review Gap outputs and re-run Decision Gate with an explicit approval."
      : "- APPROVE_ALL: proceed to Backfill module implementation + task bridge.",
    "",
    "## Next",
    decision.mode === "REJECT"
      ? "- next_step: IDLE"
      : "- next_step: MODULE_FLOW — Decision Gate COMPLETE. Next=Backfill (implement backfillEngine + task bridge).",
    ""
  ].join("\n");

  fs.writeFileSync(decisionMdAbs, md, { encoding: "utf8" });

  if (decision.mode === "REJECT") {
    return {
      stage_progress_percent: 100,
      artifact: relDecisionMd,
      outputs: { md: relDecisionMd, json: relDecisionJson },
      blocked: true,
      status_patch: {
        next_step: "IDLE — Decision Gate REJECTED",
        blocking_questions: [
          "Decision Gate REJECTED: update next_step with explicit approval to proceed."
        ]
      }
    };
  }

  return {
    stage_progress_percent: 100,
    artifact: relDecisionMd,
    outputs: { md: relDecisionMd, json: relDecisionJson },
    status_patch: {
      blocking_questions: [],
      next_step: "MODULE_FLOW — Decision Gate COMPLETE. Next=Backfill (implement backfillEngine + task bridge)."
    }
  };
}

module.exports = {
  runDecisionGate
};