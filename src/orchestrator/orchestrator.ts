/**
 * Orchestrator Implementation
 * 
 * Central coordinator for multi-agent collaboration.
 */

import type {
  AgentInfo,
  OrchestratorConfig,
  OrchestratorState,
  Task,
  TaskDefinition,
  TaskResult,
  TeamInfo,
} from "./types.js";
import type {
  IAgentManager,
  IOrchestrator,
  ITaskQueue,
  ITaskScheduler,
  ITeamManager,
} from "./interface.js";
import { AgentManager } from "./agent-manager.js";
import { TaskQueue } from "./task-queue.js";
import { TaskScheduler } from "./task-scheduler.js";
import { TeamManager } from "./team-manager.js";
import { FileStateStore } from "../persistence/state-store.js";
import { RecoveryManager } from "../persistence/recovery-manager.js";
import type { IStateStore, ICheckpointManager } from "../persistence/types.js";

export class Orchestrator implements IOrchestrator {
  private config: OrchestratorConfig | null = null;
  private initialized = false;

  private agentManager: AgentManager;
  private taskQueue: TaskQueue;
  private taskScheduler: TaskScheduler;
  private teamManager: TeamManager;

  private stateStore: IStateStore | null = null;
  private recoveryManager: RecoveryManager | null = null;
  private checkpointManager: ICheckpointManager | null = null;

  private messageHandlers: Map<string, (message: unknown) => Promise<void>> = new Map();

  constructor(options?: {
    stateStore?: IStateStore;
    checkpointManager?: ICheckpointManager;
  }) {
    this.agentManager = new AgentManager();
    this.taskQueue = new TaskQueue();
    this.teamManager = new TeamManager();
    this.taskScheduler = new TaskScheduler({
      taskQueue: this.taskQueue,
      agentManager: this.agentManager,
    });

    if (options?.stateStore) {
      this.stateStore = options.stateStore;
    }
    if (options?.checkpointManager) {
      this.checkpointManager = options.checkpointManager;
    }
  }

  async initialize(config: OrchestratorConfig): Promise<void> {
    this.config = config;
    this.initialized = true;

    if (this.stateStore) {
      await this.loadState();
    }
  }

  async shutdown(): Promise<void> {
    if (this.stateStore) {
      await this.saveState();
    }

    this.initialized = false;
  }

  async getState(): Promise<OrchestratorState> {
    const agents = await this.agentManager.listAgents();
    const tasks = await this.taskQueue.list();
    const teams = await this.teamManager.listTeams();

    return {
      agents: new Map(agents.map((a) => [a.id, a])),
      tasks: new Map(tasks.map((t) => [t.definition.id, t])),
      teams: new Map(teams.map((t) => [t.id, t])),
      taskQueue: tasks.filter((t) => t.status === "pending").map((t) => t.definition.id),
    };
  }

  getAgentManager(): IAgentManager {
    return this.agentManager;
  }

  getTaskQueue(): ITaskQueue {
    return this.taskQueue;
  }

  getTaskScheduler(): ITaskScheduler {
    return this.taskScheduler;
  }

  getTeamManager(): ITeamManager {
    return this.teamManager;
  }

  async submitTask(task: TaskDefinition): Promise<string> {
    this.ensureInitialized();

    const fullTask: TaskDefinition = {
      ...task,
      id: task.id || this.generateTaskId(),
      priority: task.priority ?? "normal",
    };

    return this.taskScheduler.schedule(fullTask);
  }

  async cancelTask(taskId: string): Promise<void> {
    this.ensureInitialized();
    await this.taskScheduler.cancel(taskId);
  }

  async getTaskStatus(taskId: string): Promise<Task | undefined> {
    return this.taskQueue.get(taskId);
  }

  async broadcastMessage(teamId: string, message: unknown): Promise<void> {
    this.ensureInitialized();

    const team = await this.teamManager.getTeam(teamId);
    if (!team) {
      throw new Error(`Team ${teamId} not found`);
    }

    const broadcastPromises = team.members.map(async (agentId) => {
      const handler = this.messageHandlers.get(agentId);
      if (handler) {
        await handler({ type: "broadcast", teamId, message });
      }
    });

    await Promise.all(broadcastPromises);
  }

  async sendMessage(fromAgentId: string, toAgentId: string, message: unknown): Promise<void> {
    this.ensureInitialized();

    const handler = this.messageHandlers.get(toAgentId);
    if (handler) {
      await handler({ type: "direct", from: fromAgentId, message });
    }
  }

  registerMessageHandler(agentId: string, handler: (message: unknown) => Promise<void>): void {
    this.messageHandlers.set(agentId, handler);
  }

  unregisterMessageHandler(agentId: string): void {
    this.messageHandlers.delete(agentId);
  }

  setStateStore(store: IStateStore): void {
    this.stateStore = store;
  }

  setRecoveryManager(manager: RecoveryManager): void {
    this.recoveryManager = manager;
  }

  setCheckpointManager(manager: ICheckpointManager): void {
    this.checkpointManager = manager;
  }

  async saveState(): Promise<void> {
    if (!this.stateStore) {
      return;
    }

    const agents = await this.agentManager.listAgents();
    const tasks = await this.taskQueue.list();
    const teams = await this.teamManager.listTeams();

    await this.stateStore.set("agents", agents, "global", "orchestrator");
    await this.stateStore.set("tasks", tasks, "global", "orchestrator");
    await this.stateStore.set("teams", teams, "global", "orchestrator");
    await this.stateStore.set("lastSaved", Date.now(), "global", "orchestrator");
  }

  async loadState(): Promise<void> {
    if (!this.stateStore) {
      return;
    }

    const agentsData = await this.stateStore.get("agents", "global", "orchestrator");
    const tasksData = await this.stateStore.get("tasks", "global", "orchestrator");
    const teamsData = await this.stateStore.get("teams", "global", "orchestrator");

    if (agentsData && Array.isArray(agentsData)) {
      for (const agent of agentsData) {
        await this.agentManager.registerAgent(agent as Parameters<IAgentManager["registerAgent"]>[0]);
      }
    }

    if (tasksData && Array.isArray(tasksData)) {
      for (const task of tasksData) {
        await this.taskQueue.update(task as Task);
      }
    }

    if (teamsData && Array.isArray(teamsData)) {
      for (const team of teamsData) {
        const teamInfo = team as TeamInfo;
        const created = await this.teamManager.createTeam(teamInfo.name, teamInfo.mode);
        for (const memberId of teamInfo.members) {
          await this.teamManager.addMember(created.id, memberId);
        }
        if (teamInfo.leaderId) {
          await this.teamManager.setLeader(created.id, teamInfo.leaderId);
        }
      }
    }
  }

  async createRecoveryPoint(): Promise<string | undefined> {
    if (!this.recoveryManager) {
      return undefined;
    }

    const point = await this.recoveryManager.createRecoveryPoint(
      "checkpoint",
      "global",
      "orchestrator"
    );

    return point.id;
  }

  async recover(recoveryPointId: string): Promise<void> {
    if (!this.recoveryManager) {
      throw new Error("Recovery manager not configured");
    }

    const plan = await this.recoveryManager.createRecoveryPlan(recoveryPointId);
    await this.recoveryManager.executeRecoveryPlan(plan);
    await this.loadState();
  }

  async processNextTask(): Promise<Task | undefined> {
    this.ensureInitialized();

    const task = await this.taskScheduler.getNextTask();
    if (!task) {
      return undefined;
    }

    const agents = this.agentManager.getAvailableAgents(
      task.definition.agentRole,
      this.config?.maxAgents
    );

    if (agents.length === 0) {
      await this.taskQueue.update(task);
      return undefined;
    }

    const agentId = task.definition.agentId ?? agents[0].id;
    await this.taskScheduler.assignTask(task.definition.id, agentId);

    return task;
  }

  async completeTask(taskId: string, result: TaskResult): Promise<void> {
    this.ensureInitialized();
    await this.taskScheduler.completeTask(taskId, result);

    if (this.stateStore) {
      await this.saveState();
    }
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error("Orchestrator not initialized");
    }
  }

  private generateTaskId(): string {
    return `task-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
}

export function createOrchestrator(options?: {
  stateStore?: IStateStore;
  checkpointManager?: ICheckpointManager;
}): Orchestrator {
  return new Orchestrator(options);
}
