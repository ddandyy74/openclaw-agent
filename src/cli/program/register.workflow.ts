import type { Command } from "commander";
import { defaultRuntime } from "../../runtime.js";
import { formatDocsLink } from "../../terminal/links.js";
import { theme } from "../../terminal/theme.js";
import { runCommandWithRuntime } from "../cli-utils.js";
import { createWorkflowListCommand, createWorkflowStatusCommand, createWorkflowSubmitCommand } from "../workflow-cli.js";

export function registerWorkflowCommands(program: Command) {
  const workflow = program
    .command("workflow")
    .alias("wf")
    .description("Workflow management and execution")
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/workflow", "docs.openclaw.ai/cli/workflow")}\n`,
    );

  workflow
    .command("list")
    .description("List workflows")
    .option("--status <status>", "Filter by status (pending|running|completed|failed|cancelled)")
    .option("--limit <n>", "Limit number of results", "20")
    .option("--json", "Output as JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await createWorkflowListCommand({
          status: opts.status,
          limit: parseInt(opts.limit, 10),
          json: opts.json,
        });
      });
    });

  workflow
    .command("status")
    .description("Show workflow status")
    .requiredOption("--id <workflow-id>", "Workflow ID")
    .option("--json", "Output as JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await createWorkflowStatusCommand({
          workflowId: opts.id,
          json: opts.json,
        });
      });
    });

  workflow
    .command("submit")
    .description("Submit a new workflow")
    .requiredOption("--file <path>", "Workflow definition file (YAML or JSON)")
    .option("--name <name>", "Workflow name")
    .option("--priority <priority>", "Priority (low|normal|high)", "normal")
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await createWorkflowSubmitCommand({
          file: opts.file,
          name: opts.name,
          priority: opts.priority,
        });
      });
    });

  workflow
    .command("cancel")
    .description("Cancel a running workflow")
    .requiredOption("--id <workflow-id>", "Workflow ID")
    .option("--force", "Force cancellation", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        console.log("Workflow cancellation not yet implemented");
        defaultRuntime.exit(0);
      });
    });

  workflow
    .command("validate")
    .description("Validate a workflow definition file")
    .requiredOption("--file <path>", "Workflow definition file (YAML or JSON)")
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        console.log("Workflow validation not yet implemented");
        defaultRuntime.exit(0);
      });
    });
}
