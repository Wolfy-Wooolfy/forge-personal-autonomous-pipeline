# SOURCE OF TRUTH AND READ RULE

## Workspace Authority

The local workspace is the authoritative source of truth for Codex execution.

Codex must treat the current files on disk as the active project state.

Codex MUST NOT rely on:
- Previous chat history
- Memory
- Assumptions
- Outdated ZIP files
- External repositories
- Unverified summaries

---

## Mandatory Read Before Change

Before proposing or applying ANY code, documentation, artifact, schema, or configuration change:

Codex MUST read:
1. The full current target file
2. Any directly related files
3. Any governing contract, schema, or spec referenced by the change

---

## Required Confirmation

Before suggesting changes, Codex MUST explicitly write:

READ COMPLETE:
- <file path>
- <related file path>
- <contract/schema path>

If this confirmation is missing, Codex MUST STOP.

---

## Partial Reading Is Not Allowed

The following do NOT qualify as reading:
- Skimming
- Search-only inspection
- Reading snippets only
- Reading summaries
- Inferring file contents from filenames

---

## Conflict Rule

If the workspace contains conflicting authority sources, Codex MUST:
- STOP
- Enter BLOCKED mode
- Ask exactly one blocking question

Codex MUST NOT choose one authority silently.

---

## Execution Safety

Codex MUST NOT change files that were not read in full.

Codex MUST NOT modify related files unless they were also read in full.