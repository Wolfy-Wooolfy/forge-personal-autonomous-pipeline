class CodexProvider {
  constructor(config = {}) {
    this.config = config;
    this.name = "codex";
  }

  async executeTask(task) {
    if (!task || typeof task !== "object") {
      throw new Error("Invalid task payload.");
    }

    return {
      task_id: task.task_id || "",
      status: "NOT_IMPLEMENTED",
      output: {
        files: []
      },
      metadata: {
        engine: "codex",
        note: "Codex provider not connected yet"
      }
    };
  }
}

module.exports = CodexProvider;