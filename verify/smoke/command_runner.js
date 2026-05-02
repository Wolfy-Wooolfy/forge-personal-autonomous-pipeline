const { spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function ensureDir(absPath) {
  fs.mkdirSync(absPath, { recursive: true });
}

function sha256File(absPath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(absPath));
  return hash.digest("hex");
}

function stampForFile(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function appendJsonl(absPath, payload) {
  fs.appendFileSync(absPath, `${JSON.stringify(payload)}\n`, "utf8");
}

function runLoggedCommand(command, args, options = {}) {
  const repoRoot = path.resolve(__dirname, "../..");
  const stage = String(options.stage || "D").toUpperCase();
  const now = new Date();
  const stamp = stampForFile(now);
  const safeLabel = String(options.label || command).replace(/[^A-Za-z0-9_-]+/g, "_");
  const outputDir = path.resolve(repoRoot, "verify", "smoke", "command_output");
  const logPath = path.resolve(repoRoot, "verify", "smoke", "local_command_log.jsonl");
  const stdoutPath = path.resolve(outputDir, `CMD-${stamp}-${stage}-${safeLabel}-stdout.txt`);
  const stderrPath = path.resolve(outputDir, `CMD-${stamp}-${stage}-${safeLabel}-stderr.txt`);

  ensureDir(outputDir);

  const result = spawnSync(command, Array.isArray(args) ? args : [], {
    cwd: path.resolve(options.cwd || repoRoot),
    encoding: "utf8",
    shell: false
  });

  fs.writeFileSync(stdoutPath, result.stdout || "", "utf8");
  fs.writeFileSync(stderrPath, result.stderr || (result.error ? String(result.error.message || result.error) : ""), "utf8");

  const exitCode = typeof result.status === "number" ? result.status : 1;

  appendJsonl(logPath, {
    timestamp_utc: now.toISOString(),
    stage,
    working_directory: path.resolve(options.cwd || repoRoot),
    command: [command, ...(Array.isArray(args) ? args : [])].join(" "),
    exit_code: exitCode,
    stdout_path: path.relative(repoRoot, stdoutPath).replace(/\\/g, "/"),
    stderr_path: path.relative(repoRoot, stderrPath).replace(/\\/g, "/"),
    stdout_sha256: sha256File(stdoutPath),
    stderr_sha256: sha256File(stderrPath)
  });

  if (result.error) {
    throw result.error;
  }

  if (exitCode !== 0) {
    const err = new Error(`${command} ${(Array.isArray(args) ? args : []).join(" ")} failed with exit code ${exitCode}`);
    err.exitCode = exitCode;
    throw err;
  }

  return result;
}

if (require.main === module) {
  const [, , stage, command, ...args] = process.argv;
  try {
    runLoggedCommand(command, args, { stage: stage || "D", label: path.basename(command || "command") });
  } catch (err) {
    process.exitCode = typeof err.exitCode === "number" ? err.exitCode : 1;
  }
}

module.exports = {
  runLoggedCommand
};
