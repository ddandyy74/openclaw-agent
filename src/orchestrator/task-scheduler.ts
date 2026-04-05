/**
 * Task Scheduler Implementation
 * 
 * Manages task scheduling, assignment, and completion.
 */

import type {
  ITaskScheduler,
  ITaskQueue,
  IAgentManager,
  Task,
  TaskAssignment,
  TaskCompletion,
  TaskDefinition,
  TaskResult,
  TaskStatus,
} from "./index.js";

export class TaskScheduler implements ITaskScheduler {
  private taskQueue: ITaskQueue;
  private agentManager: IAgentManager;
  private assignments: Map<string, TaskAssignment> = new Map();
  private completions: Map<string, TaskCompletion> = new Map();

  constructor(options: { taskQueue: ITaskQueue; agentManager: IAgentManager }) {
    this.taskQueue = options.taskQueue;
    this.agentManager = options.agentManager;
  }

  async schedule(task: TaskDefinition): Promise<string> {
    return this.taskQueue.enqueue(task);
  }

  async cancel(taskId: string): Promise<void> {
    const task = await this.taskQueue.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    if (task.status === "running") {
      const assignment = this.assignments.get(taskId);
      if (assignment) {
        const agent = await this.agentManager.getAgent(assignment.agentId);
        if (agent) {
          await this.agentManager.updateAgentStatus(agent.id, "idle");
        }
      }
    }

    task.status = "cancelled";
    task.completedAt = Date.now();
    await this.taskQueue.update(task);
  }

  async retry(taskId: string): Promise<void> {
    const task = await this.taskQueue.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    if (task.status !== "failed") {
      throw new Error(`Cannot retry task in ${task.status} status`);
    }

    task.status = "pending";
    task.retryCount++;
    task.startedAt = undefined;
    task.completedAt = undefined;
    task.result = undefined;

    await this.taskQueue.update(task);
  }

  async getNextTask(): Promise<Task | undefined> {
    return this.taskQueue.dequeue();
  }

  async assignTask(taskId: string, agentId: string): Promise<TaskAssignment> {
    const task = await this.taskQueue.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    if (task.status !== "running" && task.status !== "pending") {
      throw new Error(`Cannot assign task in ${task.status} status`);
    }

    const agent = await this.agentManager.getAgent(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }

    if (agent.status !== "idle" && agent.status !== "waiting") {
      throw new Error(`Agent ${agentId} is not available (status: ${agent.status})`);
    }

    task.status = "running";
    task.assignedAgent = agentId;
    task.startedAt = task.startedAt ?? Date.now();
    await this.taskQueue.update(task);

    await this.agentManager.updateAgentStatus(agentId, "busy");

    const assignment: TaskAssignment = {
      taskId,
      agentId,
      assignedAt: Date.now(),
      reason: `Assigned based on agent availability and task requirements`,
    };

    this.assignments.set(taskId, assignment);
    return assignment;
  }

  async completeTask(taskId: string, result: TaskResult): Promise<TaskCompletion> {
    const task = await this.taskQueue.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    if (task.status !== "running") {
      throw new Error(`Cannot complete task in ${task.status} status`);
    }

    task.status = result.status;
    task.result = result;
    task.completedAt = Date.now();
    await this.taskQueue.update(task);

    const assignment = this.assignments.get(taskId);
    if (assignment) {
      const agent = await this.agentManager.getAgent(assignment.agentId);
      if (agent) {
        const runningTasks = await this.getAgentRunningTasks(assignment.agentId);
        if (runningTasks.length <= 1) {
          await this.agentManager.updateAgentStatus(assignment.agentId, "idle");
        }
      }
    }

    const completion: TaskCompletion = {
      taskId,
      agentId: result.agentId,
      result,
      completedAt: Date.now(),
    };

    this.completions.set(taskId, completion);
    return completion;
  }

  async getAssignment(taskId: string): Promise<TaskAssignment | undefined> {
    return this.assignments.get(taskId);
  }

  async getCompletion(taskId: string): Promise<TaskCompletion | undefined> {
    return this.completions.get(taskId);
  }

  private async getAgentRunningTasks(agentId: string): Promise<Task[]> {
    const tasks = await this.taskQueue.list({ status: "running" });
    return tasks.filter((t) => t.assignedAgent === agentId);
  }

  async findBestAgent(
    task: TaskDefinition,
    agents?: Awaited<ReturnType<IAgentManager["listAgents"]>>
  ): Promise<string | undefined> {
    const availableAgents = agents ?? await this.agentManager.listAgents({ status: "idle" });

    if (availableAgents.length === 0) {
      return undefined;
    }

    let bestAgent = availableAgents[0];
    let bestScore = 0;

    for (const agent of availableAgents) {
      let score = 0;

      if (task.agentRole && agent.role === task.agentRole) {
        score += 10;
      }

      if (task.agentId && agent.id === task.agentId) {
        score += 20;
      }

      for (const capability of task.metadata?.requiredCapabilities as string[] ?? []) {
        if (agent.capabilities.includes(capability)) {
          score += 5;
        }
      }

      score += (agent.maxConcurrentTasks - agent.currentTasks);

      if (score > bestScore) {
        bestScore = score;
        bestAgent = agent;
      }
    }

    return bestAgent.id;
  }
}
