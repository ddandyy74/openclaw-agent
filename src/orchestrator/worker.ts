/**
 * Worker Agent
 * 
 * Executes tasks assigned by the Coordinator.
 * Reports progress and results back to the Coordinator.
 */

import type { TaskDefinition, TaskResult, TaskStatus } from "../orchestrator/types.js";

export type WorkerConfig = {
  maxConcurrentTasks: number;
  taskTimeout: number;
  heartbeatInterval: number;
  reportProgress: boolean;
  retryOnFailure: boolean;
  maxRetries: number;
};

export type WorkerCapabilities = {
  skills: string[];
  tools: string[];
  models: string[];
  maxTokens: number;
  supportsStreaming: boolean;
  supportsAttachments: boolean;
};

export type WorkerStatus = "idle" | "busy" | "offline" | "error";

export type TaskProgress = {
  taskId: string;
  status: TaskStatus;
  progress: number;
  message?: string;
  startedAt: number;
  updatedAt: number;
  estimatedTimeRemaining?: number;
};

export type WorkerMetrics = {
  tasksCompleted: number;
  tasksFailed: number;
  totalDuration: number;
  totalTokens: number;
  avgTaskDuration: number;
  avgTokensPerTask: number;
  successRate: number;
  uptime: number;
};

export interface IWorker {
  getId(): string;
  getStatus(): WorkerStatus;
  getCapabilities(): WorkerCapabilities;
  getMetrics(): WorkerMetrics;
  getCurrentTasks(): string[];
  canAcceptTask(): boolean;
  execute(task: TaskDefinition): Promise<TaskResult>;
  cancel(taskId: string): Promise<boolean>;
  getProgress(taskId: string): TaskProgress | undefined;
  heartbeat(): void;
  shutdown(): Promise<void>;
}

export type WorkerEventHandler = {
  onTaskStart?: (taskId: string) => void;
  onTaskProgress?: (progress: TaskProgress) => void;
  onTaskComplete?: (result: TaskResult) => void;
  onTaskError?: (taskId: string, error: Error) => void;
  onStatusChange?: (status: WorkerStatus) => void;
};

export type TaskExecutor = (task: TaskDefinition) => Promise<TaskResult>;

export class Worker implements IWorker {
  private id: string;
  private config: WorkerConfig;
  private capabilities: WorkerCapabilities;
  private status: WorkerStatus = "idle";
  private currentTasks: Map<string, TaskProgress> = new Map();
  private metrics: WorkerMetrics;
  private startTime: number;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private executor: TaskExecutor;
  private handlers: WorkerEventHandler = {};
  private abortControllers: Map<string, AbortController> = new Map();

  constructor(
    id: string,
    config: Partial<WorkerConfig>,
    capabilities: WorkerCapabilities,
    executor: TaskExecutor
  ) {
    this.id = id;
    this.config = {
      maxConcurrentTasks: config.maxConcurrentTasks ?? 3,
      taskTimeout: config.taskTimeout ?? 300000,
      heartbeatInterval: config.heartbeatInterval ?? 30000,
      reportProgress: config.reportProgress ?? true,
      retryOnFailure: config.retryOnFailure ?? true,
      maxRetries: config.maxRetries ?? 2,
    };
    this.capabilities = capabilities;
    this.executor = executor;
    this.startTime = Date.now();
    this.metrics = this.initMetrics();
  }

  private initMetrics(): WorkerMetrics {
    return {
      tasksCompleted: 0,
      tasksFailed: 0,
      totalDuration: 0,
      totalTokens: 0,
      avgTaskDuration: 0,
      avgTokensPerTask: 0,
      successRate: 1,
      uptime: 0,
    };
  }

  getId(): string {
    return this.id;
  }

  getStatus(): WorkerStatus {
    return this.status;
  }

  getCapabilities(): WorkerCapabilities {
    return this.capabilities;
  }

  getMetrics(): WorkerMetrics {
    return {
      ...this.metrics,
      uptime: Date.now() - this.startTime,
    };
  }

  getCurrentTasks(): string[] {
    return Array.from(this.currentTasks.keys());
  }

  canAcceptTask(): boolean {
    return (
      this.status !== "offline" &&
      this.status !== "error" &&
      this.currentTasks.size < this.config.maxConcurrentTasks
    );
  }

  async execute(task: TaskDefinition): Promise<TaskResult> {
    if (!this.canAcceptTask()) {
      throw new Error("Worker cannot accept more tasks");
    }

    const taskId = task.id;
    const abortController = new AbortController();
    this.abortControllers.set(taskId, abortController);

    const progress: TaskProgress = {
      taskId,
      status: "running",
      progress: 0,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.currentTasks.set(taskId, progress);

    if (this.currentTasks.size >= this.config.maxConcurrentTasks) {
      this.setStatus("busy");
    }

    this.handlers.onTaskStart?.(taskId);

    let retries = 0;
    let lastError: Error | null = null;

    while (retries <= (this.config.retryOnFailure ? this.config.maxRetries : 0)) {
      try {
        const result = await this.executeWithTimeout(task, abortController.signal);
        
        progress.status = "completed";
        progress.progress = 100;
        progress.updatedAt = Date.now();
        
        this.updateMetrics(result);
        this.handlers.onTaskComplete?.(result);
        
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        retries++;

        if (retries <= this.config.maxRetries && this.config.retryOnFailure) {
          progress.message = `Retrying (${retries}/${this.config.maxRetries})...`;
          progress.updatedAt = Date.now();
          await this.delay(this.config.maxRetries * 1000);
        }
      }
    }

    progress.status = "failed";
    progress.updatedAt = Date.now();

    const result: TaskResult = {
      taskId,
      agentId: this.id,
      status: "failed",
      error: lastError?.message ?? "Unknown error",
      duration: Date.now() - progress.startedAt,
    };

    this.updateMetrics(result);
    this.handlers.onTaskError?.(taskId, lastError!);

    return result;
  }

  private async executeWithTimeout(
    task: TaskDefinition,
    signal: AbortSignal
  ): Promise<TaskResult> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error("Task timeout"));
      }, task.timeout ?? this.config.taskTimeout);

      signal.addEventListener("abort", () => {
        clearTimeout(timeoutId);
        reject(new Error("Task cancelled"));
      });

      this.executor(task)
        .then((result) => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  async cancel(taskId: string): Promise<boolean> {
    const controller = this.abortControllers.get(taskId);
    if (controller) {
      controller.abort();
      this.currentTasks.delete(taskId);
      this.abortControllers.delete(taskId);

      if (this.currentTasks.size < this.config.maxConcurrentTasks) {
        this.setStatus("idle");
      }

      return true;
    }
    return false;
  }

  getProgress(taskId: string): TaskProgress | undefined {
    return this.currentTasks.get(taskId);
  }

  heartbeat(): void {
    if (this.status === "offline") {
      this.setStatus("idle");
    }
  }

  shutdown(): Promise<void> {
    this.setStatus("offline");
    
    for (const controller of this.abortControllers.values()) {
      controller.abort();
    }
    
    this.currentTasks.clear();
    this.abortControllers.clear();

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    return Promise.resolve();
  }

  setHandlers(handlers: WorkerEventHandler): void {
    this.handlers = { ...this.handlers, ...handlers };
  }

  updateProgress(taskId: string, progress: number, message?: string): void {
    const taskProgress = this.currentTasks.get(taskId);
    if (taskProgress) {
      taskProgress.progress = Math.min(100, Math.max(0, progress));
      taskProgress.message = message;
      taskProgress.updatedAt = Date.now();
      this.handlers.onTaskProgress?.(taskProgress);
    }
  }

  completeTask(taskId: string, result: TaskResult): void {
    const progress = this.currentTasks.get(taskId);
    if (progress) {
      progress.status = result.status;
      progress.progress = 100;
      progress.updatedAt = Date.now();
    }

    this.currentTasks.delete(taskId);
    this.abortControllers.delete(taskId);

    this.updateMetrics(result);
    this.handlers.onTaskComplete?.(result);

    if (this.currentTasks.size < this.config.maxConcurrentTasks) {
      this.setStatus("idle");
    }
  }

  failTask(taskId: string, error: Error): void {
    const progress = this.currentTasks.get(taskId);
    if (progress) {
      progress.status = "failed";
      progress.message = error.message;
      progress.updatedAt = Date.now();
    }

    this.currentTasks.delete(taskId);
    this.abortControllers.delete(taskId);

    const result: TaskResult = {
      taskId,
      agentId: this.id,
      status: "failed",
      error: error.message,
      duration: progress ? Date.now() - progress.startedAt : 0,
    };

    this.updateMetrics(result);
    this.handlers.onTaskError?.(taskId, error);

    if (this.currentTasks.size < this.config.maxConcurrentTasks) {
      this.setStatus("idle");
    }
  }

  private setStatus(status: WorkerStatus): void {
    const oldStatus = this.status;
    this.status = status;
    if (oldStatus !== status) {
      this.handlers.onStatusChange?.(status);
    }
  }

  private updateMetrics(result: TaskResult): void {
    if (result.status === "completed") {
      this.metrics.tasksCompleted++;
    } else {
      this.metrics.tasksFailed++;
    }

    if (result.duration) {
      this.metrics.totalDuration += result.duration;
      this.metrics.avgTaskDuration =
        this.metrics.totalDuration /
        (this.metrics.tasksCompleted + this.metrics.tasksFailed);
    }

    if (result.tokenUsage) {
      this.metrics.totalTokens += result.tokenUsage.total;
      this.metrics.avgTokensPerTask =
        this.metrics.totalTokens /
        (this.metrics.tasksCompleted + this.metrics.tasksFailed);
    }

    this.metrics.successRate =
      this.metrics.tasksCompleted /
      (this.metrics.tasksCompleted + this.metrics.tasksFailed);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export class WorkerPool {
  private workers: Map<string, Worker> = new Map();
  private taskAssignments: Map<string, string> = new Map();

  addWorker(worker: Worker): void {
    this.workers.set(worker.getId(), worker);
  }

  removeWorker(workerId: string): void {
    const worker = this.workers.get(workerId);
    if (worker) {
      worker.shutdown();
      this.workers.delete(workerId);
      
      for (const [taskId, wid] of this.taskAssignments) {
        if (wid === workerId) {
          this.taskAssignments.delete(taskId);
        }
      }
    }
  }

  getWorker(workerId: string): Worker | undefined {
    return this.workers.get(workerId);
  }

  getAvailableWorkers(): Worker[] {
    return Array.from(this.workers.values()).filter((w) => w.canAcceptTask());
  }

  getWorkerForTask(taskId: string): Worker | undefined {
    const workerId = this.taskAssignments.get(taskId);
    return workerId ? this.workers.get(workerId) : undefined;
  }

  assignTask(taskId: string, workerId: string): void {
    this.taskAssignments.set(taskId, workerId);
  }

  unassignTask(taskId: string): void {
    this.taskAssignments.delete(taskId);
  }

  getMetrics(): Map<string, WorkerMetrics> {
    const metrics = new Map<string, WorkerMetrics>();
    for (const [id, worker] of this.workers) {
      metrics.set(id, worker.getMetrics());
    }
    return metrics;
  }

  getTotalMetrics(): WorkerMetrics {
    let tasksCompleted = 0;
    let tasksFailed = 0;
    let totalDuration = 0;
    let totalTokens = 0;

    for (const worker of this.workers.values()) {
      const metrics = worker.getMetrics();
      tasksCompleted += metrics.tasksCompleted;
      tasksFailed += metrics.tasksFailed;
      totalDuration += metrics.totalDuration;
      totalTokens += metrics.totalTokens;
    }

    const total = tasksCompleted + tasksFailed;
    return {
      tasksCompleted,
      tasksFailed,
      totalDuration,
      totalTokens,
      avgTaskDuration: total > 0 ? totalDuration / total : 0,
      avgTokensPerTask: total > 0 ? totalTokens / total : 0,
      successRate: total > 0 ? tasksCompleted / total : 1,
      uptime: Date.now(),
    };
  }

  async broadcastHeartbeat(): Promise<void> {
    for (const worker of this.workers.values()) {
      worker.heartbeat();
    }
  }

  async shutdown(): Promise<void> {
    for (const worker of this.workers.values()) {
      await worker.shutdown();
    }
    this.workers.clear();
    this.taskAssignments.clear();
  }
}
