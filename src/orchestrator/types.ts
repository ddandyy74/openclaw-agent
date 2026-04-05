/**
 * Orchestrator Types
 * 
 * Core types for the multi-agent orchestration system.
 */

export type AgentRole = "coordinator" | "worker" | "teammate" | "leader";

export type CollaborationMode = "coordinator-worker" | "teammate" | "swarm";

export type AgentStatus = "idle" | "busy" | "waiting" | "error" | "offline";

export type TaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled" | "partial";

export type TaskPriority = "low" | "normal" | "high" | "urgent";

export interface AgentInfo {
  id: string;
  role: AgentRole;
  status: AgentStatus;
  capabilities: string[];
  maxConcurrentTasks: number;
  currentTasks: number;
  createdAt: number;
  lastHeartbeat: number;
  metadata?: Record<string, unknown>;
}

export interface TaskDefinition {
  id: string;
  prompt: string;
  agentRole?: AgentRole;
  agentId?: string;
  priority: TaskPriority;
  timeout?: number;
  maxRetries?: number;
  dependencies?: string[];
  metadata?: Record<string, unknown>;
}

export interface TaskResult {
  taskId: string;
  agentId: string;
  status: TaskStatus;
  output?: unknown;
  error?: string;
  duration: number;
  tokenUsage?: {
    input: number;
    output: number;
    total: number;
  };
}

export interface Task {
  definition: TaskDefinition;
  status: TaskStatus;
  assignedAgent?: string;
  result?: TaskResult;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  retryCount: number;
}

export interface TeamInfo {
  id: string;
  name: string;
  mode: CollaborationMode;
  leaderId?: string;
  members: string[];
  createdAt: number;
  metadata?: Record<string, unknown>;
}

export interface OrchestratorConfig {
  mode: CollaborationMode;
  maxAgents: number;
  taskTimeout: number;
  heartbeatInterval: number;
  retryDelay: number;
  maxRetries: number;
}

export interface OrchestratorState {
  agents: Map<string, AgentInfo>;
  tasks: Map<string, Task>;
  teams: Map<string, TeamInfo>;
  taskQueue: string[];
}

export interface TaskAssignment {
  taskId: string;
  agentId: string;
  assignedAt: number;
  reason: string;
}

export interface TaskCompletion {
  taskId: string;
  agentId: string;
  result: TaskResult;
  completedAt: number;
}

export interface Heartbeat {
  agentId: string;
  timestamp: number;
  status: AgentStatus;
  currentTasks: number;
  metrics?: {
    cpuUsage?: number;
    memoryUsage?: number;
    avgResponseTime?: number;
  };
}
