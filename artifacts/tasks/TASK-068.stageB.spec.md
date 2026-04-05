# TASK-068 — Stage B Specification

## Task Binding
- Task ID: TASK-068
- Task Name: FIRST ACTUAL OPENAI USE CASE — TRACE CANDIDATE MAPPING ASSIST
- Stage Binding: B

---

## Specification Objective

Define a governed, deterministic-compatible specification for integrating OpenAI into the TRACE module as a **candidate mapping assist layer** only.

This specification must NOT introduce:
- execution authority
- non-deterministic closure
- contract violations

---

## Invocation Scope

OpenAI may be invoked ONLY under the following conditions:

1. TRACE detects incomplete deterministic mapping coverage
2. TRACE detects ambiguous mapping between:
   - requirement ↔ code
   - requirement ↔ artifact
   - code ↔ requirement

3. Invocation must be explicitly triggered inside TRACE flow (not globally)

---

## Invocation Path (STRICT)

TRACE → Cognitive Adapter → OpenAI Driver

Direct calls are FORBIDDEN.

---

## Input Contract

The request sent to OpenAI MUST include:

- requirement fragment (normalized)
- candidate code units list (if any)
- candidate artifact references (if any)
- trace context:
  - missing mappings
  - ambiguous relations
  - orphan indicators

- constraint block:
  - no authority
  - suggestion only
  - ranked candidates required

---

## Output Contract

OpenAI response MUST be normalized into:

- candidate_mappings: [
    {
      requirement_id,
      candidate_code_units: [],
      candidate_artifacts: [],
      confidence_score,
      reasoning_summary
    }
]

---

## Authority Rules (CRITICAL)

OpenAI output is:

- NON-AUTHORITATIVE
- NON-BINDING
- MUST be validated deterministically

TRACE MUST:

- reject any mapping that:
  - does not match schema
  - violates contract rules
  - introduces ambiguity

- accept ONLY mappings that pass deterministic validation

---

## Fail-Closed Rules

If ANY of the following occurs:

- OpenAI unavailable
- invalid response
- schema mismatch
- low-confidence output
- adapter failure

THEN:

- TRACE continues WITHOUT OpenAI
- no fallback authority granted
- no synthetic mapping injected

---

## Artifact Persistence Rules

All OpenAI interaction MUST persist:

- requests → artifacts/llm/requests/
- responses → artifacts/llm/responses/
- metadata → artifacts/llm/metadata/

Each record MUST include:

- task_id = TASK-068
- stage = TRACE
- provider = OPENAI
- timestamp
- invocation_reason

---

## Trace Integrity Rules

- trace_matrix.json remains the ONLY authoritative mapping output
- OpenAI suggestions MUST NOT be written directly into trace_matrix
- All accepted mappings must go through deterministic trace logic

---

## Anti-Scope Rules

This use case MUST NOT:

- modify GAP logic
- modify Decision Gate behavior
- introduce auto-resolution
- generate code
- bypass verification

---

## Acceptance Criteria (for Stage C / Verify)

The implementation will be considered valid ONLY if:

- OpenAI invoked ONLY under TRACE conditions
- all requests/responses persisted correctly
- no authority leakage occurs
- trace_matrix integrity preserved
- system remains PASS under Verify
- orphan counts remain zero

---

## Status

SPEC_DEFINED

## Next Expected Artifact

artifacts/tasks/TASK-068.stageB.closure.md