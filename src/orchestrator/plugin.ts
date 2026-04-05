/**
 * Orchestrator Plugin
 * 
 * Integrates the Orchestrator with OpenClaw's plugin system.
 * Provides tools for task orchestration and multi-agent coordination.
 */

import type { TaskDefinition, TaskResult, TaskStatus } from "./types.js";
import { Coordinator, DefaultTaskDecomposer, DefaultWorkerSelector, DefaultResultAggregator } from "./coordinator.js";
import { Worker, WorkerPool } from "./worker.js";
import { TaskDispatcher, ResultCollector } from "./dispatcher.js";
import { TaskQueue } from "./task-queue.js";

export type OrchestratorPluginConfig = {
  maxWorkers: number;
  defaultTimeout: number;
  taskQueueSize: number;
  dispatchStrategy: "round-robin" | "least-loaded" | "capability-based" | "priority-based";
  enableRetry: boolean;
  maxRetries: number;
};

export type OrchestratorState = {
  isActive: boolean;
  totalTasks: number;
  pendingTasks: number;
  runningTasks: number;
  completedTasks: number;
  failedTasks: number;
  activeWorkers: number;
  queueLength: number;
};

export type SubagentConfig = {
  model?: string;
  timeout?: number;
  capabilities?: string[];
  maxConcurrentTasks?: number;
};

export type TaskSubmitOptions = {
  priority?: "low" | "normal" | "high" | "urgent";
  timeout?: number;
  retryAttempts?: number;
  dependencies?: string[];
  requiredCapabilities?: string[];
  metadata?: Record<string, unknown>;
};

export type SpawnWorkerOptions = {
  id?: string;
  capabilities?: string[];
  maxTasks?: number;
  model?: string;
};

export class OrchestratorPlugin {
  private config: OrchestratorPluginConfig;
  private coordinator: Coordinator;
  private dispatcher: TaskDispatcher;
  private collector: ResultCollector;
  private workerPool: WorkerPool;
  private taskQueue: TaskQueue;
  private isActive = false;
  private metrics = {
    tasksSubmitted: 0,
    tasksCompleted: 0,
    tasksFailed: 0,
    totalDuration: 0,
    totalTokens: 0,
  };

  constructor(config: Partial<OrchestratorPluginConfig> = {}) {
    this.config = {
      maxWorkers: config.maxWorkers ?? 10,
      defaultTimeout: config.defaultTimeout ?? 300000,
      taskQueueSize: config.taskQueueSize ?? 100,
      dispatchStrategy: config.dispatchStrategy ?? "least-loaded",
      enableRetry: config.enableRetry ?? true,
      maxRetries: config.maxRetries ?? 3,
    };

    const decomposer = new DefaultTaskDecomposer();
    const selector = new DefaultWorkerSelector();
    const aggregator = new DefaultResultAggregator();

    this.coordinator = new Coordinator(
      {
        maxWorkers: this.config.maxWorkers,
        taskTimeout: this.config.defaultTimeout,
        retryAttempts: this.config.maxRetries,
        retryDelay: 5000,
        resultAggregationStrategy: "best",
      },
      { decomposer, selector, aggregator }
    );

    this.dispatcher = new TaskDispatcher(this.coordinator, {
      strategy: this.config.dispatchStrategy,
      maxQueueSize: this.config.taskQueueSize,
      retryEnabled: this.config.enableRetry,
      retryAttempts: this.config.maxRetries,
      retryDelay: 5000,
      timeout: this.config.defaultTimeout,
      priorityBoost: true,
    });

    this.collector = new ResultCollector();
    this.workerPool = new WorkerPool();
    this.taskQueue = new TaskQueue();

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.coordinator.registerWorker({
      id: "internal-coordinator",
      status: "idle",
      capabilities: ["coordinate", "decompose", "aggregate"],
      currentTasks: 0,
      maxTasks: 100,
      lastHeartbeat: Date.now(),
    });
  }

  async start(): Promise<void> {
    this.isActive = true;
  }

  async stop(): Promise<void> {
    this.isActive = false;
    await this.workerPool.shutdown();
    this.dispatcher.cancel;
  }

  async submitTask(prompt: string, options: TaskSubmitOptions = {}): Promise<string> {
    const task: TaskDefinition = {
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      prompt,
      priority: options.priority ?? "normal",
      timeout: options.timeout ?? this.config.defaultTimeout,
      maxRetries: options.retryAttempts ?? this.config.maxRetries,
      dependencies: options.dependencies,
      metadata: {
        ...options.metadata,
        requiredCapabilities: options.requiredCapabilities,
      },
    };

    await this.taskQueue.enqueue(task);
    this.metrics.tasksSubmitted++;

    const dispatchResult = await this.dispatcher.dispatch(task);

    if (dispatchResult.status === "rejected") {
      throw new Error(`Task rejected: ${dispatchResult.reason}`);
    }

    return task.id;
  }

  async submitBatch(
    tasks: Array<{ prompt: string; options?: TaskSubmitOptions }>
  ): Promise<string[]> {
    const taskIds: string[] = [];

    for (const { prompt, options } of tasks) {
      const taskId = await this.submitTask(prompt, options);
      taskIds.push(taskId);
    }

    return taskIds;
  }

  async getTaskStatus(taskId: string): Promise<{
    status: TaskStatus;
    result?: TaskResult;
    queuePosition?: number;
    workerId?: string;
  }> {
    const task = await this.taskQueue.get(taskId);
    if (task) {
      return {
        status: task.status,
        queuePosition: await this.getQueuePosition(taskId),
      };
    }

    const result = this.collector.get(taskId);
    if (result) {
      return {
        status: result.status,
        result,
        workerId: result.agentId,
      };
    }

    const dispatchStatus = await this.dispatcher.getStatus(taskId);
    if (dispatchStatus) {
      return {
        status: dispatchStatus.status === "queued" ? "pending" : "running",
        queuePosition: dispatchStatus.queuePosition,
        workerId: dispatchStatus.workerId || undefined,
      };
    }

    throw new Error(`Task ${taskId} not found`);
  }

  async cancelTask(taskId: string): Promise<boolean> {
    await this.taskQueue.remove(taskId);
    return this.dispatcher.cancel(taskId);
  }

  async waitForTask(taskId: string, timeout?: number): Promise<TaskResult> {
    return this.collector.waitFor(taskId, timeout ?? this.config.defaultTimeout);
  }

  async waitForAll(taskIds: string[], timeout?: number): Promise<Map<string, TaskResult>> {
    return this.collector.waitForAll(taskIds, timeout ?? this.config.defaultTimeout);
  }

  spawnWorker(options: SpawnWorkerOptions = {}): string {
    const id = options.id ?? `worker-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const capabilities = options.capabilities ?? ["general"];
    const maxTasks = options.maxTasks ?? 3;

    const worker = new Worker(
      id,
      {
        maxConcurrentTasks: maxTasks,
        taskTimeout: this.config.defaultTimeout,
      },
      {
        skills: capabilities,
        tools: [],
        models: options.model ? [options.model] : [],
        maxTokens: 4096,
        supportsStreaming: true,
        supportsAttachments: false,
      },
      async (task: TaskDefinition) => {
        return this.executeTaskOnWorker(id, task);
      }
    );

    this.workerPool.addWorker(worker);
    this.dispatcher.registerWorker(
      id,
      worker.getCapabilities(),
      async () => ({ taskId: "", agentId: id, status: "completed", duration: 0 }),
      { maxConcurrentTasks: maxTasks }
    );

    return id;
  }

  terminateWorker(workerId: string): void {
    this.workerPool.removeWorker(workerId);
    this.dispatcher.unregisterWorker(workerId);
  }

  getWorkerIds(): string[] {
    return Array.from(this.workerPool.getMetrics().keys());
  }

  async getState(): Promise<OrchestratorState> {
    const coordinatorState = await this.coordinator.getState();
    const queueLength = this.dispatcher.getQueueLength();

    return {
      isActive: this.isActive,
      totalTasks: coordinatorState.totalTasks,
      pendingTasks: coordinatorState.pendingTasks,
      runningTasks: coordinatorState.runningTasks,
      completedTasks: coordinatorState.completedTasks,
      failedTasks: coordinatorState.failedTasks,
      activeWorkers: coordinatorState.activeWorkers,
      queueLength,
    };
  }

  getMetrics(): {
    tasksSubmitted: number;
    tasksCompleted: number;
    tasksFailed: number;
    totalDuration: number;
    totalTokens: number;
    avgDuration: number;
    avgTokens: number;
    successRate: number;
  } {
    const total = this.metrics.tasksCompleted + this.metrics.tasksFailed;
    return {
      ...this.metrics,
      avgDuration: total > 0 ? this.metrics.totalDuration / total : 0,
      avgTokens: total > 0 ? this.metrics.totalTokens / total : 0,
      successRate: total > 0 ? this.metrics.tasksCompleted / total : 0,
    };
  }

  getWorkerMetrics(): Map<string, ReturnType<Worker["getMetrics"]>> {
    return this.workerPool.getMetrics();
  }

  private async executeTaskOnWorker(workerId: string, task: TaskDefinition): Promise<TaskResult> {
    const startTime = Date.now();

    try {
      const worker = this.workerPool.getWorker(workerId);
      if (!worker) {
        throw new Error(`Worker ${workerId} not found`);
      }

      const result: TaskResult = {
        taskId: task.id,
        agentId: workerId,
        status: "completed",
        output: { prompt: task.prompt, processed: true },
        duration: Date.now() - startTime,
      };

      this.collector.collect(result);
      this.metrics.tasksCompleted++;
      this.metrics.totalDuration += result.duration;

      if (result.tokenUsage) {
        this.metrics.totalTokens += result.tokenUsage.total;
      }

      return result;
    } catch (error) {
      const result: TaskResult = {
        taskId: task.id,
        agentId: workerId,
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
        duration: Date.now() - startTime,
      };

      this.collector.collect(result);
      this.metrics.tasksFailed++;

      return result;
    }
  }

  private async getQueuePosition(taskId: string): Promise<number> {
    const pending = this.dispatcher.getPendingTasks();
    const index = pending.findIndex((t) => t.id === taskId);
    return index >= 0 ? index + 1 : 0;
  }
}

export function createOrchestratorPlugin(
  config?: Partial<OrchestratorPluginConfig>
): OrchestratorPlugin {
  return new OrchestratorPlugin(config);
}

export const orchestratorTools = {
  name: "orchestrator",
  tools: [
    {
      name: "orchestrator_submit_task",
      description: "Submit a task to the orchestrator for execution by available workers",
      parameters: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "The task prompt to execute",
          },
          priority: {
            type: "string",
            enum: ["low", "normal", "high", "urgent"],
            description: "Task priority (default: normal)",
          },
          timeout: {
            type: "number",
            description: "Task timeout in milliseconds",
          },
          requiredCapabilities: {
            type: "array",
            items: { type: "string" },
            description: "Required worker capabilities",
          },
        },
        required: ["prompt"],
      },
    },
    {
      name: "orchestrator_submit_batch",
      description: "Submit multiple tasks in batch",
      parameters: {
        type: "object",
        properties: {
          tasks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                prompt: { type: "string" },
                priority: { type: "string" },
              },
            },
            description: "Array of tasks to submit",
          },
        },
        required: ["tasks"],
      },
    },
    {
      name: "orchestrator_get_status",
      description: "Get the status of a task",
      parameters: {
        type: "object",
        properties: {
          taskId: {
            type: "string",
            description: "The task ID to check",
          },
        },
        required: ["taskId"],
      },
    },
    {
      name: "orchestrator_cancel_task",
      description: "Cancel a pending or running task",
      parameters: {
        type: "object",
        properties: {
          taskId: {
            type: "string",
            description: "The task ID to cancel",
          },
        },
        required: ["taskId"],
      },
    },
    {
      name: "orchestrator_wait_task",
      description: "Wait for a task to complete and get its result",
      parameters: {
        type: "object",
        properties: {
          taskId: {
            type: "string",
            description: "The task ID to wait for",
          },
          timeout: {
            type: "number",
            description: "Maximum time to wait in milliseconds",
          },
        },
        required: ["taskId"],
      },
    },
    {
      name: "orchestrator_spawn_worker",
      description: "Spawn a new worker to process tasks",
      parameters: {
        type: "object",
        properties: {
          capabilities: {
            type: "array",
            items: { type: "string" },
            description: "Worker capabilities",
          },
          maxTasks: {
            type: "number",
            description: "Maximum concurrent tasks for this worker",
          },
        },
        required: [],
      },
    },
    {
      name: "orchestrator_terminate_worker",
      description: "Terminate a worker",
      parameters: {
        type: "object",
        properties: {
          workerId: {
            type: "string",
            description: "The worker ID to terminate",
          },
        },
        required: ["workerId"],
      },
    },
    {
      name: "orchestrator_get_state",
      description: "Get the current orchestrator state",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    {
      name: "orchestrator_get_metrics",
      description: "Get orchestrator metrics",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  ],
};
