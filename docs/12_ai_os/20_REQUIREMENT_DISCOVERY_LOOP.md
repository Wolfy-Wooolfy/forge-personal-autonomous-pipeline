# Requirement Discovery Loop Contract

## Purpose

This contract defines a universal, domain-agnostic mechanism for iterative requirement discovery.

It ensures that any user request (system, app, game, tool, etc.) is expanded into a complete, validated requirement model before any downstream step (options, decisions, execution).

---

## Core Principle

Requirement discovery is NOT a one-time step.

It is an iterative loop:

User Input
→ Analyze Domain
→ Generate Requirement Model
→ Detect Missing Requirements
→ Ask Questions
→ User Answers
→ Update Model
→ Re-check Completeness
→ Repeat until COMPLETE

---

## Definitions

### Requirement Model

A structured representation of all required components of the requested system.

It is:
- Domain-specific
- Dynamically expanded
- Continuously validated

---

### Completeness

A requirement model is considered COMPLETE only when:

- All core domains are covered
- All dependent sub-requirements are resolved
- No open ambiguity exists that affects execution

---

## Iteration Rules

1. Every user answer MUST trigger re-evaluation of the model

2. If new branches appear:
   → The system MUST ask follow-up questions

3. No transition to:
   - Options
   - Decision
   - Documentation
   - Execution

   is allowed until completeness = TRUE

---

## Domain Detection

The system MUST first classify the request:

Examples:
- Game
- HR System
- Mobile App
- Website
- Internal Tool
- AI System

This classification drives the initial requirement model.

---

## Recursive Expansion

Each requirement may open sub-requirements.

Example:

Payroll → expands into:
- taxes
- insurance
- bonuses
- deductions
- approval flow
- payslips

Each sub-node must be validated.

---

## Stop Condition

The loop stops ONLY when:

completeness = TRUE

---

## Output of This Layer

The final output MUST be:

- Structured requirement model
- Fully validated
- Ready for:
  → Option generation
  → Decision making
  → Documentation build
  → Execution handoff

---

## Enforcement

This contract is MANDATORY.

It overrides:

- Fast response generation
- Direct suggestion behavior
- Premature execution

---

## Position in System Flow

This layer sits BEFORE:

07_OPTION_DECISION_CONTRACT  
08_DOCUMENTATION_BUILD_LOOP  
09_EXECUTION_HANDOFF_TO_FORGE  

---

## Summary

No requirement completeness → No system progress