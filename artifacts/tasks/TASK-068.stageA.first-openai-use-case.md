# TASK-068 — Stage A Artifact
## Artifact
first-openai-use-case

## Task Binding
- Task ID: TASK-068
- Task Name: FIRST ACTUAL OPENAI USE CASE — TRACE CANDIDATE MAPPING ASSIST
- Stage Binding: A

## Purpose
Freeze the first real OpenAI use case for Forge as a governed Stage A artifact before any runtime or code modification begins.

## Selected Use Case
TRACE Candidate Mapping Assist

## Use Case Definition
OpenAI will be used inside the TRACE module to generate non-authoritative candidate mapping hints between:

- requirement clauses
- code units
- artifacts

This use case applies only when deterministic TRACE coverage is incomplete, ambiguous, or requires bounded analytical assistance.

## Authority Rule
OpenAI output has ZERO execution authority.

It may:
- propose candidate mappings
- suggest likely requirement-to-code relationships
- return ranked hint candidates

It may NOT:
- write authoritative trace mappings directly
- close TRACE
- change Forge state
- suppress orphan detection
- override deterministic validation rules

## Required Runtime Behavior
- Invocation path must remain exclusively through the Cognitive Adapter Layer
- Requests/responses/metadata must persist under governed cognitive artifact paths
- TRACE must remain fail-closed if required deterministic validation cannot confirm a candidate hint
- If OpenAI is unavailable, Forge must continue under deterministic fallback behavior without granting synthetic authority

## Intended Value
This use case is intended to reduce future:
- orphan_code_units
- orphan_requirements
- partial coverage ambiguity

without weakening governance or deterministic closure rules.

## Non-Goals
This task does NOT authorize:
- general reasoning expansion
- autonomous design decisions
- code generation authority
- decision gate replacement
- human approval bypass

## Acceptance Target for Later Stages
The use case will be considered implemented only when:
- Stage B defines the governed spec and artifact expectations
- Stage C binds runtime/code behavior to the spec
- verification confirms persisted cognitive artifacts and fail-closed behavior
- no orphan authority is introduced

## Status
OPEN

## Next Expected Artifact
artifacts/tasks/TASK-068.stageA.approval.md