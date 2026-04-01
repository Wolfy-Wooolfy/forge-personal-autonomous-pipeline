const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function ensureObject(value, fieldName) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object`);
  }
}

function ensureNonEmptyString(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
}

function ensureNumber(value, fieldName) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`${fieldName} must be a valid number`);
  }
}

function validateRequest(request) {
  ensureObject(request, "request");
  ensureNonEmptyString(request.request_id, "request.request_id");
  ensureNonEmptyString(request.timestamp, "request.timestamp");
  ensureObject(request.task_context, "request.task_context");
  ensureNonEmptyString(request.task_context.task_id, "request.task_context.task_id");
  ensureNonEmptyString(request.task_context.module, "request.task_context.module");
  ensureObject(request.input, "request.input");
  ensureNonEmptyString(request.input.type, "request.input.type");

  if (!["structured", "text", "hybrid"].includes(request.input.type)) {
    throw new Error("request.input.type must be one of: structured, text, hybrid");
  }

  if (!Object.prototype.hasOwnProperty.call(request.input, "content")) {
    throw new Error("request.input.content is required");
  }

  ensureObject(request.constraints, "request.constraints");

  if (request.constraints.deterministic !== true) {
    throw new Error("request.constraints.deterministic must be true");
  }

  ensureNumber(request.constraints.max_tokens, "request.constraints.max_tokens");

  if (request.constraints.temperature !== 0) {
    throw new Error("request.constraints.temperature must be 0");
  }
}

function makeResponseId() {
  if (typeof crypto.randomUUID === "function") {
    return `RESP-${crypto.randomUUID()}`;
  }

  return `RESP-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function inferOutputType(content) {
  if (content !== null && typeof content === "object") {
    return "structured";
  }

  return "text";
}

function normalizeSuccessResult(handlerResult, request, responseId, latencyMs) {
  const providerMetadata =
    handlerResult &&
    typeof handlerResult === "object" &&
    !Array.isArray(handlerResult) &&
    handlerResult.provider_metadata &&
    typeof handlerResult.provider_metadata === "object"
      ? handlerResult.provider_metadata
      : {};

  const usage =
    handlerResult &&
    typeof handlerResult === "object" &&
    !Array.isArray(handlerResult) &&
    handlerResult.usage &&
    typeof handlerResult.usage === "object"
      ? handlerResult.usage
      : {};

  const outputContent =
    handlerResult &&
    typeof handlerResult === "object" &&
    !Array.isArray(handlerResult) &&
    Object.prototype.hasOwnProperty.call(handlerResult, "output")
      ? handlerResult.output
      : handlerResult;

  return {
    response_id: responseId,
    request_id: request.request_id,
    provider_metadata: {
      provider:
        typeof providerMetadata.provider === "string" && providerMetadata.provider.trim() !== ""
          ? providerMetadata.provider
          : "NONE",
      model:
        typeof providerMetadata.model === "string" && providerMetadata.model.trim() !== ""
          ? providerMetadata.model
          : "NONE",
      latency_ms: latencyMs
    },
    output: {
      type: inferOutputType(outputContent),
      content: outputContent
    },
    usage: {
      prompt_tokens:
        typeof usage.prompt_tokens === "number" && !Number.isNaN(usage.prompt_tokens)
          ? usage.prompt_tokens
          : 0,
      completion_tokens:
        typeof usage.completion_tokens === "number" && !Number.isNaN(usage.completion_tokens)
          ? usage.completion_tokens
          : 0
    },
    status: "SUCCESS"
  };
}

function normalizeFailureResult(error, request, responseId, latencyMs) {
  return {
    response_id: responseId,
    request_id: request.request_id,
    provider_metadata: {
      provider: "NONE",
      model: "NONE",
      latency_ms: latencyMs
    },
    output: {
      type: "structured",
      content: {
        error: error.message
      }
    },
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0
    },
    status: "FAILED"
  };
}

function validateNormalizedResponse(normalizedResponse, request) {
  ensureObject(normalizedResponse, "normalizedResponse");
  ensureNonEmptyString(normalizedResponse.response_id, "normalizedResponse.response_id");
  ensureNonEmptyString(normalizedResponse.request_id, "normalizedResponse.request_id");

  if (normalizedResponse.request_id !== request.request_id) {
    throw new Error("normalizedResponse.request_id must match request.request_id");
  }

  ensureObject(normalizedResponse.provider_metadata, "normalizedResponse.provider_metadata");
  ensureNonEmptyString(
    normalizedResponse.provider_metadata.provider,
    "normalizedResponse.provider_metadata.provider"
  );
  ensureNonEmptyString(
    normalizedResponse.provider_metadata.model,
    "normalizedResponse.provider_metadata.model"
  );
  ensureNumber(
    normalizedResponse.provider_metadata.latency_ms,
    "normalizedResponse.provider_metadata.latency_ms"
  );

  ensureObject(normalizedResponse.output, "normalizedResponse.output");
  ensureNonEmptyString(normalizedResponse.output.type, "normalizedResponse.output.type");

  if (!["structured", "text"].includes(normalizedResponse.output.type)) {
    throw new Error("normalizedResponse.output.type must be one of: structured, text");
  }

  if (!Object.prototype.hasOwnProperty.call(normalizedResponse.output, "content")) {
    throw new Error("normalizedResponse.output.content is required");
  }

  ensureObject(normalizedResponse.usage, "normalizedResponse.usage");
  ensureNumber(normalizedResponse.usage.prompt_tokens, "normalizedResponse.usage.prompt_tokens");
  ensureNumber(
    normalizedResponse.usage.completion_tokens,
    "normalizedResponse.usage.completion_tokens"
  );

  ensureNonEmptyString(normalizedResponse.status, "normalizedResponse.status");

  if (!["SUCCESS", "FAILED"].includes(normalizedResponse.status)) {
    throw new Error("normalizedResponse.status must be SUCCESS or FAILED");
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function storeArtifacts(responseId, rawResponse, normalizedResponse) {
  const baseDir = path.resolve(process.cwd(), "artifacts", "cognitive", responseId);
  fs.mkdirSync(baseDir, { recursive: true });

  writeJson(path.join(baseDir, "raw_response.json"), rawResponse);
  writeJson(path.join(baseDir, "normalized_response.json"), normalizedResponse);
}

async function executeCognitive(request, handler) {
  validateRequest(request);

  if (typeof handler !== "function") {
    throw new Error("handler must be a function");
  }

  const responseId = makeResponseId();
  const startedAt = Date.now();

  try {
    const handlerResult = await Promise.resolve(handler(request));
    const latencyMs = Date.now() - startedAt;

    const rawResponse = {
      response_id: responseId,
      request_id: request.request_id,
      status: "SUCCESS",
      payload: handlerResult
    };

    const normalizedResponse = normalizeSuccessResult(
      handlerResult,
      request,
      responseId,
      latencyMs
    );

    validateNormalizedResponse(normalizedResponse, request);
    storeArtifacts(responseId, rawResponse, normalizedResponse);

    return normalizedResponse;
  } catch (error) {
    const latencyMs = Date.now() - startedAt;

    const rawResponse = {
      response_id: responseId,
      request_id: request.request_id,
      status: "FAILED",
      payload: {
        error: error.message
      }
    };

    const normalizedResponse = normalizeFailureResult(
      error,
      request,
      responseId,
      latencyMs
    );

    validateNormalizedResponse(normalizedResponse, request);
    storeArtifacts(responseId, rawResponse, normalizedResponse);

    return normalizedResponse;
  }
}

module.exports = {
  executeCognitive
};