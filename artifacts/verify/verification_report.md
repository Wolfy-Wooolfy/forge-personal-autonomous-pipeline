# Verification Report

generated_at: 2026-04-20T15:09:45.402Z
status: FAIL

## Closure Gate Readiness
- gap_count: 0
- critical_violations: 0
- orphan_code_units: 0
- orphan_requirements: 0
- orphan_artifacts: 0
- execute_artifacts_complete: true
- decision_artifact_present: true
- deterministic_confirmation_ready: true
- closure_contract_ready: true

## Checks
- artifacts_intake_intake_snapshot_json_valid_json: PASS artifacts/intake/intake_snapshot.json
- artifacts_audit_audit_findings_json_valid_json: PASS artifacts/audit/audit_findings.json
- artifacts_trace_trace_matrix_json_valid_json: PASS artifacts/trace/trace_matrix.json
- artifacts_gap_gap_actions_json_valid_json: PASS artifacts/gap/gap_actions.json
- artifacts_backfill_backfill_plan_json_valid_json: PASS artifacts/backfill/backfill_plan.json
- artifacts_execute_execute_plan_json_valid_json: PASS artifacts/execute/execute_plan.json
- artifacts_execute_execute_diff_md_exists: PASS artifacts/execute/execute_diff.md
- artifacts_execute_execute_log_md_exists: PASS artifacts/execute/execute_log.md
- decision_artifact_present: PASS artifacts/decisions/decision_packet.json, artifacts/decisions/module_flow_decision_gate.json
- execute_plan_matches_backfill_plan: PASS backfill_actions=0; execute_actions=0
- decision_gate_matches_backfill_plan: PASS decision_actions=0; backfill_actions=0
- workspace_runtime_execution_id_consistent: FAIL decision=NONE; backfill=NONE; execute=NONE
- workspace_runtime_matches_current_execution_package: PASS No current workspace execution_package.json
- workspace_execution_package_identity_consistent: FAIL decision_package_id=NONE; backfill_package_id=NONE; execute_package_id=NONE; decision_package_path=NONE; backfill_package_path=NONE; execute_package_path=NONE
- workspace_execution_package_matches_current_artifact: PASS No current workspace execution_package.json
- workspace_runtime_write_applied: PASS execute_actions=0; wrote_content_all=n/a
- gap_count_zero: PASS gap_count=0
- critical_violations_zero: PASS critical_violations=0
- orphan_code_units_zero: PASS orphan_code_units=0
- orphan_requirements_zero: PASS orphan_requirements=0
- orphan_artifacts_zero: PASS orphan_artifacts=0
- audit_not_blocked: PASS audit_blocked=false
- trace_mappings_present: PASS mappings=579
- intake_snapshot_locked: PASS locked_snapshot_flag=true