import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Worker, WorkerPool, type TaskExecutor } from "./worker.js";
import type { TaskDefinition, TaskResult } from "./types.js";

describe("Worker", () => {
  let worker: Worker;
  let mockExecutor: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockExecutor = vi.fn();
    worker = new Worker(
      "test-worker",
      {
        maxConcurrentTasks: 3,
        taskTimeout: 30000,
        heartbeatInterval: 10000,
        reportProgress: true,
        retryOnFailure: false,
        maxRetries: 2,
      },
      {
        skills: ["code", "test"],
        tools: ["read", "write"],
        models: ["claude-3-sonnet"],
        maxTokens: 4096,
        supportsStreaming: true,
        supportsAttachments: false,
      },
      mockExecutor as unknown as TaskExecutor
    );
  });

  afterEach(() => {
    worker.shutdown();
    vi.clearAllMocks();
  });

  describe("getId", () => {
    it("should return worker id", () => {
      expect(worker.getId()).toBe("test-worker");
    });
  });

  describe("getStatus", () => {
    it("should return initial status as idle", () => {
      expect(worker.getStatus()).toBe("idle");
    });
  });

  describe("getCapabilities", () => {
    it("should return worker capabilities", () => {
      const capabilities = worker.getCapabilities();
      expect(capabilities.skills).toContain("code");
      expect(capabilities.tools).toContain("read");
      expect(capabilities.models).toContain("claude-3-sonnet");
    });
  });

  describe("getMetrics", () => {
    it("should return initial metrics", () => {
      const metrics = worker.getMetrics();
      expect(metrics.tasksCompleted).toBe(0);
      expect(metrics.tasksFailed).toBe(0);
      expect(metrics.successRate).toBe(1);
    });
  });

  describe("getCurrentTasks", () => {
    it("should return empty array initially", () => {
      expect(worker.getCurrentTasks()).toEqual([]);
    });
  });

  describe("canAcceptTask", () => {
    it("should return true when idle", () => {
      expect(worker.canAcceptTask()).toBe(true);
    });

    it("should return true when below max tasks", async () => {
      mockExecutor.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(
              () =>
                resolve({
                  taskId: "task-1",
                  agentId: "test-worker",
                  status: "completed",
                  duration: 100,
                }),
              100
            );
          })
      );

      const task: TaskDefinition = {
        id: "task-1",
        prompt: "Test",
        priority: "normal",
      };

      worker.execute(task);
      expect(worker.canAcceptTask()).toBe(true);
    });
  });

  describe("execute", () => {
    it("should execute task successfully", async () => {
      const expectedResult: TaskResult = {
        taskId: "task-1",
        agentId: "test-worker",
        status: "completed",
        output: { result: "success" },
        duration: 100,
      };

      mockExecutor.mockResolvedValue(expectedResult);

      const task: TaskDefinition = {
        id: "task-1",
        prompt: "Test task",
        priority: "normal",
      };

      const result = await worker.execute(task);
      expect(result.status).toBe("completed");
      expect(result.output).toEqual({ result: "success" });
    });

    it("should update metrics on success", async () => {
      mockExecutor.mockResolvedValue({
        taskId: "task-1",
        agentId: "test-worker",
        status: "completed",
        duration: 1000,
        tokenUsage: { input: 100, output: 200, total: 300 },
      });

      const task: TaskDefinition = {
        id: "task-1",
        prompt: "Test",
        priority: "normal",
      };

      await worker.execute(task);

      const metrics = worker.getMetrics();
      expect(metrics.tasksCompleted).toBe(1);
      expect(metrics.totalDuration).toBe(1000);
      expect(metrics.totalTokens).toBe(300);
    });

    it("should update metrics on failure", async () => {
      mockExecutor.mockRejectedValue(new Error("Task failed"));

      const task: TaskDefinition = {
        id: "task-1",
        prompt: "Test",
        priority: "normal",
      };

      const result = await worker.execute(task);
      expect(result.status).toBe("failed");

      const metrics = worker.getMetrics();
      expect(metrics.tasksFailed).toBe(1);
    });

    it("should update status to busy when at capacity", async () => {
      mockExecutor.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(
              () =>
                resolve({
                  taskId: "task",
                  agentId: "test-worker",
                  status: "completed",
                  duration: 100,
                }),
              5000
            );
          })
      );

      const task1: TaskDefinition = {
        id: "task-1",
        prompt: "Test 1",
        priority: "normal",
      };

      const task2: TaskDefinition = {
        id: "task-2",
        prompt: "Test 2",
        priority: "normal",
      };

      const worker2 = new Worker(
        "test-worker-2",
        { maxConcurrentTasks: 2 },
        {
          skills: ["code"],
          tools: [],
          models: [],
          maxTokens: 1000,
          supportsStreaming: false,
          supportsAttachments: false,
        },
        mockExecutor as unknown as TaskExecutor
      );

      worker2.execute(task1);
      worker2.execute(task2);

      expect(worker2.canAcceptTask()).toBe(false);
      await worker2.shutdown();
    });
  });

  describe("cancel", () => {
    it("should cancel running task", async () => {
      mockExecutor.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(
              () =>
                resolve({
                  taskId: "task-1",
                  agentId: "test-worker",
                  status: "completed",
                  duration: 1000,
                }),
              10000
            );
          })
      );

      const task: TaskDefinition = {
        id: "task-1",
        prompt: "Long task",
        priority: "normal",
      };

      worker.execute(task);

      const cancelled = await worker.cancel("task-1");
      expect(cancelled).toBe(true);
      expect(worker.getCurrentTasks()).not.toContain("task-1");
    });

    it("should return false for non-existent task", async () => {
      const cancelled = await worker.cancel("non-existent");
      expect(cancelled).toBe(false);
    });
  });

  describe("getProgress", () => {
    it("should return undefined for non-existent task", () => {
      const progress = worker.getProgress("non-existent");
      expect(progress).toBeUndefined();
    });

    it("should return progress for running task", async () => {
      mockExecutor.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(
              () =>
                resolve({
                  taskId: "task-1",
                  agentId: "test-worker",
                  status: "completed",
                  duration: 1000,
                }),
              500
            );
          })
      );

      const task: TaskDefinition = {
        id: "task-1",
        prompt: "Test",
        priority: "normal",
      };

      worker.execute(task);

      const progress = worker.getProgress("task-1");
      expect(progress).toBeDefined();
      expect(progress?.taskId).toBe("task-1");
      expect(progress?.status).toBe("running");

      await new Promise((resolve) => setTimeout(resolve, 600));
    });
  });

  describe("heartbeat", () => {
    it("should update worker status from offline to idle", () => {
      const offlineWorker = new Worker(
        "offline-worker",
        {},
        {
          skills: [],
          tools: [],
          models: [],
          maxTokens: 1000,
          supportsStreaming: false,
          supportsAttachments: false,
        },
        mockExecutor as unknown as TaskExecutor
      );

      offlineWorker.shutdown();
      expect(offlineWorker.getStatus()).toBe("offline");

      offlineWorker.heartbeat();
      expect(offlineWorker.getStatus()).toBe("idle");
    });
  });

  describe("shutdown", () => {
    it("should set status to offline", async () => {
      await worker.shutdown();
      expect(worker.getStatus()).toBe("offline");
    });

    it("should cancel all running tasks", async () => {
      mockExecutor.mockImplementation(
        () =>
          new Promise(() => {
            // Never resolves
          })
      );

      const task: TaskDefinition = {
        id: "task-1",
        prompt: "Test",
        priority: "normal",
      };

      worker.execute(task);
      expect(worker.getCurrentTasks()).toContain("task-1");

      await worker.shutdown();
      expect(worker.getCurrentTasks()).toEqual([]);
    });
  });

  describe("event handlers", () => {
    it("should call onTaskStart handler", async () => {
      const onTaskStart = vi.fn();
      worker.setHandlers({ onTaskStart });

      mockExecutor.mockResolvedValue({
        taskId: "task-1",
        agentId: "test-worker",
        status: "completed",
        duration: 100,
      });

      const task: TaskDefinition = {
        id: "task-1",
        prompt: "Test",
        priority: "normal",
      };

      await worker.execute(task);
      expect(onTaskStart).toHaveBeenCalledWith("task-1");
    });

    it("should call onTaskComplete handler", async () => {
      const onTaskComplete = vi.fn();
      worker.setHandlers({ onTaskComplete });

      const result: TaskResult = {
        taskId: "task-1",
        agentId: "test-worker",
        status: "completed",
        duration: 100,
      };

      mockExecutor.mockResolvedValue(result);

      const task: TaskDefinition = {
        id: "task-1",
        prompt: "Test",
        priority: "normal",
      };

      await worker.execute(task);
      expect(onTaskComplete).toHaveBeenCalledWith(result);
    });

    it("should call onTaskError handler on failure", async () => {
      const onTaskError = vi.fn();
      worker.setHandlers({ onTaskError });

      mockExecutor.mockRejectedValue(new Error("Task failed"));

      const task: TaskDefinition = {
        id: "task-1",
        prompt: "Test",
        priority: "normal",
      };

      await worker.execute(task);
      expect(onTaskError).toHaveBeenCalled();
    });

    it("should call onStatusChange handler", async () => {
      const onStatusChange = vi.fn();
      worker.setHandlers({ onStatusChange });

      mockExecutor.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(
              () =>
                resolve({
                  taskId: "task-1",
                  agentId: "test-worker",
                  status: "completed",
                  duration: 100,
                }),
              100
            );
          })
      );

      const workerWithMax1 = new Worker(
        "worker-1",
        { maxConcurrentTasks: 1 },
        {
          skills: [],
          tools: [],
          models: [],
          maxTokens: 1000,
          supportsStreaming: false,
          supportsAttachments: false,
        },
        mockExecutor as unknown as TaskExecutor
      );
      workerWithMax1.setHandlers({ onStatusChange });

      const task: TaskDefinition = {
        id: "task-1",
        prompt: "Test",
        priority: "normal",
      };

      await workerWithMax1.execute(task);
      expect(onStatusChange).toHaveBeenCalled();

      await workerWithMax1.shutdown();
    });
  });

  describe("updateProgress", () => {
    it("should update task progress", async () => {
      mockExecutor.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(
              () =>
                resolve({
                  taskId: "task-1",
                  agentId: "test-worker",
                  status: "completed",
                  duration: 1000,
                }),
              500
            );
          })
      );

      const task: TaskDefinition = {
        id: "task-1",
        prompt: "Test",
        priority: "normal",
      };

      worker.execute(task);

      worker.updateProgress("task-1", 50, "Half way done");

      const progress = worker.getProgress("task-1");
      expect(progress?.progress).toBe(50);
      expect(progress?.message).toBe("Half way done");

      await new Promise((resolve) => setTimeout(resolve, 600));
    });
  });
});

describe("WorkerPool", () => {
  let pool: WorkerPool;
  let mockExecutor: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockExecutor = vi.fn();
    pool = new WorkerPool();

    const worker1 = new Worker(
      "worker-1",
      { maxConcurrentTasks: 2 },
      {
        skills: ["code"],
        tools: [],
        models: [],
        maxTokens: 1000,
        supportsStreaming: false,
        supportsAttachments: false,
      },
      mockExecutor as unknown as TaskExecutor
    );

    const worker2 = new Worker(
      "worker-2",
      { maxConcurrentTasks: 2 },
      {
        skills: ["test"],
        tools: [],
        models: [],
        maxTokens: 1000,
        supportsStreaming: false,
        supportsAttachments: false,
      },
      mockExecutor as unknown as TaskExecutor
    );

    pool.addWorker(worker1);
    pool.addWorker(worker2);
  });

  afterEach(() => {
    pool.shutdown();
    vi.clearAllMocks();
  });

  describe("addWorker", () => {
    it("should add worker to pool", () => {
      const available = pool.getAvailableWorkers();
      expect(available.length).toBe(2);
    });
  });

  describe("removeWorker", () => {
    it("should remove worker from pool", () => {
      pool.removeWorker("worker-1");
      const available = pool.getAvailableWorkers();
      expect(available.length).toBe(1);
      expect(available[0]?.getId()).toBe("worker-2");
    });
  });

  describe("getWorker", () => {
    it("should return worker by id", () => {
      const worker = pool.getWorker("worker-1");
      expect(worker?.getId()).toBe("worker-1");
    });

    it("should return undefined for non-existent worker", () => {
      const worker = pool.getWorker("non-existent");
      expect(worker).toBeUndefined();
    });
  });

  describe("getAvailableWorkers", () => {
    it("should return all available workers", () => {
      const available = pool.getAvailableWorkers();
      expect(available.length).toBe(2);
    });
  });

  describe("assignTask", () => {
    it("should assign task to worker", () => {
      pool.assignTask("task-1", "worker-1");
      const worker = pool.getWorkerForTask("task-1");
      expect(worker?.getId()).toBe("worker-1");
    });
  });

  describe("unassignTask", () => {
    it("should unassign task", () => {
      pool.assignTask("task-1", "worker-1");
      pool.unassignTask("task-1");
      const worker = pool.getWorkerForTask("task-1");
      expect(worker).toBeUndefined();
    });
  });

  describe("getMetrics", () => {
    it("should return metrics for all workers", () => {
      const metrics = pool.getMetrics();
      expect(metrics.size).toBe(2);
      expect(metrics.has("worker-1")).toBe(true);
      expect(metrics.has("worker-2")).toBe(true);
    });
  });

  describe("getTotalMetrics", () => {
    it("should return aggregated metrics", () => {
      const metrics = pool.getTotalMetrics();
      expect(metrics.tasksCompleted).toBe(0);
      expect(metrics.tasksFailed).toBe(0);
      expect(metrics.uptime).toBeGreaterThan(0);
    });
  });

  describe("shutdown", () => {
    it("should shutdown all workers", async () => {
      await pool.shutdown();
      const available = pool.getAvailableWorkers();
      expect(available.length).toBe(0);
    });
  });
});
