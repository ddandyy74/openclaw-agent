import { describe, it, expect, beforeEach } from "vitest";
import type { Schedule, CronSchedule, IntervalSchedule, OnceSchedule, IdleSchedule } from "./types.js";

describe("Scheduler Types", () => {
  describe("OnceSchedule", () => {
    it("should create a valid once schedule", () => {
      const schedule: OnceSchedule = {
        id: "once-1",
        type: "once",
        enabled: true,
        task: {
          prompt: "Run once",
        },
        createdAt: Date.now(),
        scheduledTime: Date.now() + 3600000,
      };

      expect(schedule.type).toBe("once");
      expect(schedule.enabled).toBe(true);
      expect(schedule.scheduledTime).toBeGreaterThan(schedule.createdAt);
    });
  });

  describe("CronSchedule", () => {
    it("should create a valid cron schedule", () => {
      const schedule: CronSchedule = {
        id: "cron-1",
        type: "cron",
        enabled: true,
        task: {
          prompt: "Run daily",
        },
        createdAt: Date.now(),
        cronExpression: "0 0 * * *",
        timezone: "UTC",
      };

      expect(schedule.type).toBe("cron");
      expect(schedule.cronExpression).toBe("0 0 * * *");
    });

    it("should support optional fields", () => {
      const schedule: CronSchedule = {
        id: "cron-2",
        type: "cron",
        enabled: true,
        task: {
          prompt: "Run hourly",
        },
        createdAt: Date.now(),
        cronExpression: "0 * * * *",
        lastRun: Date.now() - 3600000,
        nextRun: Date.now() + 3600000,
      };

      expect(schedule.lastRun).toBeDefined();
      expect(schedule.nextRun).toBeDefined();
    });
  });

  describe("IntervalSchedule", () => {
    it("should create a valid interval schedule", () => {
      const schedule: IntervalSchedule = {
        id: "interval-1",
        type: "interval",
        enabled: true,
        task: {
          prompt: "Run every hour",
        },
        createdAt: Date.now(),
        intervalMs: 3600000,
      };

      expect(schedule.type).toBe("interval");
      expect(schedule.intervalMs).toBe(3600000);
    });

    it("should support start and end times", () => {
      const now = Date.now();
      const schedule: IntervalSchedule = {
        id: "interval-2",
        type: "interval",
        enabled: true,
        task: {
          prompt: "Run every 30 minutes",
        },
        createdAt: now,
        intervalMs: 1800000,
        startAt: now,
        endAt: now + 86400000,
      };

      expect(schedule.startAt).toBeDefined();
      expect(schedule.endAt).toBeDefined();
    });
  });

  describe("IdleSchedule", () => {
    it("should create a valid idle schedule", () => {
      const schedule: IdleSchedule = {
        id: "idle-1",
        type: "idle",
        enabled: true,
        task: {
          prompt: "Run when idle",
        },
        createdAt: Date.now(),
        idleThresholdMs: 300000,
        minIdleAgents: 1,
      };

      expect(schedule.type).toBe("idle");
      expect(schedule.idleThresholdMs).toBe(300000);
      expect(schedule.minIdleAgents).toBe(1);
    });
  });

  describe("Schedule union type", () => {
    it("should discriminate by type", () => {
      const schedules: Schedule[] = [
        {
          id: "once-1",
          type: "once",
          enabled: true,
          task: { prompt: "Once" },
          createdAt: Date.now(),
          scheduledTime: Date.now() + 1000,
        },
        {
          id: "cron-1",
          type: "cron",
          enabled: true,
          task: { prompt: "Cron" },
          createdAt: Date.now(),
          cronExpression: "* * * * *",
        },
        {
          id: "interval-1",
          type: "interval",
          enabled: true,
          task: { prompt: "Interval" },
          createdAt: Date.now(),
          intervalMs: 1000,
        },
        {
          id: "idle-1",
          type: "idle",
          enabled: true,
          task: { prompt: "Idle" },
          createdAt: Date.now(),
          idleThresholdMs: 1000,
          minIdleAgents: 1,
        },
      ];

      for (const schedule of schedules) {
        switch (schedule.type) {
          case "once":
            expect(schedule.scheduledTime).toBeDefined();
            break;
          case "cron":
            expect(schedule.cronExpression).toBeDefined();
            break;
          case "interval":
            expect(schedule.intervalMs).toBeDefined();
            break;
          case "idle":
            expect(schedule.idleThresholdMs).toBeDefined();
            expect(schedule.minIdleAgents).toBeDefined();
            break;
        }
      }
    });
  });
});
