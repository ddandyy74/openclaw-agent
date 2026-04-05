/**
 * Task Dispatcher
 * 
 * Handles task distribution, routing, and execution coordination.
 */

import type { TaskDefinition, TaskResult, TaskStatus, TaskPriority } from "./types.js";
import { Coordinator, type CoordinatorConfig, type WorkerInfo } from "./coordinator.js";
import { Worker, type WorkerConfig, type WorkerCapabilities, type TaskExecutor } from "./worker.js";

export type DispatchStrategy = "round-robin" | "least-loaded" | "capability-based" | "priority-based";

export type DispatchResult = {
  taskId: string;
  workerId: string;
  dispatchedAt: number;
  status: "dispatched" | "queued" | "rejected";
  queuePosition?: number;
  reason?: string;
};

export type DispatchConfig = {
  strategy: DispatchStrategy;
  maxQueueSize: number;
  retryEnabled: boolean;
  retryAttempts: number;
  retryDelay: number;
  timeout: number;
  priorityBoost: boolean;
};

export type TaskQueueItem = {
  task: TaskDefinition;
  enqueuedAt: number;
  priority: number;
  attempts: number;
  lastAttempt?: number;
  error?: string;
};

export interface IDispatcher {
  dispatch(task: TaskDefinition): Promise<DispatchResult>;
  dispatchBatch(tasks: TaskDefinition[]): Promise<DispatchResult[]>;
  cancel(taskId: string): Promise<boolean>;
  getStatus(taskId: string): Promise<DispatchResult | undefined>;
  getQueueLength(): number;
  getPendingTasks(): TaskDefinition[];
  setStrategy(strategy: DispatchStrategy): void;
}

export class TaskDispatcher implements IDispatcher {
  private coordinator: Coordinator;
  private workers: Map<string, Worker> = new Map();
  private taskQueue: TaskQueueItem[] = [];
  private pendingTasks: Map<string, TaskQueueItem> = new Map();
  private runningTasks: Map<string, { workerId: string; startedAt: number }> = new Map();
  private completedTasks: Map<string, TaskResult> = new Map();
  private config: DispatchConfig;
  private roundRobinIndex = 0;

  constructor(
    coordinator: Coordinator,
    config: Partial<DispatchConfig>
  ) {
    this.coordinator = coordinator;
    this.config = {
      strategy: config.strategy ?? "least-loaded",
      maxQueueSize: config.maxQueueSize ?? 100,
      retryEnabled: config.retryEnabled ?? true,
      retryAttempts: config.retryAttempts ?? 3,
      retryDelay: config.retryDelay ?? 5000,
      timeout: config.timeout ?? 300000,
      priorityBoost: config.priorityBoost ?? true,
    };
  }

  registerWorker(
    id: string,
    capabilities: WorkerCapabilities,
    executor: TaskExecutor,
    config?: Partial<WorkerConfig>
  ): void {
    const worker = new Worker(id, config ?? {}, capabilities, executor);
    this.workers.set(id, worker);

    worker.setHandlers({
      onTaskComplete: (result) => {
        this.handleTaskComplete(result);
      },
      onTaskError: (taskId, error) => {
        this.handleTaskError(taskId, error);
      },
    });

    this.coordinator.registerWorker({
      id,
      status: "idle",
      capabilities: capabilities.skills,
      currentTasks: 0,
      maxTasks: config?.maxConcurrentTasks ?? 3,
      lastHeartbeat: Date.now(),
    });
  }

  unregisterWorker(workerId: string): void {
    const worker = this.workers.get(workerId);
    if (worker) {
      worker.shutdown();
      this.workers.delete(workerId);
      this.coordinator.unregisterWorker(workerId);
    }
  }

  async dispatch(task: TaskDefinition): Promise<DispatchResult> {
    if (this.taskQueue.length >= this.config.maxQueueSize) {
      return {
        taskId: task.id,
        workerId: "",
        dispatchedAt: Date.now(),
        status: "rejected",
        reason: "Queue is full",
      };
    }

    const availableWorker = this.selectWorker(task);

    if (availableWorker) {
      return this.dispatchToWorker(task, availableWorker);
    }

    return this.enqueueTask(task);
  }

  async dispatchBatch(tasks: TaskDefinition[]): Promise<DispatchResult[]> {
    const results: DispatchResult[] = [];

    const sortedTasks = this.sortTasksByPriority(tasks);

    for (const task of sortedTasks) {
      const result = await this.dispatch(task);
      results.push(result);
    }

    return results;
  }

  async cancel(taskId: string): Promise<boolean> {
    const pending = this.pendingTasks.get(taskId);
    if (pending) {
      this.pendingTasks.delete(taskId);
      const index = this.taskQueue.findIndex((item) => item.task.id === taskId);
      if (index >= 0) {
        this.taskQueue.splice(index, 1);
      }
      return true;
    }

    const running = this.runningTasks.get(taskId);
    if (running) {
      const worker = this.workers.get(running.workerId);
      if (worker) {
        return worker.cancel(taskId);
      }
    }

    return false;
  }

  async getStatus(taskId: string): Promise<DispatchResult | undefined> {
    const completed = this.completedTasks.get(taskId);
    if (completed) {
      return {
        taskId,
        workerId: completed.agentId,
        dispatchedAt: completed.duration ? Date.now() - completed.duration : Date.now(),
        status: "dispatched",
      };
    }

    const running = this.runningTasks.get(taskId);
    if (running) {
      return {
        taskId,
        workerId: running.workerId,
        dispatchedAt: running.startedAt,
        status: "dispatched",
      };
    }

    const pending = this.pendingTasks.get(taskId);
    if (pending) {
      const queuePosition = this.taskQueue.findIndex((item) => item.task.id === taskId);
      return {
        taskId,
        workerId: "",
        dispatchedAt: pending.enqueuedAt,
        status: "queued",
        queuePosition: queuePosition >= 0 ? queuePosition + 1 : undefined,
      };
    }

    return undefined;
  }

  getQueueLength(): number {
    return this.taskQueue.length;
  }

  getPendingTasks(): TaskDefinition[] {
    return this.taskQueue.map((item) => item.task);
  }

  setStrategy(strategy: DispatchStrategy): void {
    this.config.strategy = strategy;
  }

  getResult(taskId: string): TaskResult | undefined {
    return this.completedTasks.get(taskId);
  }

  getRunningTasks(): string[] {
    return Array.from(this.runningTasks.keys());
  }

  private selectWorker(task: TaskDefinition): Worker | undefined {
    const availableWorkers = Array.from(this.workers.values()).filter((w) =>
      w.canAcceptTask()
    );

    if (availableWorkers.length === 0) {
      return undefined;
    }

    switch (this.config.strategy) {
      case "round-robin":
        return this.selectRoundRobin(availableWorkers);

      case "least-loaded":
        return this.selectLeastLoaded(availableWorkers);

      case "capability-based":
        return this.selectByCapability(task, availableWorkers);

      case "priority-based":
        return this.selectByPriority(task, availableWorkers);

      default:
        return availableWorkers[0];
    }
  }

  private selectRoundRobin(workers: Worker[]): Worker {
    this.roundRobinIndex = (this.roundRobinIndex + 1) % workers.length;
    return workers[this.roundRobinIndex];
  }

  private selectLeastLoaded(workers: Worker[]): Worker {
    return workers.reduce((min, worker) => {
      const minTasks = min.getCurrentTasks().length;
      const workerTasks = worker.getCurrentTasks().length;
      return workerTasks < minTasks ? worker : min;
    });
  }

  private selectByCapability(task: TaskDefinition, workers: Worker[]): Worker | undefined {
    const requiredCapabilities = (task.metadata?.requiredCapabilities as string[]) ?? [];

    const capableWorkers = workers.filter((worker) => {
      const capabilities = worker.getCapabilities();
      return requiredCapabilities.every((cap) => capabilities.skills.includes(cap));
    });

    if (capableWorkers.length === 0) {
      return undefined;
    }

    return this.selectLeastLoaded(capableWorkers);
  }

  private selectByPriority(task: TaskDefinition, workers: Worker[]): Worker {
    const priorityOrder: Record<TaskPriority, number> = {
      urgent: 0,
      high: 1,
      normal: 2,
      low: 3,
    };

    const workersWithPriority = workers.map((worker) => {
      const currentTasks = worker.getCurrentTasks();
      let priorityScore = 0;

      for (const taskId of currentTasks) {
        const pending = this.pendingTasks.get(taskId);
        if (pending) {
          priorityScore += priorityOrder[pending.task.priority] ?? 2;
        }
      }

      return { worker, priorityScore };
    });

    workersWithPriority.sort((a, b) => a.priorityScore - b.priorityScore);
    return workersWithPriority[0].worker;
  }

  private async dispatchToWorker(task: TaskDefinition, worker: Worker): Promise<DispatchResult> {
    const dispatchedAt = Date.now();

    try {
      const workerId = worker.getId();

      this.runningTasks.set(task.id, { workerId, startedAt: dispatchedAt });
      this.pendingTasks.delete(task.id);

      worker.execute(task).catch((error) => {
        this.handleTaskError(task.id, error);
      });

      return {
        taskId: task.id,
        workerId,
        dispatchedAt,
        status: "dispatched",
      };
    } catch (error) {
      return {
        taskId: task.id,
        workerId: "",
        dispatchedAt,
        status: "rejected",
        reason: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  private enqueueTask(task: TaskDefinition): DispatchResult {
    const item: TaskQueueItem = {
      task,
      enqueuedAt: Date.now(),
      priority: this.calculatePriority(task),
      attempts: 0,
    };

    this.pendingTasks.set(task.id, item);

    const insertIndex = this.taskQueue.findIndex((existing) => existing.priority > item.priority);
    if (insertIndex >= 0) {
      this.taskQueue.splice(insertIndex, 0, item);
    } else {
      this.taskQueue.push(item);
    }

    this.processQueue();

    return {
      taskId: task.id,
      workerId: "",
      dispatchedAt: item.enqueuedAt,
      status: "queued",
      queuePosition: insertIndex >= 0 ? insertIndex + 1 : this.taskQueue.length,
    };
  }

  private calculatePriority(task: TaskDefinition): number {
    const priorityWeights: Record<TaskPriority, number> = {
      urgent: 1000,
      high: 100,
      normal: 10,
      low: 1,
    };

    let priority = priorityWeights[task.priority] ?? 10;

    if (this.config.priorityBoost && task.metadata?.priorityBoost) {
      priority += 50;
    }

    if (task.metadata?.deadline) {
      const deadline = task.metadata.deadline as number;
      const now = Date.now();
      const timeUntilDeadline = deadline - now;
      if (timeUntilDeadline < 60000) {
        priority += 500;
      } else if (timeUntilDeadline < 300000) {
        priority += 200;
      }
    }

    return priority;
  }

  private processQueue(): void {
    while (this.taskQueue.length > 0) {
      const item = this.taskQueue[0];
      const worker = this.selectWorker(item.task);

      if (!worker) {
        break;
      }

      this.taskQueue.shift();
      this.dispatchToWorker(item.task, worker);
    }
  }

  private handleTaskComplete(result: TaskResult): void {
    this.runningTasks.delete(result.taskId);
    this.completedTasks.set(result.taskId, result);

    this.coordinator.completeTask(result.taskId, result);

    this.processQueue();
  }

  private handleTaskError(taskId: string, error: Error): void {
    const running = this.runningTasks.get(taskId);
    if (!running) {
      return;
    }

    this.runningTasks.delete(taskId);

    if (this.config.retryEnabled) {
      const pending = this.pendingTasks.get(taskId);
      if (pending && pending.attempts < this.config.retryAttempts) {
        pending.attempts++;
        pending.lastAttempt = Date.now();
        pending.error = error.message;

        setTimeout(() => {
          this.taskQueue.push(pending);
          this.processQueue();
        }, this.config.retryDelay);

        return;
      }
    }

    this.coordinator.failTask(taskId, error.message);

    this.processQueue();
  }

  private sortTasksByPriority(tasks: TaskDefinition[]): TaskDefinition[] {
    const priorityOrder: Record<TaskPriority, number> = {
      urgent: 0,
      high: 1,
      normal: 2,
      low: 3,
    };

    return [...tasks].sort((a, b) => {
      const orderA = priorityOrder[a.priority] ?? 2;
      const orderB = priorityOrder[b.priority] ?? 2;
      return orderA - orderB;
    });
  }
}

export class ResultCollector {
  private results: Map<string, TaskResult> = new Map();
  private partialResults: Map<string, TaskResult[]> = new Map();
  private callbacks: Map<string, (result: TaskResult) => void> = new Map();

  collect(result: TaskResult): void {
    this.results.set(result.taskId, result);

    const callback = this.callbacks.get(result.taskId);
    if (callback) {
      callback(result);
      this.callbacks.delete(result.taskId);
    }
  }

  collectPartial(parentTaskId: string, result: TaskResult): void {
    const existing = this.partialResults.get(parentTaskId) ?? [];
    existing.push(result);
    this.partialResults.set(parentTaskId, existing);
  }

  get(taskId: string): TaskResult | undefined {
    return this.results.get(taskId);
  }

  getPartial(parentTaskId: string): TaskResult[] {
    return this.partialResults.get(parentTaskId) ?? [];
  }

  getAll(): Map<string, TaskResult> {
    return new Map(this.results);
  }

  waitFor(taskId: string, timeout?: number): Promise<TaskResult> {
    return new Promise((resolve, reject) => {
      const existing = this.results.get(taskId);
      if (existing) {
        resolve(existing);
        return;
      }

      const timeoutId = timeout
        ? setTimeout(() => {
            this.callbacks.delete(taskId);
            reject(new Error(`Timeout waiting for task ${taskId}`));
          }, timeout)
        : undefined;

      this.callbacks.set(taskId, (result) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        resolve(result);
      });
    });
  }

  waitForAll(taskIds: string[], timeout?: number): Promise<Map<string, TaskResult>> {
    return new Promise((resolve, reject) => {
      const results = new Map<string, TaskResult>();
      const pending = new Set(taskIds);

      for (const taskId of taskIds) {
        const existing = this.results.get(taskId);
        if (existing) {
          results.set(taskId, existing);
          pending.delete(taskId);
        }
      }

      if (pending.size === 0) {
        resolve(results);
        return;
      }

      const timeoutId = timeout
        ? setTimeout(() => {
            reject(new Error(`Timeout waiting for tasks: ${Array.from(pending).join(", ")}`));
          }, timeout)
        : undefined;

      let completed = results.size;
      const total = taskIds.length;

      for (const taskId of pending) {
        this.callbacks.set(taskId, (result) => {
          results.set(taskId, result);
          completed++;

          if (completed === total) {
            if (timeoutId) {
              clearTimeout(timeoutId);
            }
            resolve(results);
          }
        });
      }
    });
  }

  clear(taskId?: string): void {
    if (taskId) {
      this.results.delete(taskId);
      this.partialResults.delete(taskId);
      this.callbacks.delete(taskId);
    } else {
      this.results.clear();
      this.partialResults.clear();
      this.callbacks.clear();
    }
  }

  stats(): {
    total: number;
    completed: number;
    failed: number;
    partial: number;
  } {
    let completed = 0;
    let failed = 0;

    for (const result of this.results.values()) {
      if (result.status === "completed") {
        completed++;
      } else if (result.status === "failed") {
        failed++;
      }
    }

    return {
      total: this.results.size,
      completed,
      failed,
      partial: this.partialResults.size,
    };
  }
}
