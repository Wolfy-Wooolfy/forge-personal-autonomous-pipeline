const http = require("http");
const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");

const root = path.resolve(__dirname, "..");
const webRoot = path.resolve(root, "web");
const indexPath = path.join(webRoot, "index.html");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const llmRoot = path.resolve(root, "artifacts/llm");
const allowedWriteRoots = [
  path.resolve(root, "artifacts/llm"),
  path.resolve(root, "web"),
  path.resolve(root, "code/tools")
];

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function isWithin(parentPath, childPath) {
  const relative = path.relative(parentPath, childPath);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) || relative === "";
}

function normalizeDraftFiles(files) {
  if (!Array.isArray(files)) {
    throw new Error("Draft payload missing files array");
  }

  return files.map(file => {
    const filePath = typeof file.path === "string" ? file.path.trim() : "";
    const fileContent = typeof file.content === "string" ? file.content : "";

    if (!filePath) {
      throw new Error("Draft contains invalid file path");
    }

    if (path.isAbsolute(filePath)) {
      throw new Error("Absolute paths are not allowed");
    }

    const normalizedPath = filePath.replace(/\\/g, "/");
    const targetPath = path.resolve(root, normalizedPath);

    const exists = fs.existsSync(targetPath);

    if (exists) {
      if (file.allow_overwrite !== true) {
        throw new Error(`Overwrite requires allow_overwrite=true: ${normalizedPath}`);
      }
    }

    if (!isWithin(root, targetPath)) {
      throw new Error(`Path escapes workspace: ${normalizedPath}`);
    }

    const allowed = allowedWriteRoots.some(basePath => isWithin(basePath, targetPath));

    if (!allowed) {
      throw new Error(`Write blocked for path: ${normalizedPath}`);
    }

    return {
      path: normalizedPath,
      content: fileContent,
      absolutePath: targetPath
    };
  });
}

function writeApprovedDraft(draft, userRequest) {
  const normalizedFiles = normalizeDraftFiles(draft.files);

  const diffs = normalizedFiles.map(file => {
    let oldContent = "";

    if (fs.existsSync(file.absolutePath)) {
      try {
        oldContent = fs.readFileSync(file.absolutePath, "utf-8");
      } catch (err) {
        oldContent = "";
      }
    }

    const newContent = file.content || "";

    return {
      path: file.path,
      diff: buildSimpleDiff(oldContent, newContent)
    };
  });

  ensureDir(path.join(llmRoot, "requests"));
  ensureDir(path.join(llmRoot, "responses"));
  ensureDir(path.join(llmRoot, "metadata"));

  const writeId = `write_${Date.now()}`;
  const requestPath = path.join(llmRoot, "requests", `${writeId}.request.json`);
  const responsePath = path.join(llmRoot, "responses", `${writeId}.response.json`);
  const metadataPath = path.join(llmRoot, "metadata", `${writeId}.write.json`);

  fs.writeFileSync(requestPath, JSON.stringify({
    request: userRequest || "",
    approved_at: new Date().toISOString()
  }, null, 2));

  fs.writeFileSync(responsePath, JSON.stringify({
    summary: typeof draft.summary === "string" ? draft.summary : "Draft generated successfully.",
    files: normalizedFiles.map(file => ({
      path: file.path,
      content: file.content
    }))
  }, null, 2));

  normalizedFiles.forEach(file => {
    ensureDir(path.dirname(file.absolutePath));
    fs.writeFileSync(file.absolutePath, file.content);
  });

  const result = {
    ok: true,
    write_id: writeId,
    written_files: normalizedFiles.map(file => file.path),
    summary: typeof draft.summary === "string" ? draft.summary : "Draft generated successfully.",
    diffs
  };

  fs.writeFileSync(metadataPath, JSON.stringify(result, null, 2));

  return result;
}

function getRecentWrites(limit = 10) {
  const metadataDir = path.join(llmRoot, "metadata");

  if (!fs.existsSync(metadataDir)) {
    return [];
  }

  const items = fs.readdirSync(metadataDir)
    .filter(name => name.endsWith(".write.json"))
    .map(name => {
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
        fullPath,
        mtimeMs: stat.mtimeMs,
        data: parsed
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit)
    .map(item => ({
      write_id: item.data && typeof item.data.write_id === "string" ? item.data.write_id : item.name.replace(/\.write\.json$/, ""),
      written_files: item.data && Array.isArray(item.data.written_files) ? item.data.written_files : [],
      summary: item.data && typeof item.data.summary === "string" ? item.data.summary : "",
      ok: !!(item.data && item.data.ok),
      logged_at: new Date(item.mtimeMs).toISOString()
    }));

  return items;
}

function buildSimpleDiff(oldContent, newContent) {
  if (oldContent === newContent) {
    return "No changes";
  }

  const oldLines = String(oldContent || "").split("\n");
  const newLines = String(newContent || "").split("\n");
  const maxLength = Math.max(oldLines.length, newLines.length);
  const diffLines = [];

  for (let i = 0; i < maxLength; i += 1) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];

    if (oldLine === newLine) {
      if (oldLine !== undefined) {
        diffLines.push(`  ${oldLine}`);
      }
      continue;
    }

    if (oldLine !== undefined) {
      diffLines.push(`- ${oldLine}`);
    }

    if (newLine !== undefined) {
      diffLines.push(`+ ${newLine}`);
    }
  }

  return diffLines.join("\n");
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload, null, 2));
}

function sendText(res, statusCode, text, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, { "Content-Type": contentType });
  res.end(text);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";

    req.on("data", chunk => {
      data += chunk;
      if (data.length > 1024 * 1024) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });

    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function buildPrompt(userRequest) {
  return `
You generate FILE DRAFTS for a local workspace.

Return STRICT JSON only in this exact shape:

{
  "summary": "short summary",
  "files": [
    {
      "path": "relative/path/to/file.ext",
      "content": "full file content"
    }
  ]
}

Rules:
- Return JSON only
- Do not wrap JSON in markdown
- Paths must be relative
- Do not include explanations outside JSON
- Do not propose deleting files
- Do not write anything inside Forge pipeline governance paths
- Allowed write areas are only:
  - artifacts/llm/
  - web/
  - code/tools/
- Do not use absolute paths
- Do not use path traversal
- When updating an existing file, you MUST include:
  "allow_overwrite": true
  inside the file object
- If the request is an update and you do not include allow_overwrite, the write will be rejected

User request:
${userRequest}
`.trim();
}

async function generateDraft(userRequest) {
  const response = await openai.chat.completions.create({
    model: "gpt-4.1",
    temperature: 0,
    messages: [
      {
        role: "system",
        content: "You are a strict JSON file-drafting engine."
      },
      {
        role: "user",
        content: buildPrompt(userRequest)
      }
    ]
  });

  const content = response.choices?.[0]?.message?.content || "";

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new Error("Model returned invalid JSON");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid draft payload");
  }

  const normalizedFiles = normalizeDraftFiles(parsed.files).map((file, index) => ({
    path: file.path,
    content: file.content,
    allow_overwrite: parsed.files[index] && parsed.files[index].allow_overwrite === true
  }));

  return {
    summary: typeof parsed.summary === "string" ? parsed.summary : "Draft generated successfully.",
    files: normalizedFiles
  };
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/") {
      const html = fs.readFileSync(indexPath, "utf-8");
      sendText(res, 200, html, "text/html; charset=utf-8");
      return;
    }

    if (req.method === "GET" && req.url === "/health") {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && req.url === "/api/ai/history") {
      const items = getRecentWrites(10);
      sendJson(res, 200, { items });
      return;
    }

    if (req.method === "POST" && req.url === "/api/ai/draft") {
      if (!process.env.OPENAI_API_KEY) {
        sendJson(res, 500, { error: "OPENAI_API_KEY is not set" });
        return;
      }

      const rawBody = await readRequestBody(req);
      let body;

      try {
        body = JSON.parse(rawBody || "{}");
      } catch (err) {
        sendJson(res, 400, { error: "Invalid JSON body" });
        return;
      }

      const userRequest = typeof body.request === "string" ? body.request.trim() : "";

      if (!userRequest) {
        sendJson(res, 400, { error: "Request text is required" });
        return;
      }

      const draft = await generateDraft(userRequest);
      sendJson(res, 200, draft);
      return;
    }

    if (req.method === "POST" && req.url === "/api/ai/preview") {
      const rawBody = await readRequestBody(req);
      let body;

      try {
        body = JSON.parse(rawBody || "{}");
      } catch (err) {
        sendJson(res, 400, { error: "Invalid JSON body" });
        return;
      }

      const draft = body && typeof body === "object" ? body.draft : null;

      if (!draft || typeof draft !== "object") {
        sendJson(res, 400, { error: "Draft payload is required" });
        return;
      }

      const normalizedFiles = normalizeDraftFiles(draft.files);

      const diffs = normalizedFiles.map(file => {
        let oldContent = "";

        if (fs.existsSync(file.absolutePath)) {
          try {
            oldContent = fs.readFileSync(file.absolutePath, "utf-8");
          } catch (err) {
            oldContent = "";
          }
        }

        return {
          path: file.path,
          diff: buildSimpleDiff(oldContent, file.content || "")
        };
      });

      sendJson(res, 200, { diffs });
      return;
    }

    if (req.method === "POST" && req.url === "/api/ai/write") {
      const rawBody = await readRequestBody(req);
      let body;

      try {
        body = JSON.parse(rawBody || "{}");
      } catch (err) {
        sendJson(res, 400, { error: "Invalid JSON body" });
        return;
      }

      const draft = body && typeof body === "object" ? body.draft : null;
      const userRequest = typeof body.request === "string" ? body.request.trim() : "";

      if (!draft || typeof draft !== "object") {
        sendJson(res, 400, { error: "Draft payload is required" });
        return;
      }

      const result = writeApprovedDraft(draft, userRequest);
      sendJson(res, 200, result);
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (err) {
    sendJson(res, 500, { error: err.message || "Server error" });
  }
});

server.listen(3000, () => {
  console.log("Forge AI Workspace running at http://localhost:3000");
});