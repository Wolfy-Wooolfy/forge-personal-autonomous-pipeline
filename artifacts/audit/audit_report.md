# Audit Report

## Summary
- blocked: true
- total_checks: 185
- passed_checks: 177
- failed_checks: 8

## Violations
- **CRITICAL** [RegistryClosureConsistency] artifacts/tasks/ — FORGE GOVERNANCE VIOLATION: orphan execution closures detected -> TASK-030, TASK-060, TASK-064
- **CRITICAL** [StatusIntegrity] progress/status.json — next_step missing/invalid.
- **CRITICAL** [ArtifactNamespaceIntegrity] artifacts/orchestration/orchestration_run_report.md — Artifact outside allowed namespaces: orchestration
- **CRITICAL** [ArtifactNamespaceIntegrity] artifacts/orchestration/orchestration_state.json — Artifact outside allowed namespaces: orchestration
- **CRITICAL** [ArtifactNamespaceIntegrity] artifacts/verify/verification_report.md — Artifact outside allowed namespaces: verify
- **CRITICAL** [ArtifactNamespaceIntegrity] artifacts/verify/verification_results.json — Artifact outside allowed namespaces: verify
- **WARNING** [ArtifactNamespaceIntegrity] artifacts/stage_D/verification_report.md — Duplicate artifact filename across namespaces: verification_report.md
- **CRITICAL** [DriftDetection] code/src/orchestrator/runner.js — Hash snapshot mismatch detected (hash_mismatch) vs release_local_v4.hashes.json
