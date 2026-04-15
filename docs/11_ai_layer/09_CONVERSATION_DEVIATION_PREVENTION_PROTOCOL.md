# CONVERSATION DEVIATION PREVENTION PROTOCOL

## 1. PURPOSE

Prevent any deviation from the Tools-first architecture
during the transition to Conversation-based UI.

---

## 2. CORE PRINCIPLE

Conversation is NOT a system.

Conversation is an INTERFACE over tools.

---

## 3. EXECUTION ORDER (MANDATORY)

Every feature MUST follow:

1. Tool definition
2. Tool implementation
3. Tool validation
4. Tool integration
5. Conversation exposure

If ANY step is skipped → INVALID IMPLEMENTATION

---

## 4. CONVERSATION MANAGEMENT CAPABILITIES

The following MUST exist as TOOLS (not UI logic):

- Ambiguity Detection
- Clarification Request
- Option Generation
- Next-Step Recommendation
- Tool Routing

Conversation layer must CALL these tools.

---

## 5. DEVIATION DETECTION RULES

System is considered DEVIATED if ANY of the following occurs:

- UI behavior added without tool backing
- Chat performs logic directly
- Hidden state drives behavior
- Conversation introduces new capability not defined as tool
- Features implemented in UI before tool exists

---

## 6. FAIL-CLOSED RESPONSE

If deviation is detected:

1. STOP conversation expansion immediately
2. Identify missing tool
3. Implement tool
4. Validate tool
5. Resume conversation layer

---

## 7. NEXT-STEP VALIDATION CHECKLIST

Before ANY new step:

- Does this step create a tool?
- Does this step validate a tool?
- Does this step expose a tool?

If NO → step is INVALID

---

## 8. DOCUMENT AUTHORITY

This document is ENFORCED.

Together with:

- 07_TOOL_VS_CONVERSATION_CONTRACT.md
- 08_CONVERSATION_EXECUTION_MODEL.md

They define the ONLY valid execution model.

---

## 9. ZERO-TOLERANCE RULE

No UI-first implementation allowed.

No shortcut allowed.

No implicit behavior allowed.

All capabilities MUST be explicit tools.