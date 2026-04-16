const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

class CodexProvider {
  constructor(config = {}) {
    this.config = config;
    this.name = "codex";
    this.command = config.command || process.env.FORGE_CODEX_COMMAND || "codex";
    this.args = Array.isArray(config.args) ? config.args : [];
  }

  async isAvailable() {
    try {
      await execFileAsync(this.command, ["--version"], { timeout: 10000 });
      return true;
    } catch (err) {
      return false;
    }
  }

  buildPrompt(task) {
    const safeTask = task && typeof task === "object" ? task : {};

    return JSON.stringify({
      task_id: safeTask.task_id || "",
      request: safeTask.request || "",
      context: safeTask.context || {},
      expected_output: safeTask.expected_output || {}
    }, null, 2);
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

      const { stdout, stderr } = await execFileAsync(
        this.command,
        [...this.args, "exec", prompt],
        { timeout: 120000, maxBuffer: 1024 * 1024 * 10 }
      );

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
          note: "Codex CLI executed successfully but structured file extraction is not implemented yet"
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