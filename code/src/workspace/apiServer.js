"use strict";

const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

function createWorkspaceApiServer(options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const port = Number(options.port || process.env.FORGE_WORKSPACE_API_PORT || 3100);

  const llmRoot = path.resolve(root, "artifacts/llm");
  const decisionsRoot = path.resolve(root, "artifacts/decisions");
  const approvalPolicyPath = path.resolve(root, "artifacts/llm/approval_policy.json");

  const allowedWriteRoots = [
    path.resolve(root, "artifacts/llm"),
    path.resolve(root, "web"),
    path.resolve(root, "code/tools"),
    path.resolve(root, "code")
  ];

  function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  function sendJson(res, statusCode, payload) {
    res.writeHead(statusCode, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    res.end(JSON.stringify(payload, null, 2));
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let raw = "";
      req.on("data", (chunk) => {
        raw += chunk;
      });
      req.on("end", () => {
        try {
          resolve(raw ? JSON.parse(raw) : {});
        } catch (err) {
          reject(err);
        }
      });
      req.on("error", reject);
    });
  }

  function uniqueLower(values) {
    return Array.from(new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim().toLowerCase())
        .filter(Boolean)
    ));
  }

  function loadApprovalPolicy() {
    const fallback = {
      version: "1.1",
      available_roles: ["cto"],
      default_required_roles: ["cto"],
      max_files_per_decision: 10,
      max_total_bytes_per_decision: 200000,
      path_rules: []
    };

    if (!fs.existsSync(approvalPolicyPath)) {
      return fallback;
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(approvalPolicyPath, "utf-8"));

      return {
        version: typeof parsed.version === "string" ? parsed.version : "1.1",
        available_roles: uniqueLower(parsed.available_roles),
        default_required_roles: uniqueLower(parsed.default_required_roles).length > 0
          ? uniqueLower(parsed.default_required_roles)
          : ["cto"],
        max_files_per_decision:
          Number.isInteger(parsed.max_files_per_decision) && parsed.max_files_per_decision > 0
            ? parsed.max_files_per_decision
            : 10,
        max_total_bytes_per_decision:
          Number.isInteger(parsed.max_total_bytes_per_decision) && parsed.max_total_bytes_per_decision > 0
            ? parsed.max_total_bytes_per_decision
            : 200000,
        path_rules: Array.isArray(parsed.path_rules)
          ? parsed.path_rules.map((rule) => ({
              match_prefix: typeof rule.match_prefix === "string" ? rule.match_prefix.trim().replace(/\\/g, "/") : "",
              required_roles: uniqueLower(rule.required_roles)
            })).filter((rule) => rule.match_prefix && rule.required_roles.length > 0)
          : []
      };
    } catch (err) {
      return fallback;
    }
  }

  function normalizeRelativePath(inputPath) {
    return String(inputPath || "").trim().replace(/\\/g, "/");
  }

  function isPathAllowed(absPath) {
    return allowedWriteRoots.some((allowedRoot) => absPath === allowedRoot || absPath.startsWith(`${allowedRoot}${path.sep}`));
  }

  function normalizeDraftFiles(files) {
    if (!Array.isArray(files) || files.length === 0) {
      throw new Error("Draft contains no files");
    }

    return files.map((file) => {
      const relPath = normalizeRelativePath(file && file.path ? file.path : "");
      const absolutePath = path.resolve(root, relPath);

      if (!relPath) {
        throw new Error("Draft file path is required");
      }

      if (!isPathAllowed(absolutePath)) {
        throw new Error(`Write blocked for path: ${relPath}`);
      }

      return {
        path: relPath,
        absolutePath,
        content: typeof file.content === "string" ? file.content : ""
      };
    });
  }

  function resolveRequiredRolesForFiles(files) {
    const policy = loadApprovalPolicy();
    const matchedRoles = new Set();

    (Array.isArray(files) ? files : []).forEach((file) => {
      const relPath = String(file && file.path ? file.path : "").trim().replace(/\\/g, "/");

      policy.path_rules.forEach((rule) => {
        if (relPath.startsWith(rule.match_prefix)) {
          rule.required_roles.forEach((role) => matchedRoles.add(role));
        }
      });
    });

    const requiredRoles = matchedRoles.size > 0
      ? Array.from(matchedRoles)
      : policy.default_required_roles;

    return {
      policy_version: policy.version,
      available_roles: policy.available_roles,
      required_roles: requiredRoles
    };
  }

  function assertApproverRoleAllowed(approverRole, requiredRoles) {
    const normalizedRole = String(approverRole || "").trim().toLowerCase();

    if (!normalizedRole) {
      throw new Error("Approver role is required");
    }

    if (!Array.isArray(requiredRoles) || requiredRoles.length === 0) {
      throw new Error("Approval policy resolution failed");
    }

    if (!requiredRoles.includes(normalizedRole)) {
      throw new Error(`Approval blocked for role: ${normalizedRole}`);
    }

    return normalizedRole;
  }

  function resolveFileRoleRequirements(files) {
    const policy = loadApprovalPolicy();

    return (Array.isArray(files) ? files : []).map((file) => {
      const relPath = String(file && file.path ? file.path : "").trim().replace(/\\/g, "/");
      const matchedRoles = new Set();

      policy.path_rules.forEach((rule) => {
        if (relPath.startsWith(rule.match_prefix)) {
          rule.required_roles.forEach((role) => matchedRoles.add(role));
        }
      });

      const requiredRoles = matchedRoles.size > 0
        ? Array.from(matchedRoles)
        : policy.default_required_roles;

      return {
        path: relPath,
        required_roles: requiredRoles
      };
    });
  }

  function buildDecisionBatchStats(files) {
    const list = Array.isArray(files) ? files : [];
    const totalBytes = list.reduce((sum, file) => {
      return sum + Buffer.byteLength(String(file && file.content ? file.content : ""), "utf8");
    }, 0);

    return {
      file_count: list.length,
      total_bytes: totalBytes,
      operation_mode: list.length > 1 ? "MULTI_FILE" : "SINGLE_FILE"
    };
  }

  function assertDecisionBatchAllowed(files) {
    const policy = loadApprovalPolicy();
    const stats = buildDecisionBatchStats(files);

    if (stats.file_count === 0) {
      throw new Error("Draft contains no files");
    }

    if (stats.file_count > policy.max_files_per_decision) {
      throw new Error(`Decision blocked: too many files (${stats.file_count}/${policy.max_files_per_decision})`);
    }

    if (stats.total_bytes > policy.max_total_bytes_per_decision) {
      throw new Error(`Decision blocked: payload too large (${stats.total_bytes}/${policy.max_total_bytes_per_decision} bytes)`);
    }

    return {
      policy_version: policy.version,
      max_files_per_decision: policy.max_files_per_decision,
      max_total_bytes_per_decision: policy.max_total_bytes_per_decision,
      stats
    };
  }

  function sha256(content) {
    return crypto.createHash("sha256").update(String(content || ""), "utf8").digest("hex");
  }

  function buildSimpleDiff(oldContent, newContent) {
    if (String(oldContent || "") === String(newContent || "")) {
      return "No changes";
    }

    const oldLines = String(oldContent || "").split("\n");
    const newLines = String(newContent || "").split("\n");
    const max = Math.max(oldLines.length, newLines.length);
    const out = [];

    for (let i = 0; i < max; i += 1) {
      const a = oldLines[i];
      const b = newLines[i];

      if (a === b) {
        continue;
      }

      if (typeof a !== "undefined") {
        out.push(`- ${a}`);
      }

      if (typeof b !== "undefined") {
        out.push(`+ ${b}`);
      }
    }

    return out.join("\n");
  }

  function readJsonSafe(filePath, fallback) {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }

    try {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch (err) {
      return fallback;
    }
  }

  function appendDecisionLog(entry) {
    const logPath = path.join(llmRoot, "decision_log.json");
    const current = readJsonSafe(logPath, []);
    const items = Array.isArray(current) ? current : [];
    items.push(entry);
    fs.writeFileSync(logPath, JSON.stringify(items, null, 2));
  }

  function renderDecisionPacketMd(packet) {
    const lines = [];

    lines.push("# Decision Packet");
    lines.push("");
    lines.push(`- execution_id: ${packet.execution_id}`);
    lines.push(`- workspace_id: ${packet.workspace_id}`);
    lines.push(`- project_id: ${packet.project_id}`);
    lines.push(`- source: ${packet.source}`);
    lines.push("");

    lines.push("## Approval");
    lines.push(`- policy_version: ${packet.approval.policy_version}`);
    lines.push(`- approved_by_role: ${packet.approval.approved_by_role}`);
    lines.push(`- required_roles: ${(packet.approval.required_roles || []).join(", ")}`);
    lines.push(`- approved_at: ${packet.approval.approved_at}`);
    lines.push("");

    lines.push("## Operation");
    lines.push(`- mode: ${packet.operation.mode}`);
    lines.push(`- file_count: ${packet.operation.file_count}`);
    lines.push(`- total_bytes: ${packet.operation.total_bytes}`);
    lines.push("");

    lines.push("## Question");
    lines.push(packet.question);
    lines.push("");

    lines.push("## Context Summary");
    lines.push(packet.context_summary || "N/A");
    lines.push("");

    lines.push("## Proposed Files");
    (packet.proposed_files || []).forEach((file) => {
      lines.push(`- ${file.path}`);
      lines.push(`  - allow_overwrite: ${file.allow_overwrite ? "true" : "false"}`);
      lines.push(`  - sha256: ${file.sha256}`);
      lines.push(`  - required_roles: ${(file.required_roles || []).join(", ")}`);
      lines.push(`  - file_index: ${file.file_index}/${file.file_count}`);
    });

    return lines.join("\n");
  }

  function getRecentWrites(limit = 10) {
    const metadataDir = path.join(llmRoot, "metadata");

    if (!fs.existsSync(metadataDir)) {
      return [];
    }

    return fs.readdirSync(metadataDir)
      .filter((name) => name.endsWith(".write.json") || name.endsWith(".decision.json"))
      .map((name) => {
        const fullPath = path.join(metadataDir, name);
        const stat = fs.statSync(fullPath);

        let parsed = null;
        try {
          parsed = JSON.parse(fs.readFileSync(fullPath, "utf-8"));
        } catch (err) {
          parsed = null;
        }

        return {
          name,
          mtimeMs: stat.mtimeMs,
          data: parsed
        };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, limit)
      .map((item) => {
        const data = item.data && typeof item.data === "object" ? item.data : {};
        const isDecision = item.name.endsWith(".decision.json");

        return {
          entry_type: isDecision ? "DECISION_PACKET" : "WRITE",
          write_id: typeof data.write_id === "string" ? data.write_id : "",
          decision_packet_id: typeof data.decision_packet_id === "string" ? data.decision_packet_id : "",
          approver_role: typeof data.approver_role === "string" ? data.approver_role : "",
          required_roles: Array.isArray(data.required_roles) ? data.required_roles : [],
          approval_policy_version: typeof data.approval_policy_version === "string" ? data.approval_policy_version : "",
          operation_mode: typeof data.operation_mode === "string" ? data.operation_mode : "",
          file_count: Number.isInteger(data.file_count) ? data.file_count : 0,
          total_bytes: Number.isInteger(data.total_bytes) ? data.total_bytes : 0,
          written_files: Array.isArray(data.written_files) ? data.written_files : [],
          queued_files: Array.isArray(data.queued_files) ? data.queued_files : [],
          summary: typeof data.summary === "string" ? data.summary : "",
          ok: !!data.ok,
          logged_at: new Date(item.mtimeMs).toISOString()
        };
      });
  }

  function createDecisionPacket(draft, userRequest, approverRole) {
    const normalizedFiles = normalizeDraftFiles(draft.files);
    const batchPolicy = assertDecisionBatchAllowed(normalizedFiles);
    const fileRoleRequirements = resolveFileRoleRequirements(normalizedFiles);
    const approvalPolicy = resolveRequiredRolesForFiles(normalizedFiles);
    const approvedByRole = assertApproverRoleAllowed(approverRole, approvalPolicy.required_roles);

    const diffs = normalizedFiles.map((file) => {
      let oldContent = "";

      if (fs.existsSync(file.absolutePath)) {
        oldContent = fs.readFileSync(file.absolutePath, "utf-8");
      }

      const newContent = file.content || "";

      return {
        path: file.path,
        diff: buildSimpleDiff(oldContent, newContent),
        sha256: sha256(newContent)
      };
    });

    ensureDir(path.join(llmRoot, "requests"));
    ensureDir(path.join(llmRoot, "responses"));
    ensureDir(path.join(llmRoot, "metadata"));
    ensureDir(decisionsRoot);

    const decisionPacketId = `workspace_decision_${Date.now()}`;
    const workspaceId = "personal";
    const projectId = path.basename(root);

    const requestPath = path.join(llmRoot, "requests", `${decisionPacketId}.request.json`);
    const responsePath = path.join(llmRoot, "responses", `${decisionPacketId}.response.json`);
    const metadataPath = path.join(llmRoot, "metadata", `${decisionPacketId}.decision.json`);
    const decisionPacketJsonAbs = path.join(decisionsRoot, "decision_packet.json");
    const decisionPacketMdAbs = path.join(decisionsRoot, "decision_packet.md");

    const packet = {
      execution_id: decisionPacketId,
      workspace_id: workspaceId,
      project_id: projectId,
      source: "EXTERNAL_AI_WORKSPACE",
      operation: {
        mode: batchPolicy.stats.operation_mode,
        file_count: batchPolicy.stats.file_count,
        total_bytes: batchPolicy.stats.total_bytes
      },
      approval: {
        policy_version: approvalPolicy.policy_version,
        approved_by_role: approvedByRole,
        required_roles: approvalPolicy.required_roles,
        approved_at: new Date().toISOString()
      },
      question: "Approve the queued workspace draft for governed deterministic application?",
      context_summary: userRequest || "",
      options: [
        {
          option_id: "OPTION-APPROVE-WORKSPACE-DRAFT",
          description: "Queue the workspace draft as a governed pending change set.",
          impact_scope: "EXTERNAL_WORKSPACE",
          risk_level: "MEDIUM",
          downstream_effects: normalizedFiles.map((file) => `Apply candidate change to ${file.path}`),
          cognitive_priority_hint: null
        }
      ],
      recommendation_reference: `artifacts/llm/metadata/${decisionPacketId}.decision.json`,
      confirmation_required_format: "OPTION-APPROVE-WORKSPACE-DRAFT",
      proposed_files: normalizedFiles.map((file, index) => ({
        path: file.path,
        allow_overwrite: draft.files[index] && draft.files[index].allow_overwrite === true,
        sha256: diffs[index].sha256,
        diff: diffs[index].diff,
        required_roles:
          fileRoleRequirements.find((item) => item.path === file.path)?.required_roles || approvalPolicy.required_roles,
        file_index: index + 1,
        file_count: batchPolicy.stats.file_count
      }))
    };

    fs.writeFileSync(requestPath, JSON.stringify({
      request: userRequest || "",
      approver_role: approvedByRole,
      required_roles: approvalPolicy.required_roles,
      approval_policy_version: approvalPolicy.policy_version,
      operation_mode: batchPolicy.stats.operation_mode,
      file_count: batchPolicy.stats.file_count,
      total_bytes: batchPolicy.stats.total_bytes,
      approved_at: new Date().toISOString(),
      workspace_id: workspaceId,
      project_id: projectId
    }, null, 2));

    fs.writeFileSync(responsePath, JSON.stringify({
      summary: typeof draft.summary === "string" ? draft.summary : "Decision packet created successfully.",
      files: normalizedFiles.map((file) => ({
        path: file.path,
        content: file.content
      }))
    }, null, 2));

    fs.writeFileSync(decisionPacketJsonAbs, JSON.stringify(packet, null, 2));
    fs.writeFileSync(decisionPacketMdAbs, renderDecisionPacketMd(packet));

    const result = {
      ok: true,
      entry_type: "DECISION_PACKET",
      decision_packet_id: decisionPacketId,
      approver_role: approvedByRole,
      required_roles: approvalPolicy.required_roles,
      approval_policy_version: approvalPolicy.policy_version,
      operation_mode: batchPolicy.stats.operation_mode,
      file_count: batchPolicy.stats.file_count,
      total_bytes: batchPolicy.stats.total_bytes,
      decision_packet_paths: [
        "artifacts/decisions/decision_packet.json",
        "artifacts/decisions/decision_packet.md"
      ],
      queued_files: normalizedFiles.map((file) => file.path),
      summary: typeof draft.summary === "string" ? draft.summary : "Decision packet created successfully.",
      diffs
    };

    fs.writeFileSync(metadataPath, JSON.stringify(result, null, 2));

    appendDecisionLog({
      timestamp: new Date().toISOString(),
      type: "DECISION_PACKET",
      decision_packet_id: decisionPacketId,
      approver_role: approvedByRole,
      required_roles: approvalPolicy.required_roles,
      approval_policy_version: approvalPolicy.policy_version,
      operation_mode: batchPolicy.stats.operation_mode,
      file_count: batchPolicy.stats.file_count,
      total_bytes: batchPolicy.stats.total_bytes,
      workspace_id: workspaceId,
      project_id: projectId,
      request: userRequest || "",
      queued_files: normalizedFiles.map((file) => file.path)
    });

    return result;
  }

  async function handlePreview(body, res) {
    const draft = body && body.draft ? body.draft : null;

    if (!draft || !Array.isArray(draft.files)) {
      sendJson(res, 400, { error: "Draft is required" });
      return;
    }

    const normalizedFiles = normalizeDraftFiles(draft.files);
    const approvalPolicy = resolveRequiredRolesForFiles(normalizedFiles);
    const batchPolicy = assertDecisionBatchAllowed(normalizedFiles);
    const fileRoleRequirements = resolveFileRoleRequirements(normalizedFiles);

    const diffs = normalizedFiles.map((file) => {
      const oldContent = fs.existsSync(file.absolutePath)
        ? fs.readFileSync(file.absolutePath, "utf-8")
        : "";

      return {
        path: file.path,
        diff: buildSimpleDiff(oldContent, file.content || ""),
        sha256: sha256(file.content || "")
      };
    });

    sendJson(res, 200, {
      diffs,
      approval_policy_version: approvalPolicy.policy_version,
      available_roles: approvalPolicy.available_roles,
      required_roles: approvalPolicy.required_roles,
      operation_mode: batchPolicy.stats.operation_mode,
      file_count: batchPolicy.stats.file_count,
      total_bytes: batchPolicy.stats.total_bytes,
      file_role_requirements: fileRoleRequirements
    });
  }

  async function handleDecision(body, res) {
    const userRequest = typeof body.request === "string" ? body.request.trim() : "";
    const approverRole = typeof body.approver_role === "string" ? body.approver_role.trim() : "";
    const draft = body && body.draft ? body.draft : null;

    if (!draft || !Array.isArray(draft.files)) {
      sendJson(res, 400, { error: "Draft is required" });
      return;
    }

    const result = createDecisionPacket(draft, userRequest, approverRole);
    sendJson(res, 200, result);
  }

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") {
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === "GET" && req.url === "/health") {
        sendJson(res, 200, { ok: true, service: "forge-workspace-api" });
        return;
      }

      if (req.method === "GET" && req.url === "/api/ai/approval-policy") {
        sendJson(res, 200, loadApprovalPolicy());
        return;
      }

      if (req.method === "GET" && req.url === "/api/ai/history") {
        sendJson(res, 200, { items: getRecentWrites(10) });
        return;
      }

      if (req.method === "POST" && req.url === "/api/ai/preview") {
        const body = await readBody(req);
        await handlePreview(body, res);
        return;
      }

      if (req.method === "POST" && req.url === "/api/ai/decision") {
        const body = await readBody(req);
        await handleDecision(body, res);
        return;
      }

      sendJson(res, 404, { error: "Not found" });
    } catch (err) {
      sendJson(res, 500, { error: err && err.message ? err.message : "Internal server error" });
    }
  });

  return {
    port,
    server,
    start() {
      return new Promise((resolve) => {
        server.listen(port, () => resolve({ port }));
      });
    }
  };
}

module.exports = {
  createWorkspaceApiServer
};