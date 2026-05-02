const { runLoggedCommand } = require("./command_runner");

function run(cmd, args) {
  runLoggedCommand(cmd, args, { stage: "D", label: args[0] || cmd });
}

function main() {
  run("node", ["verify/smoke/runner_smoke.js"]);
  run("node", ["verify/smoke/runner_dry_run_smoke.js"]);
  run("node", ["verify/smoke/stage_transitions_smoke.js"]);
  run("node", ["verify/smoke/status_writer_smoke.js"]);
  process.exitCode = 0;
}

main();
