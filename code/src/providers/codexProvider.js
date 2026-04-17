const { execFile, exec } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const execAsync = promisify(exec);

class CodexProvider {
  constructor(config = {}) {
    this.config = config;
    this.name = "codex";
    this.command = config.command || process.env.FORGE_CODEX_COMMAND || "C:\\Users\\Khaled\\AppData\\Roaming\\npm\\codex.cmd";
    this.args = Array.isArray(config.args) ? config.args : [];
  }

  quoteForWindowsCmd(value) {
    return `"${String(value || "").replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
  }

  async isAvailable() {
    try {
      if (process.platform === "win32") {
        await execAsync(`"${this.command}" --version`, {
          timeout: 10000,
          windowsHide: true
        });
      } else {
        await execFileAsync(this.command, ["--version"], { timeout: 10000 });
      }

      return true;
    } catch (err) {
      return false;
    }
  }

  buildPrompt(task) {
    const safeTask = task && typeof task === "object" ? task : {};
    const safeRequest = String(safeTask.request || "").replace(/"/g, "'").replace(/\r?\n/g, " ");
    const targetFiles =
      safeTask.context && Array.isArray(safeTask.context.target_files)
        ? safeTask.context.target_files.join(", ")
        : "";
    const operationType =
      safeTask.context && typeof safeTask.context.operation_type === "string"
        ? safeTask.context.operation_type
        : "";
    const constraints =
      safeTask.context && Array.isArray(safeTask.context.constraints)
        ? safeTask.context.constraints.join(" | ")
        : "";
    const expectedType =
      safeTask.expected_output && typeof safeTask.expected_output.type === "string"
        ? safeTask.expected_output.type
        : "";
    const expectedFormat =
      safeTask.expected_output && typeof safeTask.expected_output.format === "string"
        ? safeTask.expected_output.format
        : "";

    return [
      "Forge governed task.",
      "Return valid JSON only.",
      "No markdown fences.",
      "No explanations.",
      "Use this exact top-level structure:",
      "task_id, status, output, metadata",
      "status must be SUCCESS or FAILED",
      "output.files must be an array",
      "Each file item must contain: path, content, diff",
      `task_id: ${safeTask.task_id || ""}`,
      `request: ${safeRequest}`,
      `target_files: ${targetFiles}`,
      `operation_type: ${operationType}`,
      `constraints: ${constraints}`,
      `expected_type: ${expectedType}`,
      `expected_format: ${expectedFormat}`
    ].join("\n");
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

    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const line = lines[i];

      if (line.startsWith("{") && line.endsWith("}")) {
        try {
          JSON.parse(line);
          return line;
        } catch (err) {
        }
      }
    }

    for (let start = text.lastIndexOf("{"); start >= 0; start = text.lastIndexOf("{", start - 1)) {
      const candidate = text.slice(start).trim();

      try {
        JSON.parse(candidate);
        return candidate;
      } catch (err) {
      }
    }

    return "";
  }

  normalizeFiles(files) {
    if (!Array.isArray(files)) {
      return [];
    }

    return files
      .map((file) => ({
        path: typeof file.path === "string" ? file.path.trim() : "",
        content: typeof file.content === "string" ? file.content : "",
        diff: typeof file.diff === "string" ? file.diff : ""
      }))
      .filter((file) => file.path.length > 0);
  }

  parseStructuredOutput(stdout, fallbackTaskId) {
    const jsonText = this.extractJsonText(stdout);

    if (!jsonText) {
      return null;
    }

    try {
      const parsed = JSON.parse(jsonText);
      const files = this.normalizeFiles(
        parsed && parsed.output ? parsed.output.files : []
      );

      return {
        task_id:
          parsed && typeof parsed.task_id === "string"
            ? parsed.task_id
            : (fallbackTaskId || ""),
        status:
          parsed && typeof parsed.status === "string"
            ? parsed.status
            : "SUCCESS",
        output: {
          files
        },
        metadata:
          parsed && parsed.metadata && typeof parsed.metadata === "object"
            ? parsed.metadata
            : {}
      };
    } catch (err) {
      return null;
    }
  }

  async executeTask(task) {
    if (!task || typeof task !== "object") {
      throw new Error("Invalid task payload.");
    }

    const available = await this.isAvailable();

    if (!available) {
      return {
        task_id: task.task_id || "",
        status: "UNAVAILABLE",
        output: {
          files: []
        },
        metadata: {
          engine: "codex",
          command: this.command,
          note: "Codex CLI is not available on this machine"
        }
      };
    }

    try {
      const prompt = this.buildPrompt(task);

      let stdout = "";
      let stderr = "";

      if (process.platform === "win32") {
        const result = await execAsync(
          `"${this.command}" exec ${this.quoteForWindowsCmd(prompt)}`,
          {
            timeout: 120000,
            maxBuffer: 1024 * 1024 * 10,
            windowsHide: true
          }
        );

        stdout = result.stdout || "";
        stderr = result.stderr || "";
      } else {
        const result = await execFileAsync(
          this.command,
          [...this.args, "exec", prompt],
          { timeout: 120000, maxBuffer: 1024 * 1024 * 10 }
        );

        stdout = result.stdout || "";
        stderr = result.stderr || "";
      }

      const parsed = this.parseStructuredOutput(stdout, task.task_id || "");

      if (parsed) {
        return {
          task_id: parsed.task_id,
          status: parsed.status || "SUCCESS",
          output: {
            raw_stdout: stdout || "",
            raw_stderr: stderr || "",
            files: Array.isArray(parsed.output && parsed.output.files)
              ? parsed.output.files
              : []
          },
          metadata: {
            engine: "codex",
            command: this.command,
            ...(parsed.metadata || {})
          }
        };
      }

      return {
        task_id: task.task_id || "",
        status: "SUCCESS",
        output: {
          raw_stdout: stdout || "",
          raw_stderr: stderr || "",
          files: []
        },
        metadata: {
          engine: "codex",
          command: this.command,
          note: "Codex CLI executed successfully but structured JSON parsing failed"
        }
      };
    } catch (err) {
      return {
        task_id: task.task_id || "",
        status: "FAILED",
        output: {
          files: []
        },
        metadata: {
          engine: "codex",
          command: this.command,
          error: err && err.message ? err.message : "Unknown Codex execution error"
        }
      };
    }
  }
}

module.exports = CodexProvider;