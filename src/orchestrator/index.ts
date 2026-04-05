/**
 * Orchestrator - Multi-agent orchestration system
 * 
 * @module orchestrator
 */

// Types
export type {
  AgentRole,
  CollaborationMode,
  AgentStatus,
  TaskStatus,
  TaskPriority,
  AgentInfo,
  TaskDefinition,
  TaskResult,
  Task,
  TeamInfo,
  OrchestratorConfig,
  OrchestratorState,
  TaskAssignment,
  TaskCompletion,
  Heartbeat,
} from "./types.js";

// Interfaces
export type {
  IAgentManager,
  ITaskQueue,
  ITaskScheduler,
  ITeamManager,
  IOrchestrator,
  IOrchestratorPlugin,
} from "./interface.js";

// Implementations
export { AgentManager } from "./agent-manager.js";
export { TaskQueue } from "./task-queue.js";
export { TaskScheduler } from "./task-scheduler.js";
export { TeamManager } from "./team-manager.js";
export { Orchestrator } from "./orchestrator.js";
export { Coordinator, DefaultTaskDecomposer, DefaultWorkerSelector, DefaultResultAggregator } from "./coordinator.js";
export { Worker, WorkerPool } from "./worker.js";
export { TaskDispatcher, ResultCollector } from "./dispatcher.js";
export type { OrchestratorPluginConfig, SubagentConfig } from "./plugin.js";
export type { TeamRole, TeamStatus, TeamMember, TeamConfig, TeamDecision, TeamEvent } from "./team.js";
export { Team } from "./team.js";
