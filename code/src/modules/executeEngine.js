const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "../../..");

function sha256Text(text) {
  return crypto.createHash("sha256").update(String(text), "utf8").digest("hex");
}

function readJson(absPath) {
  const raw = fs.readFileSync(absPath, "utf8");
  return JSON.parse(raw);
}

function ensureDir(absDir) {
  fs.mkdirSync(absDir, { recursive: true });
}

function renderExecuteReport(payload) {
  const lines = [];

  lines.push("# MODULE FLOW — Execute Report");
  lines.push("");

  lines.push(`- generated_at: ${payload.generated_at}`);
  lines.push(`- operating_mode: ${payload.operating_mode}`);
  lines.push(`- repository_state: ${payload.repository_state}`);
  lines.push("");

  lines.push("## Source");
  lines.push(`- backfill_plan: ${payload.source.backfill_plan_path}`);
  lines.push(`- backfill_sha256: ${payload.source.backfill_sha256}`);
  lines.push(`- intake_context: ${payload.source.intake_context_path}`);
  lines.push(`- intake_sha256: ${payload.source.intake_sha256}`);
  lines.push("");

  lines.push("## Execution Plan");

  if (payload.actions.length === 0) {
    lines.push("- No execution actions");
  } else {
    payload.actions.forEach((a) => {
      lines.push(`- ${a.action_id}`);
      lines.push(`  - type: ${a.action_type}`);
      lines.push(`  - target: ${a.target_path || "(none)"}`);
    });
  }

  lines.push("");
  lines.push("## Next");
  lines.push(
    "- next_step: MODULE_FLOW — Execute COMPLETE. Next=Closure (implement closureEngine + task bridge)."
  );
  lines.push("");

  return lines.join("\n");
}

function runExecute(context) {
  const intakePath = path.resolve(ROOT, "artifacts/intake/intake_context.json");
  const backfillPlanPath = path.resolve(ROOT, "artifacts/backfill/backfill_plan.json");

  if (!fs.existsSync(intakePath)) {
    return {
      stage_progress_percent: 100,
      blocked: true,
      status_patch: {
        next_step: "",
        blocking_questions: ["Execute BLOCKED: intake_context.json missing"]
      }
    };
  }

  if (!fs.existsSync(backfillPlanPath)) {
    return {
      stage_progress_percent: 100,
      blocked: true,
      status_patch: {
        next_step: "",
        blocking_questions: ["Execute BLOCKED: backfill_plan.json missing"]
      }
    };
  }

  const intake = readJson(intakePath);
  const backfillPlan = readJson(backfillPlanPath);

  const mode = String(intake.operating_mode || "").toUpperCase();

  if (intake.blocked === true) {
    return {
      stage_progress_percent: 100,
      blocked: true,
      status_patch: {
        next_step: "",
        blocking_questions: ["Execute BLOCKED: intake is still blocked"]
      }
    };
  }

  if (mode !== "BUILD" && mode !== "IMPROVE") {
    return {
      stage_progress_percent: 100,
      blocked: true,
      status_patch: {
        next_step: "",
        blocking_questions: ["Execute BLOCKED: invalid operating_mode"]
      }
    };
  }

  const actions = Array.isArray(backfillPlan.approved_code_actions)
    ? backfillPlan.approved_code_actions
    : [];

  const executeDir = path.resolve(ROOT, "artifacts/execute");
  ensureDir(executeDir);

  const executePlanPath = path.resolve(executeDir, "execute_plan.json");
  const executeReportPath = path.resolve(executeDir, "execute_report.md");

  const executeDiffPath = path.resolve(executeDir, "execute_diff.md");
  const executeLogPath = path.resolve(executeDir, "execute_log.md");

  const planPayload = {
    execution_id: "MODULE_FLOW_EXECUTE_v1",
    generated_at: new Date().toISOString(),
    operating_mode: mode,
    repository_state: intake.repository_state,
    approved_code_actions: actions
  };

  const intakeText = JSON.stringify(intake, null, 2);
  const backfillText = JSON.stringify(backfillPlan, null, 2);

  const reportPayload = {
    generated_at: planPayload.generated_at,
    operating_mode: mode,
    repository_state: intake.repository_state,
    source: {
      backfill_plan_path: "artifacts/backfill/backfill_plan.json",
      backfill_sha256: sha256Text(backfillText),
      intake_context_path: "artifacts/intake/intake_context.json",
      intake_sha256: sha256Text(intakeText)
    },
    actions
  };

  fs.writeFileSync(executePlanPath, JSON.stringify(planPayload, null, 2));
  fs.writeFileSync(executeReportPath, renderExecuteReport(reportPayload));

  const diffLines = [];
  diffLines.push("# Execute Diff");
  diffLines.push("");
  if (actions.length === 0) {
    diffLines.push("- No changes applied");
  } else {
    actions.forEach((a) => {
      diffLines.push(`- ${a.action_id} → ${a.target_path || "(no target)"}`);
    });
  }
  fs.writeFileSync(executeDiffPath, diffLines.join("\n"));

  const logLines = [];
  logLines.push("# Execute Log");
  logLines.push("");
  logLines.push(`generated_at: ${planPayload.generated_at}`);
  logLines.push(`actions_count: ${actions.length}`);
  actions.forEach((a, i) => {
    logLines.push(`- [${i + 1}] ${a.action_id} (${a.action_type})`);
  });
  fs.writeFileSync(executeLogPath, logLines.join("\n"));

  return {
    stage_progress_percent: 100,
    blocked: false,
    artifact: "artifacts/execute/execute_report.md",
    outputs: {
      md: "artifacts/execute/execute_report.md",
      json: "artifacts/execute/execute_plan.json"
    },
    status_patch: {
      next_step: "MODULE FLOW — Execute COMPLETE. Next=Verify.",
      blocking_questions: []
    }
  };
}

module.exports = {
  runExecute
};