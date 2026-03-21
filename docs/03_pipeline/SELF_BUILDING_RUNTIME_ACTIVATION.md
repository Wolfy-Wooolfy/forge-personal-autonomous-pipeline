# Self-Building Runtime Activation Protocol

**Document ID:** HALO-DOC-21  
**Status:** BINDING – RUNTIME ACTIVATION AUTHORITY  
**Scope:** Forge Self-Building System Runtime  
**Applies To:** Entire Autonomous Pipeline  
**Enforcement:** Fail-Closed  

---

# 1. Purpose

This document defines when and how the Self-Building System
inside Forge becomes active.

It specifies:

- activation triggers
- repository readiness conditions
- execution bootstrap sequence
- runtime state initialization
- interaction with progress/status.json

The purpose of this protocol is to ensure that
Forge begins autonomous execution only when the system
is in a valid deterministic state.

---

# 2. Activation Trigger

The Self-Building System activates when ANY of the following occurs:

1. A new task is registered.
2. progress/status.json indicates READY state.
3. A lifecycle execution was previously interrupted and must resume.
4. A repository snapshot is loaded for autonomous processing.

Activation MUST NOT occur without one of these triggers.

---

# 3. Repository Readiness Conditions

Before activation, Forge MUST verify:

- Required governance documents exist
- Required artifact directories exist
- progress/status.json exists
- Lifecycle state is deterministic
- No corruption exists in artifacts

Required artifact root directories:

```

artifacts/intake/
artifacts/audit/
artifacts/trace/
artifacts/gap/
artifacts/decisions/
artifacts/backfill/
artifacts/execute/
artifacts/closure/

```

If any required directory is missing:

→ Backfill Module MUST create them.

---

# 4. Runtime Bootstrap Sequence

Once activation conditions are satisfied,
Forge MUST perform the following steps.

Step 1 — Repository Snapshot Lock  
The repository state MUST be frozen for deterministic analysis.

Step 2 — Status Initialization  
Forge MUST read progress/status.json and determine:

- current stage
- execution state
- pending actions
- blocking questions

Step 3 — Artifact Integrity Verification  
All artifacts referenced by status.json MUST exist.

If any artifact is missing:

→ Execution MUST halt.

Step 4 — Module Selection  
Forge determines the next module using:

MODULE_ORCHESTRATION_GOVERNANCE_v1.

Step 5 — Execution Start  
Selected module begins execution.

---

# 5. progress/status.json Authority

The file:

```

progress/status.json

```

is the authoritative runtime state descriptor.

It defines:

- pipeline state
- stage progress
- blocking conditions
- next deterministic step

Forge MUST treat status.json as the single source of truth.

No module may bypass this file.

---

# 6. Execution State Recognition

Forge MUST recognize the following states.

### READY

System may begin execution.

### RUNNING

A module is actively executing.

### BLOCKED

Execution halted due to a human interrupt.

### ABORTED

Execution terminated due to no valid path.

### CLOSED

Lifecycle execution completed successfully.

Modules MUST respect these states.

---

# 7. Resume Behavior

If runtime activation occurs while:

```

status = RUNNING

```

Forge MUST:

- verify artifact integrity
- determine last completed module
- resume execution from next module

Partial module execution MUST NOT resume.

Modules are atomic.

---

# 8. Blocked State Handling

If:

```

status = BLOCKED

```

Forge MUST:

- halt module execution
- wait for resolution of blocking_questions
- verify resolution artifact

Execution may resume ONLY after resolution.

---

# 9. Aborted Execution Handling

If:

```

status = ABORTED

```

Forge MUST:

- terminate execution attempt
- prevent automatic restart
- require new task registration

Aborted runs are terminal.

---

# 10. Lifecycle Initialization

If status.json does not exist
and a new project is introduced:

Forge MUST initialize:

```

progress/status.json

```

with:

```

state = READY
stage = A
progress = 0

```

Then begin Intake Module.

---

# 11. Deterministic Startup Guarantee

Runtime activation is deterministic only when:

- repository snapshot is locked
- artifact references are valid
- lifecycle stage is defined
- no ambiguous state exists

If determinism cannot be proven:

→ Execution MUST FAIL CLOSED.

---

# 12. Runtime Authority Limits

Runtime activation protocol MUST NOT:

- modify governance documents
- generate code
- resolve gaps
- create decisions

It only determines when execution begins.

---

# 13. Interaction with Self-Building Blueprint

This protocol activates the system defined in:

```

SELF_BUILDING_SYSTEM_BLUEPRINT_v1

```

Blueprint defines system architecture.

Runtime Activation defines when execution begins.

---

# 14. Fail-Closed Rule

If activation conditions are ambiguous
or required artifacts are missing:

- execution MUST halt
- system MUST enter BLOCKED state

Autonomous startup without deterministic readiness
is strictly forbidden.

---

# 15. Summary

The Runtime Activation Protocol guarantees that:

- Forge begins execution only under deterministic conditions
- runtime state is controlled by status.json
- lifecycle modules execute in proper order
- autonomous execution remains auditable

This protocol ensures safe startup
for the Self-Building System.

## Execution Authority Separation Rule (CRITICAL)

### Rule Definition

Forge execution MUST NOT depend on `progress/status.json` as a source of control.

`progress/status.json` is defined as:

- A project-level state artifact
- An OUTPUT of execution
- A human-readable snapshot of progress

It MUST NOT be used for:

- Determining current_task
- Determining next_step
- Blocking execution decisions
- Driving orchestration flow

---

### Execution Source of Truth

Forge runtime execution MUST be driven exclusively by:

- `artifacts/forge/forge_state.json`
- `artifacts/orchestration/orchestration_state.json`

These artifacts define:

- current_task
- execution_integrity
- next_allowed_step
- pipeline continuity

---

### Enforcement

Any logic that:

- Reads `status.json` to decide execution
- Blocks execution based on `status.json`
- Validates pipeline transitions using `status.json`

Is considered a VIOLATION of runtime determinism.

---

### Rationale

This rule eliminates:

- Circular dependency between execution and output state
- Manual intervention loops
- False BLOCKED states
- Non-deterministic execution paths

---

### Expected Outcome

After enforcement:

- Forge becomes a fully autonomous deterministic pipeline
- `status.json` becomes a pure reflection layer
- Execution consistency is guaranteed by Forge state only

---

### Runtime Implementation Note

The following runtime files MUST treat `progress/status.json` as reflection/output only and MUST NOT use it as execution authority:

- `code/src/orchestrator/entry_resolver.js`
- `code/src/orchestrator/autonomous_runner.js`

Execution entry, resume, and deterministic task selection MUST be derived from:

- `artifacts/forge/forge_state.json`
- pipeline closure continuity under `artifacts/tasks/`

---

**END OF SPECIFICATION**