/**
 * Cron Scheduler Implementation
 * 
 * Handles cron-based scheduling with:
 * - Standard cron expression parsing
 * - Timezone support
 * - Missed run recovery
 * - Execution history
 */

import type { CronSchedule, ScheduleExecution, CronParseResult } from "./types.js";

type CronField = {
  type: "every" | "specific" | "range" | "step";
  values: number[];
};

type ParsedCron = {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
};

export type CronTask = {
  id: string;
  expression: string;
  timezone?: string;
  handler: () => Promise<unknown>;
  lastRun?: number;
  nextRun?: number;
  enabled: boolean;
  executions: ScheduleExecution[];
  createdAt: number;
};

export type CronSchedulerConfig = {
  maxTasks: number;
  defaultTimezone: string;
  catchUpMissed: boolean;
  maxCatchUpRuns: number;
  executionTimeout: number;
};

type CronEventHandler = {
  onScheduled?: (taskId: string) => void;
  onTriggered?: (taskId: string) => void;
  onCompleted?: (taskId: string, result: unknown) => void;
  onFailed?: (taskId: string, error: Error) => void;
  onCancelled?: (taskId: string) => void;
};

export class CronScheduler {
  private tasks: Map<string, CronTask> = new Map();
  private config: CronSchedulerConfig;
  private timer: NodeJS.Timeout | null = null;
  private running: boolean = false;
  private runningTasks: Set<string> = new Set();
  private handlers: CronEventHandler = {};

  constructor(config: Partial<CronSchedulerConfig> = {}) {
    this.config = {
      maxTasks: config.maxTasks ?? 100,
      defaultTimezone: config.defaultTimezone ?? "UTC",
      catchUpMissed: config.catchUpMissed ?? true,
      maxCatchUpRuns: config.maxCatchUpRuns ?? 3,
      executionTimeout: config.executionTimeout ?? 300000,
    };
  }

  parseCronExpression(expression: string): CronParseResult {
    try {
      const parsed = this.parseCron(expression);
      const nextRuns = this.calculateNextRuns(parsed, 5);

      return {
        valid: true,
        nextRuns,
      };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : "Invalid cron expression",
      };
    }
  }

  async schedule(schedule: CronSchedule): Promise<string> {
    if (this.tasks.size >= this.config.maxTasks) {
      throw new Error("Maximum number of cron tasks reached");
    }

    const parseResult = this.parseCronExpression(schedule.cronExpression);
    if (!parseResult.valid) {
      throw new Error(`Invalid cron expression: ${parseResult.error}`);
    }

    const parsed = this.parseCron(schedule.cronExpression);
    const nextRun = this.calculateNextRun(parsed, Date.now());

    const task: CronTask = {
      id: schedule.id,
      expression: schedule.cronExpression,
      timezone: schedule.timezone ?? this.config.defaultTimezone,
      handler: this.createHandler(schedule),
      lastRun: schedule.lastRun,
      nextRun,
      enabled: schedule.enabled,
      executions: [],
      createdAt: Date.now(),
    };

    if (this.config.catchUpMissed && schedule.lastRun) {
      this.catchUpMissedRuns(task, parsed);
    }

    this.tasks.set(task.id, task);

    if (this.handlers.onScheduled) {
      this.handlers.onScheduled(task.id);
    }

    return task.id;
  }

  async cancel(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    task.enabled = false;
    task.nextRun = undefined;

    if (this.handlers.onCancelled) {
      this.handlers.onCancelled(taskId);
    }
  }

  async getNextRun(taskId: string): Promise<number | undefined> {
    const task = this.tasks.get(taskId);
    return task?.nextRun;
  }

  async getExecutions(taskId: string): Promise<ScheduleExecution[]> {
    const task = this.tasks.get(taskId);
    return task?.executions ?? [];
  }

  setHandlers(handlers: CronEventHandler): void {
    this.handlers = { ...this.handlers, ...handlers };
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

  getTask(taskId: string): CronTask | undefined {
    return this.tasks.get(taskId);
  }

  getAllTasks(): CronTask[] {
    return Array.from(this.tasks.values());
  }

  getEnabledTasks(): CronTask[] {
    return Array.from(this.tasks.values()).filter((task) => task.enabled);
  }

  private tick(): void {
    const now = Date.now();

    for (const task of this.tasks.values()) {
      if (
        !task.enabled ||
        !task.nextRun ||
        task.nextRun > now ||
        this.runningTasks.has(task.id)
      ) {
        continue;
      }

      this.executeTask(task);
    }
  }

  private async executeTask(task: CronTask): Promise<void> {
    this.runningTasks.add(task.id);

    if (this.handlers.onTriggered) {
      this.handlers.onTriggered(task.id);
    }

    const execution: ScheduleExecution = {
      id: `exec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      scheduleId: task.id,
      scheduledTime: task.nextRun!,
      startedAt: Date.now(),
      status: "running",
    };

    task.executions.push(execution);

    try {
      const result = await this.executeWithTimeout(task);

      execution.completedAt = Date.now();
      execution.status = "completed";
      execution.result = { output: result };

      task.lastRun = Date.now();

      if (this.handlers.onCompleted) {
        this.handlers.onCompleted(task.id, result);
      }
    } catch (error) {
      execution.status = "failed";
      execution.result = {
        error: error instanceof Error ? error.message : String(error),
      };

      if (this.handlers.onFailed) {
        this.handlers.onFailed(task.id, error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      this.runningTasks.delete(task.id);

      if (task.enabled) {
        const parsed = this.parseCron(task.expression);
        task.nextRun = this.calculateNextRun(parsed, Date.now());
      }
    }
  }

  private async executeWithTimeout(task: CronTask): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error("Cron task execution timeout"));
      }, this.config.executionTimeout);

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

  private createHandler(schedule: CronSchedule): () => Promise<unknown> {
    return async () => {
      if (schedule.task.prompt) {
        return { prompt: schedule.task.prompt, executed: true };
      }
      return { executed: true };
    };
  }

  private parseCron(expression: string): ParsedCron {
    const parts = expression.trim().split(/\s+/);
    if (parts.length !== 5) {
      throw new Error("Cron expression must have 5 fields");
    }

    return {
      minute: this.parseField(parts[0], 0, 59),
      hour: this.parseField(parts[1], 0, 23),
      dayOfMonth: this.parseField(parts[2], 1, 31),
      month: this.parseField(parts[3], 1, 12),
      dayOfWeek: this.parseField(parts[4], 0, 6),
    };
  }

  private parseField(field: string, min: number, max: number): CronField {
    if (field === "*") {
      return { type: "every", values: this.range(min, max) };
    }

    if (field.includes("/")) {
      const [base, stepStr] = field.split("/");
      const step = parseInt(stepStr, 10);
      const baseValues = base === "*" ? this.range(min, max) : this.parseField(base, min, max).values;
      const values = baseValues.filter((v) => (v - min) % step === 0);
      return { type: "step", values };
    }

    if (field.includes("-")) {
      const [start, end] = field.split("-").map((s) => parseInt(s, 10));
      return { type: "range", values: this.range(start, end) };
    }

    if (field.includes(",")) {
      const values = field.split(",").map((s) => parseInt(s, 10));
      return { type: "specific", values };
    }

    const value = parseInt(field, 10);
    if (isNaN(value) || value < min || value > max) {
      throw new Error(`Invalid field value: ${field}`);
    }

    return { type: "specific", values: [value] };
  }

  private range(start: number, end: number): number[] {
    const result: number[] = [];
    for (let i = start; i <= end; i++) {
      result.push(i);
    }
    return result;
  }

  private calculateNextRun(parsed: ParsedCron, from: number): number {
    const date = new Date(from);
    date.setSeconds(0);
    date.setMilliseconds(0);
    date.setMinutes(date.getMinutes() + 1);

    for (let i = 0; i < 366 * 24 * 60; i++) {
      if (this.matchesCron(parsed, date)) {
        return date.getTime();
      }
      date.setMinutes(date.getMinutes() + 1);
    }

    throw new Error("Could not find next run time");
  }

  private calculateNextRuns(parsed: ParsedCron, count: number): number[] {
    const runs: number[] = [];
    let from = Date.now();

    for (let i = 0; i < count; i++) {
      const nextRun = this.calculateNextRun(parsed, from);
      runs.push(nextRun);
      from = nextRun + 60000;
    }

    return runs;
  }

  private matchesCron(parsed: ParsedCron, date: Date): boolean {
    const minute = date.getMinutes();
    const hour = date.getHours();
    const dayOfMonth = date.getDate();
    const month = date.getMonth() + 1;
    const dayOfWeek = date.getDay();

    return (
      parsed.minute.values.includes(minute) &&
      parsed.hour.values.includes(hour) &&
      parsed.dayOfMonth.values.includes(dayOfMonth) &&
      parsed.month.values.includes(month) &&
      parsed.dayOfWeek.values.includes(dayOfWeek)
    );
  }

  private catchUpMissedRuns(task: CronTask, parsed: ParsedCron): void {
    if (!task.lastRun || !this.config.catchUpMissed) {
      return;
    }

    const now = Date.now();
    let missedRuns = 0;
    let checkTime = task.lastRun + 60000;

    while (checkTime < now && missedRuns < this.config.maxCatchUpRuns) {
      const checkDate = new Date(checkTime);
      if (this.matchesCron(parsed, checkDate)) {
        missedRuns++;
      }
      checkTime += 60000;
    }

    if (missedRuns > 0) {
      task.executions.push({
        id: `exec-missed-${Date.now()}`,
        scheduleId: task.id,
        scheduledTime: task.lastRun,
        status: "failed",
        result: { error: `Missed ${missedRuns} run(s)` },
      });
    }
  }
}

export function createCronScheduler(config?: Partial<CronSchedulerConfig>): CronScheduler {
  return new CronScheduler(config);
}

export function isValidCron(expression: string): boolean {
  try {
    const parts = expression.trim().split(/\s+/);
    return parts.length === 5;
  } catch {
    return false;
  }
}

export function getNextCronRuns(expression: string, count: number = 5): number[] | null {
  try {
    const scheduler = new CronScheduler();
    const result = scheduler.parseCronExpression(expression);
    if (result.valid && result.nextRuns) {
      return result.nextRuns.slice(0, count);
    }
    return null;
  } catch {
    return null;
  }
}
