# ARTIFACT NAMESPACE RULES (FORGE)

## Purpose

This file defines where Codex is allowed and NOT allowed to write.

This is a CRITICAL rule.

Violation = SYSTEM BREAK.

---

## Namespace Types

There are THREE types of namespaces:

---

### 1) Module-Owned Namespaces (Writable by modules only)

artifacts/intake/
artifacts/audit/
artifacts/trace/
artifacts/gap/
artifacts/exploration/
artifacts/decisions/
artifacts/backfill/
artifacts/execute/
artifacts/closure/

Rules:
- Codex may write ONLY through approved execution flow
- Direct writing is NOT allowed without execution plan

---

### 2) System-Governed Namespaces (STRICT CONTROL)

artifacts/forge/
artifacts/orchestration/
artifacts/cognitive/
artifacts/llm/
artifacts/ai/
artifacts/coverage/
artifacts/verify/
artifacts/archive/
artifacts/projects/
artifacts/admission/

Rules:
- Codex MUST NOT write directly
- Only owning system components may write

---

### 3) Immutable Legacy Namespaces (READ-ONLY)

artifacts/tasks/
artifacts/stage_A/
artifacts/stage_B/
artifacts/stage_C/
artifacts/stage_D/
artifacts/reports/
artifacts/release/

Rules:
- READ ONLY
- NO modifications allowed
- NO new files allowed
- NO updates allowed

Violation = CRITICAL

---

## Critical Enforcement

Codex MUST:

- Validate namespace BEFORE any change
- STOP if target path is not allowed
- NEVER create new top-level artifact namespaces

---

## Special Rule — artifacts/projects/

artifacts/projects/ is SYSTEM-GOVERNED.

Codex MUST NOT:
- write directly
- create files inside

Unless:
- explicitly allowed by an execution plan
- and approved via Decision Gate

---

## If Uncertain

If Codex is unsure about a namespace:

- STOP
- ask ONE blocking question
- DO NOT guess