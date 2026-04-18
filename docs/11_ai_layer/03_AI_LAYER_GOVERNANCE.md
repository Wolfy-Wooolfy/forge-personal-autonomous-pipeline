# AI Layer Governance Contract

## 1. Purpose

Define strict rules governing the AI Layer behavior to ensure:

- No violation of Forge authority
- No uncontrolled execution
- Clear separation between thinking and acting

---

## 2. Core Principle

AI Layer is:

- THINKING SYSTEM

Forge is:

- EXECUTION SYSTEM

AI MUST NEVER execute directly.

---

## 3. Allowed Actions

### AI Layer CAN write (restricted):

AI Layer write permissions are split into two modes:

#### Advisory Mode
AI Layer is allowed to write ONLY under:

artifacts/ai/*

This includes:

- conversations
- context snapshots
- analysis artifacts
- proposals
- drafts (non-executed)

Constraints:

- These writes are considered NON-EXECUTIONAL
- They MUST NOT affect project state
- They MUST NOT modify code/ or Forge artifacts
- They are used for traceability and reasoning only

#### Workspace Runtime Mode
Workspace Runtime is allowed to write to governed execution targets, including:

- code/*
- web/*
- code/tools/*
- artifacts/llm/*
- artifacts/decisions/*
- artifacts/backfill/*
- artifacts/execute/*
- artifacts/verify/*
- artifacts/ai/*

Constraints:

- Requires explicit approval
- Requires decision creation before execution
- Is governed as Workspace Runtime execution
- Is NOT the same as Forge Core pipeline execution

### AI Layer CAN:

- Read files (read-only)
- Analyze project structure
- Generate insights
- Propose changes
- Generate drafts (NOT applied)

---

### AI Layer CANNOT:

- Modify project source code directly
- Modify Forge artifacts outside artifacts/ai/*
- Trigger execution without approval
- Bypass Decision Gate

---

## 4. Execution Rule

Execution may proceed through one of two governed paths:

1. Decision Packet → Forge Pipeline
2. Approved Workspace Runtime flow → Workspace Execute → Workspace Verify

No unapproved execution is allowed.

---

## 5. Modes

### 5.1 Analysis Mode

- Read-only
- No write operations
- No decision packet creation

Output:
- analysis report
- insights
- May produce artifacts under artifacts/ai/* as analysis outputs (non-executional)

---

### 5.2 Proposal Mode

- Generate structured proposals
- Prepare draft actions

Output:
- proposal
- optional execution draft (NOT applied)

---

### 5.3 Execution Mode

- Requires explicit user approval
- Must generate governed execution intent
- May execute through:
  - Forge pipeline
  - Workspace Runtime lane

---

## 6. Approval Requirements

Execution requires:

- User approval
- Role-based validation (existing system)
- Decision Packet creation

---

## 7. Forbidden Transitions

The following transitions are NOT allowed:

- Analysis → Execution (direct)
- Conversation → Execution (direct)
- Proposal → Execute without approval

---

## 8. Required Flow

System MUST follow:

Discussion → Analysis → Proposal → Approval → Execution

---

## 9. Failure Handling

If any condition fails:

- Missing context → STOP
- Ambiguous request → ASK
- Missing approval → BLOCK
- Invalid proposal → REJECT

System must FAIL-CLOSED.

---

## 10. Authority Hierarchy

1. Forge Core execution contracts
2. Workspace Runtime governed execution
3. Decision Gate / approval system
4. AI advisory behavior

---

## 11. Auditability

All actions must be traceable:

- proposals must be logged
- decisions must be logged
- execution must be verifiable

---

## 12. Safety Rule

AI must prefer:

- not acting over acting incorrectly

When in doubt:
→ DO NOT EXECUTE