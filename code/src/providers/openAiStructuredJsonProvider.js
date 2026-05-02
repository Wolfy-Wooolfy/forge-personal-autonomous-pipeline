"use strict";

class OpenAiStructuredJsonProvider {
  constructor(config = {}) {
    this.config = config;
    this.name = "openai_structured_json";
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY || "";
    this.model = config.model || process.env.OPENAI_STRUCTURED_MODEL || "gpt-4.1-mini";
  }

  extractJsonText(rawText) {
    const text = String(rawText || "").trim();

    if (!text) {
      return "";
    }

    const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);

    if (fencedMatch && fencedMatch[1]) {
      return fencedMatch[1].trim();
    }

    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");

    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return text.slice(firstBrace, lastBrace + 1).trim();
    }

    return text;
  }

  async executeTask(task = {}) {
    if (!this.apiKey) {
      return {
        status: "FAILED",
        output: null,
        metadata: {
          provider: this.name,
          reason: "OPENAI_API_KEY_MISSING"
        }
      };
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "Return valid JSON only. Do not include markdown or prose outside JSON."
          },
          {
            role: "user",
            content: [
              String(task.system || "You are a structured JSON generation provider for a governed AI OS."),
              "",
              "Task:",
              String(task.request || ""),
              "",
              "Context:",
              JSON.stringify(task.context || {}, null, 2),
              "",
              "Expected output schema:",
              JSON.stringify(task.expected_output || {}, null, 2)
            ].join("\n")
          }
        ]
      })
    });

    if (!response.ok) {
      return {
        status: "FAILED",
        output: null,
        metadata: {
          provider: this.name,
          reason: "OPENAI_HTTP_ERROR",
          status_code: response.status,
          response_text: await response.text()
        }
      };
    }

    const payload = await response.json();
    const content =
      payload &&
      payload.choices &&
      payload.choices[0] &&
      payload.choices[0].message &&
      typeof payload.choices[0].message.content === "string"
        ? payload.choices[0].message.content
        : "";

    try {
      return {
        status: "SUCCESS",
        output: JSON.parse(this.extractJsonText(content)),
        metadata: {
          provider: this.name,
          model: this.model
        }
      };
    } catch (err) {
      return {
        status: "FAILED",
        output: null,
        metadata: {
          provider: this.name,
          reason: "INVALID_JSON_OUTPUT",
          error: err && err.message ? err.message : String(err)
        }
      };
    }
  }
}

module.exports = OpenAiStructuredJsonProvider;
