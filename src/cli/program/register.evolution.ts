import type { Command } from "commander";
import { defaultRuntime } from "../../runtime.js";
import { formatDocsLink } from "../../terminal/links.js";
import { theme } from "../../terminal/theme.js";
import { runCommandWithRuntime } from "../cli-utils.js";
import { createEvolutionStatsCommand, createEvolutionRunCommand, createEvolutionReportCommand } from "../evolution-cli.js";

export function registerEvolutionCommands(program: Command) {
  const evolution = program
    .command("evolution")
    .description("Agent self-evolution and learning management")
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/evolution", "docs.openclaw.ai/cli/evolution")}\n`,
    );

  evolution
    .command("stats")
    .description("Show evolution statistics for agents")
    .option("--agent <id>", "Filter by agent ID")
    .option("--json", "Output as JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await createEvolutionStatsCommand({
          agentId: opts.agent,
          json: opts.json,
        });
      });
    });

  evolution
    .command("run")
    .description("Run an evolution cycle for agents")
    .option("--agent <id>", "Target specific agent ID")
    .option("--all", "Run for all agents", false)
    .option("--dry-run", "Preview without making changes", false)
    .option("--force", "Force evolution even if conditions not met", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await createEvolutionRunCommand({
          agentId: opts.agent,
          all: opts.all,
          dryRun: opts.dryRun,
          force: opts.force,
        });
      });
    });

  evolution
    .command("report")
    .description("Show evolution reports")
    .option("--latest", "Show latest report only", false)
    .option("--agent <id>", "Filter by agent ID")
    .option("--status <status>", "Filter by status (pending|running|completed|failed)")
    .option("--limit <n>", "Limit number of reports", "10")
    .option("--json", "Output as JSON", false)
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await createEvolutionReportCommand({
          latest: opts.latest,
          agentId: opts.agent,
          status: opts.status,
          limit: parseInt(opts.limit, 10),
          json: opts.json,
        });
      });
    });
}
