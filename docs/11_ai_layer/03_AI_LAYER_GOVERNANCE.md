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

### AI Layer CAN:

- Read files (read-only)
- Analyze project structure
- Generate insights
- Propose changes
- Generate drafts (NOT applied)

---

### AI Layer CANNOT:

- Write files directly
- Modify project state
- Trigger execution without approval
- Bypass Decision Gate

---

## 4. Execution Rule

ALL execution MUST go through:

Decision Packet → Forge Pipeline

No exceptions.

---

## 5. Modes

### 5.1 Analysis Mode

- Read-only
- No write operations
- No decision packet creation

Output:
- analysis report
- insights

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
- Must generate Decision Packet
- Must pass Forge pipeline

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

1. Forge Core (highest authority)
2. Decision Gate
3. Approval system
4. AI Layer (advisory only)

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