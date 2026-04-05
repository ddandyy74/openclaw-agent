import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TaskScheduler, createTaskScheduler } from "./task-scheduler.js";
import type { OnceSchedule, IntervalSchedule } from "./types.js";

describe("TaskScheduler", () => {
  let scheduler: TaskScheduler;

  beforeEach(() => {
    scheduler = new TaskScheduler({
      maxConcurrentExecutions: 5,
      executionTimeout: 5000,
      retryFailedExecutions: false,
    });
  });

  afterEach(() => {
    scheduler.stop();
  });

  describe("schedule", () => {
    it("should schedule a one-time task", async () => {
      const schedule: OnceSchedule = {
        id: "once-1",
        type: "once",
        enabled: true,
        task: { prompt: "Test task" },
        createdAt: Date.now(),
        scheduledTime: Date.now() + 1000,
      };

      const taskId = await scheduler.schedule(schedule);
      expect(taskId).toBe("once-1");

      const task = scheduler.getTask(taskId);
      expect(task).toBeDefined();
      expect(task?.status).toBe("active");
    });

    it("should schedule an interval task", async () => {
      const schedule: IntervalSchedule = {
        id: "interval-1",
        type: "interval",
        enabled: true,
        task: { prompt: "Recurring task" },
        createdAt: Date.now(),
        intervalMs: 5000,
      };

      const taskId = await scheduler.schedule(schedule);
      expect(taskId).toBe("interval-1");

      const task = scheduler.getTask(taskId);
      expect(task).toBeDefined();
      expect(task?.nextRun).toBeGreaterThan(Date.now());
    });

    it("should schedule a paused task when disabled", async () => {
      const schedule: OnceSchedule = {
        id: "disabled-1",
        type: "once",
        enabled: false,
        task: { prompt: "Disabled task" },
        createdAt: Date.now(),
        scheduledTime: Date.now() + 1000,
      };

      const taskId = await scheduler.schedule(schedule);
      const task = scheduler.getTask(taskId);

      expect(task?.status).toBe("paused");
      expect(task?.nextRun).toBeNull();
    });
  });

  describe("cancel", () => {
    it("should cancel a scheduled task", async () => {
      const schedule: OnceSchedule = {
        id: "cancel-1",
        type: "once",
        enabled: true,
        task: { prompt: "Task to cancel" },
        createdAt: Date.now(),
        scheduledTime: Date.now() + 10000,
      };

      await scheduler.schedule(schedule);
      await scheduler.cancel("cancel-1");

      const task = scheduler.getTask("cancel-1");
      expect(task?.status).toBe("cancelled");
      expect(task?.nextRun).toBeNull();
    });

    it("should throw error for non-existent task", async () => {
      await expect(scheduler.cancel("non-existent")).rejects.toThrow("not found");
    });
  });

  describe("pause and resume", () => {
    it("should pause a task", async () => {
      const schedule: IntervalSchedule = {
        id: "pause-1",
        type: "interval",
        enabled: true,
        task: { prompt: "Task to pause" },
        createdAt: Date.now(),
        intervalMs: 10000,
      };

      await scheduler.schedule(schedule);
      await scheduler.pause("pause-1");

      const task = scheduler.getTask("pause-1");
      expect(task?.status).toBe("paused");
    });

    it("should resume a paused task", async () => {
      const schedule: IntervalSchedule = {
        id: "resume-1",
        type: "interval",
        enabled: true,
        task: { prompt: "Task to resume" },
        createdAt: Date.now(),
        intervalMs: 10000,
      };

      await scheduler.schedule(schedule);
      await scheduler.pause("resume-1");
      await scheduler.resume("resume-1");

      const task = scheduler.getTask("resume-1");
      expect(task?.status).toBe("active");
      expect(task?.nextRun).toBeGreaterThan(Date.now());
    });

    it("should throw error when resuming non-paused task", async () => {
      const schedule: IntervalSchedule = {
        id: "active-1",
        type: "interval",
        enabled: true,
        task: { prompt: "Active task" },
        createdAt: Date.now(),
        intervalMs: 10000,
      };

      await scheduler.schedule(schedule);
      await expect(scheduler.resume("active-1")).rejects.toThrow("not paused");
    });
  });

  describe("getStats", () => {
    it("should return correct stats", async () => {
      const schedule1: OnceSchedule = {
        id: "stat-1",
        type: "once",
        enabled: true,
        task: { prompt: "Task 1" },
        createdAt: Date.now(),
        scheduledTime: Date.now() + 1000,
      };

      const schedule2: OnceSchedule = {
        id: "stat-2",
        type: "once",
        enabled: false,
        task: { prompt: "Task 2" },
        createdAt: Date.now(),
        scheduledTime: Date.now() + 2000,
      };

      await scheduler.schedule(schedule1);
      await scheduler.schedule(schedule2);

      const stats = await scheduler.getStats();
      expect(stats.totalSchedules).toBe(2);
      expect(stats.enabledSchedules).toBe(1);
    });
  });

  describe("start and stop", () => {
    it("should start and stop scheduler", () => {
      scheduler.start();
      expect(scheduler["running"]).toBe(true);

      scheduler.stop();
      expect(scheduler["running"]).toBe(false);
    });

    it("should not start twice", () => {
      scheduler.start();
      scheduler.start();
      expect(scheduler["running"]).toBe(true);
    });

    it("should not stop when not running", () => {
      scheduler.stop();
      scheduler.stop();
      expect(scheduler["running"]).toBe(false);
    });
  });

  describe("getAllTasks", () => {
    it("should return all tasks", async () => {
      const schedule1: OnceSchedule = {
        id: "task-1",
        type: "once",
        enabled: true,
        task: { prompt: "Task 1" },
        createdAt: Date.now(),
        scheduledTime: Date.now() + 1000,
      };

      const schedule2: OnceSchedule = {
        id: "task-2",
        type: "once",
        enabled: true,
        task: { prompt: "Task 2" },
        createdAt: Date.now(),
        scheduledTime: Date.now() + 2000,
      };

      await scheduler.schedule(schedule1);
      await scheduler.schedule(schedule2);

      const tasks = scheduler.getAllTasks();
      expect(tasks).toHaveLength(2);
    });
  });

  describe("getActiveTasks", () => {
    it("should return only active tasks", async () => {
      const schedule1: OnceSchedule = {
        id: "active-task",
        type: "once",
        enabled: true,
        task: { prompt: "Active task" },
        createdAt: Date.now(),
        scheduledTime: Date.now() + 1000,
      };

      const schedule2: OnceSchedule = {
        id: "paused-task",
        type: "once",
        enabled: false,
        task: { prompt: "Paused task" },
        createdAt: Date.now(),
        scheduledTime: Date.now() + 2000,
      };

      await scheduler.schedule(schedule1);
      await scheduler.schedule(schedule2);

      const activeTasks = scheduler.getActiveTasks();
      expect(activeTasks).toHaveLength(1);
      expect(activeTasks[0]?.id).toBe("active-task");
    });
  });

  describe("event handlers", () => {
    it("should call event handlers", async () => {
      const onScheduled = vi.fn();

      scheduler.on(onScheduled);

      const schedule: OnceSchedule = {
        id: "event-1",
        type: "once",
        enabled: true,
        task: { prompt: "Event task" },
        createdAt: Date.now(),
        scheduledTime: Date.now() + 1000,
      };

      await scheduler.schedule(schedule);

      expect(onScheduled).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "task_scheduled",
          taskId: "event-1",
        })
      );
    });
  });
});

describe("createTaskScheduler", () => {
  it("should create a task scheduler", () => {
    const scheduler = createTaskScheduler({ maxConcurrentExecutions: 3 });
    expect(scheduler).toBeInstanceOf(TaskScheduler);
  });
});
