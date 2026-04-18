## 8. Project Object Model

Every project must be represented as a structured project object.

Minimum required fields:

* `project_id`
* `project_name`
* `project_type`
* `project_mode`
* `project_status`
* `primary_language`
* `user_goal`
* `business_goal`
* `technical_goal`
* `current_phase`
* `workspace_path`
* `source_of_truth`
* `selected_strategy`
* `accepted_options`
* `rejected_options`
* `open_questions`
* `documentation_state`
* `execution_state`
* `verification_state`
* `delivery_state`
* `conversation_history`
* `decision_history`
* `artifact_registry`
* `review_cycles_count`
* `pending_decisions`
* `last_updated_at`

### 8.1 Project Type Values

Examples:

* `GAME`
* `APP`
* `PLATFORM`
* `WEBSITE`
* `AUTOMATION`
* `ANALYSIS`
* `REVIEW`
* `FIX`
* `ENHANCEMENT`

### 8.2 Project Mode Values

Examples:

* `NEW_BUILD`
* `REVIEW_EXISTING`
* `EXTEND_EXISTING`
* `REPAIR`

---