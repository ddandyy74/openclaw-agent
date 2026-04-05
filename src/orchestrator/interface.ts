/**
 * Orchestrator Interface
 * 
 * Main interface for the multi-agent orchestration system.
 */

import type {
  AgentInfo,
  AgentRole,
  AgentStatus,
  CollaborationMode,
  Heartbeat,
  OrchestratorConfig,
  OrchestratorState,
  Task,
  TaskAssignment,
  TaskCompletion,
  TaskDefinition,
  TaskResult,
  TaskStatus,
  TeamInfo,
} from "./types.js";

export interface IAgentManager {
  registerAgent(info: Omit<AgentInfo, "createdAt" | "lastHeartbeat">): Promise<string>;
  unregisterAgent(agentId: string): Promise<void>;
  getAgent(agentId: string): Promise<AgentInfo | undefined>;
  listAgents(filter?: { role?: AgentRole; status?: AgentStatus }): Promise<AgentInfo[]>;
  updateAgentStatus(agentId: string, status: AgentStatus): Promise<void>;
  processHeartbeat(heartbeat: Heartbeat): Promise<void>;
}

export interface ITaskQueue {
  enqueue(task: TaskDefinition): Promise<string>;
  dequeue(): Promise<Task | undefined>;
  peek(): Promise<Task | undefined>;
  size(): Promise<number>;
  remove(taskId: string): Promise<void>;
  update(task: Task): Promise<void>;
  get(taskId: string): Promise<Task | undefined>;
  list(filter?: { status?: TaskStatus }): Promise<Task[]>;
  areDependenciesMet(taskId: string): boolean;
}

export interface ITaskScheduler {
  schedule(task: TaskDefinition): Promise<string>;
  cancel(taskId: string): Promise<void>;
  retry(taskId: string): Promise<void>;
  getNextTask(): Promise<Task | undefined>;
  assignTask(taskId: string, agentId: string): Promise<TaskAssignment>;
  completeTask(taskId: string, result: TaskResult): Promise<TaskCompletion>;
}

export interface ITeamManager {
  createTeam(name: string, mode: CollaborationMode): Promise<TeamInfo>;
  deleteTeam(teamId: string): Promise<void>;
  getTeam(teamId: string): Promise<TeamInfo | undefined>;
  listTeams(): Promise<TeamInfo[]>;
  addMember(teamId: string, agentId: string): Promise<void>;
  removeMember(teamId: string, agentId: string): Promise<void>;
  setLeader(teamId: string, agentId: string): Promise<void>;
}

export interface IOrchestrator {
  initialize(config: OrchestratorConfig): Promise<void>;
  shutdown(): Promise<void>;
  getState(): Promise<OrchestratorState>;
  
  getAgentManager(): IAgentManager;
  getTaskQueue(): ITaskQueue;
  getTaskScheduler(): ITaskScheduler;
  getTeamManager(): ITeamManager;
  
  submitTask(task: TaskDefinition): Promise<string>;
  cancelTask(taskId: string): Promise<void>;
  getTaskStatus(taskId: string): Promise<Task | undefined>;
  
  broadcastMessage(teamId: string, message: unknown): Promise<void>;
  sendMessage(fromAgentId: string, toAgentId: string, message: unknown): Promise<void>;
}

export interface IOrchestratorPlugin {
  id: string;
  name: string;
  version: string;
  
  onAgentRegister?(agent: AgentInfo): Promise<void>;
  onAgentUnregister?(agentId: string): Promise<void>;
  onTaskEnqueue?(task: Task): Promise<void>;
  onTaskAssign?(assignment: TaskAssignment): Promise<void>;
  onTaskComplete?(completion: TaskCompletion): Promise<void>;
  onTeamCreate?(team: TeamInfo): Promise<void>;
  onTeamDelete?(teamId: string): Promise<void>;
}
