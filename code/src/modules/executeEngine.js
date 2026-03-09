const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "../../..");

function sha256Text(text) {
  return crypto.createHash("sha256").update(String(text), "utf8").digest("hex");
}

function readJsonAbs(absPath) {
  const raw = fs.readFileSync(absPath, { encoding: "utf8" });
  return JSON.parse(raw);
}

function ensureDir(absDir) {
  fs.mkdirSync(absDir, { recursive: true });
}

function runExecute(context) {
  const status = context && context.status ? context.status : context;

  const backfillAbs = path.resolve(ROOT, "artifacts", "backfill", "backfill_tasks.json");
  const intakeContextAbs = path.resolve(ROOT, "artifacts", "intake", "intake_context.json");
  if (!fs.existsSync(backfillAbs)) {
    return {
      stage_progress_percent: 100,
      blocked: true,
      status_patch: {
        next_step: "",
        blocking_questions: [
          "Execute BLOCKED: missing artifacts/backfill/backfill_tasks.json"
        ]
      }
    };
  }

  if (!fs.existsSync(intakeContextAbs)) {
    return {
      stage_progress_percent: 100,
      blocked: true,
      status_patch: {
        next_step: "",
        blocking_questions: [
          "Execute BLOCKED: missing artifacts/intake/intake_context.json"
        ]
      }
    };
  }

  const backfill = readJsonAbs(backfillAbs);
  const intakeContext = readJsonAbs(intakeContextAbs);
  const items = Array.isArray(backfill.items) ? backfill.items : [];

  const executeDirAbs = path.resolve(ROOT, "artifacts", "execute");
  ensureDir(executeDirAbs);

  const planRel = "artifacts/execute/execute_plan.json";
  const reportRel = "artifacts/execute/execute_report.md";

  const planAbs = path.resolve(ROOT, planRel);
  const reportAbs = path.resolve(ROOT, reportRel);

  const actions = items.map((it, i) => {
    const a = it && it.action ? it.action : {};
    return {
      seq: i + 1,
      gap_id: String(it && it.gap_id ? it.gap_id : ""),
      category: String(it && it.category ? it.category : ""),
      severity: String(it && it.severity ? it.severity : ""),
      action_id: String(a && a.action_id ? a.action_id : ""),
      description: String(a && a.description ? a.description : ""),
      impact_scope: String(a && a.impact_scope ? a.impact_scope : ""),
      requires_decision: Boolean(a && a.requires_decision),
      affected_entities: Array.isArray(it && it.affected_entities ? it.affected_entities : []) ? it.affected_entities : [],
      root_cause: String(it && it.root_cause ? it.root_cause : "")
    };
  });

  const plan = {
    execute_id: "MODULE_FLOW_EXECUTE_v1",
    generated_at: new Date().toISOString(),
    source: {
      backfill_tasks_path: "artifacts/backfill/backfill_tasks.json",
      backfill_tasks_sha256: sha256Text(JSON.stringify(backfill))
    },
    status_snapshot: {
      current_stage: String(status && status.current_stage ? status.current_stage : ""),
      stage_progress_percent: typeof status && status.stage_progress_percent === "number" ? status.stage_progress_percent : null,
      last_completed_artifact: String(status && status.last_completed_artifact ? status.last_completed_artifact : "")
    },
    summary: {
      items_in_backfill: items.length,
      actions_in_plan: actions.length
    },
    plan: {
      mode: "PLAN_ONLY",
      ordering: "SEQUENTIAL_AS_BACKFILL",
      actions
    }
  };

  fs.writeFileSync(planAbs, JSON.stringify(plan, null, 2), { encoding: "utf8" });

  const md = [
    "# MODULE FLOW — Execute Report",
    "",
    `- generated_at: ${plan.generated_at}`,
    "- source: artifacts/backfill/backfill_tasks.json",
    `- actions_in_plan: ${plan.summary.actions_in_plan}`,
    "- mode: PLAN_ONLY",
    "- ordering: SEQUENTIAL_AS_BACKFILL",
    "",
    "## Outputs",
    `- ${planRel}`,
    `- ${reportRel}`,
    "",
    "## Next",
    "- next_step: MODULE_FLOW — Execute COMPLETE. Next=Closure (implement closureEngine + task bridge).",
    ""
  ].join("\n");

  fs.writeFileSync(reportAbs, md, { encoding: "utf8" });

  return {
    stage_progress_percent: 100,
    artifact: reportRel,
    outputs: {
      md: reportRel,
      json: planRel
    },
    status_patch: {
      blocking_questions: [],
      next_step: "MODULE_FLOW — Execute COMPLETE. Next=Closure (implement closureEngine + task bridge)."
    }
  };
}

module.exports = {
  runExecute
};