# CONVERSATION EXECUTION MODEL

## 1. Objective

Transform the system from:

Tool-driven UI

to:

AI Conversation-driven Workspace

WITHOUT breaking tool integrity.

---

## 2. Conversation is NOT free text

Conversation is a structured execution loop:

1. Understand intent
2. Detect ambiguity
3. Ask clarification (if needed)
4. Select tool
5. Execute tool
6. Present result
7. Wait for user decision (approve/reject/modify)

---

## 3. Conversation Loop Model

Each user interaction becomes:

MESSAGE → INTERPRETATION → TOOL → RESULT → NEXT STEP

---

## 4. Message Types

System must support:

- USER_REQUEST
- AI_RESPONSE
- AI_QUESTION
- TOOL_RESULT
- DRAFT_PROPOSAL
- DIFF_PREVIEW
- OPERATION_ANALYSIS
- APPROVAL_REQUEST
- EXECUTION_RESULT
- ERROR

---

## 5. State Model (IMPORTANT)

System MUST move from:

GLOBAL STATE

to:

MESSAGE-BOUND STATE

Each message should carry:

- request
- proposal_id
- draft
- preview
- operation_type
- required_roles

No hidden global state dependency.

---

## 6. Tool Invocation Model

Conversation layer MUST NOT:

execute logic directly.

Instead:

- Map intent → tool
- Call tool
- Receive result
- Render result

---

## 7. UI Behavior Rule

UI must:

- Append messages only (no overwrite)
- Preserve history
- Reflect execution steps clearly

UI must NOT:

- hide execution steps
- merge states silently
- override previous outputs

---

## 8. Approval Model

Approval is a conversation step:

AI → "Ready for approval"
User → Approve / Reject

Approval triggers:

- decision tool
- execution tool

---

## 9. Future Extensions

This model enables:

- Multi-step reasoning
- Multi-tool orchestration
- Project-based conversations
- Persistent context per project

---

## 10. Enforcement

Any UI or feature that:

- bypasses tools
- hides execution steps
- uses implicit state

is INVALID.

This document defines how conversation MUST operate.