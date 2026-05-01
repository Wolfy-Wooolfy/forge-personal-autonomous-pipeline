# FORGE GOVERNANCE RULES

## Core Principle

Forge is a FAIL-CLOSED system.

If anything is:
- missing
- unclear
- conflicting

Execution MUST STOP.

---

## Execution Flow

All operations MUST follow:

1. Intake
2. Audit
3. Trace
4. Gap
5. Design Exploration
6. Decision Gate
7. Backfill
8. Execute
9. Verify
10. Closure

No step can be skipped.

---

## Stage Rules

- Stages A, B, C, D are sequential
- Closed stages MUST NOT be modified
- Re-opening a stage is NOT allowed

---

## Artifact Rules

- Every module writes ONLY to its namespace
- No cross-namespace writing
- No manual artifact creation outside flow

---

## Decision Rules

No execution is allowed without:
- Decision Gate approval
- Valid decision artifact

---

## Verification Rules

No task is considered DONE unless:
- Verification artifacts exist
- Verification result is PASS

---

## Closure Rules

Closure requires:
- All previous steps completed
- All required artifacts present
- No open gaps

---

## Failure Handling

If any violation occurs:

Codex MUST:
- STOP execution
- Report the issue clearly

---

## No Silent Fixes

Codex MUST NOT:
- silently fix issues
- assume intended behavior
- auto-correct missing data

---

## System Integrity Priority

Maintaining system integrity is MORE important than:
- completing the task
- generating output
- speed of execution