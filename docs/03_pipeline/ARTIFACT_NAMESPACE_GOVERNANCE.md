# Artifact Namespace Governance

**Document ID:** DOC-54
**Status:** BINDING - ARTIFACT NAMESPACE GOVERNANCE
**Scope:** Artifact Storage and Namespace Enforcement
**Applies To:** Entire Forge Autonomous Pipeline
**Enforcement:** HARD (Fail-Closed)

---

# 1. Purpose

This document defines the governance rules
for artifact storage inside the Forge autonomous system.

It ensures that:

- artifact locations remain deterministic
- namespace sprawl is prevented
- artifact discovery remains reliable
- runtime modules write only to authorized locations

Artifact namespaces are strictly controlled.

Any artifact written outside authorized namespaces
constitutes a governance violation.

---

# 2. Root Artifact Directory

All pipeline artifacts MUST reside under:

```
artifacts/
```

No module may write artifacts outside this root.

Forbidden examples:

```
tmp/
output/
generated/
misc/
logs/
```

outside the artifacts root.

---

# 3. Authorized Namespaces

The authorized namespaces fall into THREE classes, defined in
MODULE_ORCHESTRATION_GOVERNANCE_v1 (DOC-38) Section 11, which prevails
over this section in case of conflict.

## 3.1 Module-Owned Namespaces (writable by modules)

artifacts/intake/
artifacts/audit/
artifacts/trace/
artifacts/gap/
artifacts/exploration/
artifacts/decisions/
artifacts/backfill/
artifacts/execute/
artifacts/closure/

## 3.2 System-Governed Namespaces (writable ONLY by their owning component)

artifacts/forge/         - forge_state_resolver only
artifacts/orchestration/ - orchestrator only
artifacts/cognitive/     - cognitive_adapter only
artifacts/llm/           - cognitive_adapter only
artifacts/ai/            - AI Layer modules only
artifacts/coverage/      - Vision Compliance module only
artifacts/verify/        - Boundary Audit layer only
artifacts/archive/       - forge-reset-new-project.js only
artifacts/projects/      - AI OS project workspace components; Backfill/Execute only for approved execution-package project deliverables
artifacts/admission/     - Idea Structuring Layer only

Each module/component is restricted to its designated namespace.

---

# 4. Module Namespace Mapping

Each execution module may write artifacts only
to its assigned namespace.

| Module | Namespace |
|------|------|
| Intake | artifacts/intake |
| Audit | artifacts/audit |
| Trace | artifacts/trace |
| Gap | artifacts/gap |
| Design Exploration | artifacts/exploration |
| Decision Gate | artifacts/decisions |
| Backfill | artifacts/backfill |
| Execute | artifacts/execute |
| Closure | artifacts/closure |

Modules MUST NOT write outside their namespace.

System-governed namespaces (artifacts/forge, artifacts/orchestration,
artifacts/cognitive, artifacts/llm, artifacts/ai, artifacts/coverage,
artifacts/verify, artifacts/archive, artifacts/projects,
artifacts/admission) follow ownership rules defined in
DOC-38 Section 11 and are NOT module namespaces.

---

# 5. Read Access Rules

Modules may read artifacts from:

- their own namespace
- upstream namespaces
- governance document locations

Modules MUST NOT modify artifacts
produced by other modules.

Artifacts are immutable once consumed.

---

# 6. Legacy Artifact Namespaces (IMMUTABLE-LEGACY)

The following namespaces are GRANDFATHERED for historical evidence only:

artifacts/tasks/
artifacts/stage_A/
artifacts/stage_B/
artifacts/stage_C/
artifacts/stage_D/
artifacts/reports/
artifacts/release/

These namespaces are:

- read-only
- immutable
- not permitted for new artifact generation by runtime modules.

Per DOC-38 Section 11, any attempt to write into IMMUTABLE-LEGACY
is a CRITICAL violation and MUST halt execution.

Note: artifacts/archive/ is governed under Section 3.2 above
(System-Governed) and is permitted ONLY for forge-reset-new-project.js.

---

# 7. Namespace Creation Rules

New artifact namespaces MUST NOT be created
during pipeline execution.

Namespace expansion requires:

- governance document update
- repository change approval
- new contract definition

Runtime modules cannot create namespaces.

---

# 8. Artifact Naming Rules

Artifacts MUST follow deterministic naming.

Allowed naming patterns:

```
<artifact_name>.json
<artifact_name>.md
<artifact_name>.log
```

Randomized names are forbidden.

Timestamp-based names are permitted only
when required for verification evidence.

---

# 9. Runtime Enforcement

Forge runtime MUST enforce namespace governance.

If a module attempts to:

- write outside allowed namespaces
- modify immutable artifacts
- create unauthorized directories

Then:

Execution MUST halt immediately.

A governance violation MUST be recorded.

---

# 10. Artifact Discovery Guarantee

All pipeline artifacts MUST be discoverable
through deterministic paths.

Artifact discovery MUST NOT rely on:

- directory scanning heuristics
- naming assumptions
- wildcard searches.

Explicit artifact paths MUST be used.

---

# 11. Deterministic Artifact Layout

Artifact layout is deterministic when:

- namespace paths are fixed
- artifact names are predictable
- module outputs are defined by contract.

If deterministic layout cannot be guaranteed:

Execution MUST FAIL CLOSED.

---

# 12. Interaction with Module Governance

This document enforces the storage layer
for artifacts produced by modules defined in:

```
MODULE_ORCHESTRATION_GOVERNANCE_v1
```

Module ordering remains governed by that document.

Namespace governance ensures artifact integrity.

---

# 13. Summary

Artifact Namespace Governance guarantees that:

- artifact storage remains controlled
- runtime modules cannot produce uncontrolled output
- artifact discovery remains deterministic
- pipeline integrity is preserved.

This document prevents namespace drift
and maintains predictable artifact structure.

---

**END OF SPECIFICATION**
