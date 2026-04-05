import { describe, it, expect, beforeEach } from "vitest";
import {
  Coordinator,
  DefaultTaskDecomposer,
  DefaultWorkerSelector,
  DefaultResultAggregator,
} from "./coordinator.js";
import type { TaskDefinition, TaskResult } from "./types.js";

describe("Coordinator", () => {
  let coordinator: Coordinator;
  let decomposer: DefaultTaskDecomposer;
  let selector: DefaultWorkerSelector;
  let aggregator: DefaultResultAggregator;

  beforeEach(() => {
    decomposer = new DefaultTaskDecomposer();
    selector = new DefaultWorkerSelector();
    aggregator = new DefaultResultAggregator();

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

    coordinator.registerWorker({
      id: "worker-1",
      status: "idle",
      capabilities: ["code", "test"],
      currentTasks: 0,
      maxTasks: 3,
      lastHeartbeat: Date.now(),
    });

    coordinator.registerWorker({
      id: "worker-2",
      status: "idle",
      capabilities: ["code", "deploy"],
      currentTasks: 0,
      maxTasks: 2,
      lastHeartbeat: Date.now(),
    });
  });

  describe("decomposeTask", () => {
    it("should decompose a complex task", async () => {
      const task: TaskDefinition = {
        id: "task-1",
        prompt: "Design and implement a REST API with authentication, validation, and database integration. Then write comprehensive tests and documentation.",
        priority: "high",
      };

      const decomposed = await coordinator.decomposeTask(task);
      expect(decomposed.parentTaskId).toBe("task-1");
      expect(decomposed.subtasks.length).toBeGreaterThan(1);
    });

    it("should not decompose a simple task", async () => {
      const task: TaskDefinition = {
        id: "task-2",
        prompt: "Print hello world",
        priority: "normal",
      };

      const decomposed = await coordinator.decomposeTask(task);
      expect(decomposed.subtasks.length).toBe(1);
    });

    it("should create dependencies between subtasks", async () => {
      const task: TaskDefinition = {
        id: "task-3",
        prompt: "First analyze the requirements, then design the architecture, then implement the solution, and finally write tests.",
        priority: "normal",
      };

      const decomposed = await coordinator.decomposeTask(task);
      expect(decomposed.dependencies.size).toBeGreaterThan(0);
    });
  });

  describe("assignTask", () => {
    it("should assign task to available worker", async () => {
      const task: TaskDefinition = {
        id: "task-1",
        prompt: "Write a function",
        priority: "normal",
      };

      const assignment = await coordinator.assignTask(task);
      expect(assignment.taskId).toBe("task-1");
      expect(assignment.workerId).toBeDefined();
      expect(assignment.status).toBe("pending");
    });

    it("should assign task to specified worker", async () => {
      const task: TaskDefinition = {
        id: "task-2",
        prompt: "Write tests",
        priority: "normal",
      };

      const assignment = await coordinator.assignTask(task, "worker-1");
      expect(assignment.workerId).toBe("worker-1");
    });

    it("should throw when no workers available", async () => {
      // Set all workers to busy
      const workers = await coordinator.listWorkers();
      for (const worker of workers) {
        coordinator.registerWorker({
          id: worker.id,
          status: "busy",
          capabilities: worker.capabilities,
          currentTasks: worker.maxTasks,
          maxTasks: worker.maxTasks,
          lastHeartbeat: Date.now(),
        });
      }

      const task: TaskDefinition = {
        id: "task-3",
        prompt: "Task for busy worker",
        priority: "normal",
      };

      await expect(coordinator.assignTask(task)).rejects.toThrow("No available workers");
    });
  });

  describe("collectResults", () => {
    it("should collect completed task results", async () => {
      const task: TaskDefinition = {
        id: "task-1",
        prompt: "Test task",
        priority: "normal",
      };

      await coordinator.assignTask(task, "worker-1");

      coordinator.completeTask("task-1", {
        taskId: "task-1",
        agentId: "worker-1",
        status: "completed",
        output: { result: "done" },
        duration: 1000,
      });

      const results = await coordinator.collectResults("task-1");
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.some((r) => r.taskId === "task-1")).toBe(true);
    });
  });

  describe("aggregateResults", () => {
    it("should aggregate multiple results with best strategy", async () => {
      const results: TaskResult[] = [
        {
          taskId: "task-1",
          agentId: "worker-1",
          status: "completed",
          output: { score: 80 },
          duration: 1000,
        },
        {
          taskId: "task-1",
          agentId: "worker-2",
          status: "completed",
          output: { score: 95 },
          duration: 1500,
        },
      ];

      const aggregated = await coordinator.aggregateResults(results);
      expect(aggregated.status).toBe("completed");
    });

    it("should return single result when only one provided", async () => {
      const results: TaskResult[] = [
        {
          taskId: "task-1",
          agentId: "worker-1",
          status: "completed",
          output: { result: "single" },
          duration: 1000,
        },
      ];

      const aggregated = await coordinator.aggregateResults(results);
      expect(aggregated).toEqual(results[0]);
    });
  });

  describe("getWorkerInfo", () => {
    it("should return worker info", async () => {
      const worker = await coordinator.getWorkerInfo("worker-1");
      expect(worker).toBeDefined();
      expect(worker?.id).toBe("worker-1");
      expect(worker?.capabilities).toContain("code");
    });

    it("should return undefined for non-existent worker", async () => {
      const worker = await coordinator.getWorkerInfo("non-existent");
      expect(worker).toBeUndefined();
    });
  });

  describe("listWorkers", () => {
    it("should list all workers", async () => {
      const workers = await coordinator.listWorkers();
      expect(workers.length).toBe(2);
      expect(workers.map((w) => w.id)).toContain("worker-1");
      expect(workers.map((w) => w.id)).toContain("worker-2");
    });
  });

  describe("getState", () => {
    it("should return coordinator state", async () => {
      const state = await coordinator.getState();
      expect(state.activeWorkers).toBe(2);
      expect(state.totalTasks).toBe(0);
    });
  });

  describe("registerWorker", () => {
    it("should register a new worker", () => {
      coordinator.registerWorker({
        id: "worker-3",
        status: "idle",
        capabilities: ["analyze"],
        currentTasks: 0,
        maxTasks: 5,
        lastHeartbeat: Date.now(),
      });

      const workers = coordinator.listWorkers();
      expect(workers).resolves.toHaveLength(3);
    });
  });

  describe("unregisterWorker", () => {
    it("should unregister a worker", () => {
      coordinator.unregisterWorker("worker-2");

      const workers = coordinator.listWorkers();
      expect(workers).resolves.toHaveLength(1);
    });
  });

  describe("completeTask", () => {
    it("should complete a task and update worker metrics", async () => {
      const task: TaskDefinition = {
        id: "task-1",
        prompt: "Test task",
        priority: "normal",
      };

      await coordinator.assignTask(task, "worker-1");

      coordinator.completeTask("task-1", {
        taskId: "task-1",
        agentId: "worker-1",
        status: "completed",
        output: { result: "done" },
        duration: 5000,
        tokenUsage: { input: 100, output: 200, total: 300 },
      });

      const worker = await coordinator.getWorkerInfo("worker-1");
      expect(worker?.performance.completedTasks).toBe(1);
      expect(worker?.performance.avgDuration).toBe(5000);
      expect(worker?.performance.avgTokens).toBe(300);
      expect(worker?.currentTasks).toBe(0);
      expect(worker?.status).toBe("idle");
    });
  });

  describe("failTask", () => {
    it("should fail a task and update worker metrics", async () => {
      const task: TaskDefinition = {
        id: "task-2",
        prompt: "Failing task",
        priority: "normal",
      };

      await coordinator.assignTask(task, "worker-1");

      coordinator.failTask("task-2", "Something went wrong");

      const worker = await coordinator.getWorkerInfo("worker-1");
      expect(worker?.performance.failedTasks).toBe(1);
      expect(worker?.currentTasks).toBe(0);
    });
  });
});

describe("DefaultTaskDecomposer", () => {
  let decomposer: DefaultTaskDecomposer;

  beforeEach(() => {
    decomposer = new DefaultTaskDecomposer();
  });

  describe("estimateComplexity", () => {
    it("should estimate low complexity for short prompts", async () => {
      const complexity = await decomposer.estimateComplexity("Print hello");
      expect(complexity).toBe("low");
    });

    it("should estimate medium complexity for moderate prompts", async () => {
      const complexity = await decomposer.estimateComplexity(
        "Write a function that handles user authentication with proper error handling and logging"
      );
      expect(complexity).toBe("medium");
    });

    it("should estimate high complexity for long complex prompts", async () => {
      const longPrompt = `
        Design a complete e-commerce platform with the following components:
        1. User authentication and authorization system
        2. Product catalog with search and filtering
        3. Shopping cart and checkout process
        4. Payment integration with multiple providers
        5. Order management and tracking
        6. Admin dashboard for analytics
        Implement all backend APIs, database schema, and write comprehensive tests.
      `.repeat(5);
      
      const complexity = await decomposer.estimateComplexity(longPrompt);
      expect(complexity).toBe("high");
    });
  });

  describe("shouldDecompose", () => {
    it("should return false for simple tasks", async () => {
      const should = await decomposer.shouldDecompose("Print hello");
      expect(should).toBe(false);
    });

    it("should return true for complex tasks", async () => {
      const should = await decomposer.shouldDecompose(
        "Design and implement a microservices architecture with multiple services, API gateway, and service mesh."
      );
      expect(should).toBe(true);
    });
  });

  describe("decompose", () => {
    it("should create multiple subtasks for complex prompts", async () => {
      const subtasks = await decomposer.decompose(
        "First, analyze the requirements and design the architecture. Then, implement the frontend, backend, and database components. Finally, write tests and documentation.",
        { projectType: "full-stack" }
      );

      expect(subtasks.length).toBeGreaterThan(1);
      expect(subtasks[0].metadata).toBeDefined();
    });

    it("should create single subtask for simple prompts", async () => {
      const subtasks = await decomposer.decompose("Print hello world");
      expect(subtasks.length).toBe(1);
    });
  });
});

describe("DefaultWorkerSelector", () => {
  let selector: DefaultWorkerSelector;

  beforeEach(() => {
    selector = new DefaultWorkerSelector();
  });

  describe("selectWorker", () => {
    it("should select best available worker", async () => {
      const task: TaskDefinition = {
        id: "task-1",
        prompt: "Write code",
        priority: "normal",
      };

      const workers = [
        {
          id: "worker-1",
          status: "idle" as const,
          capabilities: ["code"],
          currentTasks: 0,
          maxTasks: 3,
          lastHeartbeat: Date.now(),
          performance: { completedTasks: 10, failedTasks: 0, avgDuration: 5000, avgTokens: 1000 },
        },
        {
          id: "worker-2",
          status: "idle" as const,
          capabilities: ["code"],
          currentTasks: 2,
          maxTasks: 3,
          lastHeartbeat: Date.now(),
          performance: { completedTasks: 5, failedTasks: 1, avgDuration: 8000, avgTokens: 1500 },
        },
      ];

      const selected = await selector.selectWorker(task, workers);
      expect(selected).toBe("worker-1");
    });

    it("should return undefined when no workers available", async () => {
      const task: TaskDefinition = {
        id: "task-1",
        prompt: "Write code",
        priority: "normal",
      };

      const workers = [
        {
          id: "worker-1",
          status: "idle" as const,
          capabilities: ["code"],
          currentTasks: 3,
          maxTasks: 3,
          lastHeartbeat: Date.now(),
          performance: { completedTasks: 10, failedTasks: 0, avgDuration: 5000, avgTokens: 1000 },
        },
      ];

      const selected = await selector.selectWorker(task, workers);
      expect(selected).toBeUndefined();
    });
  });

  describe("scoreWorker", () => {
    it("should score worker based on load and performance", () => {
      const task: TaskDefinition = {
        id: "task-1",
        prompt: "Test task",
        priority: "normal",
      };

      const worker = {
        id: "worker-1",
        status: "idle" as const,
        capabilities: ["code"],
        currentTasks: 0,
        maxTasks: 3,
        lastHeartbeat: Date.now(),
        performance: { completedTasks: 100, failedTasks: 5, avgDuration: 3000, avgTokens: 500 },
      };

      const score = selector.scoreWorker(task, worker);
      expect(score).toBeGreaterThan(0);
    });

    it("should return 0 for fully loaded worker", () => {
      const task: TaskDefinition = {
        id: "task-1",
        prompt: "Test task",
        priority: "normal",
      };

      const worker = {
        id: "worker-1",
        status: "busy" as const,
        capabilities: ["code"],
        currentTasks: 3,
        maxTasks: 3,
        lastHeartbeat: Date.now(),
        performance: { completedTasks: 100, failedTasks: 5, avgDuration: 3000, avgTokens: 500 },
      };

      const score = selector.scoreWorker(task, worker);
      expect(score).toBe(0);
    });
  });
});

describe("DefaultResultAggregator", () => {
  let aggregator: DefaultResultAggregator;

  beforeEach(() => {
    aggregator = new DefaultResultAggregator();
  });

  describe("aggregate", () => {
    it("should return first result with 'first' strategy", async () => {
      const results: TaskResult[] = [
        { taskId: "1", agentId: "w1", status: "completed", output: { a: 1 }, duration: 100 },
        { taskId: "2", agentId: "w2", status: "completed", output: { b: 2 }, duration: 200 },
      ];

      const aggregated = await aggregator.aggregate(results, "first");
      expect(aggregated.taskId).toBe("1");
    });

    it("should merge all results with 'all' strategy", async () => {
      const results: TaskResult[] = [
        { taskId: "1", agentId: "w1", status: "completed", output: { a: 1 }, duration: 100 },
        { taskId: "2", agentId: "w2", status: "completed", output: { b: 2 }, duration: 200 },
      ];

      const aggregated = await aggregator.aggregate(results, "all");
      expect(aggregated.output).toEqual({ a: 1, b: 2 });
    });

    it("should select best result with 'best' strategy", async () => {
      const results: TaskResult[] = [
        { taskId: "1", agentId: "w1", status: "completed", output: { score: 95 }, duration: 100 },
        { taskId: "2", agentId: "w2", status: "completed", output: { score: 80 }, duration: 500 },
      ];

      const aggregated = await aggregator.aggregate(results, "best");
      expect((aggregated.output as { score: number }).score).toBe(95);
    });
  });

  describe("validate", () => {
    it("should validate completed results", () => {
      const result: TaskResult = {
        taskId: "1",
        agentId: "w1",
        status: "completed",
        output: { result: "done" },
        duration: 100,
      };

      expect(aggregator.validate(result)).toBe(true);
    });

    it("should reject failed results", () => {
      const result: TaskResult = {
        taskId: "1",
        agentId: "w1",
        status: "failed",
        error: "Error",
        duration: 100,
      };

      expect(aggregator.validate(result)).toBe(false);
    });
  });

  describe("merge", () => {
    it("should merge two results", () => {
      const a: TaskResult = {
        taskId: "1",
        agentId: "w1",
        status: "completed",
        output: { a: 1 },
        duration: 100,
        tokenUsage: { input: 10, output: 20, total: 30 },
      };

      const b: TaskResult = {
        taskId: "2",
        agentId: "w2",
        status: "completed",
        output: { b: 2 },
        duration: 200,
        tokenUsage: { input: 15, output: 25, total: 40 },
      };

      const merged = aggregator.merge(a, b);
      expect(merged.output).toEqual({ a: 1, b: 2 });
      expect(merged.duration).toBe(300);
      expect(merged.tokenUsage?.total).toBe(70);
    });
  });
});
