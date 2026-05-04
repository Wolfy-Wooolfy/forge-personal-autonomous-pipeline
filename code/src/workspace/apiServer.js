"use strict";

const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const net = require("net");
const { execFile, spawn, spawnSync } = require("child_process");
const { handleAuthRequest } = require("../auth/authSystem");
const { createAiOsRuntime } = require("../ai_os/projectRuntime");
const { createProjectMemoryStore } = require("../memoryEngine");
const { runAutonomous } = require("../orchestrator/autonomous_runner");
const OpenAiStructuredJsonProvider = require("../providers/openAiStructuredJsonProvider");

const ProviderRouter = require("../providers/providerRouter");

function createWorkspaceApiServer(options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const port = Number(options.port || process.env.FORGE_WORKSPACE_API_PORT || 3100);

  const llmRoot = path.resolve(root, "artifacts/llm");
  const decisionsRoot = path.resolve(root, "artifacts/decisions");
  const approvalPolicyPath = path.resolve(root, "artifacts/llm/approval_policy.json");

  const aiRoot = path.resolve(root, "artifacts/ai");
  const aiConversationsRoot = path.resolve(aiRoot, "conversations");
  const aiContextRoot = path.resolve(aiRoot, "context");
  const aiAnalysisRoot = path.resolve(aiRoot, "analysis");

  const projectsRoot = path.resolve(root, "artifacts/projects");
  const activeProjectPath = path.resolve(projectsRoot, "active_project.json");
  const projectRegistryPath = path.resolve(projectsRoot, "project_registry.json");
  const appServerProcesses = new Map();

  const aiOsRuntime = createAiOsRuntime({ root });
  const projectMemoryStore = createProjectMemoryStore({ root });

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
    const oldText = String(oldContent || "").replace(/\r\n/g, "\n");
    const newText = String(newContent || "").replace(/\r\n/g, "\n");

    if (oldText === newText) {
      return "No changes";
    }

    const oldLines = oldText.split("\n");
    const newLines = newText.split("\n");

    let prefix = 0;
    while (
      prefix < oldLines.length &&
      prefix < newLines.length &&
      oldLines[prefix] === newLines[prefix]
    ) {
      prefix += 1;
    }

    let oldSuffix = oldLines.length - 1;
    let newSuffix = newLines.length - 1;
    while (
      oldSuffix >= prefix &&
      newSuffix >= prefix &&
      oldLines[oldSuffix] === newLines[newSuffix]
    ) {
      oldSuffix -= 1;
      newSuffix -= 1;
    }

    const removed = oldLines.slice(prefix, oldSuffix + 1);
    const added = newLines.slice(prefix, newSuffix + 1);

    const out = [];

    removed.forEach((line) => {
      out.push(`- ${line}`);
    });

    added.forEach((line) => {
      out.push(`+ ${line}`);
    });

    return out.length > 0 ? out.join("\n") : "No changes";
  }

  function detectOperationType(oldContent, newContent) {
    const clean = (text) =>
      String(text || "")
        .replace(/\/\/ ==== AI GENERATED ADDITION ====[\s\S]*?$/g, "")
        .replace(/\/\/ ==== AI MERGED ADDITION ====[\s\S]*?$/g, "")
        .trim();

    const oldText = clean(oldContent);
    const newText = clean(newContent);

    if (!oldText) {
      return "CREATE";
    }

    if (oldText === newText) {
      return "DUPLICATE";
    }

    if (oldText && newText && newText.includes(oldText)) {
      return "EXPAND";
    }

    return "MODIFY";
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

  function readTextSafe(filePath) {
    if (!fs.existsSync(filePath)) {
      return "";
    }

    try {
      return fs.readFileSync(filePath, "utf-8");
    } catch (err) {
      return "";
    }
  }

  function buildFocusedFileContext(fileContent) {
    const text = String(fileContent || "");
    const maxChars = 12000;

    if (text.length <= maxChars) {
      return text;
    }

    const head = text.slice(0, 7000);
    const tail = text.slice(-4000);

    return [
      head,
      "",
      "/* ... FILE CONTEXT TRUNCATED FOR PATCH GENERATION ... */",
      "",
      tail
    ].join("\n");
  }

  function buildRequestAwareFileContext(fileContent, requestText) {
    const text = String(fileContent || "");
    const request = String(requestText || "").toLowerCase().trim();

    if (!text) {
      return "";
    }

    const maxChars = 4000;
    const exactNeedles = [];
    const broadNeedles = [];

    if (request.includes("top of") || request.includes("at the top") || request.includes("header")) {
      exactNeedles.push("<!DOCTYPE html>", "<html", "<head", "\"use strict\";");
    }

    if (request.includes("bottom of") || request.includes("at the bottom") || request.includes("footer")) {
      exactNeedles.push("</body>", "</html>", "module.exports");
    }

    if (request.includes("comment")) {
      broadNeedles.push("<!--", "<!DOCTYPE html>", "\"use strict\";");
    }

    if (request.includes("button")) {
      broadNeedles.push("<button", "</button>", "<body", "</body>");
    }

    if (request.includes("script")) {
      broadNeedles.push("<script", "</script>");
    }

    if (request.includes("api") || request.includes("endpoint") || request.includes("route")) {
      broadNeedles.push('req.url === "', 'req.method === "', "sendJson(", "http.createServer");
    }

    if (request.includes("auth") || request.includes("login") || request.includes("register")) {
      broadNeedles.push("/api/auth/register", "/api/auth/login", "handleAuthRequest");
    }

    const allNeedles = [...exactNeedles, ...broadNeedles].filter(Boolean);

    for (const needle of allNeedles) {
      const idx = text.indexOf(needle);

      if (idx >= 0) {
        const isTopRequest =
          request.includes("top of") ||
          request.includes("at the top") ||
          request.includes("header");

        if (isTopRequest && (needle === "<!DOCTYPE html>" || needle === "<html" || needle === "<head")) {
          const end = Math.min(text.length, idx + 2200);
          const slice = text.slice(idx, end);

          if (slice.length <= maxChars) {
            return slice;
          }

          return slice.slice(0, maxChars);
        }

        const start = Math.max(0, idx - 1200);
        const end = Math.min(text.length, idx + Math.max(needle.length, 1) + 1200);
        const slice = text.slice(start, end);

        if (slice.length <= maxChars) {
          return slice;
        }

        return slice.slice(0, maxChars);
      }
    }

    if (text.length <= maxChars) {
      return text;
    }

    return text.slice(0, maxChars);
  }

  function normalizePatchOperations(operations) {
    if (!Array.isArray(operations)) {
      return [];
    }

    return operations
      .map((operation) => ({
        type: typeof (operation && operation.type) === "string"
          ? operation.type.trim()
          : "",
        find: typeof (operation && operation.find) === "string"
          ? operation.find
          : "",
        replace: typeof (operation && operation.replace) === "string"
          ? operation.replace
          : "",
        anchor: typeof (operation && operation.anchor) === "string"
          ? operation.anchor
          : "",
        content: typeof (operation && operation.content) === "string"
          ? operation.content
          : (typeof (operation && operation.insert) === "string"
              ? operation.insert
              : "")
      }))
      .filter((operation) => operation.type.length > 0);
  }

  function applyPatchOperations(baseContent, operations, filePath = "") {
    const normalizedOperations = normalizePatchOperations(operations);

    if (normalizedOperations.length === 0) {
      throw new Error(`Patch operations are required for: ${filePath || "unknown file"}`);
    }

    let nextContent = String(baseContent || "");

    normalizedOperations.forEach((operation) => {
      if (operation.type === "write_full_file") {
        nextContent = operation.content;
        return;
      }

      if (operation.type === "replace_once") {
        if (!operation.find) {
          throw new Error(`replace_once missing find for: ${filePath}`);
        }

        if (nextContent.includes(operation.find)) {
          nextContent = nextContent.replace(operation.find, operation.replace);
          return;
        }

        const normalizedCurrent = nextContent.replace(/\r\n/g, "\n");
        const normalizedFind = operation.find.replace(/\r\n/g, "\n");
        const normalizedReplace = operation.replace.replace(/\r\n/g, "\n");

        if (!normalizedCurrent.includes(normalizedFind)) {
          throw new Error(`replace_once anchor not found for: ${filePath}`);
        }

        nextContent = normalizedCurrent.replace(normalizedFind, normalizedReplace);
        return;
      }

      if (operation.type === "insert_after") {
        const anchor = operation.anchor || operation.find;
        const content = operation.content || operation.replace;

        if (!anchor) {
          throw new Error(`insert_after missing anchor for: ${filePath}`);
        }

        if (!nextContent.includes(anchor)) {
          throw new Error(`insert_after anchor not found for: ${filePath}`);
        }

        nextContent = nextContent.replace(
          anchor,
          `${anchor}${content}`
        );
        return;
      }

      if (operation.type === "insert_before") {
        const anchor = operation.anchor || operation.find;
        const content = operation.content || operation.replace;

        if (!anchor) {
          throw new Error(`insert_before missing anchor for: ${filePath}`);
        }

        if (!nextContent.includes(anchor)) {
          throw new Error(`insert_before anchor not found for: ${filePath}`);
        }

        nextContent = nextContent.replace(
          anchor,
          `${content}${anchor}`
        );
        return;
      }

      if (operation.type === "delete_once") {
        if (!operation.find) {
          throw new Error(`delete_once missing find for: ${filePath}`);
        }

        if (!nextContent.includes(operation.find)) {
          throw new Error(`delete_once target not found for: ${filePath}`);
        }

        nextContent = nextContent.replace(operation.find, "");
        return;
      }

      throw new Error(`Unsupported patch operation type: ${operation.type}`);
    });

    return nextContent;
  }

  function interpretUserIntent(requestText) {
    const text = String(requestText || "").toLowerCase();

    let mode = "ANALYSIS";
    let intent = "GENERAL";
    let needsClarification = false;

    if (!text || text.trim().length === 0) {
      return {
        mode: "BLOCKED",
        intent: "EMPTY",
        needs_clarification: true,
        clarification_question: "What do you want to do?"
      };
    }

    if (
      text.includes("create") ||
      text.includes("add") ||
      text.includes("build") ||
      text.includes("function") ||
      text.includes("modify") ||
      text.includes("edit") ||
      text.includes("implement") ||
      text.includes("connect") ||
      text.includes("integrate")
    ) {
      mode = "PROPOSAL";
      intent = "CODE_GENERATION";
    }

    if (
      text.includes("why") ||
      text.includes("explain") ||
      text.includes("what") ||
      text.includes("analyze")
    ) {
      mode = "ANALYSIS";
      intent = "QUESTION";
    }

    if (text.length <= 5) {
      needsClarification = true;
      
      return {
        mode,
        intent,
        needs_clarification: true,
        clarification_question: "Your request is too short. Can you describe what you want to build or modify?",
        normalized_request: requestText
      };
    }

    return {
      mode,
      intent,
      needs_clarification: needsClarification,
      normalized_request: requestText
    };
  }

  function toPascalCase(value) {
    return String(value || "")
      .replace(/[^a-zA-Z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join("");
  }

  function buildSmartProposalCode(requestText) {
    const raw = String(requestText || "").trim();
    const lower = raw.toLowerCase();

    if (
      (lower.includes("create") || lower.includes("build")) &&
      (lower.includes("authentication") || lower.includes("auth") || lower.includes("login")) &&
      lower.includes("connect") &&
      lower.includes("server")
    ) {
      return {
        strategy: "AUTH_SYSTEM_WITH_SERVER_INTEGRATION",
        files: [
          {
            path: "code/src/auth/authSystem.js",
            content:
`const express = require("express");

function registerAuthRoutes(app) {
  app.post("/api/auth/register", (req, res) => {
    const { username, password } = req.body;
    res.json({ ok: true, message: "User registered", username });
  });

  app.post("/api/auth/login", (req, res) => {
    const { username } = req.body;
    res.json({ ok: true, message: "Login successful", username });
  });
}

module.exports = {
  registerAuthRoutes
};`
          },
          {
            path: "code/src/workspace/apiServer.js",
            content:
`const { registerAuthRoutes } = require("../auth/authSystem");

function integrateAuth(app) {
  registerAuthRoutes(app);
}`
          }
        ]
      };
    }

    if (
      lower.includes("connect") &&
      (lower.includes("auth") || lower.includes("authentication")) &&
      lower.includes("server")
    ) {
      return {
        strategy: "CONNECT_AUTH_TO_SERVER",
        target_file: "code/src/workspace/apiServer.js",
        content:
`const { registerAuthRoutes } = require("../auth/authSystem");

function integrateAuth(app) {
  registerAuthRoutes(app);
}`
      };
    }

    if (
      lower.includes("authentication") ||
      lower.includes("auth") ||
      lower.includes("login")
    ) {
      return {
        strategy: "USER_AUTH_SYSTEM",
        target_file: "code/src/auth/authSystem.js",
        content:
`const express = require("express");

function registerAuthRoutes(app) {
  app.post("/api/auth/register", (req, res) => {
    const { username, password } = req.body;
    res.json({ ok: true, message: "User registered", username });
  });

  app.post("/api/auth/login", (req, res) => {
    const { username } = req.body;
    res.json({ ok: true, message: "Login successful", username });
  });
}

module.exports = {
  registerAuthRoutes
};`
      };
    }

    const printMatch = lower.match(/^create\s+a\s+function\s+that\s+prints\s+(.+)$/i);
    if (printMatch) {
      const message = raw.slice(raw.toLowerCase().indexOf("prints") + "prints".length).trim();
      const functionName = `print${toPascalCase(message) || "Message"}`;
      const safeMessage = message.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

      return {
        strategy: "FUNCTION_PRINT",
        target_file: "code/test_workspace_integration.js",
        content:
`function ${functionName}() {
  console.log("${safeMessage}");
}`
      };
    }

    const apiMatch = lower.match(/^create\s+an?\s+api\s+endpoint\s+called\s+(.+)$/i);
    if (apiMatch) {
      const endpointNameRaw = raw.slice(raw.toLowerCase().indexOf("called") + "called".length).trim();
      const endpointName = endpointNameRaw
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase() || "new-endpoint";

      return {
        strategy: "API_ENDPOINT_CREATE",
        target_file: "code/test_workspace_integration.js",
        content:
`function register${toPascalCase(endpointName)}Endpoint(app) {
  app.post("/api/${endpointName}", (req, res) => {
    res.json({ ok: true, endpoint: "${endpointName}" });
  });
}`
      };
    }

    const loggingMatch = lower.match(/^edit\s+this\s+file\s+to\s+add\s+logging$/i);
    if (loggingMatch) {
      return {
        strategy: "EDIT_ADD_LOGGING",
        target_file: "code/test_workspace_integration.js",
        content:
`console.log("Logging enabled");

function testWorkspaceIntegration() {
  console.log("testWorkspaceIntegration started");
}`
      };
    }

    const safeRaw = raw.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

    return {
      strategy: "FALLBACK_ECHO",
      target_file: "code/test_workspace_integration.js",
      content:
`// Generated from request:
// ${raw}

console.log("${safeRaw}");`
    };
  }

  function buildCodeAwareEditProposal(requestText, currentContent, targetFile) {
    const raw = String(requestText || "").trim();
    const lower = raw.toLowerCase();
    const existing = String(currentContent || "");

    if (/^edit\s+this\s+file\s+to\s+add\s+logging$/i.test(lower)) {
      const trimmedExisting = existing.trim();

      if (!trimmedExisting) {
        return {
          strategy: "EDIT_ADD_LOGGING_EMPTY_FILE",
          target_file: targetFile,
          content:
`function testWorkspaceIntegration() {
  console.log("testWorkspaceIntegration started");
}`
        };
      }

      if (trimmedExisting.includes('console.log("testWorkspaceIntegration started");')) {
        return {
          strategy: "EDIT_ADD_LOGGING_ALREADY_PRESENT",
          target_file: targetFile,
          content: trimmedExisting
        };
      }

      const functionMatch = existing.match(/function\s+([a-zA-Z0-9_]+)\s*\(\)\s*\{([\s\S]*?)\}/);

      if (functionMatch) {
        const functionName = functionMatch[1];
        const fullMatch = functionMatch[0];
        const bodyContent = functionMatch[2];

        const logLine = `  console.log("${functionName} started");`;

        if (bodyContent.includes(`${functionName} started`)) {
          return {
            strategy: "EDIT_ADD_LOGGING_ALREADY_PRESENT",
            target_file: targetFile,
            content: trimmedExisting
          };
        }

        const normalizedBody = bodyContent.replace(/^\s*\n/, "");
        const cleanedBody = bodyContent
  .replace(/^\s*\n/, "")
  .replace(/\s*$/, "");

const updatedFunction =
`function ${functionName}() {
${logLine}${cleanedBody ? `\n${cleanedBody}` : ""}
}`;

        return {
          strategy: "EDIT_ADD_LOGGING_STRUCTURE_AWARE",
          target_file: targetFile,
          content: existing.replace(fullMatch, updatedFunction).trim()
        };
      }

      return {
        strategy: "EDIT_ADD_LOGGING_FILE_AWARE_FALLBACK",
        target_file: targetFile,
        content:
`console.log("Logging enabled");

${trimmedExisting}`
      };
    }

    return null;
  }

  function scanProjectFiles() {
    const candidates = [
      "web/index.html",
      "code/src/workspace/apiServer.js",
      "code/test_workspace_integration.js"
    ];

    return candidates
      .map((relPath) => {
        const absPath = path.resolve(root, relPath);
        return {
          path: relPath,
          exists: fs.existsSync(absPath),
          content: readTextSafe(absPath)
        };
      })
      .filter((item) => item.exists);
  }

  function resolveTargetFileForRequest(requestText, projectFiles) {
    const text = String(requestText || "").toLowerCase();
    const available = Array.isArray(projectFiles) ? projectFiles : [];

    const hasFile = (relPath) => available.some((item) => item.path === relPath);

    if (
      (text.includes("ui") ||
        text.includes("interface") ||
        text.includes("frontend") ||
        text.includes("html") ||
        text.includes("page")) &&
      hasFile("web/index.html")
    ) {
      return "web/index.html";
    }

    if (
      (text.includes("api server") ||
        text.includes("workspace api") ||
        text.includes("server") ||
        text.includes("backend")) &&
      hasFile("code/src/workspace/apiServer.js")
    ) {
      return "code/src/workspace/apiServer.js";
    }

    if (hasFile("code/test_workspace_integration.js")) {
      return "code/test_workspace_integration.js";
    }

    return available.length > 0 ? available[0].path : "code/test_workspace_integration.js";
  }

  function buildStrategyCandidates(requestText, targetFile) {
    const raw = String(requestText || "").trim();
    const lower = raw.toLowerCase();
    const file = String(targetFile || "").trim();

    const strategies = [];

    if (/^create\s+a\s+function\s+that\s+prints\s+(.+)$/i.test(lower)) {
      strategies.push({
        strategy_id: "FUNCTION_PRINT",
        title: "Generate print function",
        score: 0.95,
        target_file: file,
        rationale: "The request explicitly asks to create a function that prints a message."
      });
    }

    if (/^create\s+an?\s+api\s+endpoint\s+called\s+(.+)$/i.test(lower)) {
      strategies.push({
        strategy_id: "API_ENDPOINT_CREATE",
        title: "Generate API endpoint",
        score: 0.95,
        target_file: file,
        rationale: "The request explicitly asks to create an API endpoint with a specific name."
      });
    }

    if (lower.includes("edit") && lower.includes("logging")) {
      strategies.push({
        strategy_id: "EDIT_ADD_LOGGING_STRUCTURE_AWARE",
        title: "Inject logging into existing function structure",
        score: 0.92,
        target_file: file,
        rationale: "The request asks to modify the current file by adding logging safely."
      });

      strategies.push({
        strategy_id: "EDIT_ADD_LOGGING_FILE_AWARE_FALLBACK",
        title: "Prepend logging to file",
        score: 0.55,
        target_file: file,
        rationale: "Fallback strategy in case no function structure is available."
      });
    }

    if (
      file === "web/index.html" &&
      lower.includes("button")
    ) {
      strategies.push({
        strategy_id: "HTML_BUTTON_CREATE",
        title: "Add HTML button",
        score: 0.9,
        target_file: file,
        rationale: "The request targets the UI and explicitly mentions a button."
      });
    }

    if (
      file === "code/src/workspace/apiServer.js" &&
      lower.includes("logging")
    ) {
      strategies.push({
        strategy_id: "BACKEND_LOGGING_MIDDLEWARE",
        title: "Add backend logging middleware",
        score: 0.88,
        target_file: file,
        rationale: "The request targets the backend server and explicitly mentions logging."
      });
    }

    if (
      (lower.includes("create") || lower.includes("build")) &&
      (lower.includes("authentication") || lower.includes("auth") || lower.includes("login")) &&
      lower.includes("connect") &&
      lower.includes("server")
    ) {
      strategies.push({
        strategy_id: "AUTH_SYSTEM_WITH_SERVER_INTEGRATION",
        title: "Create auth system and connect it to API server",
        score: 0.99,
        target_file: "MULTI_FILE",
        rationale: "The request clearly asks to create the auth system and connect it to the API server in one coordinated change."
      });
    }

    if (
      lower.includes("connect") &&
      (lower.includes("auth") || lower.includes("authentication")) &&
      lower.includes("server")
    ) {
      strategies.push({
        strategy_id: "CONNECT_AUTH_TO_SERVER",
        title: "Connect auth system to API server",
        score: 0.90,
        target_file: "code/src/workspace/apiServer.js",
        rationale: "The request clearly asks to connect the authentication system to the API server."
      });
    }

    if (
      lower.includes("authentication") ||
      lower.includes("auth") ||
      lower.includes("login")
    ) {
      strategies.push({
        strategy_id: "USER_AUTH_SYSTEM",
        title: "Full user authentication system",
        score: 0.95,
        target_file: "code/src/auth/authSystem.js",
        rationale: "The request clearly asks for a user authentication system."
      });
    }

    if (strategies.length === 0) {
      strategies.push({
        strategy_id: "FALLBACK_ECHO",
        title: "Fallback echo generation",
        score: 0.4,
        target_file: file,
        rationale: "No stronger strategy matched the request."
      });
    }

    strategies.sort((a, b) => b.score - a.score);

    return strategies;
  }

  function buildFileTypeAwareProposal(requestText, targetFile) {
    const raw = String(requestText || "").trim();
    const lower = raw.toLowerCase();
    const file = String(targetFile || "").trim();

    if (
      file === "web/index.html" &&
      lower.includes("button")
    ) {
      return {
        strategy: "HTML_BUTTON_CREATE",
        target_file: file,
        content: "",
        operations: [
          {
            type: "insert_before",
            anchor: "</body>",
            content: `  <button id="newButton">Click Me</button>\n`
          }
        ]
      };
    }

    if (
      file === "code/src/workspace/apiServer.js" &&
      lower.includes("logging")
    ) {
      return {
        strategy: "BACKEND_LOGGING_MIDDLEWARE",
        target_file: file,
        content:
`app.use((req, res, next) => {
  console.log(\`\${req.method} \${req.url}\`);
  next();
});`
      };
    }

    return null;
  }

  function buildAiAnalysisArtifacts(requestText) {
    const sessionId = `ai_analysis_${Date.now()}`;
    const createdAt = new Date().toISOString();

    ensureDir(aiConversationsRoot);
    ensureDir(aiContextRoot);
    ensureDir(aiAnalysisRoot);

    const selectedPaths = [
      "progress/status.json",
      "artifacts/forge/forge_state.json",
      "artifacts/orchestration/orchestration_state.json",
      "artifacts/verify/verification_results.json",
      "docs/11_ai_layer/01_AI_LAYER_SCOPE.md",
      "docs/11_ai_layer/02_AI_LAYER_ARCHITECTURE.md",
      "docs/11_ai_layer/03_AI_LAYER_GOVERNANCE.md",
      "docs/11_ai_layer/04_AI_LAYER_ARTIFACTS.md",
      "docs/11_ai_layer/05_AI_LAYER_RUNTIME_FLOW.md",
      "code/src/workspace/apiServer.js",
      "web/index.html"
    ];

    const selectedFiles = selectedPaths.map((relPath) => {
      const absPath = path.resolve(root, relPath);
      const content = readTextSafe(absPath);

      return {
        path: relPath,
        exists: fs.existsSync(absPath),
        size_bytes: Buffer.byteLength(content, "utf8"),
        sha256: sha256(content),
        content
      };
    });

    const forgeState = readJsonSafe(path.resolve(root, "artifacts/forge/forge_state.json"), {});
    const orchestrationState = readJsonSafe(path.resolve(root, "artifacts/orchestration/orchestration_state.json"), {});
    const verificationResults = readJsonSafe(path.resolve(root, "artifacts/verify/verification_results.json"), {});
    const liveStatus = readJsonSafe(path.resolve(root, "progress/status.json"), {});

    const analysisSummary = {
      forge_core_complete: forgeState.next_allowed_step === "COMPLETE" && Array.isArray(forgeState.open_tasks) && forgeState.open_tasks.length === 0,
      verify_pass: verificationResults.status === "PASS" && verificationResults.final_outcome === "PASS",
      workspace_runtime_complete: orchestrationState.run_mode === "WORKSPACE_RUNTIME" && orchestrationState.final_outcome === "WORKSPACE_RUNTIME_COMPLETE",
      no_open_gaps: Array.isArray(forgeState.pending_gaps) && forgeState.pending_gaps.length === 0,
      current_stage: typeof liveStatus.current_stage === "string" ? liveStatus.current_stage : "",
      last_completed_artifact: typeof forgeState.last_completed_artifact === "string" ? forgeState.last_completed_artifact : "",
      ai_layer_mode: "ANALYSIS",
      execution_triggered: false,
      decision_packet_created: false
    };

    const conversationArtifact = {
      session_id: sessionId,
      created_at: createdAt,
      mode: "ANALYSIS",
      messages: [
        {
          role: "user",
          content: requestText || "General AI Layer analysis request"
        },
        {
          role: "assistant",
          content: "Analysis completed in read-only mode with context and analysis artifacts generated."
        }
      ]
    };

    const contextArtifact = {
      session_id: sessionId,
      created_at: createdAt,
      mode: "ANALYSIS",
      request: requestText || "General AI Layer analysis request",
      selected_file_count: selectedFiles.length,
      selected_files: selectedFiles
    };

    const analysisArtifact = {
      analysis_id: sessionId,
      created_at: createdAt,
      mode: "ANALYSIS",
      request: requestText || "General AI Layer analysis request",
      summary: analysisSummary,
      findings: [
        {
          finding_id: "AI-ANALYSIS-001",
          title: "Forge core remains complete and verified",
          status: analysisSummary.forge_core_complete && analysisSummary.verify_pass ? "CONFIRMED" : "NOT_CONFIRMED"
        },
        {
          finding_id: "AI-ANALYSIS-002",
          title: "Workspace runtime lane is operational",
          status: analysisSummary.workspace_runtime_complete ? "CONFIRMED" : "NOT_CONFIRMED"
        },
        {
          finding_id: "AI-ANALYSIS-003",
          title: "AI Layer is running in read-only analysis mode",
          status: "CONFIRMED"
        }
      ]
    };

    const conversationRel = `artifacts/ai/conversations/${sessionId}.conversation.json`;
    const contextRel = `artifacts/ai/context/${sessionId}.context.json`;
    const analysisRel = `artifacts/ai/analysis/${sessionId}.analysis.json`;

    fs.writeFileSync(path.resolve(root, conversationRel), JSON.stringify(conversationArtifact, null, 2));
    fs.writeFileSync(path.resolve(root, contextRel), JSON.stringify(contextArtifact, null, 2));
    fs.writeFileSync(path.resolve(root, analysisRel), JSON.stringify(analysisArtifact, null, 2));

    return {
      ok: true,
      mode: "ANALYSIS",
      session_id: sessionId,
      conversation_artifact_path: conversationRel,
      context_artifact_path: contextRel,
      analysis_artifact_path: analysisRel,
      selected_file_count: selectedFiles.length,
      summary: analysisSummary,
      findings: analysisArtifact.findings
    };
  }

  function buildExecutionPlanFromDraft(draftArtifact, executionId) {
    const files = Array.isArray(draftArtifact.files) ? draftArtifact.files : [];

    return {
      workspace_execution_id: executionId,
      generated_at: new Date().toISOString(),
      files: files.map((file) => {
        const operations = normalizePatchOperations(file.operations);

        if (operations.length > 0) {
          return {
            file_path: file.path,
            operation: "modify",
            changes: [
              {
                type: "targeted_patch",
                operations
              }
            ]
          };
        }

        return {
          file_path: file.path,
          operation: "create",
          changes: [
            {
              type: "full_content",
              content: file.content
            }
          ]
        };
      })
    };
  }

  function materializeDraftFilesForApproval(draftArtifact) {
    const files = Array.isArray(draftArtifact && draftArtifact.files)
      ? draftArtifact.files
      : [];

    return files.map((file) => {
      const relPath = normalizeRelativePath(file && file.path ? file.path : "");
      const absolutePath = path.resolve(root, relPath);
      const baseContent = fs.existsSync(absolutePath)
        ? fs.readFileSync(absolutePath, "utf8")
        : "";
      const operations = normalizePatchOperations(file && file.operations);

      const content = operations.length > 0
        ? applyPatchOperations(baseContent, operations, relPath)
        : (typeof (file && file.content) === "string" ? file.content : "");

      return {
        path: relPath,
        content,
        allow_overwrite: file && file.allow_overwrite === true
      };
    });
  }

  function applyExecutionPlan(executionPlan) {
    const plan = executionPlan && typeof executionPlan === "object" ? executionPlan : {};
    const files = Array.isArray(plan.files) ? plan.files : [];

    if (files.length === 0) {
      throw new Error("Execution plan contains no files");
    }

    const appliedFiles = files.map((file) => {
      const relPath = normalizeRelativePath(file && file.file_path ? file.file_path : "");
      const absolutePath = path.resolve(root, relPath);

      if (!relPath) {
        throw new Error("Execution plan file_path is required");
      }

      if (!isPathAllowed(absolutePath)) {
        throw new Error(`Execution blocked for path: ${relPath}`);
      }

      const changes = Array.isArray(file.changes) ? file.changes : [];
      const patchChange = changes.find((change) => change && change.type === "targeted_patch");
      const fullContentChange = changes.find((change) => change && change.type === "full_content");

      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });

      let finalContent = "";
      let bytesWritten = 0;

      if (patchChange) {
        const existing = fs.existsSync(absolutePath)
          ? fs.readFileSync(absolutePath, "utf8")
          : "";

        finalContent = applyPatchOperations(
          existing,
          patchChange.operations,
          relPath
        );

        bytesWritten = Buffer.byteLength(finalContent, "utf8");
      } else if (fullContentChange) {
        const content = typeof fullContentChange.content === "string" ? fullContentChange.content : "";

        finalContent = content;

        if (fs.existsSync(absolutePath)) {
          const existing = fs.readFileSync(absolutePath, "utf8");

          const hasGeneratedRequestBlock =
            content.includes("// Generated from request:") ||
            content.includes("// Generated from request:\r\n");

          if (hasGeneratedRequestBlock) {
            let baseContent = existing;

            baseContent = baseContent.replace(
              /\n*\/\/ ==== AI GENERATED ADDITION ====\n[\s\S]*?(?=\n\/\/ ==== AI GENERATED ADDITION ====|\n\/\/ ==== AI MERGED ADDITION ====|$)/g,
              ""
            );

            baseContent = baseContent.replace(
              /\n*\/\/ ==== AI MERGED ADDITION ====\n[\s\S]*?(?=\n\/\/ ==== AI GENERATED ADDITION ====|\n\/\/ ==== AI MERGED ADDITION ====|$)/g,
              ""
            );

            baseContent = baseContent.trimEnd();

            finalContent = baseContent
              ? `${baseContent}\n\n// ==== AI MERGED ADDITION ====\n\n${content}`
              : content;
          } else {
            finalContent = existing
              ? `${existing}\n\n${content}`
              : content;
          }
        }

        bytesWritten = Buffer.byteLength(content, "utf8");
      } else {
        throw new Error(`Execution plan missing supported change for: ${relPath}`);
      }

      fs.writeFileSync(absolutePath, finalContent, "utf8");

      return {
        file_path: relPath,
        operation: file.operation || "create",
        bytes_written: bytesWritten
      };
    });

    return {
      ok: true,
      workspace_execution_id: typeof plan.workspace_execution_id === "string"
        ? plan.workspace_execution_id
        : "",
      applied_files: appliedFiles,
      file_count: appliedFiles.length,
      applied_at: new Date().toISOString()
    };
  }

  function buildAiProposalArtifacts(requestText, providerOutput = null, projectIdInput = "") {
    const proposalId = `ai_proposal_${Date.now()}`;
    const createdAt = new Date().toISOString();

    const projectId =
      typeof projectIdInput === "string" && projectIdInput.trim() !== ""
        ? projectIdInput.trim()
        : "default_project";

    const aiProposalsRoot = path.resolve(root, "artifacts", "projects", projectId, "ai", "proposals");
    const aiDraftsRoot = path.resolve(root, "artifacts", "projects", projectId, "ai", "drafts");

    ensureDir(aiProposalsRoot);
    ensureDir(aiDraftsRoot);

    const projectFiles = scanProjectFiles();
    const resolvedTargetFile = resolveTargetFileForRequest(requestText, projectFiles);
    const targetAbsPath = path.resolve(root, resolvedTargetFile);
    const currentContent = readTextSafe(targetAbsPath);

    const recentHistory = getRecentWrites(10);
    const normalizedRequest = String(requestText || "").trim().toLowerCase();

    const duplicateHistoryEntry = recentHistory.find((entry) => {
      const requestTextFromHistory = String(
        entry && entry.request_text ? entry.request_text : ""
      ).trim().toLowerCase();

      return requestTextFromHistory === normalizedRequest;
    });

    if (duplicateHistoryEntry) {
      return {
        ok: false,
        mode: "DUPLICATE_HISTORY",
        reason: "REQUEST_ALREADY_EXECUTED_RECENTLY",
        message: "This request was already executed recently.",
        target_file: resolvedTargetFile,
        recent_entry: {
          decision_packet_id: duplicateHistoryEntry.decision_packet_id || "",
          logged_at: duplicateHistoryEntry.logged_at || "",
          summary: duplicateHistoryEntry.summary || ""
        }
      };
    }

    const providerFiles = providerOutput && Array.isArray(providerOutput.files)
      ? providerOutput.files
          .map((file) => {
            const relPath = normalizeRelativePath(file && file.path ? file.path : "");
            const absPath = path.resolve(root, relPath);
            const baseContent = readTextSafe(absPath);
            const operations = normalizePatchOperations(file && file.operations);
            return {
              path: relPath,
              content: typeof (file && file.content) === "string" ? file.content : baseContent,
              operations,
              diff: typeof (file && file.diff) === "string" ? file.diff : "",
              allow_overwrite: true
            };
          })
          .filter((file) => file.path.length > 0)
      : [];

    const providerGenerated = providerFiles.length > 0
      ? {
          strategy: "PROVIDER_CODEX_FILES",
          files: providerFiles
        }
      : null;

    const generated = buildSmartProposalCode(requestText);
    if (!generated.target_file) {
      generated.target_file = resolvedTargetFile;
    }

    const fileTypeAware = buildFileTypeAwareProposal(
      requestText,
      resolvedTargetFile
    );

    const codeAwareEdit = buildCodeAwareEditProposal(
      requestText,
      currentContent,
      resolvedTargetFile
    );

    const finalGenerated = providerGenerated
      ? providerGenerated
      : (codeAwareEdit || fileTypeAware || generated);

    const generatedFiles = Array.isArray(finalGenerated.files) && finalGenerated.files.length > 0
      ? finalGenerated.files.map((file) => ({
          path: normalizeRelativePath(file.path),
          content: typeof file.content === "string" ? file.content : "",
          operations: normalizePatchOperations(file.operations),
          diff: typeof file.diff === "string" ? file.diff : "",
          allow_overwrite: file.allow_overwrite === true
        }))
      : [
          {
            path: finalGenerated.target_file || resolvedTargetFile,
            content: typeof finalGenerated.content === "string" ? finalGenerated.content : "",
            operations: normalizePatchOperations(finalGenerated.operations),
            diff: typeof finalGenerated.diff === "string" ? finalGenerated.diff : "",
            allow_overwrite: finalGenerated.allow_overwrite === true
          }
        ];

    const targetFile = generatedFiles[0].path;
    const targetFileAbs = path.resolve(root, targetFile);
    const oldContent = readTextSafe(targetFileAbs);
    const newContent = generatedFiles[0].content || "";
    const operationType = detectOperationType(oldContent, newContent);

    if (operationType === "DUPLICATE") {
      return {
        ok: false,
        mode: "DUPLICATE",
        reason: "CONTENT_ALREADY_EXISTS",
        message: "Request already exists in target file.",
        target_file: targetFile,
        operation_analysis: {
          operation_type: operationType,
          old_content: oldContent,
          new_content: newContent
        }
      };
    }

    const strategyCandidates = providerGenerated
      ? [
          {
            strategy_id: "CODEX_PROVIDER",
            title: "Codex Generated Patch",
            score: 1.0,
            target_file: generatedFiles.length > 1 ? "MULTI_FILE" : targetFile,
            rationale: "Using Codex provider output directly"
          }
        ]
      : buildStrategyCandidates(
          requestText,
          targetFile
        );

    const proposalArtifact = {
      proposal_id: proposalId,
      project_id: projectId,
      created_at: createdAt,
      mode: "PROPOSAL",
      request: requestText || "General proposal request",
      description: "Generated proposal based on AI analysis",
      impact: "LOW",
      execution_required: true,
      execution_approved: false,
      generation_strategy: finalGenerated.strategy,
      target_file: targetFile,
      target_files: generatedFiles.map((file) => file.path),
      operation_mode: generatedFiles.length > 1 ? "MULTI_FILE" : "SINGLE_FILE",
      selected_strategy: strategyCandidates[0] || null,
      strategy_candidates: strategyCandidates
    };

    const draftArtifact = {
      draft_id: proposalId,
      project_id: projectId,
      created_at: createdAt,
      mode: "PROPOSAL",
      files: generatedFiles,
      approved: false,
      ready_for_decision: false
    };

    const proposalRel = `artifacts/projects/${projectId}/ai/proposals/${proposalId}.proposal.json`;
    const draftRel = `artifacts/projects/${projectId}/ai/drafts/${proposalId}.draft.json`;

    fs.writeFileSync(path.resolve(root, proposalRel), JSON.stringify(proposalArtifact, null, 2));
    fs.writeFileSync(path.resolve(root, draftRel), JSON.stringify(draftArtifact, null, 2));

    writeActiveProject(projectId);
    persistProjectState(projectId, {
      user_goal: requestText,
      technical_goal: requestText,
      current_phase: "DOCS_DRAFTING",
      active_runtime_state: "DOCUMENTATION",
      documentation_state: "DRAFTING",
      execution_package_state: "DRAFTING",
      execution_state: "NOT_STARTED",
      selected_strategy:
        strategyCandidates[0] && typeof strategyCandidates[0].strategy_id === "string"
          ? strategyCandidates[0].strategy_id
          : ""
    });

    return {
      ok: true,
      mode: "PROPOSAL",
      proposal_id: proposalId,
      proposal_path: proposalRel,
      draft_path: draftRel,
      ready_for_approval: true,
      selected_strategy: strategyCandidates[0] || null,
      strategy_candidates: strategyCandidates
    };
  }

  function normalizeProjectId(projectIdInput) {
    return typeof projectIdInput === "string" && projectIdInput.trim() !== ""
      ? projectIdInput.trim()
      : "default_project";
  }

  function normalizeProjectName(projectNameInput) {
    return deriveCleanEnglishProjectName(projectNameInput);
  }

  function deriveCleanEnglishProjectName(value) {
    const raw = String(value || "").trim().replace(/\s+/g, " ");

    if (!raw) {
      return "New Project";
    }

    const normalized = raw
      .toLowerCase()
      .replace(/[\u064b-\u065f]/g, "")
      .replace(/\u0623|\u0625|\u0622/g, "\u0627")
      .replace(/\u0649/g, "\u064a")
      .replace(/\u0629/g, "\u0647");

    if (/\bcrm\b/i.test(raw)) return "CRM System";
    if (/\bhr\b/i.test(raw)) return "HR System";
    if (normalized.includes("\u062e\u062f\u0645\u0647 \u0639\u0645\u0644\u0627\u0621") || normalized.includes("customer service")) return "Customer Service System";
    if (normalized.includes("\u0627\u062f\u0627\u0631\u0647 \u0645\u0627\u0644\u064a\u0647") || normalized.includes("\u0645\u0627\u0644\u064a") || normalized.includes("financial")) return "Financial Management System";
    if (normalized.includes("\u062d\u0633\u0627\u0628\u0627\u062a") || normalized.includes("accounting")) return "Accounting System";

    const cleaned = raw
      .replace(/\u0627\u0639\u0645\u0644|\u0639\u0627\u064a\u0632|\u0627\u0631\u064a\u062f|\u0623\u0631\u064a\u062f|\u0625\u0639\u0645\u0644|\u0627\u0628\u0646\u064a|\u0635\u0645\u0645|\u0645\u0642\u062a\u0631\u062d|\u0643\u0627\u0645\u0644|\u0627\u0639\u0631\u0636\u0647 \u0639\u0644\u064a\u0627|\u0627\u0639\u0631\u0636\u0647|\u0627\u0634\u0631\u062d|\u0646\u0641\u0630|\u062d\u0648\u0651\u0644|\u062d\u0648\u0644|\u0645\u0646 \u0641\u0636\u0644\u0643/gi, " ")
      .replace(/\b(create|build|make|proposal|complete|full|show|explain|execute|run|please)\b/gi, " ")
      .replace(/\b(system|\u0633\u064a\u0633\u062a\u0645|\u0646\u0638\u0627\u0645)\b/gi, " ")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!cleaned) return "New Project";

    const words = cleaned.split(/\s+/).filter(Boolean).slice(0, 5);
    const title = words.map((word) => {
      if (/^[A-Z0-9]{2,}$/i.test(word) && word.length <= 5) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    }).join(" ");

    return /\bSystem$/i.test(title) ? title : `${title} System`;
  }

  function buildProjectId(projectIdInput, projectNameInput) {
    const directValue = typeof projectIdInput === "string" ? projectIdInput.trim().toLowerCase() : "";
    const fallbackValue = normalizeProjectName(projectNameInput).toLowerCase();

    const normalized = (directValue || fallbackValue)
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");

    return normalized || `project_${Date.now()}`;
  }

  function getProjectStateRel(projectIdInput) {
    return `artifacts/projects/${normalizeProjectId(projectIdInput)}/project_state.json`;
  }

  function getProjectStateAbs(projectIdInput) {
    return path.resolve(root, getProjectStateRel(projectIdInput));
  }

  function getProjectConversationHistoryRel(projectIdInput) {
    return `artifacts/projects/${normalizeProjectId(projectIdInput)}/workspace/conversation_history.json`;
  }

  function getProjectConversationHistoryAbs(projectIdInput) {
    return path.resolve(root, getProjectConversationHistoryRel(projectIdInput));
  }

  function readProjectConversationHistory(projectIdInput) {
    const items = readJsonSafe(getProjectConversationHistoryAbs(projectIdInput), []);
    return Array.isArray(items) ? items : [];
  }

  function appendProjectConversationTurn(projectIdInput, turn) {
    const projectId = normalizeProjectId(projectIdInput);
    const historyAbs = getProjectConversationHistoryAbs(projectId);
    const items = readProjectConversationHistory(projectId);
    const entry = {
      turn_id: `turn_${Date.now()}`,
      project_id: projectId,
      created_at: new Date().toISOString(),
      request: String(turn && turn.request ? turn.request : ""),
      final_status: String(turn && turn.finalStatus ? turn.finalStatus : ""),
      proposal_id: String(turn && turn.proposalId ? turn.proposalId : ""),
      decision_packet_id: String(turn && turn.decisionPacketId ? turn.decisionPacketId : ""),
      operation_type: String(turn && turn.operationType ? turn.operationType : "UNKNOWN"),
      file_count: Number.isInteger(turn && turn.fileCount) ? turn.fileCount : 0,
      messages: Array.isArray(turn && turn.messages) ? turn.messages : []
    };

    ensureDir(path.dirname(historyAbs));
    items.push(entry);
    fs.writeFileSync(historyAbs, JSON.stringify(items, null, 2), "utf8");
    projectMemoryStore.recordConversationTurn(projectId, entry);
    return entry;
  }

  function readActiveProjectId() {
    const payload = readJsonSafe(activeProjectPath, null);

    if (payload && typeof payload.project_id === "string" && payload.project_id.trim() !== "") {
      return payload.project_id.trim();
    }

    return "default_project";
  }

  function writeActiveProject(projectIdInput) {
    const projectId = normalizeProjectId(projectIdInput);
    ensureDir(projectsRoot);
    fs.writeFileSync(activeProjectPath, JSON.stringify({
      project_id: projectId,
      updated_at: new Date().toISOString()
    }, null, 2));
    return projectId;
  }

  function listKnownProjectIds() {
    ensureDir(projectsRoot);

    const ids = fs.readdirSync(projectsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter(Boolean);

    if (!ids.includes("default_project")) {
      ids.unshift("default_project");
    }

    return Array.from(new Set(ids));
  }

  function buildProjectState(projectIdInput, overrides = {}) {
    const projectId = normalizeProjectId(projectIdInput);
    const projectRoot = getProjectArtifactsRoot(projectId);

    ensureDir(projectRoot);

    const existing = readJsonSafe(getProjectStateAbs(projectId), {});
    const proposalRoot = path.join(projectRoot, "ai", "proposals");
    const draftRoot = path.join(projectRoot, "ai", "drafts");
    const decisionRoot = path.join(projectRoot, "decisions");
    const executionPackageAbs = getProjectExecutionPackageAbs(projectId);
    const decisionPacketAbs = path.join(decisionRoot, "decision_packet.json");

    const proposalCount = fs.existsSync(proposalRoot)
      ? fs.readdirSync(proposalRoot).filter((name) => name.endsWith(".proposal.json")).length
      : 0;

    const draftCount = fs.existsSync(draftRoot)
      ? fs.readdirSync(draftRoot).filter((name) => name.endsWith(".draft.json")).length
      : 0;

    const decisionPacket = readJsonSafe(decisionPacketAbs, null);
    const executionPackage = readJsonSafe(executionPackageAbs, null);
    const conversationHistory = readProjectConversationHistory(projectId);
    const projectMemory = projectMemoryStore.loadMemory(projectId);

    const hasDecisionPacket = !!decisionPacket;
    const hasExecutionPackage = !!executionPackage;
    const packageOriginalGoal = String(
      executionPackage &&
      executionPackage.business_and_scope_decisions &&
      executionPackage.business_and_scope_decisions.user_goal
        ? executionPackage.business_and_scope_decisions.user_goal
        : ""
    ).trim();
    const existingProjectName = String(existing.project_name || "").trim();
    const existingUserGoal = String(existing.user_goal || "").trim();
    const currentOriginalGoal = String(packageOriginalGoal || existing.original_user_goal || existingUserGoal || "").trim();
    const repairedOriginalGoal = currentOriginalGoal;
    const shouldRepairFollowupIdentity =
      repairedOriginalGoal &&
      (
        isRequirementsFollowupActionText(existingProjectName) ||
        isRequirementsFollowupActionText(existingUserGoal) ||
        (
          packageOriginalGoal &&
          existingUserGoal &&
          existingUserGoal !== packageOriginalGoal
        )
      );

    const activeRuntimeState =
      overrides.active_runtime_state ||
      (hasExecutionPackage ? "EXECUTION_PREPARATION" : proposalCount > 0 ? "DOCUMENTATION" : "DISCUSSION");

    const currentPhase =
      overrides.current_phase ||
      (hasExecutionPackage ? "EXECUTION_READY" : proposalCount > 0 ? "DOCS_DRAFTING" : "DISCOVERY");

    const existingDocumentationState = String(existing.documentation_state || "").trim();
    const documentationState =
      overrides.documentation_state ||
      (existingDocumentationState && existingDocumentationState !== "EMPTY" ? existingDocumentationState : "") ||
      (hasDecisionPacket ? "APPROVED" : proposalCount > 0 ? "DRAFTING" : "EMPTY");

    const executionPackageStatus = hasExecutionPackage
      ? String(executionPackage.handoff_status || "").trim().toUpperCase()
      : "";

    const executionPackageState =
      overrides.execution_package_state ||
      (hasExecutionPackage
        ? executionPackageStatus === "APPROVED_PENDING_FORGE"
          ? "APPROVED_PENDING_FORGE"
          : executionPackageStatus === "EXECUTED"
            ? "EXECUTED"
            : "DRAFTING"
        : "NOT_READY");

    const executionState =
      overrides.execution_state ||
      (hasExecutionPackage
        ? executionPackageStatus === "EXECUTED"
          ? "EXECUTED"
          : "PENDING_FORGE"
        : "NOT_STARTED");

    const verificationState = overrides.verification_state || (executionPackageStatus === "EXECUTED" ? "PASS" : "NOT_READY");
    const deliveryState = overrides.delivery_state || existing.delivery_state || (executionPackageStatus === "EXECUTED" ? "ARTIFACTS_ONLY" : "NOT_READY");
    const existingDeliverySummary =
      existing.delivery_summary && typeof existing.delivery_summary === "object"
        ? existing.delivery_summary
        : null;
    const hasDeliverySummaryOverride = Object.prototype.hasOwnProperty.call(overrides, "delivery_summary");
    const effectiveDeliverySummary =
      hasDeliverySummaryOverride
        ? (overrides.delivery_summary && typeof overrides.delivery_summary === "object" ? overrides.delivery_summary : null)
        : existingDeliverySummary
          ? (
              existingDeliverySummary.app_preview_url === undefined ||
              existingDeliverySummary.absolute_output_path === undefined ||
              existingDeliverySummary.absolute_app_output_path === undefined ||
              (existingDeliverySummary.delivery_type === "RUNNABLE_APPLICATION" && !existingDeliverySummary.app_preview_url) ||
              String(existingDeliverySummary.app_preview_url || "").includes("/app/app/") ||
              (Array.isArray(existingDeliverySummary.output_files) &&
                existingDeliverySummary.output_files.some((file) => String(file || "").replace(/\\/g, "/").includes("app/app/")))
                ? buildDeliverySummary(projectId)
                : existingDeliverySummary
            )
          : null;

    const state = {
      project_id: projectId,
      project_name: typeof overrides.project_name === "string" && overrides.project_name.trim() !== ""
        ? normalizeProjectName(overrides.project_name)
        : shouldRepairFollowupIdentity
          ? normalizeProjectName(repairedOriginalGoal)
          : typeof existing.project_name === "string" && existing.project_name.trim() !== ""
          ? normalizeProjectName(existing.project_name)
          : projectId,
      project_type: overrides.project_type || existing.project_type || "REVIEW",
      project_mode: overrides.project_mode || existing.project_mode || "EXTEND_EXISTING",
      project_status: overrides.project_status || existing.project_status || "ACTIVE",
      primary_language: overrides.primary_language || existing.primary_language || "MIXED",
      user_goal: overrides.user_goal || (shouldRepairFollowupIdentity ? repairedOriginalGoal : existing.user_goal) || "",
      business_goal: overrides.business_goal || existing.business_goal || "",
      technical_goal: overrides.technical_goal || existing.technical_goal || "",
      current_phase: currentPhase,
      active_runtime_state: activeRuntimeState,
      workspace_path: root,
      source_of_truth: "ZIP_SNAPSHOT",
      selected_strategy:
        typeof overrides.selected_strategy === "string"
          ? overrides.selected_strategy
          : existing.selected_strategy || "",
      accepted_options: Array.isArray(overrides.accepted_options)
        ? overrides.accepted_options
        : Array.isArray(existing.accepted_options)
          ? existing.accepted_options
          : [],
      rejected_options: Array.isArray(overrides.rejected_options)
        ? overrides.rejected_options
        : Array.isArray(existing.rejected_options)
          ? existing.rejected_options
          : [],
      open_questions: Array.isArray(overrides.open_questions)
        ? overrides.open_questions
        : Array.isArray(existing.open_questions)
          ? existing.open_questions
          : [],

      clarification_answers:
        overrides.clarification_answers && typeof overrides.clarification_answers === "object"
          ? overrides.clarification_answers
          : existing.clarification_answers && typeof existing.clarification_answers === "object"
            ? existing.clarification_answers
            : {},
      requirement_domain: overrides.requirement_domain || existing.requirement_domain || "",
      requirement_completeness:
        typeof overrides.requirement_completeness === "boolean"
          ? overrides.requirement_completeness
          : typeof existing.requirement_completeness === "boolean"
            ? existing.requirement_completeness
            : false,

      requirement_model:
        overrides.requirement_model && typeof overrides.requirement_model === "object"
          ? overrides.requirement_model
          : existing.requirement_model && typeof existing.requirement_model === "object"
            ? existing.requirement_model
            : {},
      requirement_reasoning_summary:
        typeof overrides.requirement_reasoning_summary === "string"
          ? overrides.requirement_reasoning_summary
          : existing.requirement_reasoning_summary || "",
      provider_error:
        typeof overrides.provider_error === "string"
          ? overrides.provider_error
          : existing.provider_error || "",
      original_user_goal:
        typeof overrides.original_user_goal === "string"
          ? overrides.original_user_goal
          : currentOriginalGoal,
      latest_requested_action:
        typeof overrides.latest_requested_action === "string"
          ? overrides.latest_requested_action
          : existing.latest_requested_action || "",
      active_followup_action:
        typeof overrides.active_followup_action === "string"
          ? overrides.active_followup_action
          : existing.active_followup_action || "",
        
      documentation_state: documentationState,
      execution_package_state: executionPackageState,
      execution_state: executionState,
      verification_state: verificationState,
      delivery_state: deliveryState,
      delivery_summary: effectiveDeliverySummary,
      current_delivery_state:
        typeof overrides.current_delivery_state === "string"
          ? overrides.current_delivery_state
          : effectiveDeliverySummary ? "DELIVERED" : existing.current_delivery_state || "UNKNOWN",
      current_delivery_type:
        typeof overrides.current_delivery_type === "string"
          ? overrides.current_delivery_type
          : effectiveDeliverySummary && effectiveDeliverySummary.delivery_type
            ? String(effectiveDeliverySummary.delivery_type)
            : existing.current_delivery_type || "",
      current_execution_id:
        typeof overrides.current_execution_id === "string"
          ? overrides.current_execution_id
          : effectiveDeliverySummary && effectiveDeliverySummary.execution_id
            ? String(effectiveDeliverySummary.execution_id)
            : existing.current_execution_id || "",
      current_package_id:
        typeof overrides.current_package_id === "string"
          ? overrides.current_package_id
          : effectiveDeliverySummary && effectiveDeliverySummary.package_id
            ? String(effectiveDeliverySummary.package_id)
            : existing.current_package_id || "",
      current_output_files:
        Array.isArray(overrides.current_output_files)
          ? overrides.current_output_files
          : effectiveDeliverySummary && Array.isArray(effectiveDeliverySummary.output_files)
            ? effectiveDeliverySummary.output_files
            : Array.isArray(existing.current_output_files) ? existing.current_output_files : [],
      current_followup_mode:
        typeof overrides.current_followup_mode === "string"
          ? overrides.current_followup_mode
          : existing.current_followup_mode || "",
      conversation_history: {
        proposal_count: proposalCount,
        draft_count: draftCount,
        turn_count: conversationHistory.length,
        latest_turn_id: conversationHistory.length > 0
          ? String(conversationHistory[conversationHistory.length - 1].turn_id || "")
          : "",
        artifact_path: getProjectConversationHistoryRel(projectId)
      },
      decision_history: {
        has_decision_packet: hasDecisionPacket
      },
      artifact_registry: {
        project_root: `artifacts/projects/${projectId}`,
        project_state: getProjectStateRel(projectId),
        decision_packet: hasDecisionPacket ? `artifacts/projects/${projectId}/decisions/decision_packet.json` : "",
        execution_package: hasExecutionPackage ? getProjectExecutionPackageRel(projectId) : ""
      },
      review_cycles_count: Number.isInteger(existing.review_cycles_count) ? existing.review_cycles_count : 0,
      pending_decisions: hasExecutionPackage && executionPackageState !== "EXECUTED" ? ["EXECUTION_PACKAGE_PENDING_FORGE"] : [],
      memory_state:
        projectMemory.memory_state && projectMemory.memory_state !== "EMPTY"
          ? projectMemory.memory_state
          : proposalCount > 0 || hasDecisionPacket ? "ACTIVE" : "EMPTY",
      version_registry: Array.isArray(projectMemory.version_registry) && projectMemory.version_registry.length > 0
        ? projectMemory.version_registry
        : Array.isArray(existing.version_registry) ? existing.version_registry : [],
      active_project_flag: readActiveProjectId() === projectId,
      last_updated_at: new Date().toISOString()
    };

    return state;
  }

  function persistProjectState(projectIdInput, overrides = {}) {
    const projectId = normalizeProjectId(projectIdInput);
    const state = buildProjectState(projectId, overrides);
    const projectStateAbs = getProjectStateAbs(projectId);

    const projectMemory = projectMemoryStore.snapshotProjectState(projectId, state);
    state.memory_state = projectMemory.memory_state;
    state.version_registry = Array.isArray(projectMemory.version_registry)
      ? projectMemory.version_registry
      : [];

    ensureDir(path.dirname(projectStateAbs));
    fs.writeFileSync(projectStateAbs, JSON.stringify(state, null, 2));

    ensureDir(projectsRoot);

    const registry = {
      active_project_id: readActiveProjectId(),
      updated_at: new Date().toISOString(),
      projects: listKnownProjectIds().map((id) => {
        const item = id === projectId ? state : buildProjectState(id);
        return {
          project_id: item.project_id,
          project_name: item.project_name,
          project_status: item.project_status,
          current_phase: item.current_phase,
          active_runtime_state: item.active_runtime_state,
          pending_decisions: item.pending_decisions,
          active_project_flag: item.active_project_flag,
          last_updated_at: item.last_updated_at
        };
      })
    };

    fs.writeFileSync(projectRegistryPath, JSON.stringify(registry, null, 2));

    return state;
  }

  function assertWorkspaceDiscoveryComplete(body = {}) {
    const projectId =
      typeof body.project_id === "string" && body.project_id.trim() !== ""
        ? body.project_id.trim()
        : "default_project";

    const state = buildProjectState(projectId);
    const openQuestions = Array.isArray(state.open_questions) ? state.open_questions : [];

    if (
      state.requirement_completeness !== true &&
      state.active_runtime_state !== "IDEATION"
    ) {
      return {
        ok: false,
        mode: "BLOCKED",
        reason: "DISCOVERY_NOT_COMPLETE",
        project_id: projectId,
        requirement_domain: state.requirement_domain || "",
        requirement_completeness: state.requirement_completeness === true,
        blocking_questions: openQuestions
      };
  }

    return {
      ok: true,
      project_id: projectId
    };
  }

  async function runForgeWorkspaceRuntime(body = {}) {
    const projectId = normalizeProjectId(body.project_id || readActiveProjectId());
    writeActiveProject(projectId);

    const previousCwd = process.cwd();

    try {
      if (previousCwd !== root) {
        process.chdir(root);
      }

      const result = await runAutonomous({
        run_id: `WORKSPACE-RUN-${Date.now()}`,
        started_at: new Date().toISOString()
      });

      const orchestrationState = readJsonSafe(
        path.resolve(root, "artifacts", "orchestration", "orchestration_state.json"),
        {}
      );

      const finalOutcome = String(
        orchestrationState.final_outcome || result.final_outcome || ""
      ).toUpperCase();
      const blocked = orchestrationState.blocked === true || result.blocked === true;
      const ok = blocked !== true && finalOutcome === "WORKSPACE_RUNTIME_COMPLETE";
      const deliverySummary = buildDeliverySummary(projectId);
      const runnableApplicationCreated = deliverySummary.runnable_application_created === true;
      const blockingReason = String(
        orchestrationState.blocking_reason || result.blocking_reason || result.reason || ""
      ).trim();

      const project = persistProjectState(projectId, {
        current_phase: ok ? (runnableApplicationCreated ? "DELIVERY_READY" : "FORGE_RUNTIME_COMPLETE") : "EXECUTION_BLOCKED",
        active_runtime_state: ok ? "EXECUTION_COMPLETE" : "EXECUTION_BLOCKED",
        execution_package_state: ok ? "EXECUTED" : "APPROVED_PENDING_FORGE",
        execution_state: ok ? "EXECUTED" : "BLOCKED",
        verification_state: ok ? "PASS" : "BLOCKED",
        delivery_state: ok ? (runnableApplicationCreated ? "READY" : deliverySummary.delivery_type || "ARTIFACTS_ONLY") : "NOT_READY",
        delivery_summary: deliverySummary
      });

      return {
        ok,
        mode: ok ? "FORGE_WORKSPACE_RUNTIME_COMPLETE" : "FORGE_WORKSPACE_RUNTIME_BLOCKED",
        project_id: projectId,
        project,
        result,
        orchestration_state: orchestrationState,
        delivery_summary: deliverySummary,
        blocking_reason: blockingReason,
        artifacts: {
          orchestration_state: "artifacts/orchestration/orchestration_state.json",
          orchestration_report: "artifacts/orchestration/orchestration_run_report.md",
          execute_plan: "artifacts/execute/execute_plan.json",
          execute_report: "artifacts/execute/execute_report.md",
          verification_report: "artifacts/verify/verification_report.md"
        }
      };
    } finally {
      if (process.cwd() !== previousCwd) {
        process.chdir(previousCwd);
      }
    }
  }

  function listProjects() {
    ensureDir(projectsRoot);

    if (!fs.existsSync(activeProjectPath)) {
      writeActiveProject("default_project");
    }

    const items = listKnownProjectIds().map((projectId) => persistProjectState(projectId));

    return {
      active_project_id: readActiveProjectId(),
      items
    };
  }

  function getProjectConversationHistory(body = {}) {
    const projectId =
      typeof body.project_id === "string" && body.project_id.trim() !== ""
        ? body.project_id.trim()
        : readActiveProjectId();

    return {
      ok: true,
      project_id: normalizeProjectId(projectId),
      items: readProjectConversationHistory(projectId)
    };
  }

  function getProjectOutputFile(body = {}) {
    const projectId = normalizeProjectId(body.project_id || readActiveProjectId());
    const requestedPath = String(body.path || "").trim().replace(/\\/g, "/");
    const deliverySummary = buildDeliverySummary(projectId);
    const outputFiles = Array.isArray(deliverySummary.output_files) ? deliverySummary.output_files : [];

    if (!requestedPath || !outputFiles.includes(requestedPath)) {
      return {
        ok: false,
        reason: "OUTPUT_FILE_NOT_IN_CURRENT_DELIVERY",
        delivery_summary: deliverySummary
      };
    }

    const outputAbs = getProjectOutputAbs(projectId);
    const fileAbs = path.resolve(outputAbs, requestedPath);

    if (!fileAbs.startsWith(outputAbs + path.sep) && fileAbs !== outputAbs) {
      return {
        ok: false,
        reason: "OUTPUT_FILE_PATH_OUTSIDE_PROJECT",
        delivery_summary: deliverySummary
      };
    }

    if (!fs.existsSync(fileAbs) || !fs.statSync(fileAbs).isFile()) {
      return {
        ok: false,
        reason: "OUTPUT_FILE_NOT_FOUND",
        delivery_summary: deliverySummary
      };
    }

    return {
      ok: true,
      project_id: projectId,
      path: requestedPath,
      content: readTextSafe(fileAbs),
      delivery_summary: deliverySummary
    };
  }

  function recordProjectConversationTurn(body = {}) {
    const projectId =
      typeof body.project_id === "string" && body.project_id.trim() !== ""
        ? body.project_id.trim()
        : readActiveProjectId();

    const entry = appendProjectConversationTurn(projectId, body.turn || body);
    const state = persistProjectState(projectId);

    return {
      ok: true,
      project_id: normalizeProjectId(projectId),
      entry,
      project: state
    };
  }

  function createProject(body = {}) {
    const projectName = normalizeProjectName(body.project_name);
    const baseProjectId = buildProjectId(body.project_id, projectName);

    let projectId = baseProjectId;
    let suffix = 1;

    while (fs.existsSync(getProjectArtifactsRoot(projectId))) {
      projectId = `${baseProjectId}_${suffix}`;
      suffix += 1;
    }

    writeActiveProject(projectId);

    const state = persistProjectState(projectId, {
      project_name: projectName,
      project_status: "ACTIVE"
    });

    return {
      ok: true,
      created: true,
      active_project_id: projectId,
      project: state
    };
  }

  function deleteProject(body = {}) {
    const rawProjectId = typeof body.project_id === "string" ? body.project_id.trim() : "";

    if (!rawProjectId) {
      return {
        ok: false,
        reason: "PROJECT_ID_REQUIRED"
      };
    }

    const projectId = normalizeProjectId(rawProjectId);
    const projectRootAbs = path.resolve(projectsRoot, projectId);
    const resolvedProjectsRoot = path.resolve(projectsRoot);

    if (!projectRootAbs.startsWith(`${resolvedProjectsRoot}${path.sep}`)) {
      return {
        ok: false,
        reason: "PROJECT_PATH_OUTSIDE_PROJECTS_ROOT",
        project_id: projectId
      };
    }

    stopProjectAppServer({ project_id: projectId });

    const existed = fs.existsSync(projectRootAbs);
    if (existed) {
      fs.rmSync(projectRootAbs, { recursive: true, force: true });
    }

    const remainingProjectIds = fs.existsSync(projectsRoot)
      ? fs.readdirSync(projectsRoot, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
          .filter((id) => id && id !== projectId)
      : [];
    const previousActiveProjectId = readActiveProjectId();
    const nextActiveProjectId = previousActiveProjectId === projectId
      ? (remainingProjectIds[0] || "default_project")
      : previousActiveProjectId;

    writeActiveProject(nextActiveProjectId);
    const activeProject = persistProjectState(nextActiveProjectId);

    return {
      ok: true,
      deleted: existed,
      project_id: projectId,
      deleted_path: path.relative(root, projectRootAbs).replace(/\\/g, "/"),
      active_project_id: nextActiveProjectId,
      project: activeProject,
      projects: listProjects().items
    };
  }

  function getProjectArtifactsRoot(projectIdInput) {
    return path.resolve(root, "artifacts", "projects", normalizeProjectId(projectIdInput));
  }

  function getProjectDecisionLinksRoot(projectIdInput) {
    return path.join(getProjectArtifactsRoot(projectIdInput), "ai", "decision_links");
  }

  function getProjectDecisionLinksRel(projectIdInput, linkId) {
    return `artifacts/projects/${normalizeProjectId(projectIdInput)}/ai/decision_links/${linkId}.json`;
  }

  function getProjectExecutionPackageRel(projectIdInput) {
    return `artifacts/projects/${normalizeProjectId(projectIdInput)}/execute/execution_package.json`;
  }

  function getProjectExecutionPackageAbs(projectIdInput) {
    return path.resolve(root, getProjectExecutionPackageRel(projectIdInput));
  }

  function getProjectOutputRel(projectIdInput) {
    return `artifacts/projects/${normalizeProjectId(projectIdInput)}/output`;
  }

  function getProjectOutputAbs(projectIdInput) {
    return path.resolve(root, getProjectOutputRel(projectIdInput));
  }

  function getProjectOutputAppRelativePath(projectIdInput) {
    return `${getProjectOutputRel(projectIdInput)}/app`;
  }

  function getProjectOutputAppDir(projectIdInput) {
    return path.resolve(root, getProjectOutputAppRelativePath(projectIdInput));
  }

  function getProjectOutputAppAbs(projectIdInput) {
    return getProjectOutputAppDir(projectIdInput);
  }

  function normalizeFileInsideOutputApp(fileInsideApp = "index.html") {
    const normalized = String(fileInsideApp || "index.html")
      .replace(/\\/g, "/")
      .replace(/^\/+/, "")
      .replace(/^app\/+/i, "");

    return normalized || "index.html";
  }

  function getAppPreviewUrl(projectIdInput, fileInsideApp = "index.html") {
    const projectId = normalizeProjectId(projectIdInput);
    const safeFile = normalizeFileInsideOutputApp(fileInsideApp);

    return `http://localhost:3000/outputs/${encodeURIComponent(projectId)}/app/${safeFile.split("/").map(encodeURIComponent).join("/")}`;
  }

  function getProjectAppPreviewUrl(projectIdInput, fileInsideApp = "index.html") {
    return getAppPreviewUrl(projectIdInput, fileInsideApp);
  }

  function getProjectAppRuntimeAbs(projectIdInput) {
    return path.join(getProjectOutputAppAbs(projectIdInput), "app_runtime.json");
  }

  function getStaticPreviewUrl(projectIdInput) {
    const indexAbs = path.join(getProjectOutputAppAbs(projectIdInput), "index.html");
    return fs.existsSync(indexAbs) ? getAppPreviewUrl(projectIdInput, "index.html") : "";
  }

  function getServerAppUrl(portValue) {
    const portNumber = Number(portValue);
    return Number.isInteger(portNumber) && portNumber > 0 ? `http://localhost:${portNumber}` : "";
  }

  function readAppRuntime(projectIdInput) {
    const runtime = readJsonSafe(getProjectAppRuntimeAbs(projectIdInput), {});
    return runtime && typeof runtime === "object" ? runtime : {};
  }

  function writeAppRuntime(projectIdInput, payload) {
    const runtimeAbs = getProjectAppRuntimeAbs(projectIdInput);
    ensureDir(path.dirname(runtimeAbs));
    fs.writeFileSync(runtimeAbs, JSON.stringify(payload, null, 2), "utf8");
    return payload;
  }

  function isPortAvailable(portValue) {
    const portNumber = Number(portValue);
    return new Promise((resolve) => {
      const tester = net.createServer()
        .once("error", () => resolve(false))
        .once("listening", () => {
          tester.close(() => resolve(true));
        });
      tester.listen(portNumber, "127.0.0.1");
    });
  }

  async function allocateAppPort(projectIdInput) {
    const projectId = normalizeProjectId(projectIdInput);
    const reservedPorts = new Set([3000, 3100, port]);
    const numericHint = Array.from(projectId).reduce((sum, char) => sum + char.charCodeAt(0), 0) % 100;
    let candidate = 3210 + numericHint;

    for (let attempts = 0; attempts < 300; attempts += 1) {
      if (!reservedPorts.has(candidate) && await isPortAvailable(candidate)) {
        return candidate;
      }
      candidate += 1;
    }

    throw new Error("NO_AVAILABLE_APP_PORT");
  }

  function httpHealthCheck(urlValue, timeoutMs = 5000) {
    return new Promise((resolve) => {
      const target = new URL(urlValue);
      const req = http.request({
        hostname: target.hostname,
        port: target.port,
        path: target.pathname || "/",
        method: "GET",
        timeout: timeoutMs
      }, (res) => {
        res.resume();
        resolve(res.statusCode >= 200 && res.statusCode < 500);
      });

      req.on("timeout", () => {
        req.destroy();
        resolve(false);
      });
      req.on("error", () => resolve(false));
      req.end();
    });
  }

  async function waitForAppReady(projectId, child, fallbackUrl, logs, timeoutMs = 25000) {
    const startedAt = Date.now();
    let readyUrl = "";

    while (Date.now() - startedAt < timeoutMs) {
      const joinedLogs = logs.join("\n");
      const match = joinedLogs.match(/APP_READY_URL=(https?:\/\/[^\s]+)/);
      if (match && match[1]) {
        readyUrl = match[1].trim();
      }

      const runtime = readAppRuntime(projectId);
      if (!readyUrl && runtime && runtime.app_url) {
        readyUrl = String(runtime.app_url || "").trim();
      }

      const candidate = readyUrl || fallbackUrl;
      if (candidate && await httpHealthCheck(candidate, 1200)) {
        return candidate;
      }

      if (child.exitCode !== null) {
        return "";
      }

      await new Promise((resolve) => setTimeout(resolve, 600));
    }

    return "";
  }

  function repairNestedOutputAppDir(projectIdInput) {
    const appAbs = getProjectOutputAppAbs(projectIdInput);
    const nestedAppAbs = path.join(appAbs, "app");

    if (!fs.existsSync(nestedAppAbs) || !fs.statSync(nestedAppAbs).isDirectory()) {
      return;
    }

    fs.readdirSync(nestedAppAbs, { withFileTypes: true }).forEach((entry) => {
      const fromAbs = path.join(nestedAppAbs, entry.name);
      const toAbs = path.join(appAbs, entry.name);

      if (!fs.existsSync(toAbs)) {
        fs.renameSync(fromAbs, toAbs);
      }
    });

    if (fs.readdirSync(nestedAppAbs).length === 0) {
      fs.rmdirSync(nestedAppAbs);
    }
  }

  function openProjectOutputFolder(body = {}) {
    const projectId = normalizeProjectId(body.project_id || readActiveProjectId());
    const projectRootAbs = path.resolve(projectsRoot, projectId);
    const targetAbs = getProjectOutputAppAbs(projectId);
    const resolvedTarget = path.resolve(targetAbs);
    const resolvedProjectRoot = path.resolve(projectRootAbs);

    if (!(resolvedTarget === resolvedProjectRoot || resolvedTarget.startsWith(`${resolvedProjectRoot}${path.sep}`))) {
      return {
        ok: false,
        opened: false,
        mode: "OPEN_OUTPUT_FOLDER_BLOCKED",
        reason: "TARGET_OUTSIDE_PROJECT_ROOT",
        project_id: projectId,
        absolute_path: resolvedTarget
      };
    }

    if (!fs.existsSync(resolvedTarget)) {
      return {
        ok: false,
        opened: false,
        mode: "OUTPUT_FOLDER_NOT_FOUND",
        reason: "OUTPUT_FOLDER_NOT_FOUND",
        project_id: projectId,
        output_folder: path.relative(root, resolvedTarget).replace(/\\/g, "/"),
        absolute_path: resolvedTarget,
        message: "Output folder was not found for this project."
      };
    }

    const outputFolder = path.relative(root, resolvedTarget).replace(/\\/g, "/");

    if (process.platform !== "win32") {
      return {
        ok: false,
        opened: false,
        mode: "OPEN_OUTPUT_FOLDER_UNAVAILABLE",
        reason: "UNSUPPORTED_PLATFORM",
        project_id: projectId,
        output_folder: outputFolder,
        absolute_path: resolvedTarget,
        message: "Opening the output folder is only enabled for local Windows workspace runs."
      };
    }

    execFile("explorer", [resolvedTarget], { windowsHide: true }, () => {});

    return {
      ok: true,
      opened: true,
      mode: "OPEN_OUTPUT_FOLDER_OPENED",
      project_id: projectId,
      output_folder: outputFolder,
      absolute_path: resolvedTarget,
      message: "Output folder was opened."
    };
  }

  async function runProjectOutputAppServer(body = {}) {
    const projectId = normalizeProjectId(body.project_id || readActiveProjectId());
    const appAbs = getProjectOutputAppAbs(projectId);
    const packageAbs = path.join(appAbs, "package.json");
    const existing = appServerProcesses.get(projectId);

    if (existing && existing.child && existing.child.exitCode === null && existing.app_url && await httpHealthCheck(existing.app_url, 1200)) {
      return {
        ok: true,
        already_running: true,
        running: true,
        project_id: projectId,
        app_url: existing.app_url,
        port: existing.port,
        absolute_path: appAbs
      };
    }

    appServerProcesses.delete(projectId);

    if (!fs.existsSync(appAbs) || !fs.statSync(appAbs).isDirectory()) {
      return {
        ok: false,
        running: false,
        reason: "OUTPUT_APP_FOLDER_NOT_FOUND",
        project_id: projectId,
        absolute_path: appAbs
      };
    }

    if (!fs.existsSync(packageAbs)) {
      return {
        ok: false,
        running: false,
        reason: "PACKAGE_JSON_NOT_FOUND",
        project_id: projectId,
        absolute_path: appAbs,
        message: "This output appears to be static. Use app_preview_url instead."
      };
    }

    const scripts = readPackageScripts(packageAbs);
    const startCommand = scripts.start ? String(scripts.start) : "";

    if (!startCommand) {
      return {
        ok: false,
        running: false,
        reason: "NPM_START_SCRIPT_NOT_FOUND",
        project_id: projectId,
        absolute_path: appAbs,
        logs: ["package.json does not define scripts.start."]
      };
    }

    const logs = [];
    const spawnNpmAction = (action, options = {}) => {
      if (process.platform === "win32") {
        return spawn(`npm ${action}`, [], {
          ...options,
          windowsHide: true,
          shell: true
        });
      }

      return spawn("npm", [action], {
        ...options,
        windowsHide: true,
        shell: false
      });
    };
    const nodeModulesAbs = path.join(appAbs, "node_modules");

    try {
      if (!fs.existsSync(nodeModulesAbs)) {
        const installResult = await new Promise((resolve) => {
          const installer = spawnNpmAction("install", {
            cwd: appAbs
          });

          installer.stdout.on("data", (chunk) => logs.push(String(chunk)));
          installer.stderr.on("data", (chunk) => logs.push(String(chunk)));
          installer.on("error", (err) => resolve({ ok: false, error: err.message }));
          installer.on("close", (code) => resolve({ ok: code === 0, code }));
        });

        if (!installResult.ok) {
          return {
            ok: false,
            running: false,
            reason: installResult.error || `NPM_INSTALL_FAILED_${installResult.code}`,
            logs: logs.join("").slice(-4000),
            absolute_path: appAbs
          };
        }
      }

      const allocatedPort = await allocateAppPort(projectId);
      const fallbackUrl = getServerAppUrl(allocatedPort);
      const child = spawnNpmAction("start", {
        cwd: appAbs,
        env: {
          ...process.env,
          PORT: String(allocatedPort),
          BROWSER: "none",
          HOST: "127.0.0.1"
        }
      });

      child.stdout.on("data", (chunk) => {
        const text = String(chunk);
        logs.push(text);
      });
      child.stderr.on("data", (chunk) => {
        const text = String(chunk);
        logs.push(text);
      });
      child.on("exit", () => {
        const current = appServerProcesses.get(projectId);
        if (current && current.child === child) {
          appServerProcesses.delete(projectId);
        }
      });

      appServerProcesses.set(projectId, {
        child,
        port: allocatedPort,
        app_url: fallbackUrl,
        logs,
        absolute_path: appAbs
      });

      const appUrl = await waitForAppReady(projectId, child, fallbackUrl, logs);

      if (!appUrl) {
        return {
          ok: false,
          running: child.exitCode === null,
          reason: child.exitCode === null ? "APP_HEALTH_CHECK_FAILED" : `APP_PROCESS_EXITED_${child.exitCode}`,
          logs: logs.join("").slice(-4000),
          absolute_path: appAbs
        };
      }

      writeAppRuntime(projectId, {
        running: true,
        port: allocatedPort,
        app_url: appUrl,
        started_at: new Date().toISOString()
      });

      const project = persistProjectState(projectId, {
        delivery_summary: buildDeliverySummary(projectId)
      });

      return {
        ok: true,
        running: true,
        already_running: false,
        project_id: projectId,
        absolute_path: appAbs,
        app_url: appUrl,
        port: allocatedPort,
        project,
        delivery_summary: project.delivery_summary,
        logs: logs.join("").slice(-2000)
      };
    } catch (err) {
      return {
        ok: false,
        running: false,
        reason: err && err.message ? err.message : "APP_SERVER_START_FAILED",
        logs: logs.join("").slice(-4000),
        absolute_path: appAbs
      };
    }
  }

  function stopProjectAppServer(body = {}) {
    const projectId = normalizeProjectId(body.project_id || readActiveProjectId());
    const existing = appServerProcesses.get(projectId);

    if (!existing || !existing.child || existing.child.exitCode !== null) {
      appServerProcesses.delete(projectId);
      writeAppRuntime(projectId, {
        running: false,
        stopped_at: new Date().toISOString()
      });
      return {
        ok: true,
        stopped: false,
        already_stopped: true,
        project_id: projectId,
        message: "No running app server was registered for this project."
      };
    }

    if (process.platform === "win32" && existing.child.pid) {
      spawnSync("taskkill", ["/PID", String(existing.child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore"
      });
    } else {
      existing.child.kill();
    }
    appServerProcesses.delete(projectId);
    writeAppRuntime(projectId, {
      running: false,
      port: existing.port,
      app_url: existing.app_url,
      stopped_at: new Date().toISOString()
    });

    const project = persistProjectState(projectId, {
      delivery_summary: buildDeliverySummary(projectId)
    });

    return {
      ok: true,
      stopped: true,
      project_id: projectId,
      app_url: existing.app_url,
      port: existing.port,
      absolute_path: existing.absolute_path,
      project,
      delivery_summary: project.delivery_summary
    };
  }

  function getCleanupTargets(modeInput) {
    const mode = String(modeInput || "").trim();
    const targets = [];

    if (mode === "default_project_only") {
      ["output", "execute", "ai_os"].forEach((name) => {
        targets.push(path.join(projectsRoot, "default_project", name));
      });
    } else if (mode === "test_projects") {
      if (fs.existsSync(projectsRoot)) {
        fs.readdirSync(projectsRoot, { withFileTypes: true })
          .filter((entry) => entry.isDirectory() && /^memory_test_/i.test(entry.name))
          .forEach((entry) => targets.push(path.join(projectsRoot, entry.name)));
      }
    } else {
      throw new Error("INVALID_CLEANUP_MODE");
    }

    const resolvedProjectsRoot = path.resolve(projectsRoot);
    return targets.map((targetAbs) => path.resolve(targetAbs)).filter((targetAbs) =>
      targetAbs.startsWith(`${resolvedProjectsRoot}${path.sep}`)
    );
  }

  function cleanupTestArtifacts(body = {}) {
    const mode = String(body.mode || "").trim();
    const dryRun = body.dry_run !== false;
    const targets = getCleanupTargets(mode);
    const existingTargets = targets.filter((targetAbs) => fs.existsSync(targetAbs));

    if (!dryRun) {
      if (mode === "default_project_only") {
        stopProjectAppServer({ project_id: "default_project" });
      }
      if (mode === "test_projects") {
        existingTargets.forEach((targetAbs) => {
          stopProjectAppServer({ project_id: path.basename(targetAbs) });
        });
      }

      existingTargets.forEach((targetAbs) => {
        fs.rmSync(targetAbs, { recursive: true, force: true });
      });

      if (mode === "default_project_only") {
        persistProjectState("default_project", {
          delivery_state: "NOT_READY",
          delivery_summary: null,
          current_delivery_type: "",
          current_delivery_state: "UNKNOWN",
          current_output_files: []
        });
      }
    }

    return {
      ok: true,
      mode,
      dry_run: dryRun,
      deleted: dryRun ? [] : existingTargets.map((targetAbs) => path.relative(root, targetAbs).replace(/\\/g, "/")),
      targets: existingTargets.map((targetAbs) => path.relative(root, targetAbs).replace(/\\/g, "/")),
      protected_roots: ["code/", "docs/", "architecture/", "progress/", "artifacts/forge/"]
    };
  }

  function isRequirementsFollowupActionText(value) {
    const normalized = String(value || "")
      .trim()
      .toLowerCase()
      .replace(/^\s*-\s*/, "")
      .replace(/\s+/g, " ");

    return normalized === "build the runnable application from these requirements" ||
      normalized === "build the application from these requirements" ||
      normalized === "build runnable application from these requirements" ||
      normalized === "build app from these requirements" ||
      normalized === "build the app from these requirements" ||
      normalized === "create a simple local html prototype from these requirements" ||
      normalized === "create local html prototype from these requirements" ||
      normalized === "create a local html prototype from these requirements" ||
      normalized === "show requirement files" ||
      normalized === "show output files" ||
      normalized === "revise the requirements" ||
      normalized === "\u0627\u0628\u0646\u064a \u062a\u0637\u0628\u064a\u0642 \u0642\u0627\u0628\u0644 \u0644\u0644\u062a\u0634\u063a\u064a\u0644 \u0645\u0646 \u0647\u0630\u0647 \u0627\u0644\u0645\u062a\u0637\u0644\u0628\u0627\u062a" ||
      normalized === "\u0627\u0628\u0646\u064a \u0627\u0644\u062a\u0637\u0628\u064a\u0642 \u0645\u0646 \u0627\u0644\u0645\u062a\u0637\u0644\u0628\u0627\u062a" ||
      normalized === "\u0627\u0628\u0646\u064a \u062a\u0637\u0628\u064a\u0642 \u0645\u0646 \u0627\u0644\u0645\u062a\u0637\u0644\u0628\u0627\u062a" ||
      normalized === "\u062d\u0648\u0644 \u0627\u0644\u0645\u062a\u0637\u0644\u0628\u0627\u062a \u0644\u062a\u0637\u0628\u064a\u0642" ||
      normalized === "\u0625\u0646\u0634\u0627\u0621 \u0642\u0627\u0644\u0628 html \u0645\u062d\u0644\u064a \u0628\u0633\u064a\u0637 \u0645\u0646 \u0627\u0644\u0645\u062a\u0637\u0644\u0628\u0627\u062a" ||
      normalized === "\u0627\u0646\u0634\u0627\u0621 \u0642\u0627\u0644\u0628 html \u0645\u062d\u0644\u064a \u0628\u0633\u064a\u0637 \u0645\u0646 \u0627\u0644\u0645\u062a\u0637\u0644\u0628\u0627\u062a" ||
      normalized === "\u0627\u0639\u0631\u0636 \u0645\u0644\u0641\u0627\u062a \u0627\u0644\u0645\u062a\u0637\u0644\u0628\u0627\u062a" ||
      normalized === "\u0639\u062f\u0644 \u0627\u0644\u0645\u062a\u0637\u0644\u0628\u0627\u062a";
  }

  function isBuildRunnableRequirementsFollowupText(value) {
    const normalized = String(value || "")
      .trim()
      .toLowerCase()
      .replace(/^\s*-\s*/, "")
      .replace(/\s+/g, " ");

    return normalized === "build the runnable application from these requirements" ||
      normalized === "build the application from these requirements" ||
      normalized === "build runnable application from these requirements" ||
      normalized === "build app from these requirements" ||
      normalized === "build the app from these requirements" ||
      normalized === "\u0627\u0628\u0646\u064a \u062a\u0637\u0628\u064a\u0642 \u0642\u0627\u0628\u0644 \u0644\u0644\u062a\u0634\u063a\u064a\u0644 \u0645\u0646 \u0647\u0630\u0647 \u0627\u0644\u0645\u062a\u0637\u0644\u0628\u0627\u062a" ||
      normalized === "\u0627\u0628\u0646\u064a \u0627\u0644\u062a\u0637\u0628\u064a\u0642 \u0645\u0646 \u0627\u0644\u0645\u062a\u0637\u0644\u0628\u0627\u062a" ||
      normalized === "\u0627\u0628\u0646\u064a \u062a\u0637\u0628\u064a\u0642 \u0645\u0646 \u0627\u0644\u0645\u062a\u0637\u0644\u0628\u0627\u062a" ||
      normalized === "\u062d\u0648\u0644 \u0627\u0644\u0645\u062a\u0637\u0644\u0628\u0627\u062a \u0644\u062a\u0637\u0628\u064a\u0642";
  }

  function listOutputFiles(outputAbs, currentAbs = outputAbs, depth = 0) {
    if (!fs.existsSync(currentAbs) || depth > 6) {
      return [];
    }

    return fs.readdirSync(currentAbs, { withFileTypes: true }).flatMap((entry) => {
      const entryAbs = path.join(currentAbs, entry.name);

      if (entry.isDirectory()) {
        return listOutputFiles(outputAbs, entryAbs, depth + 1);
      }

      if (!entry.isFile()) {
        return [];
      }

      return [path.relative(outputAbs, entryAbs).replace(/\\/g, "/")];
    });
  }

  function readPackageScripts(packageAbs) {
    const packageJson = readJsonSafe(packageAbs, null);

    if (!packageJson || typeof packageJson !== "object" || !packageJson.scripts || typeof packageJson.scripts !== "object") {
      return {};
    }

    return Object.keys(packageJson.scripts).reduce((acc, key) => {
      if (typeof packageJson.scripts[key] === "string") {
        acc[key] = packageJson.scripts[key];
      }
      return acc;
    }, {});
  }

  function buildDeliverySummary(projectIdInput) {
    const projectId = normalizeProjectId(projectIdInput);
    repairNestedOutputAppDir(projectId);
    const outputRel = getProjectOutputRel(projectId);
    const outputAbs = getProjectOutputAbs(projectId);
    const executionPackage = readJsonSafe(getProjectExecutionPackageAbs(projectId), null);
    const projectState = readJsonSafe(getProjectStateAbs(projectId), {});
    const executionId = String(executionPackage && executionPackage.execution_id ? executionPackage.execution_id : "").trim();
    const packageId = String(executionPackage && executionPackage.package_id ? executionPackage.package_id : "").trim();
    const proposedFiles =
      executionPackage &&
      executionPackage.execution_plan &&
      Array.isArray(executionPackage.execution_plan.proposed_files)
        ? executionPackage.execution_plan.proposed_files
        : [];
    const expectedOutputFiles = proposedFiles
      .map((file) => String(file && file.path ? file.path : "").trim().replace(/\\/g, "/"))
      .filter((filePath) => filePath.startsWith(`${outputRel}/`))
      .map((filePath) => filePath.slice(outputRel.length + 1).replace(/^app\/app\//i, "app/"));
    const allFiles = listOutputFiles(outputAbs);
    const expectedSet = new Set(expectedOutputFiles.map((file) => file.toLowerCase()));
    const files = expectedSet.size > 0
      ? allFiles.filter((file) => expectedSet.has(file.toLowerCase()))
      : allFiles;
    const lowerFiles = files.map((file) => file.toLowerCase());
    const topLevelEntries = fs.existsSync(outputAbs)
      ? fs.readdirSync(outputAbs, { withFileTypes: true })
      : [];
    const directories = topLevelEntries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    const lowerDirectories = directories.map((name) => name.toLowerCase());

    const findFile = (name) => {
      const target = String(name || "").toLowerCase();
      const index = lowerFiles.findIndex((file) => file === target || file.endsWith(`/${target}`));
      return index >= 0 ? files[index] : "";
    };

    const indexHtml = findFile("index.html");
    const packageJson = findFile("package.json");
    const serverJs = findFile("server.js");
    const appJs = findFile("app.js");
    const mainPy = findFile("main.py");
    const appPy = findFile("app.py");
    const requirementsTxt = findFile("requirements.txt");
    const runBat = findFile("run.bat");
    const openAppBat = findFile("open_app.bat");
    const readme = findFile("readme.md");
    const readmeText = readme ? readTextSafe(path.join(outputAbs, readme)).toLowerCase() : "";
    const readmeHasRunInstructions = Boolean(
      readme &&
      (
        readmeText.includes("npm ") ||
        readmeText.includes("run ") ||
        readmeText.includes("start") ||
        readmeText.includes("open ") ||
        readmeText.includes("تشغيل") ||
        readmeText.includes("افتح")
      )
    );
    const hasSrc = lowerDirectories.includes("src") || lowerFiles.some((file) => file.startsWith("src/") || file.includes("/src/"));
    const hasDistOrBuildIndex = lowerFiles.some((file) =>
      (file.startsWith("dist/") || file.includes("/dist/") || file.startsWith("build/") || file.includes("/build/")) &&
      file.endsWith("/index.html")
    );
    const hasPythonEntrypoint = Boolean(mainPy || appPy);
    const hasNodeEntrypoint = Boolean(packageJson || serverJs || appJs);
    const hasStaticEntrypoint = Boolean(indexHtml || hasDistOrBuildIndex);

    const runnableIndicators = [
      indexHtml ? "index.html" : "",
      packageJson ? "package.json" : "",
      serverJs ? "server.js" : "",
      appJs ? "app.js" : "",
      mainPy ? "main.py" : "",
      appPy ? "app.py" : "",
      requirementsTxt && hasPythonEntrypoint ? "requirements.txt" : "",
      hasSrc && packageJson ? "src/" : "",
      hasDistOrBuildIndex ? "dist/build index.html" : ""
    ].filter(Boolean);

    const currentExecutionOutputFound = files.length > 0;
    const mdFiles = files.filter((file) => file.toLowerCase().endsWith(".md"));
    const intentText = [
      projectState.user_goal,
      projectState.project_name,
      projectState.business_goal,
      projectState.technical_goal,
      projectState.requirement_domain,
      executionPackage && executionPackage.approved_scope && executionPackage.approved_scope.summary,
      executionPackage && executionPackage.business_and_scope_decisions && executionPackage.business_and_scope_decisions.user_goal,
      files.join(" ")
    ].map((value) => String(value || "")).join(" ").toLowerCase();
    const documentIntentPattern = /(مقترح|وثيقة|خطة|متطلبات|proposal|document|documentation|plan|requirements)/i;
    const buildIntentPattern = /(ابني|اعمل|تطبيق|سيستم|نظام|قابل للتشغيل|build app|create app|build system|create system|runnable)/i;
    const hasDocumentIntent = documentIntentPattern.test(intentText);
    const hasBuildIntent = buildIntentPattern.test(intentText);
    const requirementPackageNames = new Set([
      "requirements.md",
      "requirements.json",
      "execution_plan.json",
      "provider_requirements_model.json",
      "project_metadata.json",
      "deployment_plan.md",
      "specification.md"
    ]);
    const requirementArtifactPattern = /(^|\/)(readme\.md|project_metadata\.json|deployment_plan\.md|execution_plan\.md|security_guidelines\.md|specification\.md|requirements\.(json|md)|.*_requirements\.json|.*_execution_plan\.md|.*_security_guidelines\.md|.*_specification\.md)$/i;
    const hasOnlyRequirementsPackage =
      currentExecutionOutputFound &&
      files.every((file) => {
        const normalized = file.toLowerCase();
        return Array.from(requirementPackageNames).some((suffix) => normalized.endsWith(suffix)) ||
          requirementArtifactPattern.test(file);
      });
    const hasRealRunnableEntrypoint =
      hasStaticEntrypoint ||
      hasNodeEntrypoint ||
      hasPythonEntrypoint ||
      Boolean(requirementsTxt && hasPythonEntrypoint) ||
      Boolean(hasSrc && packageJson);
    const hasRunnableApplication = currentExecutionOutputFound && !hasOnlyRequirementsPackage && hasRealRunnableEntrypoint;
    const hasOnlyDocsOrData =
      currentExecutionOutputFound &&
      files.every((file) => {
        const normalized = file.toLowerCase();
        return normalized.endsWith(".md") || normalized.endsWith(".json") || normalized.endsWith(".txt");
      });
    const hasDocumentDelivery =
      currentExecutionOutputFound &&
      !hasRunnableApplication &&
      mdFiles.length > 0 &&
      hasDocumentIntent &&
      (!hasBuildIntent || intentText.includes("مقترح") || intentText.includes("proposal") || intentText.includes("وثيقة") || intentText.includes("document"));
    const detectedDeliveryType = hasRunnableApplication
      ? "RUNNABLE_APPLICATION"
      : hasOnlyRequirementsPackage || (hasOnlyDocsOrData && hasBuildIntent)
          ? "REQUIREMENTS_PACKAGE"
          : hasDocumentDelivery
            ? "DOCUMENT_DELIVERY"
            : currentExecutionOutputFound && files.every((file) => /(^|\/).*(report|log|summary).*\.(md|json|txt)$/i.test(file))
              ? "REPORTS_ONLY"
              : currentExecutionOutputFound
                ? "UNKNOWN_ARTIFACTS"
              : "UNKNOWN_ARTIFACTS";
    const outputTypes = [];

    if (indexHtml) {
      outputTypes.push("HTML_STATIC_APP");
    }
    if (packageJson) {
      outputTypes.push("NODE_PACKAGE");
    }
    if (runBat || openAppBat) {
      outputTypes.push("WINDOWS_QUICK_LAUNCH");
    }
    if (serverJs || appJs) {
      outputTypes.push("NODE_SERVER");
    }
    if (hasSrc) {
      outputTypes.push("SOURCE_TREE");
    }
    if (readme) {
      outputTypes.push("README");
    }
    if (hasDocumentDelivery) {
      outputTypes.push("DOCUMENT_DELIVERY");
    }
    if (detectedDeliveryType === "REQUIREMENTS_PACKAGE") {
      outputTypes.push("REQUIREMENTS_PACKAGE");
    }
    if (!currentExecutionOutputFound && expectedOutputFiles.length > 0) {
      outputTypes.push("NO_CURRENT_EXECUTION_OUTPUT_FILES");
    }
    if (
      !hasRunnableApplication &&
      currentExecutionOutputFound &&
      detectedDeliveryType !== "DOCUMENT_DELIVERY" &&
      detectedDeliveryType !== "REQUIREMENTS_PACKAGE"
    ) {
      outputTypes.push("PACKAGE_OR_REPORT_FILES");
    }
    if (allFiles.length === 0) {
      outputTypes.push("NO_OUTPUT_FILES");
    }

    const runInstructions = [];
    const appOutputPath = getProjectOutputAppRelativePath(projectId);
    const absoluteOutputPath = outputAbs;
    const absoluteAppOutputPath = getProjectOutputAppAbs(projectId);
    const previewIndexFile = indexHtml || files.find((file) => String(file || "").toLowerCase().endsWith("/index.html")) || "";
    const previewFileInsideApp = normalizeFileInsideOutputApp(previewIndexFile);
    const appPreviewUrl = previewIndexFile ? getProjectAppPreviewUrl(projectId, previewFileInsideApp || "index.html") : "";
    const runtimeState = readAppRuntime(projectId);
    const serverAppUrl = runtimeState && runtimeState.running === true && runtimeState.app_url
      ? String(runtimeState.app_url || "")
      : "";
    const appRuntimeType = appPreviewUrl
      ? "STATIC_HTML"
      : packageJson || serverJs || appJs
        ? "NODE_SERVER"
        : "UNKNOWN";
    const deliveryType = detectedDeliveryType === "RUNNABLE_APPLICATION" && !appPreviewUrl && !serverAppUrl
      ? "SERVER_START_REQUIRED"
      : detectedDeliveryType;

    if (detectedDeliveryType === "RUNNABLE_APPLICATION") {
      runInstructions.push(`Application folder: ${appOutputPath}`);
      if (appPreviewUrl && appRuntimeType === "STATIC_HTML") {
        runInstructions.push(`Open the application preview: ${appPreviewUrl}`);
      }
      if (runBat) {
        runInstructions.push(`Quick start on Windows: double-click ${outputRel}/${runBat}`);
      }
      if (openAppBat) {
        runInstructions.push(`Quick open on Windows: double-click ${outputRel}/${openAppBat}`);
      }
      runInstructions.push("Prototype note: This is a prototype built from requirements, not a production system.");
    }

    if (indexHtml) {
      runInstructions.push(`Open this file in the browser: ${outputRel}/${indexHtml}`);
    } else if (hasDistOrBuildIndex) {
      const distIndex = files.find((file) => {
        const normalized = String(file || "").toLowerCase();
        return (normalized.startsWith("dist/") || normalized.includes("/dist/") || normalized.startsWith("build/") || normalized.includes("/build/")) &&
          normalized.endsWith("/index.html");
      });
      if (distIndex) {
        runInstructions.push(`Open this file in the browser: ${outputRel}/${distIndex}`);
      }
    }

    if (packageJson) {
      const scripts = readPackageScripts(path.join(outputAbs, packageJson));
      runInstructions.push(`From this folder run: cd ${path.dirname(`${outputRel}/${packageJson}`).replace(/\\/g, "/")}`);
      runInstructions.push("npm install");

      if (scripts.start) {
        runInstructions.push("npm start");
      } else {
        const firstScript = Object.keys(scripts)[0] || "";
        runInstructions.push(firstScript ? `npm run ${firstScript}` : "No npm start script was found in package.json.");
      }
    }

    if (mainPy) {
      runInstructions.push(`From this folder run: cd ${path.dirname(`${outputRel}/${mainPy}`).replace(/\\/g, "/")}`);
      if (requirementsTxt) {
        runInstructions.push("pip install -r requirements.txt");
      }
      runInstructions.push("python main.py");
    } else if (appPy) {
      runInstructions.push(`From this folder run: cd ${path.dirname(`${outputRel}/${appPy}`).replace(/\\/g, "/")}`);
      if (requirementsTxt) {
        runInstructions.push("pip install -r requirements.txt");
      }
      runInstructions.push("python app.py");
    }

    if (!currentExecutionOutputFound) {
      runInstructions.push("No output files linked to the current execution were found.");
    } else if (deliveryType === "DOCUMENT_DELIVERY") {
      const firstDoc = mdFiles[0] || files[0];
      runInstructions.push("Open and review the generated document/proposal.");
      if (firstDoc) {
        runInstructions.push(`Document path: ${outputRel}/${firstDoc}`);
      }
      runInstructions.push("You can then request building the application based on it.");
    } else if (deliveryType === "REQUIREMENTS_PACKAGE") {
      runInstructions.push("A requirements package and execution plan were created, not a runnable application.");
    } else if (!hasRunnableApplication) {
      runInstructions.push("No runnable application was detected in the current execution output.");
    }

    return {
      project_id: projectId,
      project_name: normalizeProjectName(projectState.project_name || projectState.original_user_goal || projectState.user_goal || projectId),
      language: String(projectState.primary_language || "").toUpperCase() === "AR" ? "ar" : "en",
      execution_id: executionId,
      package_id: packageId,
      delivery_type: deliveryType,
      output_path: outputRel,
      app_output_path: appOutputPath,
      absolute_output_path: absoluteOutputPath,
      absolute_app_output_path: absoluteAppOutputPath,
      static_preview_url: detectedDeliveryType === "RUNNABLE_APPLICATION" ? appPreviewUrl : "",
      server_app_url: detectedDeliveryType === "RUNNABLE_APPLICATION" ? serverAppUrl : "",
      app_url: detectedDeliveryType === "RUNNABLE_APPLICATION" ? (appPreviewUrl || serverAppUrl) : "",
      app_preview_url: detectedDeliveryType === "RUNNABLE_APPLICATION" ? (appPreviewUrl || serverAppUrl) : "",
      app_runtime_type: detectedDeliveryType === "RUNNABLE_APPLICATION" ? appRuntimeType : "UNKNOWN",
      requires_server: detectedDeliveryType === "RUNNABLE_APPLICATION" && !appPreviewUrl && appRuntimeType === "NODE_SERVER",
      app_server_running: Boolean(serverAppUrl),
      app_server_port: Number.isInteger(Number(runtimeState.port)) ? Number(runtimeState.port) : null,
      quick_launch_files: {
        run_bat: runBat ? `${outputRel}/${runBat}` : "",
        open_app_bat: openAppBat ? `${outputRel}/${openAppBat}` : ""
      },
      output_exists: fs.existsSync(outputAbs),
      current_execution_output_found: currentExecutionOutputFound,
      expected_current_output_files: expectedOutputFiles,
      output_file_count: files.length,
      output_files: files,
      ignored_existing_output_files: allFiles.filter((file) => !files.includes(file)),
      output_types: outputTypes,
      runnable_application_created: deliveryType === "RUNNABLE_APPLICATION",
      runnable_application_detected: detectedDeliveryType === "RUNNABLE_APPLICATION",
      runnable_indicators: runnableIndicators,
      run_instructions: runInstructions,
      usage_or_run_instructions: runInstructions,
      next_suggested_actions: deliveryType === "DOCUMENT_DELIVERY"
        ? [
            "Build the application from this proposal",
            "Revise the proposal",
            "Show the proposal file",
            "Start over",
            "Stop"
          ]
        : deliveryType === "REQUIREMENTS_PACKAGE"
          ? [
              "Build the runnable application from these requirements",
              "Revise the requirements",
              "Show output files"
            ]
          : deliveryType === "RUNNABLE_APPLICATION"
            ? [
                "Run or open the application",
                ...(appRuntimeType === "NODE_SERVER" ? ["Start app server"] : []),
                "Review generated files",
                "Request changes"
              ]
            : deliveryType === "SERVER_START_REQUIRED"
              ? [
                  "Start server and open app",
                  "Review generated files",
                  "Request changes"
                ]
            : [
                "Review output files",
                "Clarify the requested delivery"
              ]
    };
  }

  function buildOpenAppBat() {
    return [
      "@echo off",
      "cd /d \"%~dp0\"",
      "start \"\" \"index.html\"",
      ""
    ].join("\r\n");
  }

  function buildRunBat() {
    return [
      "@echo off",
      "cd /d \"%~dp0\"",
      "echo Installing dependencies...",
      "npm install",
      "echo Starting application...",
      "npm start",
      "pause",
      ""
    ].join("\r\n");
  }

  function appendWindowsQuickStartReadme(content, hasPackageJson, hasIndexHtml) {
    const base = String(content || "").trimEnd();
    const existing = base.toLowerCase();

    if (existing.includes("windows quick start") || existing.includes("تشغيل سريع على windows")) {
      return `${base}\n`;
    }

    const lines = [
      "",
      "## تشغيل سريع على Windows",
      "",
      hasPackageJson ? "- Double click `run.bat` لتثبيت الاعتماديات وتشغيل التطبيق." : "",
      hasIndexHtml ? "- Double click `open_app.bat` لو التطبيق static HTML فقط." : "",
      "",
      "هذا Prototype أولي مبني من المتطلبات، وليس نظام Production كامل.",
      ""
    ].filter((line) => line !== "");

    return `${base}\n${lines.join("\n")}`;
  }

  function withWindowsLauncherFiles(projectIdInput, files) {
    const projectId = normalizeProjectId(projectIdInput);
    const outputBase = getProjectOutputAppRelativePath(projectId);
    const list = Array.isArray(files) ? files.slice() : [];
    const lowerPaths = list.map((file) => String(file && file.path ? file.path : "").toLowerCase().replace(/\\/g, "/"));
    const hasIndexHtml = lowerPaths.some((filePath) => filePath === `${outputBase}/index.html` || filePath.endsWith("/app/index.html"));
    const hasPackageJson = lowerPaths.some((filePath) => filePath === `${outputBase}/package.json` || filePath.endsWith("/app/package.json"));
    const hasReadme = lowerPaths.some((filePath) => filePath === `${outputBase}/readme.md` || filePath.endsWith("/app/readme.md"));

    const upsertFile = (relativePath, content) => {
      const target = `${outputBase}/${relativePath}`;
      const index = list.findIndex((file) => String(file && file.path ? file.path : "").replace(/\\/g, "/") === target);

      if (index >= 0) {
        list[index] = { ...list[index], content, allow_overwrite: true };
      } else {
        list.push({ path: target, content, allow_overwrite: true });
      }
    };

    if (hasPackageJson) {
      upsertFile("run.bat", buildRunBat());
    }

    if (hasIndexHtml) {
      upsertFile("open_app.bat", buildOpenAppBat());
    }

    if (hasPackageJson || hasIndexHtml) {
      const readmeIndex = list.findIndex((file) => String(file && file.path ? file.path : "").toLowerCase().replace(/\\/g, "/").endsWith("/app/readme.md"));
      if (readmeIndex >= 0) {
        list[readmeIndex] = {
          ...list[readmeIndex],
          content: appendWindowsQuickStartReadme(list[readmeIndex].content, hasPackageJson, hasIndexHtml),
          allow_overwrite: true
        };
      } else if (!hasReadme) {
        upsertFile("README.md", appendWindowsQuickStartReadme("# Runnable Prototype\n\nThis is a prototype built from requirements, not a production system.", hasPackageJson, hasIndexHtml));
      }
    }

    return list;
  }

  function normalizeProviderRunnableFiles(projectIdInput, providerFiles) {
    const projectId = normalizeProjectId(projectIdInput);
    const outputBase = getProjectOutputAppRelativePath(projectId);
    const list = Array.isArray(providerFiles) ? providerFiles : [];

    const normalized = list
      .map((file, index) => {
        const rawPath = String(file && file.path ? file.path : "").trim().replace(/\\/g, "/");
        const content = typeof (file && file.content) === "string" ? file.content : "";
        const basename = path.posix.basename(rawPath || `file_${index + 1}.txt`);
        const outputRoot = getProjectOutputRel(projectId);
        const pathInsideApp = rawPath.startsWith(`${outputBase}/`)
          ? rawPath.slice(outputBase.length + 1)
          : rawPath.startsWith(`${outputRoot}/app/`)
            ? rawPath.slice(`${outputRoot}/app/`.length)
            : rawPath.startsWith("app/")
              ? rawPath.slice(4)
              : basename;
        const safeInsideApp = normalizeFileInsideOutputApp(pathInsideApp || basename);
        const scopedPath = `${outputBase}/${safeInsideApp}`;

        return {
          path: scopedPath,
          content,
          allow_overwrite: true
        };
      })
      .filter((file) => file.path && typeof file.content === "string");

    return withWindowsLauncherFiles(projectId, normalized);
  }

  function filesContainRunnableIndicator(files) {
    const normalized = (Array.isArray(files) ? files : [])
      .map((file) => String(file && file.path ? file.path : "").trim().toLowerCase().replace(/\\/g, "/"));

    return normalized.some((filePath) =>
      filePath.endsWith("/index.html") ||
      filePath.endsWith("/package.json") ||
      filePath.endsWith("/server.js") ||
      filePath.endsWith("/app.js") ||
      filePath.includes("/src/")
    );
  }

  function readCurrentRequirementOutputFiles(projectIdInput, deliverySummary) {
    const projectId = normalizeProjectId(projectIdInput);
    const outputAbs = getProjectOutputAbs(projectId);
    const outputRel = getProjectOutputRel(projectId);
    const files = Array.isArray(deliverySummary && deliverySummary.output_files)
      ? deliverySummary.output_files
      : [];

    return files
      .filter((file) => /(_requirements\.json|requirements\.json|_execution_plan\.md|execution_plan\.md|_security_guidelines\.md|security_guidelines\.md|_specification\.md|specification\.md)$/i.test(String(file || "")))
      .map((file) => {
        const rel = String(file || "").replace(/\\/g, "/");
        const abs = path.resolve(outputAbs, rel);
        return {
          path: `${outputRel}/${rel}`,
          name: rel,
          content: readTextSafe(abs)
        };
      })
      .filter((file) => file.content !== "");

    return withWindowsLauncherFiles(projectId, normalized);
  }

  function escapeHtmlText(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function buildLocalPrototypeFiles(projectIdInput, requirementFiles) {
    const projectId = normalizeProjectId(projectIdInput);
    const projectState = readJsonSafe(getProjectStateAbs(projectId), {});
    const executionPackage = readJsonSafe(getProjectExecutionPackageAbs(projectId), {});
    const projectName = normalizeProjectName(
      projectState.project_name ||
      projectState.original_user_goal ||
      (executionPackage && executionPackage.business_and_scope_decisions && executionPackage.business_and_scope_decisions.user_goal) ||
      projectId
    );
    const requirementText = (Array.isArray(requirementFiles) ? requirementFiles : [])
      .map((file) => `Source: ${file.path}\n${file.content}`)
      .join("\n\n---\n\n")
      .slice(0, 30000);
    const safeTitle = escapeHtmlText(projectName || "Runnable Prototype");
    const safeRequirementText = escapeHtmlText(requirementText || "No requirement text was available.");
    const indexHtml = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle} - Prototype</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #f8fafc; color: #111827; }
    header { background: #0f172a; color: #f8fafc; padding: 28px; }
    main { max-width: 1100px; margin: 0 auto; padding: 24px; }
    section { background: #ffffff; border: 1px solid #d1d5db; border-radius: 8px; padding: 18px; margin-bottom: 16px; }
    h1, h2 { margin-top: 0; }
    .notice { border-color: #f59e0b; background: #fffbeb; }
    pre { white-space: pre-wrap; direction: ltr; text-align: left; background: #f1f5f9; padding: 14px; border-radius: 8px; overflow: auto; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
    .card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px; background: #f9fafb; }
  </style>
</head>
<body>
  <header>
    <h1>${safeTitle}</h1>
    <p>Static runnable prototype generated from the approved requirements package.</p>
  </header>
  <main>
    <section class="notice">
      <h2>تنبيه</h2>
      <p>هذا Prototype ثابت مبني من المتطلبات، وليس نظام production كامل.</p>
    </section>
    <section>
      <h2>لوحة تشغيل أولية</h2>
      <div class="grid">
        <div class="card"><strong>Tickets</strong><br />عرض وتتبع طلبات العملاء.</div>
        <div class="card"><strong>Knowledge Base</strong><br />مساحة محتوى مساعدة أولية.</div>
        <div class="card"><strong>Reports</strong><br />مؤشرات أداء تجريبية.</div>
      </div>
    </section>
    <section>
      <h2>Requirements Source</h2>
      <pre>${safeRequirementText}</pre>
    </section>
  </main>
</body>
</html>
`;
    const readme = [
      "# Static Runnable Prototype",
      "",
      "This is a static prototype generated from the approved requirements package.",
      "It is not a production-ready system.",
      "",
      "## Run",
      "",
      "Double click `open_app.bat`, or open `index.html` in a browser.",
      ""
    ].join("\n");

    return [
      {
        path: `artifacts/projects/${projectId}/output/app/index.html`,
        content: indexHtml,
        allow_overwrite: true
      },
      {
        path: `artifacts/projects/${projectId}/output/app/README.md`,
        content: readme,
        allow_overwrite: true
      }
    ];
  }

  function writeRunnableExecutionPackage(projectIdInput, files, action) {
    const projectId = normalizeProjectId(projectIdInput);
    const normalizedFiles = normalizeProviderRunnableFiles(projectId, files);
    const createdAt = new Date().toISOString();
    const executionId = `ai_os_runnable_execution_${Date.now()}`;
    const packageId = `ai_os_runnable_package_${Date.now()}`;
    const handoffId = `ai_os_runnable_handoff_${Date.now()}`;
    const packageAbs = getProjectExecutionPackageAbs(projectId);
    const responseAbs = path.resolve(root, "artifacts", "llm", "responses", `${executionId}.response.json`);
    const previousPackage = readJsonSafe(packageAbs, {});
    const previousScope = previousPackage && previousPackage.business_and_scope_decisions
      ? previousPackage.business_and_scope_decisions
      : {};

    ensureDir(path.dirname(packageAbs));
    ensureDir(path.dirname(responseAbs));

    const responsePayload = {
      execution_id: executionId,
      source: "AI_OPERATING_SYSTEM",
      project_id: projectId,
      package_id: packageId,
      created_at: createdAt,
      summary: "Build runnable application from requirements package.",
      files: normalizedFiles.map((file) => ({
        path: file.path,
        content: file.content,
        execution_id: executionId,
        package_id: packageId
      }))
    };

    const executionPackage = {
      package_id: packageId,
      handoff_id: handoffId,
      created_at: createdAt,
      source: "EXTERNAL_AI_WORKSPACE",
      source_layer: "AI_OPERATING_SYSTEM",
      handoff_status: "APPROVED_PENDING_FORGE",
      project_id: projectId,
      execution_id: executionId,
      artifact_path: getProjectExecutionPackageRel(projectId),
      approved_scope: {
        summary: "Build runnable application from the approved requirements package.",
        operation_mode: normalizedFiles.length > 1 ? "MULTI_FILE" : "SINGLE_FILE",
        file_count: normalizedFiles.length
      },
      target_project_path: `artifacts/projects/${projectId}`,
      output_path: `artifacts/projects/${projectId}/output`,
      requested_outputs: normalizedFiles.map((file) => `Create runnable artifact ${file.path}`),
      file_or_artifact_targets: normalizedFiles.map((file) => file.path),
      dependency_assumptions: [],
      risk_notes: [
        action === "LOCAL_STATIC_PROTOTYPE"
          ? "Local fallback creates a static prototype only, not a production-ready system."
          : "Provider output must create runnable application indicators."
      ],
      execution_approval_reference: {
        approved_by_role: "CTO",
        approved_at: createdAt,
        documentation_state: "DOCS_APPROVED",
        source_execution_id: String(previousPackage.execution_id || ""),
        source_package_id: String(previousPackage.package_id || ""),
        project_state_path: getProjectStateRel(projectId)
      },
      finalized_documentation_set: [
        getProjectStateRel(projectId)
      ],
      execution_plan: {
        mode: normalizedFiles.length > 1 ? "MULTI_FILE" : "SINGLE_FILE",
        file_count: normalizedFiles.length,
        proposed_files: normalizedFiles.map((file) => ({
          path: file.path,
          allow_overwrite: file.allow_overwrite === true,
          sha256: sha256(file.content),
          required_roles: ["cto"],
          diff: ""
        }))
      },
      business_and_scope_decisions: {
        ...previousScope,
        user_goal: String(previousScope.user_goal || ""),
        followup_action: action
      }
    };

    fs.writeFileSync(responseAbs, JSON.stringify(responsePayload, null, 2), "utf8");
    fs.writeFileSync(packageAbs, JSON.stringify(executionPackage, null, 2), "utf8");

    return {
      execution_id: executionId,
      package_id: packageId,
      package_path: getProjectExecutionPackageRel(projectId),
      response_path: path.relative(root, responseAbs).replace(/\\/g, "/")
    };
  }

  async function generateRunnableFilesViaProvider(projectIdInput, requirementFiles) {
    const projectId = normalizeProjectId(projectIdInput);
    const provider = new OpenAiStructuredJsonProvider();
    const result = await provider.executeTask({
      system: "Generate a small runnable application from approved requirements. Return files only. Do not claim production readiness.",
      request: "Create a runnable application artifact under the provided output app folder.",
      context: {
        output_base: `artifacts/projects/${projectId}/output/app`,
        requirement_files: requirementFiles,
        constraints: [
          "Write all files under output_base",
          "Include index.html or package.json or server.js or src/",
          "If static, include app/index.html and app/README.md",
          "README must include run/open instructions",
          "State clearly when the result is a prototype"
        ]
      },
      expected_output: {
        files: [
          {
            path: "string under output_base",
            content: "string",
            allow_overwrite: true
          }
        ]
      }
    });

    if (result.status !== "SUCCESS" || !result.output || !Array.isArray(result.output.files)) {
      return {
        ok: false,
        reason: "PROVIDER_NOT_AVAILABLE",
        provider_metadata: result.metadata || {}
      };
    }

    const files = normalizeProviderRunnableFiles(projectId, result.output.files);

    if (!filesContainRunnableIndicator(files)) {
      return {
        ok: false,
        reason: "PROVIDER_DID_NOT_CREATE_RUNNABLE_FILES",
        provider_metadata: result.metadata || {}
      };
    }

    return {
      ok: true,
      files,
      provider_metadata: result.metadata || {}
    };
  }

  async function buildRunnableFromRequirements(body = {}) {
    const projectId = normalizeProjectId(body.project_id || readActiveProjectId());
    const sourceExecutionId = String(body.source_execution_id || "").trim();
    const sourcePackageId = String(body.package_id || body.source_package_id || "").trim();
    const action = String(body.action || "").trim().toUpperCase();
    const deliverySummary = buildDeliverySummary(projectId);
    const executionPackage = readJsonSafe(getProjectExecutionPackageAbs(projectId), {});

    if (deliverySummary.delivery_type !== "REQUIREMENTS_PACKAGE") {
      return {
        ok: false,
        mode: "BUILD_RUNNABLE_FROM_REQUIREMENTS_BLOCKED",
        reason: "CURRENT_DELIVERY_IS_NOT_REQUIREMENTS_PACKAGE",
        delivery_summary: deliverySummary
      };
    }

    if (sourceExecutionId && sourceExecutionId !== deliverySummary.execution_id) {
      return {
        ok: false,
        mode: "BUILD_RUNNABLE_FROM_REQUIREMENTS_BLOCKED",
        reason: "SOURCE_EXECUTION_ID_MISMATCH",
        delivery_summary: deliverySummary
      };
    }

    if (sourcePackageId && sourcePackageId !== deliverySummary.package_id) {
      return {
        ok: false,
        mode: "BUILD_RUNNABLE_FROM_REQUIREMENTS_BLOCKED",
        reason: "SOURCE_PACKAGE_ID_MISMATCH",
        delivery_summary: deliverySummary
      };
    }

    const requirementFiles = readCurrentRequirementOutputFiles(projectId, deliverySummary);

    if (requirementFiles.length === 0) {
      return {
        ok: false,
        mode: "BUILD_RUNNABLE_FROM_REQUIREMENTS_BLOCKED",
        reason: "NO_CURRENT_REQUIREMENT_FILES_FOUND",
        delivery_summary: deliverySummary
      };
    }

    const originalGoal = String(
      executionPackage &&
      executionPackage.business_and_scope_decisions &&
      executionPackage.business_and_scope_decisions.user_goal
        ? executionPackage.business_and_scope_decisions.user_goal
        : ""
    ).trim();
    const existingState = readJsonSafe(getProjectStateAbs(projectId), {});
    const repairedName = normalizeProjectName(originalGoal || existingState.original_user_goal || existingState.project_name || projectId);

    persistProjectState(projectId, {
      project_name: repairedName,
      user_goal: originalGoal || existingState.user_goal || repairedName,
      original_user_goal: originalGoal || existingState.original_user_goal || existingState.user_goal || repairedName,
      latest_requested_action: action === "LOCAL_STATIC_PROTOTYPE" ? "CREATE_LOCAL_STATIC_PROTOTYPE" : "BUILD_RUNNABLE_FROM_REQUIREMENTS",
      active_followup_action: action === "LOCAL_STATIC_PROTOTYPE" ? "CREATE_LOCAL_STATIC_PROTOTYPE" : "BUILD_RUNNABLE_FROM_REQUIREMENTS",
      provider_error: ""
    });

    if (action === "LOCAL_STATIC_PROTOTYPE") {
      const packageInfo = writeRunnableExecutionPackage(
        projectId,
        buildLocalPrototypeFiles(projectId, requirementFiles),
        "LOCAL_STATIC_PROTOTYPE"
      );
      const runResult = await runForgeWorkspaceRuntime({ project_id: projectId });
      return {
        ok: runResult.ok === true,
        mode: "LOCAL_STATIC_PROTOTYPE_FORGE_RUNTIME_COMPLETE",
        project: runResult.project,
        delivery_summary: runResult.delivery_summary,
        package: packageInfo,
        run_result: runResult,
        message: "A local static prototype package was executed through Forge governance."
      };
    }

    const providerFiles = await generateRunnableFilesViaProvider(projectId, requirementFiles);

    if (!providerFiles.ok) {
      const project = persistProjectState(projectId, {
        project_name: repairedName,
        user_goal: originalGoal || existingState.user_goal || repairedName,
        original_user_goal: originalGoal || existingState.original_user_goal || existingState.user_goal || repairedName,
        delivery_state: "REQUIREMENTS_PACKAGE",
        delivery_summary: {
          ...deliverySummary,
          build_attempt_reason: providerFiles.reason,
          next_suggested_actions: [
            "Create a simple local HTML prototype from these requirements",
            "Show requirement files",
            "Stop",
            "Start over"
          ]
        },
        latest_requested_action: "BUILD_RUNNABLE_FROM_REQUIREMENTS",
        active_followup_action: "BUILD_RUNNABLE_FROM_REQUIREMENTS",
        provider_error: providerFiles.reason
      });

      return {
        ok: true,
        mode: "BUILD_RUNNABLE_PROVIDER_UNAVAILABLE",
        project,
        delivery_summary: project.delivery_summary,
        reason: providerFiles.reason,
        provider_metadata: providerFiles.provider_metadata || {},
        message: "Building a runnable application requires a code generator/provider that is not available right now.",
        followup_choices: [
          "Create a simple local HTML prototype from these requirements",
          "Show requirement files",
          "Stop",
          "Start over"
        ]
      };
    }

    const packageInfo = writeRunnableExecutionPackage(projectId, providerFiles.files, "PROVIDER_RUNNABLE_APPLICATION");
    const runResult = await runForgeWorkspaceRuntime({ project_id: projectId });

    return {
      ok: runResult.ok === true,
      mode: "BUILD_RUNNABLE_FROM_REQUIREMENTS_FORGE_RUNTIME_COMPLETE",
      project: runResult.project,
      delivery_summary: runResult.delivery_summary,
      package: packageInfo,
      run_result: runResult
    };
  }

  function writeDecisionLinkArtifact(proposalId, decisionPacketId, projectIdInput = "") {
    const projectId = normalizeProjectId(projectIdInput);
    const linkRoot = getProjectDecisionLinksRoot(projectId);
    ensureDir(linkRoot);

    const link = {
      link_id: `ai_decision_link_${Date.now()}`,
      created_at: new Date().toISOString(),
      proposal_id: proposalId || "",
      decision_packet_id: decisionPacketId || "",
      project_id: projectId,
      relationship: "PROPOSAL_TO_DECISION"
    };

    const rel = getProjectDecisionLinksRel(projectId, link.link_id);
    fs.writeFileSync(path.resolve(root, rel), JSON.stringify(link, null, 2));

    return rel;
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

function buildExecutionPackage(packet) {
  const proposedFiles = Array.isArray(packet && packet.proposed_files)
    ? packet.proposed_files
    : [];

  const projectId = normalizeProjectId(packet && packet.project_id ? packet.project_id : "");

  return {
    package_id: `execution_package_${Date.now()}`,
    created_at: new Date().toISOString(),
    source: "EXTERNAL_AI_WORKSPACE",
    handoff_status: "APPROVED_PENDING_FORGE",
    project_id: projectId,
    execution_id: String(packet && packet.execution_id ? packet.execution_id : ""),
    artifact_path: getProjectExecutionPackageRel(projectId),
    approved_scope: {
      summary: String(packet && packet.context_summary ? packet.context_summary : ""),
      operation_mode:
        packet && packet.operation && typeof packet.operation.mode === "string"
          ? packet.operation.mode
          : "",
      file_count:
        packet && packet.operation && Number.isInteger(packet.operation.file_count)
          ? packet.operation.file_count
          : proposedFiles.length
    },
    target_project_path: root,
    requested_outputs: proposedFiles.map((file) => `Apply approved change to ${String(file && file.path ? file.path : "")}`),
    file_or_artifact_targets: proposedFiles.map((file) => String(file && file.path ? file.path : "")),
    dependency_assumptions: [],
    risk_notes: proposedFiles.length > 1 ? ["MULTI_FILE_CHANGESET"] : [],
    execution_approval_reference: {
      decision_packet_json: `artifacts/projects/${projectId}/decisions/decision_packet.json`,
      decision_packet_md: `artifacts/projects/${projectId}/decisions/decision_packet.md`,
      approved_by_role:
        packet && packet.approval && typeof packet.approval.approved_by_role === "string"
          ? packet.approval.approved_by_role
          : "",
      approved_at:
        packet && packet.approval && typeof packet.approval.approved_at === "string"
          ? packet.approval.approved_at
          : ""
    },
    finalized_documentation_set: [
      `artifacts/projects/${projectId}/decisions/decision_packet.json`,
      `artifacts/projects/${projectId}/decisions/decision_packet.md`
    ],
    execution_plan: {
      mode:
        packet && packet.operation && typeof packet.operation.mode === "string"
          ? packet.operation.mode
          : "",
      file_count:
        packet && packet.operation && Number.isInteger(packet.operation.file_count)
          ? packet.operation.file_count
          : proposedFiles.length,
      proposed_files: proposedFiles.map((file) => ({
        path: String(file && file.path ? file.path : ""),
        allow_overwrite: !!(file && file.allow_overwrite === true),
        sha256: String(file && file.sha256 ? file.sha256 : ""),
        required_roles: Array.isArray(file && file.required_roles) ? file.required_roles : [],
        diff: String(file && file.diff ? file.diff : "")
      }))
    },
    business_and_scope_decisions: {
      confirmation_required_format:
        typeof (packet && packet.confirmation_required_format) === "string"
          ? packet.confirmation_required_format
          : "",
      context_summary: String(packet && packet.context_summary ? packet.context_summary : ""),
      options: Array.isArray(packet && packet.options) ? packet.options : []
    }
  };
}

  function getRecentWrites(projectIdInput = "", limit = 10) {
    const metadataDir = path.join(llmRoot, "metadata");
    const targetProjectId = normalizeProjectId(projectIdInput || readActiveProjectId());

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
      .filter((item) => {
        const data = item.data && typeof item.data === "object" ? item.data : {};
        const itemProjectId =
          typeof data.project_id === "string" && data.project_id.trim() !== ""
            ? data.project_id.trim()
            : "default_project";

        return itemProjectId === targetProjectId;
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, limit)
      .map((item) => {
        const data = item.data && typeof item.data === "object" ? item.data : {};
        const isDecision = item.name.endsWith(".decision.json");

        return {
          entry_type: isDecision ? "DECISION_PACKET" : "WRITE",
          project_id:
            typeof data.project_id === "string" && data.project_id.trim() !== ""
              ? data.project_id.trim()
              : "default_project",
          decision_packet_id: data.decision_packet_id || "",
          write_id: data.write_id || "",
          approver_role: data.approver_role || "",
          required_roles: Array.isArray(data.required_roles) ? data.required_roles : [],
          approval_policy_version: data.approval_policy_version || "",
          operation_mode: data.operation_mode || "",
          file_count: Number.isInteger(data.file_count) ? data.file_count : 0,
          total_bytes: Number.isInteger(data.total_bytes) ? data.total_bytes : 0,
          logged_at: data.approved_at || data.timestamp || "",
          queued_files: Array.isArray(data.queued_files) ? data.queued_files : [],
          written_files: Array.isArray(data.written_files) ? data.written_files : [],
          summary: data.summary || data.request || ""
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

    const decisionPacketId = `workspace_decision_${Date.now()}`;
    const workspaceId = "personal";
    const projectId = normalizeProjectId(draft.project_id);

    const projectDecisionsRoot = path.resolve(root, "artifacts", "projects", projectId, "decisions");
    ensureDir(projectDecisionsRoot);



    const requestPath = path.join(llmRoot, "requests", `${decisionPacketId}.request.json`);
    const responsePath = path.join(llmRoot, "responses", `${decisionPacketId}.response.json`);
    const metadataPath = path.join(llmRoot, "metadata", `${decisionPacketId}.decision.json`);
    const decisionPacketJsonAbs = path.join(projectDecisionsRoot, "decision_packet.json");
    const decisionPacketMdAbs = path.join(projectDecisionsRoot, "decision_packet.md");

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

    const executionPackageAbs = getProjectExecutionPackageAbs(projectId);
    const executionPackage = buildExecutionPackage(packet);

    fs.mkdirSync(path.dirname(executionPackageAbs), { recursive: true });
    fs.writeFileSync(executionPackageAbs, JSON.stringify(executionPackage, null, 2));

    const result = {
      ok: true,
      entry_type: "DECISION_PACKET",
      decision_packet_id: decisionPacketId,
      project_id: projectId,
      approver_role: approvedByRole,
      required_roles: approvalPolicy.required_roles,
      approval_policy_version: approvalPolicy.policy_version,
      operation_mode: batchPolicy.stats.operation_mode,
      file_count: batchPolicy.stats.file_count,
      total_bytes: batchPolicy.stats.total_bytes,
      decision_packet_paths: [
        `artifacts/projects/${projectId}/decisions/decision_packet.json`,
        `artifacts/projects/${projectId}/decisions/decision_packet.md`
      ],
      execution_package_paths: [
        getProjectExecutionPackageRel(projectId)
      ],
      queued_files: normalizedFiles.map((file) => file.path),
      summary: typeof draft.summary === "string" ? draft.summary : "Decision packet created successfully.",
      request: userRequest || "",
      diffs
    };

    fs.writeFileSync(metadataPath, JSON.stringify(result, null, 2));

    writeActiveProject(projectId);
    persistProjectState(projectId, {
      current_phase: "EXECUTION_READY",
      active_runtime_state: "EXECUTION_PREPARATION",
      documentation_state: "APPROVED",
      execution_package_state: "APPROVED",
      execution_state: "PENDING_FORGE",
      accepted_options: ["OPTION-APPROVE-WORKSPACE-DRAFT"]
    });

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

    const discoveryGate = assertWorkspaceDiscoveryComplete(body);

    if (!discoveryGate.ok) {
      sendJson(res, 409, discoveryGate);
      return;
    }

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
    const discoveryGate = assertWorkspaceDiscoveryComplete(body);

    if (!discoveryGate.ok) {
      sendJson(res, 409, discoveryGate);
      return;
    }
    const approverRole = typeof body.approver_role === "string" ? body.approver_role.trim() : "";
    const draft = body && body.draft ? body.draft : null;

    if (!draft || !Array.isArray(draft.files)) {
      sendJson(res, 400, { error: "Draft is required" });
      return;
    }

    const result = createDecisionPacket(draft, userRequest, approverRole);

    const proposalId =
      body && typeof body.proposal_id === "string"
        ? body.proposal_id
        : "";

    if (proposalId && result && result.decision_packet_id) {
      const linkPath = writeDecisionLinkArtifact(
        proposalId,
        result.decision_packet_id,
        result.project_id
      );

      result.decision_link_artifact = linkPath;
    }
    sendJson(res, 200, result);
  }

  async function handleClarify(body, res) {
    const requestText = typeof body.request === "string" ? body.request.trim() : "";
    const interpretation = interpretUserIntent(requestText);

    sendJson(res, 200, {
      ok: true,
      request: requestText,
      needs_clarification: interpretation.needs_clarification === true,
      clarification_question:
        interpretation.clarification_question ||
        (interpretation.needs_clarification === true ? "What do you want to do?" : ""),
      interpretation
    });
  }

  async function handleAnalyze(body, res) {
    const requestText = typeof body.request === "string" ? body.request.trim() : "";
    const result = buildAiAnalysisArtifacts(requestText);
    sendJson(res, 200, result);
  }

  async function handleOptions(body, res) {
    const requestText = typeof body.request === "string" ? body.request.trim() : "";
    const discoveryGate = assertWorkspaceDiscoveryComplete(body);

    if (!discoveryGate.ok) {
      sendJson(res, 409, discoveryGate);
      return;
    }
    const interpretation = interpretUserIntent(requestText);

    if (
      interpretation.mode === "BLOCKED" ||
      interpretation.needs_clarification === true
    ) {
      sendJson(res, 200, {
        ok: false,
        mode: "BLOCKED",
        reason: "CLARIFICATION_REQUIRED",
        clarification_question:
          interpretation.clarification_question || "What do you want to do?",
        interpretation
      });
      return;
    }

    const projectFiles = scanProjectFiles();
    const resolvedTargetFile = resolveTargetFileForRequest(
      interpretation.normalized_request,
      projectFiles
    );

    const strategyCandidates = buildStrategyCandidates(
      interpretation.normalized_request,
      resolvedTargetFile
    );

    sendJson(res, 200, {
      ok: true,
      mode: "OPTIONS",
      request: interpretation.normalized_request,
      target_file: resolvedTargetFile,
      selected_strategy: strategyCandidates[0] || null,
      strategy_candidates: strategyCandidates,
      interpretation
    });
  }

  async function handleSelectStrategy(body, res) {
    const requestText = typeof body.request === "string" ? body.request.trim() : "";
    const discoveryGate = assertWorkspaceDiscoveryComplete(body);

    if (!discoveryGate.ok) {
      sendJson(res, 409, discoveryGate);
      return;
    }
    const interpretation = interpretUserIntent(requestText);

    if (
      interpretation.mode === "BLOCKED" ||
      interpretation.needs_clarification === true
    ) {
      sendJson(res, 200, {
        ok: false,
        mode: "BLOCKED",
        reason: "CLARIFICATION_REQUIRED",
        clarification_question:
          interpretation.clarification_question || "What do you want to do?",
        interpretation
      });
      return;
    }

    const projectFiles = scanProjectFiles();
    const resolvedTargetFile = resolveTargetFileForRequest(
      interpretation.normalized_request,
      projectFiles
    );

    const strategyCandidates = buildStrategyCandidates(
      interpretation.normalized_request,
      resolvedTargetFile
    );

    if (strategyCandidates.length === 1) {
      sendJson(res, 200, {
        ok: true,
        mode: "STRATEGY_SELECTED",
        selection_mode: "AUTO",
        request: interpretation.normalized_request,
        target_file: resolvedTargetFile,
        selected_strategy: strategyCandidates[0],
        strategy_candidates: strategyCandidates,
        interpretation
      });
      return;
    }

    sendJson(res, 200, {
      ok: true,
      mode: "STRATEGY_SELECTION_REQUIRED",
      selection_mode: "USER_CHOICE_REQUIRED",
      request: interpretation.normalized_request,
      target_file: resolvedTargetFile,
      selected_strategy: null,
      strategy_candidates: strategyCandidates,
      selection_question: "Multiple strategies are available. Which one do you want to use?",
      interpretation
    });
  }

  async function handleConfirmStrategy(body, res) {
    const requestText = typeof body.request === "string" ? body.request.trim() : "";
    const selectedStrategyId =
      typeof body.selected_strategy_id === "string" ? body.selected_strategy_id.trim() : "";

    const discoveryGate = assertWorkspaceDiscoveryComplete(body);

    if (!discoveryGate.ok) {
      sendJson(res, 409, discoveryGate);
      return;
    }

    const interpretation = interpretUserIntent(requestText);

    if (
      interpretation.mode === "BLOCKED" ||
      interpretation.needs_clarification === true
    ) {
      sendJson(res, 200, {
        ok: false,
        mode: "BLOCKED",
        reason: "CLARIFICATION_REQUIRED",
        clarification_question:
          interpretation.clarification_question || "What do you want to do?",
        interpretation
      });
      return;
    }

    const projectFiles = scanProjectFiles();
    const resolvedTargetFile = resolveTargetFileForRequest(
      interpretation.normalized_request,
      projectFiles
    );

    const strategyCandidates = buildStrategyCandidates(
      interpretation.normalized_request,
      resolvedTargetFile
    );

    const selectedStrategy = strategyCandidates.find(
      (item) => item.strategy_id === selectedStrategyId
    );

    if (!selectedStrategy) {
      sendJson(res, 200, {
        ok: false,
        mode: "INVALID_SELECTION",
        reason: "STRATEGY_NOT_FOUND",
        message: "Selected strategy is not valid.",
        strategy_candidates: strategyCandidates,
        interpretation
      });
      return;
    }

    sendJson(res, 200, {
      ok: true,
      mode: "STRATEGY_CONFIRMED",
      request: interpretation.normalized_request,
      target_file: resolvedTargetFile,
      selected_strategy: selectedStrategy,
      strategy_candidates: strategyCandidates,
      interpretation
    });
  }

  async function handlePropose(body, res) {
    const requestText = typeof body.request === "string" ? body.request.trim() : "";

    const projectId =
      typeof body.project_id === "string" ? body.project_id.trim() : "";

    const discoveryGate = assertWorkspaceDiscoveryComplete(body);

    if (!discoveryGate.ok) {
      sendJson(res, 409, discoveryGate);
      return;
    }

    const interpretation = interpretUserIntent(requestText);

    if (
      interpretation.mode === "BLOCKED" ||
      interpretation.needs_clarification === true
    ) {
      sendJson(res, 200, {
        ok: false,
        mode: "BLOCKED",
        reason: "CLARIFICATION_REQUIRED",
        clarification_question:
          interpretation.clarification_question || "What do you want to do?",
        interpretation
      });
      return;
    }

    if (interpretation.mode !== "PROPOSAL") {
      sendJson(res, 200, {
        ok: false,
        mode: interpretation.mode,
        message: "This request is not a proposal request. Try Analyze instead.",
        interpretation
      });
      return;
    }

    const projectFiles = scanProjectFiles();
    const resolvedTargetFile = resolveTargetFileForRequest(
      interpretation.normalized_request,
      projectFiles
    );

    const providerRouter = new ProviderRouter();

    const targetAbsolutePath = path.resolve(root, resolvedTargetFile);
    const currentTargetFileContent = readTextSafe(targetAbsolutePath);
    const fileExists = fs.existsSync(targetAbsolutePath);

    const providerResult = await providerRouter.execute({
      task_id: `task_${Date.now()}`,
      request: interpretation.normalized_request,
      context: {
        target_files: [resolvedTargetFile],
        operation_type: fileExists ? "MODIFY" : "CREATE",
        file_exists: fileExists,
        current_file_context: buildRequestAwareFileContext(
          currentTargetFileContent,
          interpretation.normalized_request
        ),
        constraints: [
          "Return valid JSON only",
          "Do not wrap output in markdown",
          "Do not execute filesystem changes",
          "return targeted patch operations only for existing files",
          "use write_full_file only when the file does not already exist",
          "do not return human instructions inside JSON"
        ]
      },
      expected_output: {
        type: "PATCH_OPERATIONS",
        format: "structured_json"
      }
    });

    const result = buildAiProposalArtifacts(
      interpretation.normalized_request,
      providerResult.output || null,
      projectId
    );

    result.interpretation = interpretation;
    result.provider = {
      name: "codex",
      status: providerResult.status || "UNKNOWN",
      metadata: providerResult.metadata || {}
    };

    if (providerResult.status === "SUCCESS" && providerResult.output && providerResult.output.raw_stdout) {
      result.provider.patch = providerResult.output.raw_stdout;
    }

    sendJson(res, 200, result);
  }

  async function handleApprove(body, res) {
    const proposalId = typeof body.proposal_id === "string" ? body.proposal_id.trim() : "";
    const approverRole = typeof body.approver_role === "string" && body.approver_role.trim()
      ? body.approver_role.trim()
      : "cto";

    const discoveryGate = assertWorkspaceDiscoveryComplete(body);

    if (!discoveryGate.ok) {
      sendJson(res, 409, discoveryGate);
      return;
    }

    if (!proposalId) {
      sendJson(res, 400, { error: "proposal_id is required" });
      return;
    }

    const projectId =
      typeof body.project_id === "string" && body.project_id.trim() !== ""
        ? body.project_id.trim()
        : "default_project";

    const draftPath = path.resolve(
      root,
      "artifacts",
      "projects",
      projectId,
      "ai",
      "drafts",
      `${proposalId}.draft.json`
    );
    const proposalPath = path.resolve(
      root,
      "artifacts",
      "projects",
      projectId,
      "ai",
      "proposals",
      `${proposalId}.proposal.json`
    );

    if (!fs.existsSync(draftPath)) {
      sendJson(res, 404, { error: "Draft not found" });
      return;
    }

    const draftArtifact = readJsonSafe(draftPath, null);
    const proposalArtifact = readJsonSafe(proposalPath, null);

    if (!draftArtifact || !Array.isArray(draftArtifact.files)) {
      sendJson(res, 400, { error: "Invalid draft artifact" });
      return;
    }

    const materializedFiles = materializeDraftFilesForApproval(draftArtifact);

    const decisionResult = createDecisionPacket(
      {
        ...draftArtifact,
        files: materializedFiles,
        summary: proposalArtifact && typeof proposalArtifact.description === "string"
          ? proposalArtifact.description
          : "Proposal approved for execution."
      },
      proposalArtifact && typeof proposalArtifact.request === "string"
        ? proposalArtifact.request
        : "",
      approverRole
    );

    draftArtifact.approved = true;
    draftArtifact.ready_for_decision = true;
    draftArtifact.approved_at = new Date().toISOString();
    draftArtifact.approved_by_role = approverRole;

    if (proposalArtifact && typeof proposalArtifact === "object") {
      proposalArtifact.execution_approved = true;
      proposalArtifact.execution_approved_at = new Date().toISOString();
      proposalArtifact.execution_approved_by_role = approverRole;
      fs.writeFileSync(proposalPath, JSON.stringify(proposalArtifact, null, 2), "utf8");
    }

    fs.writeFileSync(draftPath, JSON.stringify(draftArtifact, null, 2), "utf8");

    if (decisionResult && decisionResult.decision_packet_id) {
      decisionResult.decision_link_artifact = writeDecisionLinkArtifact(
        proposalId,
        decisionResult.decision_packet_id,
        decisionResult.project_id
      );
    }

    sendJson(res, 200, {
      ok: true,
      mode: "APPROVED",
      proposal_id: proposalId,
      approver_role: approverRole,
      decision: decisionResult
    });
  }

  async function handleApplyExecutePlan(body, res) {
    sendJson(res, 409, {
      ok: false,
      error: "CONVERSATION_EXECUTION_BLOCKED",
      message: "Direct execution from conversation/workspace is blocked. Approved execution must be handed off to Forge through an approved execution package."
    });
  }

  const server = http.createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url, "http://localhost");
      const pathname = requestUrl.pathname;
      if (req.method === "OPTIONS") {
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === "GET" && pathname === "/health") {
        sendJson(res, 200, { ok: true, service: "forge-workspace-api" });
        return;
      }

      if (req.method === "GET" && pathname === "/api/ai/approval-policy") {
        sendJson(res, 200, loadApprovalPolicy());
        return;
      }

      if (req.method === "POST" && pathname === "/api/ai-os/intake") {
        const body = await readBody(req);
        const message = String(body.message || body.request || "").trim();

        if (isBuildRunnableRequirementsFollowupText(message)) {
          sendJson(res, 200, await buildRunnableFromRequirements({
            project_id: body.project_id || readActiveProjectId(),
            source_execution_id: body.source_execution_id || "",
            package_id: body.package_id || body.source_package_id || "",
            action: "BUILD_RUNNABLE_FROM_REQUIREMENTS"
          }));
          return;
        }

        sendJson(res, 200, await aiOsRuntime.intakeProject(body));
        return;
      }

      if (req.method === "POST" && pathname === "/api/ai-os/clarification/answer") {
        const body = await readBody(req);
        sendJson(res, 200, await aiOsRuntime.answerClarification(body));
        return;
      }

      if (req.method === "POST" && pathname === "/api/ai-os/options") {
        const body = await readBody(req);
        sendJson(res, 200, await aiOsRuntime.registerOptions(body));
        return;
      }

      if (req.method === "POST" && pathname === "/api/ai-os/decision") {
        const body = await readBody(req);
        sendJson(res, 200, aiOsRuntime.decideOption(body));
        return;
      }

      if (req.method === "POST" && pathname === "/api/ai-os/documentation/draft") {
        const body = await readBody(req);
        sendJson(res, 200, await aiOsRuntime.saveDocumentationDraft(body));
        return;
      }

      if (req.method === "POST" && pathname === "/api/ai-os/documentation/current") {
        const body = await readBody(req);
        sendJson(res, 200, aiOsRuntime.getDocumentationDraft(body));
        return;
      }

      if (req.method === "POST" && pathname === "/api/ai-os/documentation/approve") {
        const body = await readBody(req);
        sendJson(res, 200, aiOsRuntime.approveDocumentation(body));
        return;
      }

      if (req.method === "POST" && pathname === "/api/ai-os/handoff") {
        const body = await readBody(req);
        sendJson(res, 200, await aiOsRuntime.createExecutionHandoff(body));
        return;
      }

      if (req.method === "POST" && pathname === "/api/ai-os/build-runnable-from-requirements") {
        const body = await readBody(req);
        sendJson(res, 200, await buildRunnableFromRequirements(body));
        return;
      }

      if (req.method === "GET" && pathname === "/api/ai-os/project") {
        sendJson(res, 200, aiOsRuntime.getProject({
          project_id: requestUrl.searchParams.get("project_id") || ""
        }));
        return;
      }

      if (req.method === "POST" && pathname === "/api/forge/workspace-runtime/run") {
        const body = await readBody(req);
        sendJson(res, 200, await runForgeWorkspaceRuntime(body));
        return;
      }

      if (req.method === "GET" && pathname === "/api/projects") {
        sendJson(res, 200, listProjects());
        return;
      }

      if (req.method === "POST" && pathname === "/api/projects/create") {
        const body = await readBody(req);
        const result = createProject(body);
        sendJson(res, 200, result);
        return;
      }

      if (req.method === "POST" && pathname === "/api/projects/delete") {
        const body = await readBody(req);
        sendJson(res, 200, deleteProject(body));
        return;
      }

      if (req.method === "POST" && pathname === "/api/projects/activate") {
        const body = await readBody(req);
        const projectId = writeActiveProject(
          typeof body.project_id === "string" ? body.project_id.trim() : ""
        );
        const state = persistProjectState(projectId);
        sendJson(res, 200, {
          ok: true,
          active_project_id: projectId,
          project: state
        });
        return;
      }

      if (req.method === "POST" && pathname === "/api/projects/open-output-folder") {
        const body = await readBody(req);
        sendJson(res, 200, openProjectOutputFolder(body));
        return;
      }

      if (req.method === "POST" && pathname === "/api/projects/run-output-app") {
        const body = await readBody(req);
        sendJson(res, 200, await runProjectOutputAppServer(body));
        return;
      }

      if (req.method === "POST" && pathname === "/api/projects/run-app-server") {
        const body = await readBody(req);
        sendJson(res, 200, await runProjectOutputAppServer(body));
        return;
      }

      if (req.method === "POST" && pathname === "/api/projects/stop-app-server") {
        const body = await readBody(req);
        sendJson(res, 200, stopProjectAppServer(body));
        return;
      }

      if (req.method === "POST" && pathname === "/api/projects/cleanup-test-artifacts") {
        const body = await readBody(req);
        sendJson(res, 200, cleanupTestArtifacts(body));
        return;
      }

      if (req.method === "GET" && pathname === "/api/projects/conversation-history") {
        sendJson(res, 200, getProjectConversationHistory({
          project_id: requestUrl.searchParams.get("project_id") || ""
        }));
        return;
      }

      if (req.method === "POST" && pathname === "/api/projects/conversation-history") {
        const body = await readBody(req);
        sendJson(res, 200, recordProjectConversationTurn(body));
        return;
      }

      if (req.method === "POST" && pathname === "/api/projects/output-file") {
        const body = await readBody(req);
        sendJson(res, 200, getProjectOutputFile(body));
        return;
      }

      if (req.method === "GET" && pathname === "/api/ai/history") {
        const projectId =
          typeof requestUrl.searchParams.get("project_id") === "string"
            ? requestUrl.searchParams.get("project_id")
            : "";
        sendJson(res, 200, { items: getRecentWrites(projectId, 10) });
        return;
      }

      if (req.method === "POST" && req.url === "/api/ai/clarify") {
        const body = await readBody(req);
        await handleClarify(body, res);
        return;
      }

      if (req.method === "POST" && req.url === "/api/ai/analyze") {
        const body = await readBody(req);
        await handleAnalyze(body, res);
        return;
      }

      if (req.method === "POST" && req.url === "/api/ai/options") {
        const body = await readBody(req);
        await handleOptions(body, res);
        return;
      }

      if (req.method === "POST" && req.url === "/api/ai/select-strategy") {
        const body = await readBody(req);
        await handleSelectStrategy(body, res);
        return;
      }

      if (req.method === "POST" && req.url === "/api/ai/confirm-strategy") {
        const body = await readBody(req);
        await handleConfirmStrategy(body, res);
        return;
      }

      if (req.method === "POST" && req.url === "/api/ai/propose") {
        const body = await readBody(req);
        await handlePropose(body, res);
        return;
      }

      if (req.method === "POST" && req.url === "/api/ai/approve") {
        const body = await readBody(req);
        await handleApprove(body, res);
        return;
      }

      if (req.method === "POST" && req.url === "/api/ai/apply-execute-plan") {
        const body = await readBody(req);
        await handleApplyExecutePlan(body, res);
        return;
      }

      if (req.method === "POST" && req.url === "/api/ai/read-file") {
        const body = await readBody(req);

        const relPath = normalizeRelativePath(body.path);
        const absolutePath = path.resolve(root, relPath);

        if (!relPath) {
          sendJson(res, 400, { error: "File path is required" });
          return;
        }

        if (!isPathAllowed(absolutePath)) {
          sendJson(res, 403, { error: "Access denied for path" });
          return;
        }

        if (!fs.existsSync(absolutePath)) {
          sendJson(res, 404, { error: "File not found" });
          return;
        }

        const content = fs.readFileSync(absolutePath, "utf-8");

        sendJson(res, 200, {
          ok: true,
          path: relPath,
          content
        });
        return;
      }

      if (req.method === "POST" && req.url === "/api/ai/draft") {
        const body = await readBody(req);

        const discoveryGate = assertWorkspaceDiscoveryComplete(body);

        if (!discoveryGate.ok) {
          sendJson(res, 409, discoveryGate);
          return;
        }

        const requestText = typeof body.request === "string" ? body.request.trim() : "";

        if (!requestText) {
          sendJson(res, 400, { error: "Request is required" });
          return;
        }

        const draft = {
          files: [
            {
              path: "code/test_workspace_integration.js",
              content: requestText.includes("Overwrite file")
                ? requestText.split("with:")[1]?.split("allow_overwrite")[0]?.trim() || ""
                : `console.log("Auto-generated from request");`,
              allow_overwrite: true
            }
          ]
        };

        sendJson(res, 200, draft);
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

      if (
        (req.method === "POST" && req.url === "/api/auth/register") ||
        (req.method === "POST" && req.url === "/api/auth/login")
      ) {
        const body = await readBody(req);

        if (handleAuthRequest(req, res, body, sendJson)) {
          return;
        }
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
