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
- Do not write anything inside Forge pipeline governance paths unless explicitly requested
- Prefer paths under artifacts/llm/, web/, or code/tools/ unless the request clearly requires another location

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

  if (!Array.isArray(parsed.files)) {
    throw new Error("Draft payload missing files array");
  }

  const normalizedFiles = parsed.files.map(file => {
    const filePath = typeof file.path === "string" ? file.path.trim() : "";
    const fileContent = typeof file.content === "string" ? file.content : "";

    if (!filePath) {
      throw new Error("Draft contains invalid file path");
    }

    if (path.isAbsolute(filePath)) {
      throw new Error("Absolute paths are not allowed");
    }

    return {
      path: filePath.replace(/\\/g, "/"),
      content: fileContent
    };
  });

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

    sendJson(res, 404, { error: "Not found" });
  } catch (err) {
    sendJson(res, 500, { error: err.message || "Server error" });
  }
});

server.listen(3000, () => {
  console.log("Forge AI Workspace running at http://localhost:3000");
});