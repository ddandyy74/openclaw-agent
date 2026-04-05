import { Orchestrator } from "../orchestrator/index.js";
import { FileStateStore } from "../persistence/state-store.js";
import { resolveOpenClawAgentDir } from "../agents/agent-paths.js";
import path from "node:path";
import { theme } from "../terminal/theme.js";
import chalk from "chalk";
import type { AgentRole, AgentStatus, TaskStatus } from "../orchestrator/types.js";

type OrchestratorStatusOptions = {
  json: boolean;
};

type OrchestratorAgentsOptions = {
  role?: string;
  status?: string;
  json: boolean;
};

type OrchestratorTasksOptions = {
  status?: string;
  limit: number;
  json: boolean;
};

function getOrchestratorDir(): string {
  return path.join(resolveOpenClawAgentDir(), "orchestrator");
}

export async function createOrchestratorStatusCommand(opts: OrchestratorStatusOptions): Promise<void> {
  const orchestratorDir = getOrchestratorDir();
  const stateStore = new FileStateStore({ basePath: orchestratorDir });
  const orchestrator = new Orchestrator({ stateStore });

  try {
    await orchestrator.initialize({
      mode: "coordinator-worker",
      maxAgents: 100,
      taskTimeout: 300000,
      heartbeatInterval: 30000,
      retryDelay: 5000,
      maxRetries: 3,
    });

    const state = await orchestrator.getState();

    if (opts.json) {
      const stateObj = {
        agentsCount: state.agents.size,
        tasksCount: state.tasks.size,
        teamsCount: state.teams.size,
        taskQueueLength: state.taskQueue.length,
      };
      console.log(JSON.stringify(stateObj, null, 2));
    } else {
      console.log(theme.heading("\nOrchestrator Status\n"));
      console.log(`Agents: ${state.agents.size}`);
      console.log(`Tasks: ${state.tasks.size}`);
      console.log(`Teams: ${state.teams.size}`);
      console.log(`Queued Tasks: ${state.taskQueue.length}`);
    }
  } finally {
    await orchestrator.shutdown();
  }
}

export async function createOrchestratorAgentsCommand(opts: OrchestratorAgentsOptions): Promise<void> {
  const orchestratorDir = getOrchestratorDir();
  const stateStore = new FileStateStore({ basePath: orchestratorDir });
  const orchestrator = new Orchestrator({ stateStore });

  try {
    await orchestrator.initialize({
      mode: "coordinator-worker",
      maxAgents: 100,
      taskTimeout: 300000,
      heartbeatInterval: 30000,
      retryDelay: 5000,
      maxRetries: 3,
    });

    const agentManager = orchestrator.getAgentManager();
    const filter: { role?: AgentRole; status?: AgentStatus } = {};
    if (opts.role) filter.role = opts.role as AgentRole;
    if (opts.status) filter.status = opts.status as AgentStatus;

    const agents = await agentManager.listAgents(filter);

    if (opts.json) {
      console.log(JSON.stringify(agents, null, 2));
    } else {
      if (agents.length === 0) {
        console.log(theme.muted("No agents found."));
        return;
      }

      console.log(theme.heading(`\nRegistered Agents (${agents.length})\n`));

      for (const agent of agents) {
        const statusColor = agent.status === "idle" ? theme.success : agent.status === "busy" ? theme.warn : theme.error;
        console.log(chalk.bold(agent.id));
        console.log(`  Role: ${agent.role}`);
        console.log(`  Status: ${statusColor(agent.status)}`);
        console.log(`  Capabilities: ${agent.capabilities.join(", ") || "none"}`);
        console.log(`  Current Tasks: ${agent.currentTasks}/${agent.maxConcurrentTasks}`);
        console.log(`  Last Heartbeat: ${new Date(agent.lastHeartbeat).toISOString()}`);
        console.log();
      }
    }
  } finally {
    await orchestrator.shutdown();
  }
}

export async function createOrchestratorTasksCommand(opts: OrchestratorTasksOptions): Promise<void> {
  const orchestratorDir = getOrchestratorDir();
  const stateStore = new FileStateStore({ basePath: orchestratorDir });
  const orchestrator = new Orchestrator({ stateStore });

  try {
    await orchestrator.initialize({
      mode: "coordinator-worker",
      maxAgents: 100,
      taskTimeout: 300000,
      heartbeatInterval: 30000,
      retryDelay: 5000,
      maxRetries: 3,
    });

    const taskQueue = orchestrator.getTaskQueue();
    const filter: { status?: TaskStatus } = {};
    if (opts.status) filter.status = opts.status as TaskStatus;

    const tasks = await taskQueue.list(filter);

    const limitedTasks = tasks.slice(0, opts.limit);

    if (opts.json) {
      console.log(JSON.stringify(limitedTasks, null, 2));
    } else {
      if (limitedTasks.length === 0) {
        console.log(theme.muted("No tasks found."));
        return;
      }

      console.log(theme.heading(`\nTasks (${limitedTasks.length}${tasks.length > opts.limit ? ` of ${tasks.length}` : ""})\n`));

      for (const task of limitedTasks) {
        const statusColor = task.status === "completed" ? theme.success : task.status === "running" ? theme.warn : task.status === "failed" ? theme.error : theme.muted;
        console.log(chalk.bold(task.definition.id));
        console.log(`  Prompt: ${task.definition.prompt?.slice(0, 50) || "N/A"}...`);
        console.log(`  Priority: ${task.definition.priority}`);
        console.log(`  Status: ${statusColor(task.status)}`);
        if (task.assignedAgent) {
          console.log(`  Assigned: ${task.assignedAgent}`);
        }
        console.log(`  Created: ${new Date(task.createdAt).toISOString()}`);
        console.log();
      }
    }
  } finally {
    await orchestrator.shutdown();
  }
}
