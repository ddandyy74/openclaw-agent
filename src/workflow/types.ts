/**
 * Workflow Types
 * 
 * Core types for the workflow engine.
 */

export type NodeType = "task" | "parallel" | "sequential" | "condition" | "loop" | "subworkflow";

export type WorkflowStatus = "pending" | "running" | "paused" | "completed" | "failed" | "cancelled";

export type NodeStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface WorkflowNode {
  id: string;
  type: NodeType;
  name: string;
  dependencies: string[];
  config: NodeConfig;
  timeout?: number;
  retryCount?: number;
  metadata?: Record<string, unknown>;
}

export interface TaskNodeConfig {
  type: "task";
  prompt: string;
  agentRole?: string;
  agentId?: string;
}

export interface ParallelNodeConfig {
  type: "parallel";
  branches: WorkflowNode[];
  failFast?: boolean;
}

export interface SequentialNodeConfig {
  type: "sequential";
  steps: WorkflowNode[];
}

export interface ConditionNodeConfig {
  type: "condition";
  expression: string;
  thenBranch: WorkflowNode;
  elseBranch?: WorkflowNode;
}

export interface LoopNodeConfig {
  type: "loop";
  iteratorExpression: string;
  itemVariable: string;
  body: WorkflowNode;
  maxIterations?: number;
}

export interface SubworkflowNodeConfig {
  type: "subworkflow";
  workflowId: string;
  inputs: Record<string, string>;
}

export type NodeConfig =
  | TaskNodeConfig
  | ParallelNodeConfig
  | SequentialNodeConfig
  | ConditionNodeConfig
  | LoopNodeConfig
  | SubworkflowNodeConfig;

export interface WorkflowDefinition {
  id: string;
  name: string;
  version: string;
  description?: string;
  nodes: WorkflowNode[];
  variables: Record<string, unknown>;
  triggers: WorkflowTrigger[];
  timeout?: number;
  metadata?: Record<string, unknown>;
}

export interface WorkflowTrigger {
  type: "manual" | "schedule" | "event" | "webhook";
  config: Record<string, unknown>;
  enabled: boolean;
}

export interface WorkflowExecution {
  id: string;
  workflowId: string;
  workflowVersion: string;
  status: WorkflowStatus;
  startedAt: number;
  completedAt?: number;
  variables: Record<string, unknown>;
  nodeStates: Record<string, NodeExecutionState>;
  checkpoints: Checkpoint[];
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface NodeExecutionState {
  nodeId: string;
  status: NodeStatus;
  startedAt?: number;
  completedAt?: number;
  result?: unknown;
  error?: string;
  retryCount: number;
}

export interface Checkpoint {
  id: string;
  executionId: string;
  nodeId: string;
  timestamp: number;
  variables: Record<string, unknown>;
  nodeStates: Record<string, NodeExecutionState>;
}

export interface WorkflowResult {
  executionId: string;
  workflowId: string;
  status: WorkflowStatus;
  output?: unknown;
  error?: string;
  duration: number;
  nodeResults: Record<string, unknown>;
}

export interface WorkflowEngineConfig {
  maxConcurrentExecutions: number;
  defaultTimeout: number;
  checkpointEnabled: boolean;
  checkpointInterval: number;
  persistenceEnabled: boolean;
  persistencePath?: string;
}
