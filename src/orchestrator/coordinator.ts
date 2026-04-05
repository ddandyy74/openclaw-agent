/**
 * Coordinator Agent
 * 
 * Responsible for task decomposition, distribution, and result aggregation.
 * Coordinates multiple worker agents to complete complex tasks.
 */

import type { TaskDefinition, TaskResult, AgentInfo, TaskPriority } from "../orchestrator/types.js";
import type { SubagentRunRecord } from "../agents/subagent-registry.types.js";

export type CoordinatorConfig = {
  maxWorkers: number;
  taskTimeout: number;
  retryAttempts: number;
  retryDelay: number;
  resultAggregationStrategy: "first" | "all" | "best" | "consensus";
};

export type DecomposedTask = {
  id: string;
  parentTaskId: string;
  subtasks: TaskDefinition[];
  dependencies: Map<string, string[]>;
  strategy: "parallel" | "sequential" | "hybrid";
};

export type TaskAssignment = {
  taskId: string;
  workerId: string;
  assignedAt: number;
  status: "pending" | "running" | "completed" | "failed";
  result?: TaskResult;
};

export type CoordinatorState = {
  totalTasks: number;
  pendingTasks: number;
  runningTasks: number;
  completedTasks: number;
  failedTasks: number;
  activeWorkers: number;
};

export type WorkerInfo = {
  id: string;
  status: "idle" | "busy" | "offline";
  capabilities: string[];
  currentTasks: number;
  maxTasks: number;
  lastHeartbeat: number;
  performance: {
    completedTasks: number;
    failedTasks: number;
    avgDuration: number;
    avgTokens: number;
  };
};

export interface ICoordinator {
  decomposeTask(task: TaskDefinition): Promise<DecomposedTask>;
  assignTask(task: TaskDefinition, workerId?: string): Promise<TaskAssignment>;
  collectResults(taskId: string): Promise<TaskResult[]>;
  aggregateResults(results: TaskResult[]): Promise<TaskResult>;
  getWorkerInfo(workerId: string): Promise<WorkerInfo | undefined>;
  listWorkers(): Promise<WorkerInfo[]>;
  getState(): Promise<CoordinatorState>;
}

export interface ITaskDecomposer {
  decompose(prompt: string, context?: Record<string, unknown>): Promise<TaskDefinition[]>;
  estimateComplexity(prompt: string): Promise<"low" | "medium" | "high">;
  shouldDecompose(prompt: string): Promise<boolean>;
}

export interface IWorkerSelector {
  selectWorker(task: TaskDefinition, workers: WorkerInfo[]): Promise<string | undefined>;
  scoreWorker(task: TaskDefinition, worker: WorkerInfo): number;
}

export interface IResultAggregator {
  aggregate(results: TaskResult[], strategy: CoordinatorConfig["resultAggregationStrategy"]): Promise<TaskResult>;
  validate(result: TaskResult): boolean;
  merge(a: TaskResult, b: TaskResult): TaskResult;
}

export class Coordinator implements ICoordinator {
  private config: CoordinatorConfig;
  private workers: Map<string, WorkerInfo> = new Map();
  private assignments: Map<string, TaskAssignment> = new Map();
  private decomposer: ITaskDecomposer;
  private selector: IWorkerSelector;
  private aggregator: IResultAggregator;

  constructor(
    config: Partial<CoordinatorConfig>,
    deps: {
      decomposer: ITaskDecomposer;
      selector: IWorkerSelector;
      aggregator: IResultAggregator;
    }
  ) {
    this.config = {
      maxWorkers: config.maxWorkers ?? 10,
      taskTimeout: config.taskTimeout ?? 300000,
      retryAttempts: config.retryAttempts ?? 2,
      retryDelay: config.retryDelay ?? 5000,
      resultAggregationStrategy: config.resultAggregationStrategy ?? "best",
    };
    this.decomposer = deps.decomposer;
    this.selector = deps.selector;
    this.aggregator = deps.aggregator;
  }

  async decomposeTask(task: TaskDefinition): Promise<DecomposedTask> {
    const shouldDecompose = await this.decomposer.shouldDecompose(task.prompt);
    
    if (!shouldDecompose) {
      return {
        id: `decomposed-${task.id}`,
        parentTaskId: task.id,
        subtasks: [task],
        dependencies: new Map([[task.id, []]]),
        strategy: "sequential",
      };
    }

    const subtasks = await this.decomposer.decompose(task.prompt, task.metadata);
    
    const dependencies = new Map<string, string[]>();
    for (let i = 0; i < subtasks.length; i++) {
      const deps = i === 0 ? [] : [subtasks[i - 1].id];
      dependencies.set(subtasks[i].id, deps);
    }

    return {
      id: `decomposed-${task.id}`,
      parentTaskId: task.id,
      subtasks,
      dependencies,
      strategy: subtasks.length > 1 ? "parallel" : "sequential",
    };
  }

  async assignTask(task: TaskDefinition, workerId?: string): Promise<TaskAssignment> {
    const workers = await this.listWorkers();
    const availableWorkers = workers.filter(
      (w) => w.status === "idle" || (w.status === "busy" && w.currentTasks < w.maxTasks)
    );

    if (availableWorkers.length === 0) {
      throw new Error("No available workers");
    }

    const selectedWorkerId = workerId ?? await this.selector.selectWorker(task, availableWorkers);
    
    if (!selectedWorkerId) {
      throw new Error("No suitable worker found for task");
    }

    const worker = this.workers.get(selectedWorkerId);
    if (!worker) {
      throw new Error(`Worker ${selectedWorkerId} not found`);
    }

    const assignment: TaskAssignment = {
      taskId: task.id,
      workerId: selectedWorkerId,
      assignedAt: Date.now(),
      status: "pending",
    };

    this.assignments.set(task.id, assignment);
    worker.currentTasks++;
    if (worker.currentTasks >= worker.maxTasks) {
      worker.status = "busy";
    }

    return assignment;
  }

  async collectResults(taskId: string): Promise<TaskResult[]> {
    const results: TaskResult[] = [];
    
    for (const [id, assignment] of this.assignments) {
      if (id === taskId || assignment.status === "completed") {
        if (assignment.result) {
          results.push(assignment.result);
        }
      }
    }

    return results;
  }

  async aggregateResults(results: TaskResult[]): Promise<TaskResult> {
    if (results.length === 0) {
      throw new Error("No results to aggregate");
    }

    if (results.length === 1) {
      return results[0];
    }

    return this.aggregator.aggregate(results, this.config.resultAggregationStrategy);
  }

  async getWorkerInfo(workerId: string): Promise<WorkerInfo | undefined> {
    return this.workers.get(workerId);
  }

  async listWorkers(): Promise<WorkerInfo[]> {
    return Array.from(this.workers.values());
  }

  async getState(): Promise<CoordinatorState> {
    const workers = await this.listWorkers();
    const assignments = Array.from(this.assignments.values());

    return {
      totalTasks: assignments.length,
      pendingTasks: assignments.filter((a) => a.status === "pending").length,
      runningTasks: assignments.filter((a) => a.status === "running").length,
      completedTasks: assignments.filter((a) => a.status === "completed").length,
      failedTasks: assignments.filter((a) => a.status === "failed").length,
      activeWorkers: workers.filter((w) => w.status !== "offline").length,
    };
  }

  registerWorker(info: Omit<WorkerInfo, "performance">): void {
    this.workers.set(info.id, {
      ...info,
      performance: {
        completedTasks: 0,
        failedTasks: 0,
        avgDuration: 0,
        avgTokens: 0,
      },
    });
  }

  unregisterWorker(workerId: string): void {
    this.workers.delete(workerId);
  }

  updateWorkerHeartbeat(workerId: string): void {
    const worker = this.workers.get(workerId);
    if (worker) {
      worker.lastHeartbeat = Date.now();
    }
  }

  completeTask(taskId: string, result: TaskResult): void {
    const assignment = this.assignments.get(taskId);
    if (assignment) {
      assignment.status = "completed";
      assignment.result = result;

      const worker = this.workers.get(assignment.workerId);
      if (worker) {
        worker.currentTasks = Math.max(0, worker.currentTasks - 1);
        if (worker.currentTasks === 0) {
          worker.status = "idle";
        }
        worker.performance.completedTasks++;
        if (result.duration) {
          const prevAvg = worker.performance.avgDuration;
          const count = worker.performance.completedTasks;
          worker.performance.avgDuration = (prevAvg * (count - 1) + result.duration) / count;
        }
        if (result.tokenUsage) {
          const prevAvg = worker.performance.avgTokens;
          const count = worker.performance.completedTasks;
          worker.performance.avgTokens = (prevAvg * (count - 1) + result.tokenUsage.total) / count;
        }
      }
    }
  }

  failTask(taskId: string, error: string): void {
    const assignment = this.assignments.get(taskId);
    if (assignment) {
      assignment.status = "failed";
      assignment.result = {
        taskId,
        agentId: assignment.workerId,
        status: "failed",
        error,
        duration: Date.now() - assignment.assignedAt,
      };

      const worker = this.workers.get(assignment.workerId);
      if (worker) {
        worker.currentTasks = Math.max(0, worker.currentTasks - 1);
        if (worker.currentTasks === 0) {
          worker.status = "idle";
        }
        worker.performance.failedTasks++;
      }
    }
  }
}

export class DefaultTaskDecomposer implements ITaskDecomposer {
  async decompose(prompt: string, context?: Record<string, unknown>): Promise<TaskDefinition[]> {
    const complexity = await this.estimateComplexity(prompt);
    
    if (complexity === "low") {
      return [this.createTask(prompt, "normal")];
    }

    const subtaskCount = complexity === "high" ? 4 : 2;
    const subtasks: TaskDefinition[] = [];
    
    for (let i = 0; i < subtaskCount; i++) {
      subtasks.push(this.createTask(
        `Subtask ${i + 1} of ${subtaskCount}: ${prompt}`,
        complexity === "high" ? "high" : "normal",
        { index: i, total: subtaskCount, context }
      ));
    }

    return subtasks;
  }

  async estimateComplexity(prompt: string): Promise<"low" | "medium" | "high"> {
    const wordCount = prompt.split(/\s+/).length;
    const hasMultipleSteps = /step|phase|stage|then|next|after|finally/i.test(prompt);
    const hasComplexKeywords = /analyze|design|implement|refactor|optimize|architect/i.test(prompt);

    if (wordCount > 500 || (hasMultipleSteps && hasComplexKeywords)) {
      return "high";
    }
    if (wordCount > 200 || hasMultipleSteps || hasComplexKeywords) {
      return "medium";
    }
    return "low";
  }

  async shouldDecompose(prompt: string): Promise<boolean> {
    const complexity = await this.estimateComplexity(prompt);
    return complexity !== "low";
  }

  private createTask(
    prompt: string,
    priority: TaskPriority,
    metadata?: Record<string, unknown>
  ): TaskDefinition {
    return {
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      prompt,
      priority,
      metadata,
    };
  }
}

export class DefaultWorkerSelector implements IWorkerSelector {
  async selectWorker(task: TaskDefinition, workers: WorkerInfo[]): Promise<string | undefined> {
    const scoredWorkers = workers
      .filter((w) => w.currentTasks < w.maxTasks)
      .map((w) => ({ worker: w, score: this.scoreWorker(task, w) }))
      .sort((a, b) => b.score - a.score);

    return scoredWorkers[0]?.worker.id;
  }

  scoreWorker(task: TaskDefinition, worker: WorkerInfo): number {
    let score = 100;

    if (worker.currentTasks >= worker.maxTasks) {
      return 0;
    }

    const loadFactor = 1 - worker.currentTasks / worker.maxTasks;
    score += loadFactor * 30;

    const successRate = worker.performance.completedTasks > 0
      ? worker.performance.completedTasks /
        (worker.performance.completedTasks + worker.performance.failedTasks)
      : 1;
    score += successRate * 20;

    if (worker.performance.avgDuration > 0) {
      const speedFactor = Math.max(0, 1 - worker.performance.avgDuration / 60000);
      score += speedFactor * 10;
    }

    if (task.metadata?.requiredCapabilities) {
      const required = task.metadata.requiredCapabilities as string[];
      const hasCapability = required.every((cap) => worker.capabilities.includes(cap));
      if (!hasCapability) {
        return 0;
      }
    }

    if (task.priority === "urgent") {
      if (worker.currentTasks > 0) {
        score -= 20;
      }
    } else if (task.priority === "high") {
      if (worker.currentTasks > worker.maxTasks / 2) {
        score -= 10;
      }
    }

    return score;
  }
}

export class DefaultResultAggregator implements IResultAggregator {
  async aggregate(
    results: TaskResult[],
    strategy: CoordinatorConfig["resultAggregationStrategy"]
  ): Promise<TaskResult> {
    switch (strategy) {
      case "first":
        return results[0];
      
      case "all":
        return this.mergeAll(results);
      
      case "best":
        return this.selectBest(results);
      
      case "consensus":
        return this.findConsensus(results);
      
      default:
        return results[0];
    }
  }

  validate(result: TaskResult): boolean {
    return result.status === "completed" && !result.error;
  }

  merge(a: TaskResult, b: TaskResult): TaskResult {
    return {
      taskId: `${a.taskId}+${b.taskId}`,
      agentId: `${a.agentId},${b.agentId}`,
      status: a.status === "completed" && b.status === "completed" ? "completed" : "partial",
      output: {
        ...(a.output ?? {}),
        ...(b.output ?? {}),
      },
      duration: a.duration + b.duration,
      tokenUsage: {
        input: (a.tokenUsage?.input ?? 0) + (b.tokenUsage?.input ?? 0),
        output: (a.tokenUsage?.output ?? 0) + (b.tokenUsage?.output ?? 0),
        total: (a.tokenUsage?.total ?? 0) + (b.tokenUsage?.total ?? 0),
      },
    };
  }

  private mergeAll(results: TaskResult[]): TaskResult {
    return results.reduce((acc, result) => this.merge(acc, result));
  }

  private selectBest(results: TaskResult[]): TaskResult {
    const validResults = results.filter((r) => this.validate(r));
    if (validResults.length === 0) {
      return results[0];
    }

    return validResults.reduce((best, current) => {
      const bestScore = this.scoreResult(best);
      const currentScore = this.scoreResult(current);
      return currentScore > bestScore ? current : best;
    });
  }

  private findConsensus(results: TaskResult[]): TaskResult {
    const validResults = results.filter((r) => this.validate(r));
    if (validResults.length === 0) {
      return results[0];
    }

    const outputStrs = validResults.map((r) => JSON.stringify(r.output));
    const counts = new Map<string, { result: TaskResult; count: number }>();

    for (let i = 0; i < outputStrs.length; i++) {
      const str = outputStrs[i];
      const existing = counts.get(str);
      if (existing) {
        existing.count++;
      } else {
        counts.set(str, { result: validResults[i], count: 1 });
      }
    }

    let maxCount = 0;
    let consensus: TaskResult = validResults[0];
    for (const { result, count } of counts.values()) {
      if (count > maxCount) {
        maxCount = count;
        consensus = result;
      }
    }

    return consensus;
  }

  private scoreResult(result: TaskResult): number {
    let score = 0;

    if (result.status === "completed") {
      score += 50;
    }

    if (result.output && typeof result.output === "object") {
      score += Object.keys(result.output).length * 5;
    }

    if (result.duration) {
      score += Math.max(0, 20 - result.duration / 10000);
    }

    return score;
  }
}
