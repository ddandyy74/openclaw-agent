import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TaskDispatcher, ResultCollector } from "./dispatcher.js";
import type { TaskExecutor } from "./worker.js";
import { Coordinator, DefaultTaskDecomposer, DefaultWorkerSelector, DefaultResultAggregator } from "./coordinator.js";
import type { TaskDefinition, TaskResult } from "./types.js";

describe("TaskDispatcher", () => {
  let dispatcher: TaskDispatcher;
  let coordinator: Coordinator;
  let mockExecutor: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockExecutor = vi.fn();

    const decomposer = new DefaultTaskDecomposer();
    const selector = new DefaultWorkerSelector();
    const aggregator = new DefaultResultAggregator();

    coordinator = new Coordinator(
      {
        maxWorkers: 5,
        taskTimeout: 60000,
        retryAttempts: 2,
        retryDelay: 1000,
        resultAggregationStrategy: "best",
      },
      { decomposer, selector, aggregator }
    );

    dispatcher = new TaskDispatcher(coordinator, {
      strategy: "least-loaded",
      maxQueueSize: 10,
      retryEnabled: false,
      retryAttempts: 2,
      retryDelay: 1000,
      timeout: 30000,
      priorityBoost: true,
    });

    dispatcher.registerWorker(
      "worker-1",
      {
        skills: ["code", "test"],
        tools: ["read", "write"],
        models: ["claude-3-sonnet"],
        maxTokens: 4096,
        supportsStreaming: true,
        supportsAttachments: false,
      },
      mockExecutor as unknown as TaskExecutor,
      { maxConcurrentTasks: 2 }
    );

    dispatcher.registerWorker(
      "worker-2",
      {
        skills: ["analyze", "report"],
        tools: ["read"],
        models: ["claude-3-sonnet"],
        maxTokens: 4096,
        supportsStreaming: true,
        supportsAttachments: false,
      },
      mockExecutor as unknown as TaskExecutor,
      { maxConcurrentTasks: 2 }
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("dispatch", () => {
    it("should dispatch task to available worker", async () => {
      mockExecutor.mockResolvedValue({
        taskId: "task-1",
        agentId: "worker-1",
        status: "completed",
        duration: 100,
      });

      const task: TaskDefinition = {
        id: "task-1",
        prompt: "Test task",
        priority: "normal",
      };

      const result = await dispatcher.dispatch(task);
      expect(result.status).toBe("dispatched");
      expect(result.workerId).toBeDefined();
    });

    it("should queue task when no workers available", async () => {
      const limitedDispatcher = new TaskDispatcher(coordinator, {
        strategy: "least-loaded",
        maxQueueSize: 10,
        retryEnabled: false,
      });

      limitedDispatcher.registerWorker(
        "limited-worker",
        {
          skills: ["code"],
          tools: [],
          models: [],
          maxTokens: 1000,
          supportsStreaming: false,
          supportsAttachments: false,
        },
        mockExecutor as unknown as TaskExecutor,
        { maxConcurrentTasks: 1 }
      );

      mockExecutor.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve({ taskId: "task", agentId: "limited-worker", status: "completed", duration: 500 }), 10000);
          })
      );

      await limitedDispatcher.dispatch({ id: "task-1", prompt: "Task 1", priority: "normal" });

      const task2: TaskDefinition = {
        id: "task-2",
        prompt: "Task 2",
        priority: "normal",
      };

      const result = await limitedDispatcher.dispatch(task2);
      expect(result.status).toBe("queued");
      expect(result.queuePosition).toBeDefined();
    });

    it("should reject task when queue is full", async () => {
      const smallDispatcher = new TaskDispatcher(coordinator, {
        strategy: "least-loaded",
        maxQueueSize: 1,
        retryEnabled: false,
      });

      smallDispatcher.registerWorker(
        "tiny-worker",
        {
          skills: ["code"],
          tools: [],
          models: [],
          maxTokens: 1000,
          supportsStreaming: false,
          supportsAttachments: false,
        },
        mockExecutor as unknown as TaskExecutor,
        { maxConcurrentTasks: 1 }
      );

      mockExecutor.mockImplementation(
        () =>
          new Promise(() => {
            // Never resolves
          })
      );

      await smallDispatcher.dispatch({ id: "task-1", prompt: "Task 1", priority: "normal" });
      await smallDispatcher.dispatch({ id: "task-2", prompt: "Task 2", priority: "normal" });

      const result = await smallDispatcher.dispatch({ id: "task-3", prompt: "Task 3", priority: "normal" });
      expect(result.status).toBe("rejected");
      expect(result.reason).toContain("Queue is full");
    });

    it("should use priority-based dispatch", async () => {
      dispatcher.setStrategy("priority-based");

      mockExecutor.mockResolvedValue({
        taskId: "task",
        agentId: "worker-1",
        status: "completed",
        duration: 100,
      });

      const result = await dispatcher.dispatch({
        id: "task-urgent",
        prompt: "Urgent task",
        priority: "urgent",
      });

      expect(result.status).toBe("dispatched");
    });
  });

  describe("dispatchBatch", () => {
    it("should dispatch multiple tasks", async () => {
      mockExecutor.mockResolvedValue({
        taskId: "task",
        agentId: "worker-1",
        status: "completed",
        duration: 100,
      });

      const tasks: TaskDefinition[] = [
        { id: "task-1", prompt: "Task 1", priority: "normal" },
        { id: "task-2", prompt: "Task 2", priority: "high" },
        { id: "task-3", prompt: "Task 3", priority: "low" },
      ];

      const results = await dispatcher.dispatchBatch(tasks);
      expect(results).toHaveLength(3);
      expect(results.every((r) => r.status === "dispatched" || r.status === "queued")).toBe(true);
    });

    it("should sort tasks by priority", async () => {
      mockExecutor.mockResolvedValue({
        taskId: "task",
        agentId: "worker-1",
        status: "completed",
        duration: 100,
      });

      const tasks: TaskDefinition[] = [
        { id: "low-task", prompt: "Low priority", priority: "low" },
        { id: "urgent-task", prompt: "Urgent", priority: "urgent" },
        { id: "normal-task", prompt: "Normal", priority: "normal" },
      ];

      const results = await dispatcher.dispatchBatch(tasks);
      expect(results).toHaveLength(3);
    });
  });

  describe("cancel", () => {
    it("should cancel queued task", async () => {
      const limitedDispatcher = new TaskDispatcher(coordinator, {
        strategy: "least-loaded",
        maxQueueSize: 10,
        retryEnabled: false,
      });

      limitedDispatcher.registerWorker(
        "limited-worker",
        {
          skills: ["code"],
          tools: [],
          models: [],
          maxTokens: 1000,
          supportsStreaming: false,
          supportsAttachments: false,
        },
        mockExecutor as unknown as TaskExecutor,
        { maxConcurrentTasks: 1 }
      );

      mockExecutor.mockImplementation(
        () =>
          new Promise(() => {
            // Never resolves
          })
      );

      await limitedDispatcher.dispatch({ id: "task-1", prompt: "Task 1", priority: "normal" });
      await limitedDispatcher.dispatch({ id: "task-2", prompt: "Task 2", priority: "normal" });

      const cancelled = await limitedDispatcher.cancel("task-2");
      expect(cancelled).toBe(true);
    });

    it("should return false for non-existent task", async () => {
      const cancelled = await dispatcher.cancel("non-existent");
      expect(cancelled).toBe(false);
    });
  });

  describe("getStatus", () => {
    it("should return status for dispatched task", async () => {
      mockExecutor.mockResolvedValue({
        taskId: "task-1",
        agentId: "worker-1",
        status: "completed",
        duration: 100,
      });

      await dispatcher.dispatch({ id: "task-1", prompt: "Test", priority: "normal" });

      const status = await dispatcher.getStatus("task-1");
      expect(status).toBeDefined();
      expect(status?.taskId).toBe("task-1");
    });

    it("should return undefined for non-existent task", async () => {
      const status = await dispatcher.getStatus("non-existent");
      expect(status).toBeUndefined();
    });
  });

  describe("getQueueLength", () => {
    it("should return queue length", () => {
      expect(dispatcher.getQueueLength()).toBe(0);
    });
  });

  describe("getPendingTasks", () => {
    it("should return empty array when no pending tasks", () => {
      const tasks = dispatcher.getPendingTasks();
      expect(tasks).toEqual([]);
    });
  });

  describe("setStrategy", () => {
    it("should change dispatch strategy", () => {
      dispatcher.setStrategy("round-robin");
      expect(dispatcher.getQueueLength()).toBe(0);
    });
  });
});

describe("ResultCollector", () => {
  let collector: ResultCollector;

  beforeEach(() => {
    collector = new ResultCollector();
  });

  describe("collect", () => {
    it("should collect a result", () => {
      const result: TaskResult = {
        taskId: "task-1",
        agentId: "worker-1",
        status: "completed",
        duration: 100,
      };

      collector.collect(result);

      const collected = collector.get("task-1");
      expect(collected).toEqual(result);
    });

    it("should trigger waiting callback", async () => {
      const result: TaskResult = {
        taskId: "task-1",
        agentId: "worker-1",
        status: "completed",
        duration: 100,
      };

      const waitPromise = collector.waitFor("task-1", 1000);

      collector.collect(result);

      const collected = await waitPromise;
      expect(collected).toEqual(result);
    });
  });

  describe("collectPartial", () => {
    it("should collect partial results", () => {
      const result1: TaskResult = {
        taskId: "subtask-1",
        agentId: "worker-1",
        status: "completed",
        duration: 100,
      };

      const result2: TaskResult = {
        taskId: "subtask-2",
        agentId: "worker-2",
        status: "completed",
        duration: 150,
      };

      collector.collectPartial("parent-task", result1);
      collector.collectPartial("parent-task", result2);

      const partials = collector.getPartial("parent-task");
      expect(partials).toHaveLength(2);
      expect(partials.map((p) => p.taskId)).toContain("subtask-1");
      expect(partials.map((p) => p.taskId)).toContain("subtask-2");
    });
  });

  describe("get", () => {
    it("should return undefined for non-existent result", () => {
      const result = collector.get("non-existent");
      expect(result).toBeUndefined();
    });
  });

  describe("getAll", () => {
    it("should return all results", () => {
      collector.collect({ taskId: "task-1", agentId: "w1", status: "completed", duration: 100 });
      collector.collect({ taskId: "task-2", agentId: "w2", status: "completed", duration: 200 });

      const all = collector.getAll();
      expect(all.size).toBe(2);
    });
  });

  describe("waitFor", () => {
    it("should wait for result", async () => {
      const result: TaskResult = {
        taskId: "task-1",
        agentId: "worker-1",
        status: "completed",
        duration: 100,
      };

      setTimeout(() => collector.collect(result), 50);

      const collected = await collector.waitFor("task-1", 1000);
      expect(collected).toEqual(result);
    });

    it("should return immediately if result exists", async () => {
      const result: TaskResult = {
        taskId: "task-1",
        agentId: "worker-1",
        status: "completed",
        duration: 100,
      };

      collector.collect(result);

      const collected = await collector.waitFor("task-1");
      expect(collected).toEqual(result);
    });

    it("should timeout if result not available", async () => {
      await expect(collector.waitFor("non-existent", 100)).rejects.toThrow("Timeout");
    });
  });

  describe("waitForAll", () => {
    it("should wait for multiple results", async () => {
      const result1: TaskResult = {
        taskId: "task-1",
        agentId: "worker-1",
        status: "completed",
        duration: 100,
      };

      const result2: TaskResult = {
        taskId: "task-2",
        agentId: "worker-2",
        status: "completed",
        duration: 200,
      };

      setTimeout(() => collector.collect(result1), 50);
      setTimeout(() => collector.collect(result2), 100);

      const results = await collector.waitForAll(["task-1", "task-2"], 1000);
      expect(results.size).toBe(2);
      expect(results.get("task-1")).toEqual(result1);
      expect(results.get("task-2")).toEqual(result2);
    });

    it("should include already collected results", async () => {
      const result1: TaskResult = {
        taskId: "task-1",
        agentId: "worker-1",
        status: "completed",
        duration: 100,
      };

      collector.collect(result1);

      const result2: TaskResult = {
        taskId: "task-2",
        agentId: "worker-2",
        status: "completed",
        duration: 200,
      };

      setTimeout(() => collector.collect(result2), 50);

      const results = await collector.waitForAll(["task-1", "task-2"], 1000);
      expect(results.size).toBe(2);
    });
  });

  describe("clear", () => {
    it("should clear specific result", () => {
      collector.collect({ taskId: "task-1", agentId: "w1", status: "completed", duration: 100 });
      collector.collect({ taskId: "task-2", agentId: "w2", status: "completed", duration: 200 });

      collector.clear("task-1");

      expect(collector.get("task-1")).toBeUndefined();
      expect(collector.get("task-2")).toBeDefined();
    });

    it("should clear all results", () => {
      collector.collect({ taskId: "task-1", agentId: "w1", status: "completed", duration: 100 });
      collector.collect({ taskId: "task-2", agentId: "w2", status: "completed", duration: 200 });

      collector.clear();

      expect(collector.getAll().size).toBe(0);
    });
  });

  describe("stats", () => {
    it("should return correct stats", () => {
      collector.collect({ taskId: "task-1", agentId: "w1", status: "completed", duration: 100 });
      collector.collect({ taskId: "task-2", agentId: "w2", status: "completed", duration: 200 });
      collector.collect({ taskId: "task-3", agentId: "w3", status: "failed", error: "Error", duration: 50 });

      const stats = collector.stats();
      expect(stats.total).toBe(3);
      expect(stats.completed).toBe(2);
      expect(stats.failed).toBe(1);
    });

    it("should count partial results", () => {
      collector.collectPartial("parent", { taskId: "subtask-1", agentId: "w1", status: "completed", duration: 100 });

      const stats = collector.stats();
      expect(stats.partial).toBe(1);
    });
  });
});
