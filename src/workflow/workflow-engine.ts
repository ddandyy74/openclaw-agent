/**
 * Workflow Engine Implementation
 * 
 * Executes DAG-based workflows with support for:
 * - Sequential and parallel execution
 * - Conditional branching
 * - Loops
 * - Checkpoints and recovery
 * - Persistent state storage
 */

import type {
  WorkflowDefinition,
  WorkflowExecution,
  WorkflowResult,
  WorkflowEngineConfig,
  WorkflowNode,
  NodeStatus,
  NodeExecutionState,
  Checkpoint,
  WorkflowStatus,
} from "./types.js";
import type { ICheckpointManager } from "../persistence/types.js";

export type WorkflowContext = {
  workflowId: string;
  executionId: string;
  variables: Record<string, unknown>;
  nodeResults: Record<string, unknown>;
  metadata: Record<string, unknown>;
};

export type WorkflowEventHandler = {
  onWorkflowStart?: (execution: WorkflowExecution) => void;
  onWorkflowComplete?: (result: WorkflowResult) => void;
  onWorkflowError?: (execution: WorkflowExecution, error: Error) => void;
  onNodeStart?: (nodeId: string, context: WorkflowContext) => void;
  onNodeComplete?: (nodeId: string, result: unknown, context: WorkflowContext) => void;
  onNodeError?: (nodeId: string, error: Error, context: WorkflowContext) => void;
  onCheckpoint?: (checkpoint: Checkpoint) => void;
};

export class WorkflowEngine {
  private config: WorkflowEngineConfig;
  private executions: Map<string, WorkflowExecution> = new Map();
  private checkpoints: Map<string, Checkpoint> = new Map();
  private handlers: WorkflowEventHandler = {};
  private running: boolean = false;
  private concurrentExecutions = 0;
  private checkpointManager: ICheckpointManager | null = null;
  private currentWorkflow: WorkflowDefinition | null = null;

  constructor(config: Partial<WorkflowEngineConfig> = {}) {
    this.config = {
      maxConcurrentExecutions: config.maxConcurrentExecutions ?? 10,
      defaultTimeout: config.defaultTimeout ?? 300000,
      checkpointEnabled: config.checkpointEnabled ?? true,
      checkpointInterval: config.checkpointInterval ?? 60000,
      persistenceEnabled: config.persistenceEnabled ?? false,
      persistencePath: config.persistencePath,
    };
  }

  setCheckpointManager(manager: ICheckpointManager): void {
    this.checkpointManager = manager;
  }

  getCheckpointManager(): ICheckpointManager | null {
    return this.checkpointManager;
  }

  async initialize(config: Partial<WorkflowEngineConfig>): Promise<void> {
    this.config = { ...this.config, ...config };
    this.running = true;
  }

  async shutdown(): Promise<void> {
    this.running = false;

    for (const execution of this.executions.values()) {
      if (execution.status === "running") {
        execution.status = "cancelled";
      }
    }

    this.executions.clear();
    this.checkpoints.clear();
  }

  async execute(
    workflow: WorkflowDefinition,
    variables?: Record<string, unknown>
  ): Promise<WorkflowResult> {
    if (this.concurrentExecutions >= this.config.maxConcurrentExecutions) {
      throw new Error("Maximum concurrent executions reached");
    }

    this.currentWorkflow = workflow;

    const executionId = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const execution = this.createExecution(workflow, executionId, variables);

    this.executions.set(executionId, execution);
    this.concurrentExecutions++;

    if (this.handlers.onWorkflowStart) {
      this.handlers.onWorkflowStart(execution);
    }

    try {
      const context = this.createContext(workflow, execution);

      const sortedNodes = this.topologicalSort(workflow.nodes);
      const result = await this.executeNodes(sortedNodes, workflow, context, execution);

      execution.status = "completed";
      execution.completedAt = Date.now();

      const workflowResult: WorkflowResult = {
        executionId,
        workflowId: workflow.id,
        status: "completed",
        output: result,
        duration: execution.completedAt - execution.startedAt,
        nodeResults: context.nodeResults,
      };

      if (this.handlers.onWorkflowComplete) {
        this.handlers.onWorkflowComplete(workflowResult);
      }

      return workflowResult;
    } catch (error) {
      execution.status = "failed";
      execution.completedAt = Date.now();
      execution.error = error instanceof Error ? error.message : String(error);

      const workflowResult: WorkflowResult = {
        executionId,
        workflowId: workflow.id,
        status: "failed",
        error: execution.error,
        duration: execution.completedAt - execution.startedAt,
        nodeResults: {},
      };

      if (this.handlers.onWorkflowError) {
        this.handlers.onWorkflowError(execution, error instanceof Error ? error : new Error(String(error)));
      }

      return workflowResult;
    } finally {
      this.concurrentExecutions--;
    }
  }

  async pause(executionId: string): Promise<void> {
    const execution = this.executions.get(executionId);
    if (!execution) {
      throw new Error(`Execution ${executionId} not found`);
    }

    if (execution.status !== "running") {
      throw new Error(`Cannot pause execution in ${execution.status} state`);
    }

    execution.status = "paused";
  }

  async resume(executionId: string, checkpointId?: string): Promise<WorkflowResult> {
    let execution = this.executions.get(executionId);

    if (!execution) {
      const checkpoint = checkpointId ? await this.loadCheckpoint(checkpointId) : await this.getLatestCheckpoint(executionId);
      
      if (checkpoint) {
        execution = await this.restoreExecutionFromCheckpoint(checkpoint);
        this.executions.set(executionId, execution);
      } else {
        throw new Error(`Execution ${executionId} not found and no checkpoint available`);
      }
    }

    const currentStatus = execution.status as WorkflowStatus;
    if (currentStatus !== "paused") {
      throw new Error(`Cannot resume execution in ${currentStatus} state`);
    }

    if (checkpointId) {
      const checkpoint = await this.loadCheckpoint(checkpointId);
      if (!checkpoint) {
        throw new Error(`Checkpoint ${checkpointId} not found`);
      }

      execution.variables = { ...checkpoint.variables };
      execution.nodeStates = { ...checkpoint.nodeStates };
    }

    execution.status = "running";
    return this.continueExecution(execution);
  }

  private async restoreExecutionFromCheckpoint(checkpoint: Checkpoint): Promise<WorkflowExecution> {
    return {
      id: checkpoint.executionId,
      workflowId: this.currentWorkflow?.id ?? "unknown",
      workflowVersion: this.currentWorkflow?.version ?? "1.0.0",
      status: "paused",
      startedAt: checkpoint.timestamp,
      variables: { ...checkpoint.variables },
      nodeStates: { ...checkpoint.nodeStates },
      checkpoints: [checkpoint],
    };
  }

  async cancel(executionId: string): Promise<void> {
    const execution = this.executions.get(executionId);
    if (!execution) {
      throw new Error(`Execution ${executionId} not found`);
    }

    execution.status = "cancelled";
    execution.completedAt = Date.now();
  }

  async getStatus(executionId: string): Promise<WorkflowExecution | undefined> {
    return this.executions.get(executionId);
  }

  setHandlers(handlers: WorkflowEventHandler): void {
    this.handlers = { ...this.handlers, ...handlers };
  }

  getExecution(executionId: string): WorkflowExecution | undefined {
    return this.executions.get(executionId);
  }

  getActiveExecutions(): WorkflowExecution[] {
    return Array.from(this.executions.values()).filter(
      (exec) => exec.status === "running" || exec.status === "paused"
    );
  }

  createCheckpoint(executionId: string, nodeId: string): Checkpoint {
    const execution = this.executions.get(executionId);
    if (!execution) {
      throw new Error(`Execution ${executionId} not found`);
    }

    const checkpointId = `cp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const checkpoint: Checkpoint = {
      id: checkpointId,
      executionId,
      nodeId,
      timestamp: Date.now(),
      variables: { ...execution.variables },
      nodeStates: { ...execution.nodeStates },
    };

    this.checkpoints.set(checkpointId, checkpoint);

    if (this.handlers.onCheckpoint) {
      this.handlers.onCheckpoint(checkpoint);
    }

    return checkpoint;
  }

  async createPersistentCheckpoint(executionId: string, nodeId: string): Promise<Checkpoint> {
    const execution = this.executions.get(executionId);
    if (!execution) {
      throw new Error(`Execution ${executionId} not found`);
    }

    const nodeStates: Record<string, unknown> = { ...execution.nodeStates };

    if (this.checkpointManager) {
      const checkpoint = await this.checkpointManager.createCheckpoint(
        executionId,
        nodeId,
        { ...execution.variables },
        nodeStates
      );

      const workflowCheckpoint: Checkpoint = {
        id: checkpoint.id,
        executionId: checkpoint.executionId,
        nodeId: checkpoint.nodeId,
        timestamp: checkpoint.timestamp,
        variables: checkpoint.variables,
        nodeStates: checkpoint.nodeStates as Record<string, NodeExecutionState>,
      };

      this.checkpoints.set(checkpoint.id, workflowCheckpoint);

      if (this.handlers.onCheckpoint) {
        this.handlers.onCheckpoint(workflowCheckpoint);
      }

      return workflowCheckpoint;
    }

    return this.createCheckpoint(executionId, nodeId);
  }

  getCheckpoint(checkpointId: string): Checkpoint | undefined {
    return this.checkpoints.get(checkpointId);
  }

  async loadCheckpoint(checkpointId: string): Promise<Checkpoint | undefined> {
    if (this.checkpointManager) {
      const checkpoint = await this.checkpointManager.loadCheckpoint(checkpointId);
      if (checkpoint) {
        const workflowCheckpoint: Checkpoint = {
          id: checkpoint.id,
          executionId: checkpoint.executionId,
          nodeId: checkpoint.nodeId,
          timestamp: checkpoint.timestamp,
          variables: checkpoint.variables,
          nodeStates: checkpoint.nodeStates as Record<string, NodeExecutionState>,
        };
        this.checkpoints.set(checkpointId, workflowCheckpoint);
        return workflowCheckpoint;
      }
    }
    return this.checkpoints.get(checkpointId);
  }

  async listCheckpoints(executionId: string): Promise<Checkpoint[]> {
    if (this.checkpointManager) {
      const checkpoints = await this.checkpointManager.listCheckpoints(executionId);
      return checkpoints.map((cp) => ({
        id: cp.id,
        executionId: cp.executionId,
        nodeId: cp.nodeId,
        timestamp: cp.timestamp,
        variables: cp.variables,
        nodeStates: cp.nodeStates as Record<string, NodeExecutionState>,
      }));
    }

    return Array.from(this.checkpoints.values())
      .filter((cp) => cp.executionId === executionId)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  async getLatestCheckpoint(executionId: string): Promise<Checkpoint | undefined> {
    if (this.checkpointManager) {
      const checkpoint = await this.checkpointManager.getLatestCheckpoint(executionId);
      if (checkpoint) {
        return {
          id: checkpoint.id,
          executionId: checkpoint.executionId,
          nodeId: checkpoint.nodeId,
          timestamp: checkpoint.timestamp,
          variables: checkpoint.variables,
          nodeStates: checkpoint.nodeStates as Record<string, NodeExecutionState>,
        };
      }
    }

    const checkpoints = Array.from(this.checkpoints.values())
      .filter((cp) => cp.executionId === executionId)
      .sort((a, b) => b.timestamp - a.timestamp);

    return checkpoints[0];
  }

  async deleteCheckpoint(checkpointId: string): Promise<void> {
    if (this.checkpointManager) {
      await this.checkpointManager.deleteCheckpoint(checkpointId);
    }
    this.checkpoints.delete(checkpointId);
  }

  async deleteCheckpointsForExecution(executionId: string): Promise<void> {
    if (this.checkpointManager) {
      await this.checkpointManager.deleteCheckpointsForExecution(executionId);
    }

    for (const [id, cp] of this.checkpoints) {
      if (cp.executionId === executionId) {
        this.checkpoints.delete(id);
      }
    }
  }

  private createExecution(
    workflow: WorkflowDefinition,
    executionId: string,
    variables?: Record<string, unknown>
  ): WorkflowExecution {
    return {
      id: executionId,
      workflowId: workflow.id,
      workflowVersion: workflow.version,
      status: "running",
      startedAt: Date.now(),
      variables: { ...workflow.variables, ...variables },
      nodeStates: {},
      checkpoints: [],
    };
  }

  private createContext(
    workflow: WorkflowDefinition,
    execution: WorkflowExecution
  ): WorkflowContext {
    return {
      workflowId: workflow.id,
      executionId: execution.id,
      variables: execution.variables,
      nodeResults: {},
      metadata: workflow.metadata ?? {},
    };
  }

  private topologicalSort(nodes: WorkflowNode[]): WorkflowNode[] {
    const sorted: WorkflowNode[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const nodeMap = new Map<string, WorkflowNode>();

    for (const node of nodes) {
      nodeMap.set(node.id, node);
    }

    const visit = (nodeId: string): void => {
      if (visited.has(nodeId)) {
        return;
      }

      if (visiting.has(nodeId)) {
        throw new Error(`Circular dependency detected at node ${nodeId}`);
      }

      visiting.add(nodeId);

      const node = nodeMap.get(nodeId);
      if (node) {
        for (const depId of node.dependencies) {
          visit(depId);
        }
        sorted.push(node);
      }

      visiting.delete(nodeId);
      visited.add(nodeId);
    };

    for (const node of nodes) {
      visit(node.id);
    }

    return sorted;
  }

  private async executeNodes(
    nodes: WorkflowNode[],
    workflow: WorkflowDefinition,
    context: WorkflowContext,
    execution: WorkflowExecution
  ): Promise<unknown> {
    const completed = new Set<string>();
    const results: Record<string, unknown> = {};

    for (const node of nodes) {
      const currentStatus = execution.status as WorkflowStatus;
      if (currentStatus === "cancelled" || currentStatus === "paused") {
        break;
      }

      await this.waitForDependencies(node, completed, execution);

      const checkStatus = execution.status as WorkflowStatus;
      if (checkStatus === "cancelled" || checkStatus === "paused") {
        break;
      }

      const result = await this.executeNode(node, context, execution, workflow);
      results[node.id] = result;
      completed.add(node.id);

      if (this.config.checkpointEnabled && this.config.persistenceEnabled && this.checkpointManager) {
        const checkpoint = await this.createPersistentCheckpoint(execution.id, node.id);
        execution.checkpoints.push(checkpoint);
      } else if (this.config.checkpointEnabled) {
        const checkpoint = this.createCheckpoint(execution.id, node.id);
        execution.checkpoints.push(checkpoint);
      }
    }

    return results;
  }

  private async waitForDependencies(
    node: WorkflowNode,
    completed: Set<string>,
    execution: WorkflowExecution
  ): Promise<void> {
    for (const depId of node.dependencies) {
      while (!completed.has(depId)) {
        if (execution.status === "cancelled" || execution.status === "paused") {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  }

  private async executeNode(
    node: WorkflowNode,
    context: WorkflowContext,
    execution: WorkflowExecution,
    workflow: WorkflowDefinition
  ): Promise<unknown> {
    const nodeState: NodeExecutionState = execution.nodeStates[node.id] ?? {
      nodeId: node.id,
      status: "pending",
      retryCount: 0,
    };

    nodeState.status = "running";
    nodeState.startedAt = Date.now();
    execution.nodeStates[node.id] = nodeState;

    if (this.handlers.onNodeStart) {
      this.handlers.onNodeStart(node.id, context);
    }

    try {
      const result = await this.executeNodeByType(node, context, execution, workflow);

      nodeState.status = "completed";
      nodeState.completedAt = Date.now();
      nodeState.result = result;

      context.nodeResults[node.id] = result;

      if (this.handlers.onNodeComplete) {
        this.handlers.onNodeComplete(node.id, result, context);
      }

      return result;
    } catch (error) {
      nodeState.status = "failed";
      nodeState.completedAt = Date.now();
      nodeState.error = error instanceof Error ? error.message : String(error);
      nodeState.retryCount++;

      if (this.handlers.onNodeError) {
        this.handlers.onNodeError(node.id, error instanceof Error ? error : new Error(String(error)), context);
      }

      throw error;
    }
  }

  private async executeNodeByType(
    node: WorkflowNode,
    context: WorkflowContext,
    execution: WorkflowExecution,
    workflow: WorkflowDefinition
  ): Promise<unknown> {
    switch (node.config.type) {
      case "task":
        return this.executeTaskNode(node, context);

      case "parallel":
        return this.executeParallelNode(node, context, execution, workflow);

      case "sequential":
        return this.executeSequentialNode(node, context, execution, workflow);

      case "condition":
        return this.executeConditionNode(node, context, execution, workflow);

      case "loop":
        return this.executeLoopNode(node, context, execution, workflow);

      case "subworkflow":
        return this.executeSubworkflowNode(node, context);

      default: {
        const exhaustiveCheck: never = node.config;
        throw new Error(`Unknown node type: ${(exhaustiveCheck as { type: string }).type}`);
      }
    }
  }

  private async executeTaskNode(node: WorkflowNode, context: WorkflowContext): Promise<unknown> {
    const config = node.config as import("./types.js").TaskNodeConfig;
    return {
      prompt: config.prompt,
      agentRole: config.agentRole,
      agentId: config.agentId,
      executed: true,
    };
  }

  private async executeParallelNode(
    node: WorkflowNode,
    context: WorkflowContext,
    execution: WorkflowExecution,
    workflow: WorkflowDefinition
  ): Promise<unknown> {
    const config = node.config as import("./types.js").ParallelNodeConfig;
    const branches = config.branches;

    const results = await Promise.all(
      branches.map((branch) => this.executeNode(branch, context, execution, workflow))
    );

    return { branches: results };
  }

  private async executeSequentialNode(
    node: WorkflowNode,
    context: WorkflowContext,
    execution: WorkflowExecution,
    workflow: WorkflowDefinition
  ): Promise<unknown> {
    const config = node.config as import("./types.js").SequentialNodeConfig;
    const steps = config.steps;
    const results: unknown[] = [];

    for (const step of steps) {
      const result = await this.executeNode(step, context, execution, workflow);
      results.push(result);
    }

    return { steps: results };
  }

  private async executeConditionNode(
    node: WorkflowNode,
    context: WorkflowContext,
    execution: WorkflowExecution,
    workflow: WorkflowDefinition
  ): Promise<unknown> {
    const config = node.config as import("./types.js").ConditionNodeConfig;
    const conditionResult = this.evaluateCondition(config.expression, context);

    if (conditionResult) {
      return this.executeNode(config.thenBranch, context, execution, workflow);
    } else if (config.elseBranch) {
      return this.executeNode(config.elseBranch, context, execution, workflow);
    }

    return { conditionResult, executed: false };
  }

  private async executeLoopNode(
    node: WorkflowNode,
    context: WorkflowContext,
    execution: WorkflowExecution,
    workflow: WorkflowDefinition
  ): Promise<unknown> {
    const config = node.config as import("./types.js").LoopNodeConfig;
    const items = this.evaluateExpression(config.iteratorExpression, context);
    const results: unknown[] = [];

    const maxIterations = config.maxIterations ?? 100;
    const itemsArray = Array.isArray(items) ? items : [items];
    const iterations = Math.min(itemsArray.length, maxIterations);

    for (let i = 0; i < iterations; i++) {
      context.variables[config.itemVariable] = itemsArray[i];
      const result = await this.executeNode(config.body, context, execution, workflow);
      results.push(result);
    }

    return { iterations: results.length, results };
  }

  private async executeSubworkflowNode(
    node: WorkflowNode,
    context: WorkflowContext
  ): Promise<unknown> {
    const config = node.config as import("./types.js").SubworkflowNodeConfig;
    return {
      workflowId: config.workflowId,
      inputs: config.inputs,
      executed: true,
    };
  }

  private evaluateCondition(expression: string, context: WorkflowContext): boolean {
    try {
      const sanitized = expression.replace(/[^a-zA-Z0-9_.\s<>=!&|()'"-]/g, "");
      const fn = new Function("variables", `return ${sanitized}`);
      return !!fn(context.variables);
    } catch {
      return false;
    }
  }

  private evaluateExpression(expression: string, context: WorkflowContext): unknown {
    try {
      const sanitized = expression.replace(/[^a-zA-Z0-9_.\s<>=!&|()'"-[\]]/g, "");
      const fn = new Function("variables", `return ${sanitized}`);
      return fn(context.variables);
    } catch {
      return undefined;
    }
  }

  private async continueExecution(execution: WorkflowExecution): Promise<WorkflowResult> {
    if (!this.currentWorkflow) {
      throw new Error("No workflow set for continuation");
    }

    const workflow = this.currentWorkflow;
    const context = this.createContext(workflow, execution);
    const completedNodeIds = new Set<string>();

    for (const [nodeId, state] of Object.entries(execution.nodeStates)) {
      if (state.status === "completed") {
        completedNodeIds.add(nodeId);
        if (state.result) {
          context.nodeResults[nodeId] = state.result;
        }
      }
    }

    const sortedNodes = this.topologicalSort(workflow.nodes);
    const pendingNodes = sortedNodes.filter(
      (node) => !completedNodeIds.has(node.id)
    );

    try {
      const result = await this.executeNodesFrom(
        pendingNodes,
        workflow,
        context,
        execution,
        completedNodeIds
      );

      execution.status = "completed";
      execution.completedAt = Date.now();

      const workflowResult: WorkflowResult = {
        executionId: execution.id,
        workflowId: workflow.id,
        status: "completed",
        output: result,
        duration: execution.completedAt - execution.startedAt,
        nodeResults: context.nodeResults,
      };

      if (this.handlers.onWorkflowComplete) {
        this.handlers.onWorkflowComplete(workflowResult);
      }

      return workflowResult;
    } catch (error) {
      execution.status = "failed";
      execution.completedAt = Date.now();
      execution.error = error instanceof Error ? error.message : String(error);

      const workflowResult: WorkflowResult = {
        executionId: execution.id,
        workflowId: workflow.id,
        status: "failed",
        error: execution.error,
        duration: execution.completedAt - execution.startedAt,
        nodeResults: context.nodeResults,
      };

      if (this.handlers.onWorkflowError) {
        this.handlers.onWorkflowError(execution, error instanceof Error ? error : new Error(String(error)));
      }

      return workflowResult;
    }
  }

  private async executeNodesFrom(
    nodes: WorkflowNode[],
    workflow: WorkflowDefinition,
    context: WorkflowContext,
    execution: WorkflowExecution,
    completed: Set<string>
  ): Promise<unknown> {
    const results: Record<string, unknown> = {};

    for (const [nodeId, state] of Object.entries(execution.nodeStates)) {
      if (state.result) {
        results[nodeId] = state.result;
      }
    }

    for (const node of nodes) {
      const currentStatus = execution.status as WorkflowStatus;
      if (currentStatus === "cancelled" || currentStatus === "paused") {
        break;
      }

      await this.waitForDependencies(node, completed, execution);

      const checkStatus = execution.status as WorkflowStatus;
      if (checkStatus === "cancelled" || checkStatus === "paused") {
        break;
      }

      const result = await this.executeNode(node, context, execution, workflow);
      results[node.id] = result;
      completed.add(node.id);

      if (this.config.checkpointEnabled && this.config.persistenceEnabled && this.checkpointManager) {
        const checkpoint = await this.createPersistentCheckpoint(execution.id, node.id);
        execution.checkpoints.push(checkpoint);
      } else if (this.config.checkpointEnabled) {
        const checkpoint = this.createCheckpoint(execution.id, node.id);
        execution.checkpoints.push(checkpoint);
      }
    }

    return results;
  }

  setWorkflow(workflow: WorkflowDefinition): void {
    this.currentWorkflow = workflow;
  }
}

export function createWorkflowEngine(config?: Partial<WorkflowEngineConfig>): WorkflowEngine {
  return new WorkflowEngine(config);
}
