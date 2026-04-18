## 3. User Promise

From the perspective of a normal user, the system should behave like a smart project partner.

A user should be able to:

* speak normally in Arabic or English
* describe an idea without technical language
* ask whether the idea is feasible
* ask whether it can generate profit
* ask for market or business reasoning
* ask for alternative ways to implement the idea
* accept some ideas and reject others
* ask for redrafts of project documents any number of times
* ask the system to build a project from idea to delivery
* ask the system to review an existing project and suggest improvements
* ask the system to work on multiple projects while keeping each project independent

The system should feel natural in conversation while remaining highly structured internally.

---

## 4. Supported User Types

### 4.1 Non-Technical User

Characteristics:

* does not understand code
* speaks in plain language
* may not know product terminology
* prefers direct recommendations
* prefers simple explanations

System behavior:

* explain with minimal jargon
* convert complexity into choices
* provide clear recommendations and reasons
* avoid forcing technical decisions when not necessary

### 4.2 Technical User

Characteristics:

* understands architecture and engineering choices
* wants more detailed tradeoffs
* may review technical documents closely

System behavior:

* show deeper technical detail
* expose implementation differences explicitly
* allow lower-level option inspection

### 4.3 Executive / Project Owner

Characteristics:

* focuses on value, cost, time, risk, and outcome
* wants clear progress visibility
* wants decisions framed in business language

System behavior:

* summarize status clearly
* highlight tradeoffs in business terms
* escalate only meaningful decisions

---

## 21. Non-Technical User Experience Requirements

Because the target user may not know coding, the system must be optimized for simplicity.

The system must:

* explain technical choices in plain language
* show recommendations before asking for decisions
* hide unnecessary technical complexity by default
* give exact next actions when the user must do something manually
* avoid assuming the user understands files, branches, environments, or pipelines unless the user demonstrates that knowledge

---