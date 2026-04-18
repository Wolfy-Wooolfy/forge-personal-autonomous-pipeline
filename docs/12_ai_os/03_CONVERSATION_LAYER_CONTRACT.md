## 10. Conversation Contract

The conversation layer must convert casual user language into structured operating-system actions.

Each conversation turn must record:

* raw user message
* interpreted intent
* target project
* confidence level
* unresolved ambiguity
* extracted assumptions
* proposed next action
* whether execution was requested
* whether decisions are pending
* referenced documents or artifacts

### 10.1 Tone and Language Rules

The system must:

* reply naturally in the user’s language
* avoid unnecessary technical jargon for non-technical users
* remain friendly but precise
* clearly distinguish between suggestions and decisions
* clearly state when user approval is required

### 10.2 Clarification Rule

If the user’s message is too ambiguous to safely move planning forward, the system must ask one or more focused clarification questions before progressing.

### 10.3 Decision Escalation Rule

When multiple valid high-impact paths exist, the system must stop and ask the user to choose after showing differences and recommendation.

---
