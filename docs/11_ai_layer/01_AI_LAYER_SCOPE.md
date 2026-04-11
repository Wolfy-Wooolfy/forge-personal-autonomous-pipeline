# AI Layer Scope — Phase Definition

## 1. Purpose

Introduce a new AI Layer on top of Forge Core to enable:

- Natural language discussion (idea exploration before execution)
- Project understanding and analysis
- Proposal generation before execution
- Controlled transition from discussion → execution

This layer MUST NOT break or bypass Forge governance.

---

## 2. Scope of This Phase

### Included

1. Conversation Layer (Chat Interface)
   - Accept user input (initially English)
   - Maintain session-level context

2. Analysis Mode
   - Read project files (read-only)
   - Generate summaries
   - Detect gaps and improvement opportunities

3. Proposal Mode
   - Convert ideas into structured proposals
   - Prepare potential execution drafts (NOT applied automatically)

4. Context Builder
   - Aggregate relevant project files
   - Prepare context for AI reasoning

---

### Excluded

- Direct execution without approval
- Automatic modification of files
- Any bypass of Decision Gate or approval system
- Full autonomy (system must remain human-approved)

---

## 3. Modes of Operation

The system will now support two distinct modes:

### 1) Analysis Mode (NEW)
- Read-only
- No file writes
- Produces:
  - summaries
  - insights
  - proposals

### 2) Execution Mode (EXISTING)
- Uses Forge pipeline
- Requires:
  - Decision Packet
  - Approval
  - Verify PASS

---

## 4. Transition Rules

System MUST follow:

- Discussion → Analysis → Proposal → Approval → Execution

Forbidden:

- Discussion → Execution (direct)

---

## 5. Governance Constraints

- AI Layer MUST NOT write directly to filesystem
- All execution MUST go through:
  Forge → Decision Gate → Backfill → Execute → Verify

- AI Layer acts as:
  - Advisor
  - Analyzer
  - Proposal generator

NOT as executor

---

## 6. Output Types

AI Layer can produce:

- Conversation responses
- Analysis reports
- Improvement proposals
- Draft execution plans (pending approval)

---

## 7. Success Criteria

This phase is complete when:

- User can discuss ideas naturally
- System can analyze project structure
- System can propose improvements
- No execution happens without approval
- Full compatibility with Forge governance is preserved

---

## 8. Non-Goals

- Replacing Forge execution engine
- Removing approval requirements
- Full automation without human control