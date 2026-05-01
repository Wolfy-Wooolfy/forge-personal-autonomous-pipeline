# DOCS vs ARTIFACTS GAP FIXING SPEC

## Context

The system currently contains inconsistencies between:
- documentation (docs/)
- artifacts (artifacts/)

These inconsistencies were identified in a detailed gap report.

---

## Objective

Codex MUST:

- identify mismatches between docs and artifacts
- fix structural inconsistencies
- enforce schema compliance
- align artifacts with governing contracts

---

## Strict Boundaries

Codex MUST NOT:

- change system architecture
- introduce new features
- refactor code
- optimize performance
- open or modify closed stages
- modify legacy artifacts

---

## Allowed Actions

Codex MAY:

- fix schema mismatches
- add missing required fields
- rename incorrect fields
- fix formatting issues (JSON, markdown)
- align enum values with docs
- update documentation to resolve conflicts

---

## Disallowed Actions

Codex MUST NOT:

- invent new artifact types
- create new execution flows
- bypass governance rules
- write into forbidden namespaces
- modify system-governed artifacts directly

---

## Decision Rule

If a gap can be resolved in TWO ways:

Codex MUST:
- STOP
- ask ONE blocking question

Codex MUST NOT choose arbitrarily.

---

## Conflict Resolution

If docs conflict:

Priority order:
1. Latest governance contract
2. Module orchestration rules
3. Schema definitions
4. Supporting docs

If still unclear:
STOP.

---

## Execution Style

For every fix:

Codex MUST:
- specify exact file path
- specify exact change location
- specify change type (ADD / REPLACE / DELETE)
- explain reason based on contract

---

## Verification

After each fix:

Codex MUST ensure:
- schema compliance
- no new inconsistencies introduced
- no violation of namespace rules

---

## Output Behavior

Codex MUST:

- proceed step-by-step
- fix ONE issue at a time
- wait for confirmation before next fix