const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../../..");

function ensureDir(absDir) {
  fs.mkdirSync(absDir, { recursive: true });
}

function fileExists(rel) {
  const abs = path.resolve(ROOT, rel);
  return fs.existsSync(abs);
}

function readJson(rel) {
  const abs = path.resolve(ROOT, rel);
  const raw = fs.readFileSync(abs, "utf8");
  return JSON.parse(raw);
}

function runVerify(context) {

  const executePlan = "artifacts/execute/execute_plan.json";
  const backfillPlan = "artifacts/backfill/backfill_plan.json";

  const verifyDir = path.resolve(ROOT, "artifacts/verify");
  ensureDir(verifyDir);

  const reportPath = path.resolve(verifyDir, "verification_report.md");
  const jsonPath = path.resolve(verifyDir, "verification_results.json");

  const results = {
    generated_at: new Date().toISOString(),
    blocked: false,
    status: "",
    outcome: "",
    final_outcome: "",
    checks: []
  };

  function addCheck(name, passed, detail) {
    results.checks.push({
      name,
      passed,
      detail
    });
  }

  if (!fileExists(executePlan)) {
    addCheck("execute_plan_exists", false, executePlan + " missing");
  } else {
    try {
      readJson(executePlan);
      addCheck("execute_plan_valid_json", true, "");
    } catch (e) {
      addCheck("execute_plan_valid_json", false, "invalid JSON");
    }
  }

  if (!fileExists(backfillPlan)) {
    addCheck("backfill_plan_exists", false, backfillPlan + " missing");
  } else {
    try {
      readJson(backfillPlan);
      addCheck("backfill_plan_valid_json", true, "");
    } catch (e) {
      addCheck("backfill_plan_valid_json", false, "invalid JSON");
    }
  }

  const failed = results.checks.filter(c => !c.passed);

  const md = [];

  md.push("# Verification Report");
  md.push("");
  md.push(`generated_at: ${results.generated_at}`);
  md.push("");

  md.push("## Checks");

  for (const c of results.checks) {
    md.push(`- ${c.name}: ${c.passed ? "PASS" : "FAIL"} ${c.detail}`);
  }

  if (failed.length > 0) {
    results.blocked = true;
    results.status = "FAIL";
    results.outcome = "FAIL";
    results.final_outcome = "FAIL";

    fs.writeFileSync(reportPath, md.join("\n"));
    fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));

    return {
      blocked: true,
      artifact: "artifacts/verify/verification_report.md",
      outputs: {
        md: "artifacts/verify/verification_report.md",
        json: "artifacts/verify/verification_results.json"
      },
      status_patch: {
        blocking_questions: ["Verification failed — review verification_report.md"],
        next_step: ""
      }
    };
  }

  results.blocked = false;
  results.status = "PASS";
  results.outcome = "PASS";
  results.final_outcome = "PASS";

  fs.writeFileSync(reportPath, md.join("\n"));
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));

  return {
    stage_progress_percent: 100,
    artifact: "artifacts/verify/verification_report.md",
    outputs: {
      md: "artifacts/verify/verification_report.md",
      json: "artifacts/verify/verification_results.json"
    },
    status_patch: {
      blocking_questions: [],
      next_step: "MODULE_FLOW — Verify COMPLETE. Next=Closure"
    }
  };

}

module.exports = {
  runVerify
};