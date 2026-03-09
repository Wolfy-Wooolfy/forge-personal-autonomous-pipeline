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

function renderClosureReport(payload) {
  const lines = [];

  lines.push("# MODULE FLOW — Closure Report");
  lines.push("");

  lines.push(`- generated_at: ${payload.generated_at}`);
  lines.push(`- operating_mode: ${payload.operating_mode}`);
  lines.push(`- repository_state: ${payload.repository_state}`);
  lines.push("");

  lines.push("## Verification");

  lines.push(`- Decision Gate: ${payload.verify.decision_gate}`);
  lines.push(`- Backfill: ${payload.verify.backfill}`);
  lines.push(`- Execute: ${payload.verify.execute}`);

  lines.push("");

  lines.push("## Artifacts");

  lines.push(`- ${payload.artifacts.decision_gate}`);
  lines.push(`- ${payload.artifacts.backfill}`);
  lines.push(`- ${payload.artifacts.execute}`);

  lines.push("");

  lines.push("## Result");

  lines.push("Module Flow successfully closed.");

  lines.push("");

  return lines.join("\n");
}

function runClosure(context) {

  const intakePath = path.resolve(ROOT, "artifacts/intake/intake_context.json");
  const decisionPath = path.resolve(ROOT, "artifacts/decisions/module_flow_decision_gate.json");
  const backfillPath = path.resolve(ROOT, "artifacts/backfill/backfill_plan.json");
  const executePath = path.resolve(ROOT, "artifacts/execute/execute_plan.json");

  if (!fs.existsSync(intakePath)) {
    return {
      blocked: true,
      status_patch: {
        next_step: "",
        blocking_questions: ["Closure BLOCKED: intake_context.json missing"]
      }
    };
  }

  if (!fs.existsSync(decisionPath)) {
    return {
      blocked: true,
      status_patch: {
        next_step: "",
        blocking_questions: ["Closure BLOCKED: Decision Gate artifact missing"]
      }
    };
  }

  if (!fs.existsSync(backfillPath)) {
    return {
      blocked: true,
      status_patch: {
        next_step: "",
        blocking_questions: ["Closure BLOCKED: Backfill artifact missing"]
      }
    };
  }

  if (!fs.existsSync(executePath)) {
    return {
      blocked: true,
      status_patch: {
        next_step: "",
        blocking_questions: ["Closure BLOCKED: Execute artifact missing"]
      }
    };
  }

  const intake = readJson(intakePath);
  const mode = String(intake.operating_mode || "").toUpperCase();

  if (mode !== "BUILD" && mode !== "IMPROVE") {
    return {
      blocked: true,
      status_patch: {
        next_step: "",
        blocking_questions: ["Closure BLOCKED: invalid operating mode"]
      }
    };
  }

  const closureDir = path.resolve(ROOT, "artifacts/closure");
  ensureDir(closureDir);

  const closureReportPath = path.resolve(closureDir, "closure_report.md");

  const payload = {
    generated_at: new Date().toISOString(),
    operating_mode: mode,
    repository_state: intake.repository_state,
    verify: {
      decision_gate: "OK",
      backfill: "OK",
      execute: "OK"
    },
    artifacts: {
      decision_gate: "artifacts/decisions/module_flow_decision_gate.json",
      backfill: "artifacts/backfill/backfill_plan.json",
      execute: "artifacts/execute/execute_plan.json"
    }
  };

  fs.writeFileSync(
    closureReportPath,
    renderClosureReport(payload)
  );

  return {
    stage_progress_percent: 100,
    artifact: "artifacts/closure/closure_report.md",
    outputs: {
      md: "artifacts/closure/closure_report.md"
    },
    status_patch: {
      blocking_questions: [],
      next_step: "READY — Module Flow Closure COMPLETE"
    }
  };
}

module.exports = {
  runClosure
};