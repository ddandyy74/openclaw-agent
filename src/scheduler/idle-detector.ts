/**
 * Idle Detector Implementation
 * 
 * Detects system idle states and triggers tasks when conditions are met.
 */

import type { IdleSchedule, ScheduleExecution } from "./types.js";

export type IdleState = {
  isIdle: boolean;
  idleSince: number | null;
  idleDuration: number;
  activeAgents: number;
  lastActivity: number;
};

export type IdleTask = {
  id: string;
  schedule: IdleSchedule;
  handler: () => Promise<unknown>;
  lastRun: number | null;
  executions: ScheduleExecution[];
  enabled: boolean;
  createdAt: number;
};

export type IdleDetectorConfig = {
  checkInterval: number;
  defaultIdleThreshold: number;
  defaultMinIdleAgents: number;
  activityTimeout: number;
};

export type IdleEventHandler = {
  onIdle?: () => void;
  onActive?: () => void;
  onTaskTriggered?: (taskId: string) => void;
  onTaskCompleted?: (taskId: string, result: unknown) => void;
  onTaskFailed?: (taskId: string, error: Error) => void;
};

export class IdleDetector {
  private tasks: Map<string, IdleTask> = new Map();
  private config: IdleDetectorConfig;
  private state: IdleState = {
    isIdle: false,
    idleSince: null,
    idleDuration: 0,
    activeAgents: 0,
    lastActivity: Date.now(),
  };
  private timer: NodeJS.Timeout | null = null;
  private running: boolean = false;
  private runningTasks: Set<string> = new Set();
  private activityCallbacks: Set<() => void> = new Set();
  private handlers: IdleEventHandler = {};

  constructor(config: Partial<IdleDetectorConfig> = {}) {
    this.config = {
      checkInterval: config.checkInterval ?? 5000,
      defaultIdleThreshold: config.defaultIdleThreshold ?? 300000,
      defaultMinIdleAgents: config.defaultMinIdleAgents ?? 0,
      activityTimeout: config.activityTimeout ?? 60000,
    };
  }

  async schedule(schedule: IdleSchedule): Promise<string> {
    const task: IdleTask = {
      id: schedule.id,
      schedule,
      handler: this.createHandler(schedule),
      lastRun: null,
      executions: [],
      enabled: schedule.enabled,
      createdAt: Date.now(),
    };

    this.tasks.set(task.id, task);
    return task.id;
  }

  async cancel(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (task) {
      task.enabled = false;
    }
  }

  async isEnabled(taskId: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    return task?.enabled ?? false;
  }

  async setEnabled(taskId: string, enabled: boolean): Promise<void> {
    const task = this.tasks.get(taskId);
    if (task) {
      task.enabled = enabled;
    }
  }

  getState(): IdleState {
    return { ...this.state };
  }

  reportActivity(): void {
    this.state.lastActivity = Date.now();
    this.state.idleDuration = 0;

    if (this.state.isIdle) {
      this.state.isIdle = false;
      this.state.idleSince = null;

      if (this.handlers.onActive) {
        this.handlers.onActive();
      }
    }

    for (const callback of this.activityCallbacks) {
      try {
        callback();
      } catch {
        // Ignore callback errors
      }
    }
  }

  reportAgentCount(count: number): void {
    this.state.activeAgents = count;
  }

  onActivity(callback: () => void): () => void {
    this.activityCallbacks.add(callback);
    return () => this.activityCallbacks.delete(callback);
  }

  setHandlers(handlers: IdleEventHandler): void {
    this.handlers = { ...this.handlers, ...handlers };
  }

  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.timer = setInterval(() => this.tick(), this.config.checkInterval);
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

  getTask(taskId: string): IdleTask | undefined {
    return this.tasks.get(taskId);
  }

  getAllTasks(): IdleTask[] {
    return Array.from(this.tasks.values());
  }

  getEnabledTasks(): IdleTask[] {
    return Array.from(this.tasks.values()).filter((task) => task.enabled);
  }

  checkIdleConditions(): boolean {
    const now = Date.now();
    const idleDuration = now - this.state.lastActivity;

    this.state.idleDuration = idleDuration;

    if (!this.state.isIdle && idleDuration >= this.config.activityTimeout) {
      this.state.isIdle = true;
      this.state.idleSince = this.state.lastActivity;

      if (this.handlers.onIdle) {
        this.handlers.onIdle();
      }
    }

    return this.state.isIdle;
  }

  private tick(): void {
    const isIdle = this.checkIdleConditions();
    const now = Date.now();

    for (const task of this.tasks.values()) {
      if (!task.enabled || this.runningTasks.has(task.id)) {
        continue;
      }

      const threshold = task.schedule.idleThresholdMs;
      const minAgents = task.schedule.minIdleAgents;

      const idleLongEnough = isIdle && this.state.idleDuration >= threshold;
      const agentsIdle = this.state.activeAgents <= minAgents;

      if (idleLongEnough && agentsIdle) {
        const lastRun = task.lastRun ?? 0;
        const timeSinceLastRun = now - lastRun;

        if (timeSinceLastRun >= threshold) {
          this.executeTask(task);
        }
      }
    }
  }

  private async executeTask(task: IdleTask): Promise<void> {
    this.runningTasks.add(task.id);

    if (this.handlers.onTaskTriggered) {
      this.handlers.onTaskTriggered(task.id);
    }

    const execution: ScheduleExecution = {
      id: `exec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      scheduleId: task.id,
      scheduledTime: Date.now(),
      startedAt: Date.now(),
      status: "running",
    };

    task.executions.push(execution);

    try {
      const result = await task.handler();

      execution.completedAt = Date.now();
      execution.status = "completed";
      execution.result = { output: result };

      task.lastRun = Date.now();

      if (this.handlers.onTaskCompleted) {
        this.handlers.onTaskCompleted(task.id, result);
      }
    } catch (error) {
      execution.status = "failed";
      execution.result = {
        error: error instanceof Error ? error.message : String(error),
      };

      if (this.handlers.onTaskFailed) {
        this.handlers.onTaskFailed(task.id, error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      this.runningTasks.delete(task.id);
    }
  }

  private createHandler(schedule: IdleSchedule): () => Promise<unknown> {
    return async () => {
      if (schedule.task.prompt) {
        return { prompt: schedule.task.prompt, executed: true };
      }
      return { executed: true };
    };
  }
}

export function createIdleDetector(config?: Partial<IdleDetectorConfig>): IdleDetector {
  return new IdleDetector(config);
}
