import { describe, it, expect, beforeEach } from "vitest";
import { TaskQueue } from "./task-queue.js";
import type { TaskDefinition, TaskPriority } from "./types.js";

describe("TaskQueue", () => {
  let queue: TaskQueue;

  beforeEach(() => {
    queue = new TaskQueue();
  });

  const createTask = (
    id: string,
    priority: TaskPriority = "normal",
    dependencies: string[] = []
  ): TaskDefinition => ({
    id,
    prompt: `Test task ${id}`,
    priority,
    dependencies: dependencies.length > 0 ? dependencies : undefined,
  });

  describe("enqueue", () => {
    it("should enqueue a task", async () => {
      const task = createTask("task-1");
      const taskId = await queue.enqueue(task);
      expect(taskId).toBe("task-1");

      const size = await queue.size();
      expect(size).toBe(1);
    });

    it("should maintain priority order", async () => {
      await queue.enqueue(createTask("low-1", "low"));
      await queue.enqueue(createTask("high-1", "high"));
      await queue.enqueue(createTask("urgent-1", "urgent"));
      await queue.enqueue(createTask("normal-1", "normal"));

      const urgent = await queue.dequeue();
      expect(urgent?.definition.id).toBe("urgent-1");

      const high = await queue.dequeue();
      expect(high?.definition.id).toBe("high-1");

      const normal = await queue.dequeue();
      expect(normal?.definition.id).toBe("normal-1");

      const low = await queue.dequeue();
      expect(low?.definition.id).toBe("low-1");
    });

    it("should place urgent tasks at front", async () => {
      await queue.enqueue(createTask("normal-1", "normal"));
      await queue.enqueue(createTask("normal-2", "normal"));
      await queue.enqueue(createTask("urgent-1", "urgent"));

      const first = await queue.peek();
      expect(first?.definition.id).toBe("urgent-1");
    });

    it("should place high tasks before normal and low", async () => {
      await queue.enqueue(createTask("low-1", "low"));
      await queue.enqueue(createTask("normal-1", "normal"));
      await queue.enqueue(createTask("high-1", "high"));

      const first = await queue.dequeue();
      expect(first?.definition.id).toBe("high-1");
    });
  });

  describe("dequeue", () => {
    it("should return undefined when queue is empty", async () => {
      const task = await queue.dequeue();
      expect(task).toBeUndefined();
    });

    it("should dequeue and return task", async () => {
      await queue.enqueue(createTask("task-1"));

      const task = await queue.dequeue();
      expect(task).toBeDefined();
      expect(task?.definition.id).toBe("task-1");
      expect(task?.status).toBe("running");
      expect(task?.startedAt).toBeDefined();

      const size = await queue.size();
      expect(size).toBe(0);
    });

    it("should skip tasks with unmet dependencies", async () => {
      await queue.enqueue(createTask("task-1", "normal", ["task-2"]));
      await queue.enqueue(createTask("task-2", "normal"));

      // task-1 has dependency on task-2 which is pending
      const first = await queue.dequeue();
      expect(first?.definition.id).toBe("task-2");
    });

    it("should dequeue task with met dependencies", async () => {
      await queue.enqueue(createTask("task-1"));
      await queue.enqueue(createTask("task-2", "normal", ["task-1"]));

      // Complete task-1
      const first = await queue.dequeue();
      expect(first?.definition.id).toBe("task-1");
      
      if (first) {
        first.status = "completed";
        first.completedAt = Date.now();
        await queue.update(first);
      }

      // Now task-2 should be dequeuable
      const second = await queue.dequeue();
      expect(second?.definition.id).toBe("task-2");
    });
  });

  describe("peek", () => {
    it("should return undefined when queue is empty", async () => {
      const task = await queue.peek();
      expect(task).toBeUndefined();
    });

    it("should return next task without removing it", async () => {
      await queue.enqueue(createTask("task-1"));
      await queue.enqueue(createTask("task-2"));

      const peeked = await queue.peek();
      expect(peeked?.definition.id).toBe("task-1");

      const size = await queue.size();
      expect(size).toBe(2);
    });
  });

  describe("size", () => {
    it("should return 0 for empty queue", async () => {
      const size = await queue.size();
      expect(size).toBe(0);
    });

    it("should return correct size", async () => {
      await queue.enqueue(createTask("task-1"));
      await queue.enqueue(createTask("task-2"));
      await queue.enqueue(createTask("task-3"));

      const size = await queue.size();
      expect(size).toBe(3);
    });
  });

  describe("remove", () => {
    it("should remove task from queue", async () => {
      await queue.enqueue(createTask("task-1"));
      await queue.enqueue(createTask("task-2"));

      await queue.remove("task-1");

      const size = await queue.size();
      expect(size).toBe(1);

      const peeked = await queue.peek();
      expect(peeked?.definition.id).toBe("task-2");
    });

    it("should not throw when removing non-existent task", async () => {
      await expect(queue.remove("non-existent")).resolves.not.toThrow();
    });
  });

  describe("update", () => {
    it("should update task in queue", async () => {
      await queue.enqueue(createTask("task-1"));

      const task = await queue.get("task-1");
      expect(task).toBeDefined();

      if (task) {
        task.status = "completed";
        task.completedAt = Date.now();
        await queue.update(task);
      }

      const updated = await queue.get("task-1");
      expect(updated?.status).toBe("completed");
      expect(updated?.completedAt).toBeDefined();
    });
  });

  describe("get", () => {
    it("should return undefined for non-existent task", async () => {
      const task = await queue.get("non-existent");
      expect(task).toBeUndefined();
    });

    it("should return task by id", async () => {
      await queue.enqueue(createTask("task-1"));

      const task = await queue.get("task-1");
      expect(task).toBeDefined();
      expect(task?.definition.id).toBe("task-1");
    });
  });

  describe("list", () => {
    beforeEach(async () => {
      await queue.enqueue(createTask("task-1"));
      await queue.enqueue(createTask("task-2"));
      
      // Set task-1 to running
      const task1 = await queue.get("task-1");
      if (task1) {
        task1.status = "running";
        await queue.update(task1);
      }
    });

    it("should list all tasks without filter", async () => {
      const tasks = await queue.list();
      expect(tasks).toHaveLength(2);
    });

    it("should filter by status", async () => {
      const pendingTasks = await queue.list({ status: "pending" });
      expect(pendingTasks).toHaveLength(1);
      expect(pendingTasks[0]?.definition.id).toBe("task-2");

      const runningTasks = await queue.list({ status: "running" });
      expect(runningTasks).toHaveLength(1);
      expect(runningTasks[0]?.definition.id).toBe("task-1");
    });
  });

  describe("getPendingTasks", () => {
    it("should return only pending tasks", async () => {
      await queue.enqueue(createTask("task-1"));
      await queue.enqueue(createTask("task-2"));

      const task1 = await queue.get("task-1");
      if (task1) {
        task1.status = "running";
        await queue.update(task1);
      }

      const pending = queue.getPendingTasks();
      expect(pending).toHaveLength(1);
      expect(pending[0]?.definition.id).toBe("task-2");
    });
  });

  describe("getRunningTasks", () => {
    it("should return only running tasks", async () => {
      await queue.enqueue(createTask("task-1"));
      await queue.enqueue(createTask("task-2"));

      const task1 = await queue.get("task-1");
      if (task1) {
        task1.status = "running";
        await queue.update(task1);
      }

      const running = queue.getRunningTasks();
      expect(running).toHaveLength(1);
      expect(running[0]?.definition.id).toBe("task-1");
    });
  });

  describe("areDependenciesMet", () => {
    it("should return true for task with no dependencies", async () => {
      await queue.enqueue(createTask("task-1"));
      expect(queue.areDependenciesMet("task-1")).toBe(true);
    });

    it("should return false for task with pending dependency", async () => {
      await queue.enqueue(createTask("task-1"));
      await queue.enqueue(createTask("task-2", "normal", ["task-1"]));
      expect(queue.areDependenciesMet("task-2")).toBe(false);
    });

    it("should return true when all dependencies are completed", async () => {
      await queue.enqueue(createTask("task-1"));
      await queue.enqueue(createTask("task-2", "normal", ["task-1"]));

      const task1 = await queue.get("task-1");
      if (task1) {
        task1.status = "completed";
        await queue.update(task1);
      }

      expect(queue.areDependenciesMet("task-2")).toBe(true);
    });

    it("should return false when dependency does not exist", async () => {
      await queue.enqueue(createTask("task-1", "normal", ["non-existent"]));
      expect(queue.areDependenciesMet("task-1")).toBe(false);
    });
  });
});
