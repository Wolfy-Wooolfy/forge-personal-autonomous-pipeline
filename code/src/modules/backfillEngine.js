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

function runBackfill(context) {
  const status = context && context.status ? context.status : context;

  const decisionAbs = path.resolve(ROOT, "artifacts", "decisions", "module_flow_decision_gate.json");
  if (!fs.existsSync(decisionAbs)) {
    return {
      stage_progress_percent: 100,
      blocked: true,
      status_patch: {
        next_step: "",
        blocking_questions: [
          "Backfill BLOCKED: missing artifacts/decisions/module_flow_decision_gate.json"
        ]
      }
    };
  }

  const decision = readJsonAbs(decisionAbs);
  const mode = String(decision && decision.mode ? decision.mode : "").trim().toUpperCase();
  if (mode !== "APPROVE_ALL") {
    return {
      stage_progress_percent: 100,
      blocked: true,
      status_patch: {
        next_step: "IDLE — Backfill halted (Decision Gate not APPROVE_ALL)",
        blocking_questions: [
          "Backfill halted: Decision Gate mode is not APPROVE_ALL."
        ]
      }
    };
  }

  const gapAbs = path.resolve(ROOT, "artifacts", "gap", "gap_actions.json");
  if (!fs.existsSync(gapAbs)) {
    return {
      stage_progress_percent: 100,
      blocked: true,
      status_patch: {
        next_step: "",
        blocking_questions: [
          "Backfill BLOCKED: missing artifacts/gap/gap_actions.json"
        ]
      }
    };
  }

  const gapActions = readJsonAbs(gapAbs);
  const gaps = Array.isArray(gapActions.gaps) ? gapActions.gaps : [];

  const backfillDirAbs = path.resolve(ROOT, "artifacts", "backfill");
  ensureDir(backfillDirAbs);

  const tasksRel = "artifacts/backfill/backfill_tasks.json";
  const reportRel = "artifacts/backfill/backfill_report.md";

  const tasksAbs = path.resolve(ROOT, tasksRel);
  const reportAbs = path.resolve(ROOT, reportRel);

  const normalized = gaps.map((g) => {
    const rec = Array.isArray(g.recommended_actions) ? g.recommended_actions : [];
    const first = rec[0] || {};
    return {
      gap_id: String(g.gap_id || ""),
      category: String(g.category || ""),
      severity: String(g.severity || ""),
      affected_entities: Array.isArray(g.affected_entities) ? g.affected_entities : [],
      root_cause: String(g.root_cause || ""),
      action: {
        action_id: String(first.action_id || ""),
        description: String(first.description || ""),
        impact_scope: String(first.impact_scope || ""),
        requires_decision: Boolean(first.requires_decision)
      }
    };
  });

  const payload = {
    backfill_id: "MODULE_FLOW_BACKFILL_v1",
    generated_at: new Date().toISOString(),
    source: {
      gap_actions_path: "artifacts/gap/gap_actions.json",
      gap_actions_sha256: sha256Text(JSON.stringify(gapActions))
    },
    summary: {
      total_gaps: Number(gapActions.total_gaps || normalized.length || 0),
      critical_count: Number(gapActions.critical_count || 0),
      items_emitted: normalized.length
    },
    items: normalized
  };

  fs.writeFileSync(tasksAbs, JSON.stringify(payload, null, 2), { encoding: "utf8" });

  const md = [
    "# MODULE FLOW — Backfill Report",
    "",
    `- generated_at: ${payload.generated_at}`,
    `- source: artifacts/gap/gap_actions.json`,
    `- gaps_total: ${payload.summary.total_gaps}`,
    `- critical_count: ${payload.summary.critical_count}`,
    `- items_emitted: ${payload.summary.items_emitted}`,
    "",
    "## Next",
    "- next_step: MODULE_FLOW — Backfill COMPLETE. Next=Execute (implement executeEngine + task bridge).",
    ""
  ].join("\n");

  fs.writeFileSync(reportAbs, md, { encoding: "utf8" });

  return {
    stage_progress_percent: 100,
    artifact: reportRel,
    outputs: {
      md: reportRel,
      json: tasksRel
    },
    status_patch: {
      blocking_questions: [],
      next_step: "MODULE_FLOW — Backfill COMPLETE. Next=Execute (implement executeEngine + task bridge)."
    }
  };
}

module.exports = {
  runBackfill
};