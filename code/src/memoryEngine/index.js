"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function createProjectMemoryStore(options = {}) {
  const root = path.resolve(options.root || process.cwd());

  function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  function normalizeProjectId(projectIdInput) {
    const value = typeof projectIdInput === "string" ? projectIdInput.trim() : "";
    const normalized = value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");

    return normalized || "default_project";
  }

  function stableStringify(value) {
    if (Array.isArray(value)) {
      return `[${value.map((item) => stableStringify(item)).join(",")}]`;
    }

    if (value && typeof value === "object") {
      return `{${Object.keys(value).sort().map((key) => {
        return `${JSON.stringify(key)}:${stableStringify(value[key])}`;
      }).join(",")}}`;
    }

    return JSON.stringify(value);
  }

  function sha256(value) {
    return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
  }

  function getMemoryRel(projectIdInput) {
    return `artifacts/projects/${normalizeProjectId(projectIdInput)}/memory/project_memory.json`;
  }

  function getMemoryAbs(projectIdInput) {
    return path.resolve(root, getMemoryRel(projectIdInput));
  }

  function emptyMemory(projectIdInput) {
    const projectId = normalizeProjectId(projectIdInput);

    return {
      schema_version: "1.0",
      project_id: projectId,
      memory_state: "EMPTY",
      idea_definition: {},
      decisions_taken: [],
      business_model: {},
      documentation_versions: [],
      execution_status: {},
      change_history: [],
      version_registry: [],
      updated_at: null
    };
  }

  function loadMemory(projectIdInput) {
    const projectId = normalizeProjectId(projectIdInput);
    const memoryAbs = getMemoryAbs(projectId);

    if (!fs.existsSync(memoryAbs)) {
      return emptyMemory(projectId);
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(memoryAbs, "utf8"));
      const base = emptyMemory(projectId);

      return {
        ...base,
        ...parsed,
        project_id: projectId,
        decisions_taken: Array.isArray(parsed.decisions_taken) ? parsed.decisions_taken : [],
        documentation_versions: Array.isArray(parsed.documentation_versions) ? parsed.documentation_versions : [],
        change_history: Array.isArray(parsed.change_history) ? parsed.change_history : [],
        version_registry: Array.isArray(parsed.version_registry) ? parsed.version_registry : []
      };
    } catch (err) {
      return {
        ...emptyMemory(projectId),
        memory_state: "RESTORE_FAILED",
        restore_error: err && err.message ? err.message : "Unable to read memory"
      };
    }
  }

  function writeMemory(memory) {
    const projectId = normalizeProjectId(memory && memory.project_id);
    const memoryAbs = getMemoryAbs(projectId);
    ensureDir(path.dirname(memoryAbs));
    fs.writeFileSync(memoryAbs, JSON.stringify(memory, null, 2), "utf8");
    return getMemoryRel(projectId);
  }

  function appendEvent(projectIdInput, eventInput = {}) {
    const projectId = normalizeProjectId(projectIdInput);
    const memory = loadMemory(projectId);
    const event = {
      event_id: `memory_event_${Date.now()}`,
      event_type: String(eventInput.event_type || "PROJECT_UPDATE"),
      created_at: new Date().toISOString(),
      summary: String(eventInput.summary || ""),
      payload: eventInput.payload && typeof eventInput.payload === "object"
        ? eventInput.payload
        : {}
    };

    memory.change_history.push(event);
    memory.memory_state = "ACTIVE";
    memory.updated_at = event.created_at;

    writeMemory(memory);
    return event;
  }

  function recordConversationTurn(projectIdInput, turn) {
    return appendEvent(projectIdInput, {
      event_type: "CONVERSATION_TURN",
      summary: "Conversation turn recorded",
      payload: {
        turn_id: turn && turn.turn_id ? turn.turn_id : "",
        final_status: turn && turn.final_status ? turn.final_status : "",
        proposal_id: turn && turn.proposal_id ? turn.proposal_id : "",
        decision_packet_id: turn && turn.decision_packet_id ? turn.decision_packet_id : "",
        operation_type: turn && turn.operation_type ? turn.operation_type : ""
      }
    });
  }

  function snapshotProjectState(projectIdInput, stateInput = {}) {
    const projectId = normalizeProjectId(projectIdInput);
    const memory = loadMemory(projectId);
    const snapshot = {
      project_id: projectId,
      project_name: stateInput.project_name || "",
      project_status: stateInput.project_status || "",
      current_phase: stateInput.current_phase || "",
      active_runtime_state: stateInput.active_runtime_state || "",
      documentation_state: stateInput.documentation_state || "",
      execution_package_state: stateInput.execution_package_state || "",
      execution_state: stateInput.execution_state || "",
      verification_state: stateInput.verification_state || "",
      delivery_state: stateInput.delivery_state || "",
      pending_decisions: Array.isArray(stateInput.pending_decisions) ? stateInput.pending_decisions : []
    };
    const stateHash = sha256(stableStringify(snapshot));
    const latestVersion = memory.version_registry[memory.version_registry.length - 1] || null;

    memory.execution_status = {
      current_phase: snapshot.current_phase,
      active_runtime_state: snapshot.active_runtime_state,
      execution_state: snapshot.execution_state,
      verification_state: snapshot.verification_state,
      delivery_state: snapshot.delivery_state
    };

    if (!latestVersion || latestVersion.state_hash !== stateHash) {
      memory.version_registry.push({
        version_id: `state_${String(memory.version_registry.length + 1).padStart(4, "0")}`,
        version_type: "PROJECT_STATE",
        created_at: new Date().toISOString(),
        state_hash: stateHash,
        summary: snapshot
      });
    }

    memory.memory_state = "ACTIVE";
    memory.updated_at = new Date().toISOString();

    writeMemory(memory);
    return memory;
  }

  return {
    getMemoryRel,
    getMemoryAbs,
    loadMemory,
    appendEvent,
    recordConversationTurn,
    snapshotProjectState
  };
}

module.exports = {
  createProjectMemoryStore
};
