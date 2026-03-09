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

function classifyActionRisk({ action, gap, intakeContext }) {
  const description = String(action && action.description ? action.description : "").toLowerCase();
  const impactScope = String(action && action.impact_scope ? action.impact_scope : "").toLowerCase();
  const category = String(gap && gap.category ? gap.category : "").toUpperCase();
  const severity = String(gap && gap.severity ? gap.severity : "").toUpperCase();
  const operatingMode = String(intakeContext && intakeContext.operating_mode ? intakeContext.operating_mode : "").toUpperCase();

  const destructivePattern =
    /\b(remove|delete|relocate|rewrite|replace|destructive|irreversible|bypass|contract|governance|architecture|refactor)\b/;

  const hardReviewCategories = new Set([
    "GOVERNANCE_MISMATCH",
    "EXECUTION_STATE_INCONSISTENCY",
    "STRUCTURAL_DRIFT",
    "ORPHAN_CODE"
  ]);

  if (severity === "CRITICAL") {
    return {
      decision: "REVIEW",
      reason: "critical severity gap"
    };
  }

  if (action && action.requires_decision === true) {
    return {
      decision: "REVIEW",
      reason: "action explicitly marked requires_decision"
    };
  }

  if (hardReviewCategories.has(category)) {
    return {
      decision: "REVIEW",
      reason: `category ${category} requires explicit review`
    };
  }

  if (destructivePattern.test(description) || destructivePattern.test(impactScope)) {
    return {
      decision: "REVIEW",
      reason: "destructive or structural wording detected"
    };
  }

  if (operatingMode === "BUILD") {
    return {
      decision: "APPROVE",
      reason: "build mode clear bounded action"
    };
  }

  if (operatingMode === "IMPROVE") {
    if (category === "UNIMPLEMENTED_REQUIREMENT" || category === "ORPHAN_ARTIFACT" || category === "PARTIAL_COVERAGE") {
      return {
        decision: "APPROVE",
        reason: "improve mode bounded non-destructive remediation"
      };
    }
  }

  return {
    decision: "APPROVE",
    reason: "clear bounded low-risk action"
  };
}

function flattenGapActions(gapPayload) {
  const rows = [];
  const gaps = Array.isArray(gapPayload && gapPayload.gaps) ? gapPayload.gaps : [];

  for (const gap of gaps) {
    const recommended = Array.isArray(gap && gap.recommended_actions) ? gap.recommended_actions : [];
    for (const action of recommended) {
      rows.push({
        gap_id: String(gap.gap_id || ""),
        category: String(gap.category || ""),
        severity: String(gap.severity || ""),
        affected_entities: Array.isArray(gap.affected_entities) ? gap.affected_entities.map((x) => String(x)) : [],
        action_id: String(action && action.action_id ? action.action_id : ""),
        description: String(action && action.description ? action.description : ""),
        impact_scope: String(action && action.impact_scope ? action.impact_scope : ""),
        requires_decision: !!(action && action.requires_decision === true),
        _gap: gap,
        _action: action
      });
    }
  }

  return rows;
}

function renderDecisionMd(payload) {
  const lines = [];

  lines.push("# MODULE FLOW — Decision Gate");
  lines.push("");
  lines.push(`- timestamp: ${payload.timestamp}`);
  lines.push(`- policy: ${payload.policy}`);
  lines.push(`- operating_mode: ${payload.operating_mode}`);
  lines.push(`- repository_state: ${payload.repository_state}`);
  lines.push(`- blocked: ${payload.blocked ? "true" : "false"}`);
  lines.push("");
  lines.push("## Source");
  lines.push(`- gap_actions_path: ${payload.source.gap_actions_path}`);
  lines.push(`- gap_actions_sha256: ${payload.source.gap_actions_sha256}`);
  lines.push(`- intake_context_path: ${payload.source.intake_context_path}`);
  lines.push(`- intake_context_sha256: ${payload.source.intake_context_sha256}`);
  lines.push("");
  lines.push("## Summary");
  lines.push(`- total_actions: ${payload.summary.total_actions}`);
  lines.push(`- approved_count: ${payload.summary.approved_count}`);
  lines.push(`- review_required_count: ${payload.summary.review_required_count}`);
  lines.push(`- rejected_count: ${payload.summary.rejected_count}`);
  lines.push("");

  lines.push("## Approved Actions");
  if (payload.approved_actions.length === 0) {
    lines.push("- None");
  } else {
    for (const row of payload.approved_actions) {
      lines.push(`- ${row.action_id} [${row.category}/${row.severity}] ${row.description}`);
      lines.push(`  - reason: ${row.reason}`);
    }
  }
  lines.push("");

  lines.push("## Review Required");
  if (payload.review_required_actions.length === 0) {
    lines.push("- None");
  } else {
    for (const row of payload.review_required_actions) {
      lines.push(`- ${row.action_id} [${row.category}/${row.severity}] ${row.description}`);
      lines.push(`  - reason: ${row.reason}`);
    }
  }
  lines.push("");

  lines.push("## Rejected Actions");
  if (payload.rejected_actions.length === 0) {
    lines.push("- None");
  } else {
    for (const row of payload.rejected_actions) {
      lines.push(`- ${row.action_id} [${row.category}/${row.severity}] ${row.description}`);
      lines.push(`  - reason: ${row.reason}`);
    }
  }
  lines.push("");

  lines.push("## Next");
  if (payload.rejected_actions.length > 0) {
    lines.push("- next_step: IDLE — Decision Gate REJECTED");
  } else if (payload.blocked) {
    lines.push("- next_step: BLOCKED pending explicit decision override");
  } else {
    lines.push("- next_step: MODULE_FLOW — Decision Gate COMPLETE. Next=Backfill (implement backfillEngine + task bridge).");
  }
  lines.push("");

  return lines.join("\n");
}

function runDecisionGate(context) {
  const status = context && context.status ? context.status : context;

  const gapActionsAbs = path.resolve(ROOT, "artifacts", "gap", "gap_actions.json");
  const intakeContextAbs = path.resolve(ROOT, "artifacts", "intake", "intake_context.json");

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

  if (!fs.existsSync(intakeContextAbs)) {
    return {
      stage_progress_percent: 100,
      blocked: true,
      status_patch: {
        next_step: "",
        blocking_questions: [
          "Decision Gate BLOCKED: artifacts/intake/intake_context.json missing. Run Intake first."
        ]
      }
    };
  }

  const decision = parseDecisionFromStatus(status);
  const actionsObj = readJson(gapActionsAbs);
  const intakeContext = readJson(intakeContextAbs);

  const validOperatingMode =
    intakeContext &&
    (intakeContext.operating_mode === "BUILD" || intakeContext.operating_mode === "IMPROVE") &&
    intakeContext.blocked === false;

  if (!validOperatingMode) {
    return {
      stage_progress_percent: 100,
      blocked: true,
      status_patch: {
        next_step: "",
        blocking_questions: [
          "Decision Gate BLOCKED: intake_context operating_mode invalid or intake still blocked."
        ]
      }
    };
  }

  const flatActions = flattenGapActions(actionsObj);

  const approvedActions = [];
  const reviewRequiredActions = [];
  const rejectedActions = [];

  for (const row of flatActions) {
    const verdict = classifyActionRisk({
      action: row._action,
      gap: row._gap,
      intakeContext
    });

    const cleanRow = {
      gap_id: row.gap_id,
      category: row.category,
      severity: row.severity,
      affected_entities: row.affected_entities,
      action_id: row.action_id,
      description: row.description,
      impact_scope: row.impact_scope,
      requires_decision: row.requires_decision,
      reason: verdict.reason
    };

    if (decision.mode === "REJECT") {
      cleanRow.reason = "explicit REJECT from status.next_step";
      rejectedActions.push(cleanRow);
      continue;
    }

    if (verdict.decision === "REVIEW") {
      if (decision.mode === "APPROVE_ALL") {
        cleanRow.reason = `${verdict.reason}; approved by explicit override`;
        approvedActions.push(cleanRow);
      } else {
        reviewRequiredActions.push(cleanRow);
      }
      continue;
    }

    approvedActions.push(cleanRow);
  }

  const decisionsDirAbs = path.resolve(ROOT, "artifacts", "decisions");
  ensureDir(decisionsDirAbs);

  const relDecisionJson = "artifacts/decisions/module_flow_decision_gate.json";
  const relDecisionMd = "artifacts/decisions/module_flow_decision_gate.md";

  const decisionJsonAbs = path.resolve(ROOT, relDecisionJson);
  const decisionMdAbs = path.resolve(ROOT, relDecisionMd);

  const actionsText = JSON.stringify(actionsObj, null, 2);
  const intakeText = JSON.stringify(intakeContext, null, 2);
  const stamp = new Date().toISOString();

  const blocked = rejectedActions.length === 0 && reviewRequiredActions.length > 0;

  const decisionPayload = {
    decision_id: "MODULE_FLOW_DECISION_GATE",
    timestamp: stamp,
    task: "TASK-052",
    policy: "AUTONOMOUS_BY_DEFAULT_FAIL_CLOSED_ON_RISK",
    operating_mode: intakeContext.operating_mode,
    repository_state: intakeContext.repository_state,
    override_mode: decision.mode,
    source: {
      gap_actions_path: "artifacts/gap/gap_actions.json",
      gap_actions_sha256: sha256Text(actionsText),
      intake_context_path: "artifacts/intake/intake_context.json",
      intake_context_sha256: sha256Text(intakeText)
    },
    summary: {
      total_actions: flatActions.length,
      approved_count: approvedActions.length,
      review_required_count: reviewRequiredActions.length,
      rejected_count: rejectedActions.length
    },
    approved_actions: approvedActions,
    review_required_actions: reviewRequiredActions,
    rejected_actions: rejectedActions,
    blocked
  };

  fs.writeFileSync(decisionJsonAbs, JSON.stringify(decisionPayload, null, 2), { encoding: "utf8" });
  fs.writeFileSync(decisionMdAbs, renderDecisionMd(decisionPayload), { encoding: "utf8" });

  if (rejectedActions.length > 0) {
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

  if (blocked) {
    return {
      stage_progress_percent: 100,
      artifact: relDecisionMd,
      outputs: { md: relDecisionMd, json: relDecisionJson },
      blocked: true,
      status_patch: {
        next_step: "",
        blocking_questions: [
          "Decision Gate BLOCKED: high-risk or ambiguous actions require explicit override. Set next_step to include (APPROVE ALL) or (REJECT) then re-run Decision Gate."
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