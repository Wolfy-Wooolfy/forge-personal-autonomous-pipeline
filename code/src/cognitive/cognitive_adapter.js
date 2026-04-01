const fs = require("fs");
const path = require("path");

function validateRequest(request) {
  if (!request) throw new Error("CognitiveAdapter: request is required");

  if (!request.request_id) throw new Error("Missing request_id");
  if (!request.timestamp) throw new Error("Missing timestamp");
  if (!request.task_context) throw new Error("Missing task_context");
  if (!request.input) throw new Error("Missing input");

  if (request.constraints) {
    if (request.constraints.temperature !== 0) {
      throw new Error("Non-deterministic temperature is not allowed");
    }
  }
}

function buildNormalizedResponse(rawResponse, request) {
  return {
    response_id: `RESP-${Date.now()}`,
    request_id: request.request_id,
    provider_metadata: {
      provider: "NONE",
      model: "NONE",
      latency_ms: 0
    },
    output: {
      type: typeof rawResponse === "object" ? "structured" : "text",
      content: rawResponse
    },
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0
    },
    status: "SUCCESS"
  };
}

function storeArtifacts(normalizedResponse) {
  const baseDir = path.resolve("artifacts/cognitive");
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }

  const fileName = `${normalizedResponse.response_id}.json`;
  const filePath = path.join(baseDir, fileName);

  fs.writeFileSync(filePath, JSON.stringify(normalizedResponse, null, 2));
}

function executeCognitive(request, handler) {
  validateRequest(request);

  if (typeof handler !== "function") {
    throw new Error("CognitiveAdapter: handler must be a function");
  }

  const start = Date.now();

  const rawResponse = handler(request.input);

  const latency = Date.now() - start;

  const normalized = buildNormalizedResponse(rawResponse, request);

  normalized.provider_metadata.latency_ms = latency;

  storeArtifacts(normalized);

  return normalized;
}

module.exports = {
  executeCognitive
};