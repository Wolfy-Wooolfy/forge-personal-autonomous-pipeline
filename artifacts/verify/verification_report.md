# Verification Report

generated_at: 2026-04-02T10:35:18.085Z
status: FAIL

## Closure Gate Readiness
- gap_count: 391
- critical_violations: 0
- orphan_code_units: 0
- orphan_requirements: 0
- orphan_artifacts: 0
- execute_artifacts_complete: true
- decision_artifact_present: true
- deterministic_confirmation_ready: true
- closure_contract_ready: false

## Checks
- artifacts_intake_intake_snapshot_json_valid_json: PASS artifacts/intake/intake_snapshot.json
- artifacts_audit_audit_findings_json_valid_json: PASS artifacts/audit/audit_findings.json
- artifacts_trace_trace_matrix_json_valid_json: PASS artifacts/trace/trace_matrix.json
- artifacts_gap_gap_actions_json_valid_json: PASS artifacts/gap/gap_actions.json
- artifacts_backfill_backfill_plan_json_valid_json: PASS artifacts/backfill/backfill_plan.json
- artifacts_execute_execute_plan_json_valid_json: PASS artifacts/execute/execute_plan.json
- artifacts_execute_execute_diff_md_exists: PASS artifacts/execute/execute_diff.md
- artifacts_execute_execute_log_md_exists: PASS artifacts/execute/execute_log.md
- decision_artifact_present: PASS artifacts/decisions/module_flow_decision_gate.json
- execute_plan_matches_backfill_plan: PASS backfill_actions=391; execute_actions=391
- gap_count_zero: FAIL gap_count=391
- critical_violations_zero: PASS critical_violations=0
- orphan_code_units_zero: PASS orphan_code_units=0
- orphan_requirements_zero: PASS orphan_requirements=0
- orphan_artifacts_zero: PASS orphan_artifacts=0
- audit_not_blocked: PASS audit_blocked=false
- trace_mappings_present: PASS mappings=579
- intake_snapshot_locked: PASS locked_snapshot_flag=true