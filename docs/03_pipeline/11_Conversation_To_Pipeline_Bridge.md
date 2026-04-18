# Conversation → Pipeline Bridge Layer

---

## Overview

This layer connects user conversation with Forge execution pipeline.

It translates natural language into structured pipeline execution.

---

## Core Responsibility

Convert:

→ User Intent (Conversation)

Into:

→ Pipeline Execution Tasks

---

## Flow Mapping

### Step 1: User Input

User sends natural language message.

Example:
"I want to build a mining game"

---

### Step 2: Intent Interpretation

System must detect:

- intent type
- scope
- required action

Types:

- IDEA
- QUESTION
- DECISION
- EXECUTION_REQUEST
- REVIEW_REQUEST

---

### Step 3: Mode Selection

Based on intent:

| Intent | Mode |
|------|------|
| IDEA | DISCUSSION |
| QUESTION | ANALYSIS |
| DECISION | DECISION_SUPPORT |
| EXECUTION_REQUEST | EXECUTION |
| REVIEW_REQUEST | AUDIT |

---

### Step 4: Context Update

System must:

- update project context
- store conversation state
- maintain history

---

### Step 5: Pipeline Trigger

Depending on mode:

#### DISCUSSION
- no pipeline execution
- only cognitive layer

#### ANALYSIS
- optional lightweight pipeline
- no file execution

#### DECISION_SUPPORT
- prepare structured options
- no execution

#### EXECUTION
→ FULL PIPELINE START

Pipeline flow:

1. INTAKE
2. TRACE
3. GAP
4. DECISION_GATE
5. BACKFILL
6. EXECUTE
7. VERIFY
8. CLOSURE

#### AUDIT
→ AUDIT PIPELINE ONLY

---

## Execution Guard

Pipeline must NOT start unless:

- user explicitly approves
OR
- system reaches autonomous execution threshold

---

## Decision Loop

If during execution:

- multiple strategies appear

System must:

- pause execution
- return options to user
- wait for decision

---

## State Management

Each conversation must map to:

- project_id
- execution_state
- pipeline_state

---

## Error Handling

If failure occurs:

- stop execution
- explain issue
- propose fix
- retry if approved

---

## Output Mapping

Pipeline outputs must be translated back to:

→ Human readable responses

NOT raw system data

---

## Key Rule

User NEVER sees:

- pipeline internals
- raw artifacts
- execution complexity

User sees ONLY:

→ Results + explanations