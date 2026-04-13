# CHAT-FIRST WORKSPACE SPEC
## Forge AI Engineering Layer

---

## 1. PURPOSE

Transform Forge AI Workspace from a Tool-Based Interface
into a Chat-First Intelligent System

Where:

- Primary interaction = AI conversation
- UI = minimal interface layer
- Buttons = secondary or removed

---

## 2. CORE PRINCIPLE

User does NOT operate the system manually.

Instead:

- User writes request
- AI understands intent
- AI decides next step
- AI asks when blocked
- AI executes or proposes

---

## 3. PROJECT MODEL

### Required Feature: Project Isolation

System must operate with clear Projects.

Each Project must include:

- project_id
- name
- created_at
- last_updated
- current_state
- conversation_history
- related_artifacts

---

## 4. PROJECT LIST BEHAVIOR

UI must include:

### Sidebar (Projects)

- List of projects
- Button:
  - New Project

On project selection:

- Load project state
- Load conversation history
- Resume from last checkpoint

---

## 5. CHAT BEHAVIOR

### Input

- User provides text input only

### Output

AI must:

- Respond in user's language
- Explain actions
- Ask when ambiguous
- Provide choices when needed
- Propose or execute actions

---

## 6. AI RESPONSIBILITY

AI controls:

- Operation type:
  - Analyze
  - Draft
  - Proposal
  - Execute

- Flow management:
  - No dependency on UI buttons
  - Fully intent-driven

---

## 7. REMOVE UI COMPLEXITY

The following are considered LEGACY:

- Analyze Project button
- Run Direct
- Generate Proposal
- Generate Draft
- Manual Approval section

They must be replaced by:

- AI-driven execution flow

---

## 8. HISTORY MODEL

History must NOT be a flat list.

Instead:

- Scoped per Project
- Used as AI context
- Used for duplicate prevention

---

## 9. LANGUAGE MODE

If user writes Arabic:
→ AI responds in Arabic

If user writes English:
→ AI responds in English

---

## 10. EXECUTION MODEL

AI must:

- Propose (Proposal)
OR
- Execute directly (Auto Execution)

Based on:

- Risk level
- Approval policy

---

## 11. SYSTEM STATE

Each Project must track:

- Last executed step
- Open proposals (if any)
- Pending decisions

---

## 12. TRANSITION RULE

Current UI:

Tool-Based Dashboard

Is considered:

- Temporary Layer
- Will be fully replaced

---

## 13. NEXT IMPLEMENTATION STEP

1. Add Project Manager Layer
2. Refactor UI:
   - Chat Panel
   - Projects Sidebar
3. Bind AI to project context
4. Remove button-driven flow

---

## END