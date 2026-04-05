/**
 * Task Scheduler Implementation
 * 
 * Schedules and manages task executions with support for:
 * - One-time scheduled tasks
 * - Interval-based recurring tasks
 * - Delayed execution
 * - Task cancellation
 * - Execution tracking
 */

import type {
  Schedule,
  OnceSchedule,
  IntervalSchedule,
  ScheduleExecution,
  ScheduleStatus,
  SchedulerStats,
  SchedulerOptions,
} from "./types.js";

export type ScheduledTask = {
  id: string;
  schedule: Schedule;
  handler: () => Promise<unknown>;
  nextRun: number | null;
  lastRun: number | null;
  executions: ScheduleExecution[];
  status: "active" | "paused" | "cancelled";
  createdAt: number;
};

export type SchedulerEvent = {
  type: "task_scheduled" | "task_started" | "task_completed" | "task_failed" | "task_cancelled";
  taskId: string;
  timestamp: number;
  data?: unknown;
};

export type SchedulerEventHandler = (event: SchedulerEvent) => void;

export class TaskScheduler {
  private tasks: Map<string, ScheduledTask> = new Map();
  private options: SchedulerOptions;
  private timer: NodeJS.Timeout | null = null;
  private running: boolean = false;
  private runningTasks: Set<string> = new Set();
  private stats: SchedulerStats = {
    totalSchedules: 0,
    enabledSchedules: 0,
    totalExecutions: 0,
    successfulExecutions: 0,
    failedExecutions: 0,
    averageExecutionTime: 0,
  };
  private eventHandlers: SchedulerEventHandler[] = [];
  private persistencePath: string | null = null;
  private totalExecutionTime = 0;

  constructor(options: Partial<SchedulerOptions> = {}) {
    this.options = {
      maxConcurrentExecutions: options.maxConcurrentExecutions ?? 10,
      executionTimeout: options.executionTimeout ?? 300000,
      retryFailedExecutions: options.retryFailedExecutions ?? false,
      maxRetryCount: options.maxRetryCount ?? 2,
      persistenceEnabled: options.persistenceEnabled ?? false,
      persistencePath: options.persistencePath,
    };
  }

  async schedule(schedule: Schedule): Promise<string> {
    const task = this.createTask(schedule);
    this.tasks.set(task.id, task);
    this.updateStats();

    if (schedule.enabled) {
      this.calculateNextRun(task);
    }

    this.emitEvent({
      type: "task_scheduled",
      taskId: task.id,
      timestamp: Date.now(),
      data: { scheduleType: schedule.type },
    });

    return task.id;
  }

  async cancel(scheduleId: string): Promise<void> {
    const task = this.tasks.get(scheduleId);
    if (!task) {
      throw new Error(`Schedule ${scheduleId} not found`);
    }

    task.status = "cancelled";
    task.nextRun = null;

    this.emitEvent({
      type: "task_cancelled",
      taskId: scheduleId,
      timestamp: Date.now(),
    });

    this.updateStats();
  }

  async pause(scheduleId: string): Promise<void> {
    const task = this.tasks.get(scheduleId);
    if (!task) {
      throw new Error(`Schedule ${scheduleId} not found`);
    }

    task.status = "paused";
    task.nextRun = null;
    this.updateStats();
  }

  async resume(scheduleId: string): Promise<void> {
    const task = this.tasks.get(scheduleId);
    if (!task) {
      throw new Error(`Schedule ${scheduleId} not found`);
    }

    if (task.status !== "paused") {
      throw new Error(`Schedule ${scheduleId} is not paused`);
    }

    task.status = "active";
    this.calculateNextRun(task);
    this.updateStats();
  }

  async getExecution(executionId: string): Promise<ScheduleExecution | undefined> {
    for (const task of this.tasks.values()) {
      const execution = task.executions.find((e) => e.id === executionId);
      if (execution) {
        return execution;
      }
    }
    return undefined;
  }

  async getStats(): Promise<SchedulerStats> {
    return { ...this.stats };
  }

  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.timer = setInterval(() => this.tick(), 1000);
  }

  stop(): void {
    if (!this.running) {
      return;
    }

    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getTask(scheduleId: string): ScheduledTask | undefined {
    return this.tasks.get(scheduleId);
  }

  getAllTasks(): ScheduledTask[] {
    return Array.from(this.tasks.values());
  }

  getActiveTasks(): ScheduledTask[] {
    return Array.from(this.tasks.values()).filter(
      (task) => task.status === "active" && task.nextRun !== null
    );
  }

  on(eventHandler: SchedulerEventHandler): void {
    this.eventHandlers.push(eventHandler);
  }

  off(eventHandler: SchedulerEventHandler): void {
    const index = this.eventHandlers.indexOf(eventHandler);
    if (index >= 0) {
      this.eventHandlers.splice(index, 1);
    }
  }

  setPersistencePath(path: string): void {
    this.persistencePath = path;
    this.options.persistenceEnabled = true;
    this.options.persistencePath = path;
  }

  private createTask(schedule: Schedule): ScheduledTask {
    return {
      id: schedule.id,
      schedule,
      handler: this.resolveHandler(schedule),
      nextRun: null,
      lastRun: null,
      executions: [],
      status: schedule.enabled ? "active" : "paused",
      createdAt: Date.now(),
    };
  }

  private resolveHandler(schedule: Schedule): () => Promise<unknown> {
    return async () => {
      if (schedule.task.prompt) {
        return { prompt: schedule.task.prompt, executed: true };
      }
      return { executed: true };
    };
  }

  private calculateNextRun(task: ScheduledTask): void {
    const schedule = task.schedule;

    switch (schedule.type) {
      case "once":
        task.nextRun = (schedule as OnceSchedule).scheduledTime;
        break;

      case "interval":
        const intervalSchedule = schedule as IntervalSchedule;
        const startAt = intervalSchedule.startAt ?? Date.now();
        const elapsed = Date.now() - startAt;
        const intervals = Math.floor(elapsed / intervalSchedule.intervalMs);
        task.nextRun = startAt + (intervals + 1) * intervalSchedule.intervalMs;
        break;

      case "cron":
        task.nextRun = this.calculateNextCronRun((schedule as any).cronExpression);
        break;

      case "idle":
        task.nextRun = null;
        break;
    }

    if (task.nextRun && task.nextRun < Date.now()) {
      switch (schedule.type) {
        case "once":
          task.nextRun = null;
          task.status = "cancelled";
          break;
        case "interval":
          this.calculateNextRun(task);
          break;
      }
    }
  }

  private calculateNextCronRun(cronExpression: string): number | null {
    return this.parseCron(cronExpression)?.nextRun ?? null;
  }

  private parseCron(expression: string): { nextRun: number } | null {
    const parts = expression.split(/\s+/);
    if (parts.length !== 5) {
      return null;
    }

    const now = new Date();
    const next = new Date(now);
    next.setSeconds(0);
    next.setMilliseconds(0);
    next.setMinutes(next.getMinutes() + 1);

    return { nextRun: next.getTime() };
  }

  private async tick(): Promise<void> {
    const now = Date.now();

    for (const task of this.tasks.values()) {
      if (
        task.status !== "active" ||
        task.nextRun === null ||
        task.nextRun > now ||
        this.runningTasks.has(task.id)
      ) {
        continue;
      }

      if (this.runningTasks.size >= this.options.maxConcurrentExecutions) {
        break;
      }

      this.executeTask(task);
    }
  }

  private async executeTask(task: ScheduledTask): Promise<void> {
    this.runningTasks.add(task.id);

    const execution: ScheduleExecution = {
      id: `exec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      scheduleId: task.id,
      scheduledTime: task.nextRun!,
      startedAt: Date.now(),
      status: "running",
    };

    task.executions.push(execution);
    task.lastRun = Date.now();

    this.emitEvent({
      type: "task_started",
      taskId: task.id,
      timestamp: Date.now(),
      data: { executionId: execution.id },
    });

    try {
      const result = await this.executeWithTimeout(task);

      execution.completedAt = Date.now();
      execution.status = "completed";
      execution.result = {
        output: result,
      };

      this.stats.successfulExecutions++;
      this.totalExecutionTime += execution.completedAt - execution.startedAt!;
      this.stats.averageExecutionTime =
        this.totalExecutionTime / this.stats.successfulExecutions;

      this.emitEvent({
        type: "task_completed",
        taskId: task.id,
        timestamp: Date.now(),
        data: { executionId: execution.id, result },
      });
    } catch (error) {
      execution.status = "failed";
      execution.result = {
        error: error instanceof Error ? error.message : String(error),
      };

      this.stats.failedExecutions++;

      this.emitEvent({
        type: "task_failed",
        taskId: task.id,
        timestamp: Date.now(),
        data: { executionId: execution.id, error },
      });

      if (this.options.retryFailedExecutions && task.executions.length < this.options.maxRetryCount) {
        task.nextRun = Date.now() + 60000;
      }
    } finally {
      this.runningTasks.delete(task.id);
      this.stats.totalExecutions++;

      if (task.schedule.type !== "once" && task.status === "active") {
        this.calculateNextRun(task);
      } else if (task.schedule.type === "once") {
        task.nextRun = null;
        task.status = "cancelled";
      }
    }
  }

  private async executeWithTimeout(task: ScheduledTask): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error("Task execution timeout"));
      }, this.options.executionTimeout);

      task.handler()
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

  private updateStats(): void {
    this.stats.totalSchedules = this.tasks.size;
    this.stats.enabledSchedules = Array.from(this.tasks.values()).filter(
      (task) => task.status === "active" && task.schedule.enabled
    ).length;
  }

  private emitEvent(event: SchedulerEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch {
        // Handler error, ignore
      }
    }
  }

  checkIdleTasks(idleAgents: number): void {
    for (const task of this.tasks.values()) {
      if (task.schedule.type === "idle" && task.status === "active") {
        const idleSchedule = task.schedule as any;
        if (idleAgents >= idleSchedule.minIdleAgents) {
          task.nextRun = Date.now();
        }
      }
    }
  }
}

export function createTaskScheduler(options?: Partial<SchedulerOptions>): TaskScheduler {
  return new TaskScheduler(options);
}
