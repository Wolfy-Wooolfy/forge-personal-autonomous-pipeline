## 25. Initial Provider Positioning

For the first full version of this operating-system layer, the AI provider may be an OpenAI API integration.

At this stage, local edge inference is optional and not required by the core design.

That means:

* the conversation, planning, ideation, and document-generation intelligence may be powered by an OpenAI API provider
* Forge remains the execution authority
* any future edge or on-device inference remains an optional extension, not a foundational requirement for the first architecture

---

## Provider Responsibilities (Explicit)

The AI provider (e.g. OpenAI API) is responsible for:
- natural language understanding
- conversation continuity
- idea generation
- proposal generation
- structured output generation

The AI provider is NOT responsible for:
- execution
- file system modification
- pipeline control
- verification authority

All execution authority remains strictly within Forge Core.