/**
 * Scheduler Types
 * 
 * Core types for the task scheduling system.
 */

export type ScheduleType = "once" | "cron" | "interval" | "idle";

export type ScheduleStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface ScheduleConfig {
  id: string;
  type: ScheduleType;
  enabled: boolean;
  task: {
    prompt: string;
    agentRole?: string;
    agentId?: string;
    timeout?: number;
    metadata?: Record<string, unknown>;
  };
  createdAt: number;
  createdBy?: string;
  metadata?: Record<string, unknown>;
}

export interface OnceSchedule extends ScheduleConfig {
  type: "once";
  scheduledTime: number;
}

export interface CronSchedule extends ScheduleConfig {
  type: "cron";
  cronExpression: string;
  timezone?: string;
  lastRun?: number;
  nextRun?: number;
}

export interface IntervalSchedule extends ScheduleConfig {
  type: "interval";
  intervalMs: number;
  startAt?: number;
  endAt?: number;
  lastRun?: number;
  nextRun?: number;
}

export interface IdleSchedule extends ScheduleConfig {
  type: "idle";
  idleThresholdMs: number;
  minIdleAgents: number;
  lastRun?: number;
}

export type Schedule = OnceSchedule | CronSchedule | IntervalSchedule | IdleSchedule;

export interface ScheduleExecution {
  id: string;
  scheduleId: string;
  scheduledTime: number;
  startedAt?: number;
  completedAt?: number;
  status: ScheduleStatus;
  result?: {
    taskId?: string;
    output?: unknown;
    error?: string;
  };
}

export interface SchedulerState {
  schedules: Map<string, Schedule>;
  executions: Map<string, ScheduleExecution>;
  runningExecutions: Set<string>;
}

export interface SchedulerStats {
  totalSchedules: number;
  enabledSchedules: number;
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  averageExecutionTime: number;
}

export interface CronParseResult {
  valid: boolean;
  error?: string;
  nextRuns?: number[];
}

export interface SchedulerOptions {
  maxConcurrentExecutions: number;
  executionTimeout: number;
  retryFailedExecutions: boolean;
  maxRetryCount: number;
  persistenceEnabled: boolean;
  persistencePath?: string;
}
