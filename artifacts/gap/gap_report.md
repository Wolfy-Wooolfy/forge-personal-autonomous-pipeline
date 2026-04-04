# Gap Report

## Summary
- total_gaps: 2
- critical_count: 0
- requires_decision: true

## Gaps
- **MEDIUM** [ORPHAN_CODE] GAP-047122a31360
  - affected_entities: code/src/cognitive/cognitive_config_resolver.js
  - root_cause: Code unit is exported/detected but not mapped to any requirement by trace rules.
  - actions:
    - ACT-19548f8ab493: Remove or relocate code unit CODE::code/src/cognitive/cognitive_config_resolver.js::FILE if it is not part of Forge scope/contracts. (requires_decision=true)
    - ACT-9ee5a048eaf2: Map code unit CODE::code/src/cognitive/cognitive_config_resolver.js::FILE to an existing requirement by adding deterministic mapping rules in Trace (if valid). (requires_decision=true)
- **MEDIUM** [ORPHAN_CODE] GAP-0c18d91e82d2
  - affected_entities: code/src/cognitive/drivers/openai_driver.js
  - root_cause: Code unit is exported/detected but not mapped to any requirement by trace rules.
  - actions:
    - ACT-65a38bca0c98: Map code unit CODE::code/src/cognitive/drivers/openai_driver.js::FILE to an existing requirement by adding deterministic mapping rules in Trace (if valid). (requires_decision=true)
    - ACT-d5fea2ff89d4: Remove or relocate code unit CODE::code/src/cognitive/drivers/openai_driver.js::FILE if it is not part of Forge scope/contracts. (requires_decision=true)
