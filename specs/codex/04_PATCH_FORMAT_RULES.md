# PATCH FORMAT RULES

## Purpose

Codex MUST provide changes as controlled patches, not broad rewrites.

---

## Required Patch Format

For every change, Codex MUST provide:

- File path
- Change type: ADD / REPLACE / DELETE
- Exact location
- Exact content to add, replace, or delete
- Reason for the change

---

## Forbidden Output

Codex MUST NOT:

- rewrite full files unless explicitly required
- change unrelated content
- rename files without explicit approval
- perform formatting-only changes unless requested

---

## Location Rules

Codex MUST identify the location by:

- section heading
- line reference if available
- exact nearby text

---

## Multi-File Patch Rule

If a fix requires multiple files:

Codex MUST group them as one patch set and explain dependency order.

---

## Stop Rule

If Codex cannot identify the exact location:

Codex MUST STOP and ask for the full file content or exact target section.