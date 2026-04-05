import type { Command } from "commander";
import { defaultRuntime } from "../../runtime.js";
import { formatDocsLink } from "../../terminal/links.js";
import { theme } from "../../terminal/theme.js";
import { runCommandWithRuntime } from "../cli-utils.js";
import { createOrchestratorStatusCommand, createOrchestratorAgentsCommand, createOrchestratorTasksCommand } from "../orchestrator-cli.js";

export function registerOrchestratorCommands(program: Command) {
  const orchestrator = program
    .command("orchestrator")
    .alias("orch")
    .description("Multi-agent orchestration management")
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/orchestrator", "docs.openclaw.ai/cli/orchestrator")}\n`,
    );

  orchestrator
    .command("status")
    .description("Show orchestrator status")
    .option("--json", "Output as JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await createOrchestratorStatusCommand({
          json: opts.json,
        });
      });
    });

  orchestrator
    .command("agents")
    .description("List registered agents")
    .option("--role <role>", "Filter by role (coordinator|worker|teammate|leader)")
    .option("--status <status>", "Filter by status (idle|busy|offline)")
    .option("--json", "Output as JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await createOrchestratorAgentsCommand({
          role: opts.role,
          status: opts.status,
          json: opts.json,
        });
      });
    });

  orchestrator
    .command("tasks")
    .description("List or manage tasks")
    .option("--status <status>", "Filter by status (pending|assigned|running|completed|failed)")
    .option("--limit <n>", "Limit number of tasks", "20")
    .option("--json", "Output as JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await createOrchestratorTasksCommand({
          status: opts.status,
          limit: parseInt(opts.limit, 10),
          json: opts.json,
        });
      });
    });

  orchestrator
    .command("submit")
    .description("Submit a new task")
    .requiredOption("--type <type>", "Task type")
    .requiredOption("--priority <priority>", "Task priority (low|normal|high|urgent)")
    .option("--agent <id>", "Preferred agent ID")
    .option("--payload <json>", "Task payload as JSON string")
    .option("--timeout <seconds>", "Task timeout in seconds", "300")
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        console.log("Task submission not yet implemented");
        defaultRuntime.exit(0);
      });
    });

  orchestrator
    .command("teams")
    .description("Manage agent teams")
    .option("--list", "List all teams", false)
    .option("--create <name>", "Create a new team")
    .option("--mode <mode>", "Team collaboration mode (sequential|parallel|hierarchical|adaptive)")
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        console.log("Team management not yet implemented");
        defaultRuntime.exit(0);
      });
    });
}
