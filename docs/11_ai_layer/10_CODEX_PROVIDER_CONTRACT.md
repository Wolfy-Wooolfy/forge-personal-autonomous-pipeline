# CODEX PROVIDER CONTRACT (FORGE AI LAYER)

## PURPOSE

Define a strict contract between Forge (governance system)
and external code execution engines (e.g. Codex).

This contract ensures:

- Forge remains the decision authority
- External engines act as execution workers only
- No direct code mutation happens without Forge approval

---

## ROLE DEFINITIONS

### Forge
- Owns decision making
- Owns verification
- Owns approval & execution authority
- Defines tasks and expected outputs

### Codex (Provider)
- Receives structured task
- Produces code / diff / draft
- Does NOT execute
- Does NOT decide
- Does NOT persist

---

## INPUT CONTRACT (Forge → Codex)

```json
{
  "task_id": "string",
  "request": "string",
  "context": {
    "target_files": ["string"],
    "operation_type": "CREATE | MODIFY | EXPAND",
    "constraints": ["string"]
  },
  "expected_output": {
    "type": "DIFF | FULL_FILE | MULTI_FILE",
    "format": "structured_json"
  }
}
```

---

## OUTPUT CONTRACT (Codex → Forge)

```json
{
  "task_id": "string",
  "status": "SUCCESS | FAILED",
  "output": {
    "files": [
      {
        "path": "string",
        "content": "string",
        "diff": "string"
      }
    ]
  },
  "metadata": {
    "engine": "codex",
    "confidence": "number"
  }
}
```

---

## RULES (CRITICAL)

1. Codex MUST NOT:

   * write to filesystem
   * call Forge execution endpoints
   * bypass approval

2. Forge MUST:

   * treat Codex output as UNTRUSTED
   * pass output through:

     * preview
     * approval
     * verify
     * execution

3. No direct execution allowed without:

   * Decision Packet
   * Approval
   * Verify PASS

---

## EXECUTION FLOW

1. User request enters Forge
2. Forge builds strategy + plan
3. Forge sends task to Codex
4. Codex returns draft / diff
5. Forge:

   * builds proposal
   * generates preview
   * requests approval
6. Only then execution is allowed
7. Runtime integration currently exists through:
   - code/src/providers/providerRouter.js
   - code/src/providers/codexProvider.js
   - code/src/workspace/apiServer.js

---

## FUTURE EXTENSIONS

* Multi-provider support
* Load balancing between engines
* Confidence-based routing
* Cost-aware execution

---

## STATUS

* Contract defined
* Runtime integration exists
* Codex acts as proposal / draft / patch generator
* Codex does not own execution authority

## OPEN CONTRACT GAPS

The following runtime gaps remain:

- normalization layer is not formally specified
- schema validation before execution is not fully contract-defined
- lifecycle boundary between provider output and governed execution must remain explicit

---