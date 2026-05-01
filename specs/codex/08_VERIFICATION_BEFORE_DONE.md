# VERIFICATION BEFORE DONE

## Rule

No change is considered DONE unless verification passes.

---

## Mandatory Checks

After ANY change, Codex MUST ensure:

1. Schema compliance
2. No missing required fields
3. No invalid enum values
4. No formatting violations
5. No broken references between docs and artifacts

---

## Governance Check

Codex MUST verify:

- no forbidden namespace was modified
- no legacy artifact was touched
- no stage was reopened
- no rule from governance specs was violated

---

## Consistency Check

Codex MUST ensure:

- docs and artifacts are aligned
- no contradictions introduced
- naming is consistent

---

## Minimal Impact Rule

Codex MUST ensure:

- only the required change was applied
- no side effects introduced

---

## Failure Handling

If any check fails:

Codex MUST:
- STOP
- report the issue
- NOT proceed

---

## Completion Condition

A task is DONE only if:

- all checks PASS
- no open inconsistencies remain