const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const openaiDriver = require("./drivers/openai_driver");
const { resolveCognitiveConfig } = require("./cognitive_config_resolver");

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
  const rootDir = path.resolve(__dirname, "../../..");
  const baseDir = path.join(rootDir, "artifacts", "cognitive", responseId);

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

  const cognitiveConfig = resolveCognitiveConfig({
    stage_key:
      request &&
      request.task_context &&
      typeof request.task_context.module === "string" &&
      request.task_context.module.trim() !== ""
        ? request.task_context.module.trim().toUpperCase()
        : "",
    task_category:
      request &&
      request.task_context &&
      typeof request.task_context.task_category === "string" &&
      request.task_context.task_category.trim() !== ""
        ? request.task_context.task_category.trim().toUpperCase()
        : "ANALYZER",
    cognitive_engine_provider:
      request &&
      typeof request.cognitive_engine_provider === "string" &&
      request.cognitive_engine_provider.trim() !== ""
        ? request.cognitive_engine_provider.trim()
        : "",
    cognitive_engine_model_id:
      request &&
      typeof request.cognitive_engine_model_id === "string" &&
      request.cognitive_engine_model_id.trim() !== ""
        ? request.cognitive_engine_model_id.trim()
        : ""
  });

  try {
    const handlerResult = cognitiveConfig.enabled === true &&
      String(cognitiveConfig.provider_id || "").toUpperCase() === "OPENAI"
      ? await openaiDriver.execute({
          provider_id: cognitiveConfig.provider_id,
          model_id: cognitiveConfig.model_id,
          task_category: cognitiveConfig.task_category || "ANALYZER",
          prompt:
            request.input.type === "text"
              ? String(request.input.content || "")
              : JSON.stringify(request.input.content),
          timeout_ms:
            request.constraints &&
            typeof request.constraints.timeout_ms === "number" &&
            Number.isFinite(request.constraints.timeout_ms) &&
            request.constraints.timeout_ms > 0
              ? request.constraints.timeout_ms
              : 30000,
          attempt_number: 1,
          constraints: {
            max_output_tokens:
              request.constraints &&
              typeof request.constraints.max_tokens === "number" &&
              Number.isFinite(request.constraints.max_tokens) &&
              request.constraints.max_tokens > 0
                ? request.constraints.max_tokens
                : undefined
          }
        })
      : await Promise.resolve(handler(request));

    if (
      handlerResult &&
      typeof handlerResult === "object" &&
      typeof handlerResult.error_classification === "string" &&
      handlerResult.error_classification.trim() !== ""
    ) {
      throw new Error(
        `COGNITIVE_PROVIDER_FAILED: ${handlerResult.error_classification}`
      );
    }

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