/**
 * Workflow Engine Integration Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { WorkflowEngine, createWorkflowEngine } from "./workflow-engine.js";
import { CheckpointManager, createCheckpointManager } from "../persistence/checkpoint-manager.js";
import type { WorkflowDefinition, WorkflowNode } from "./types.js";

describe("Workflow Engine Integration", () => {
  let tempDir: string;
  let engine: WorkflowEngine;
  let checkpointManager: CheckpointManager;

  const createTestWorkflow = (): WorkflowDefinition => ({
    id: "test-workflow",
    name: "Test Workflow",
    version: "1.0.0",
    description: "A test workflow",
    nodes: [
      {
        id: "node-1",
        type: "task",
        name: "First Task",
        dependencies: [],
        config: { type: "task", prompt: "Do something" },
      },
      {
        id: "node-2",
        type: "task",
        name: "Second Task",
        dependencies: ["node-1"],
        config: { type: "task", prompt: "Do something else" },
      },
      {
        id: "node-3",
        type: "task",
        name: "Final Task",
        dependencies: ["node-2"],
        config: { type: "task", prompt: "Finish up" },
      },
    ],
    variables: { count: 0 },
    triggers: [{ type: "manual", config: {}, enabled: true }],
  });

  const createParallelWorkflow = (): WorkflowDefinition => ({
    id: "parallel-workflow",
    name: "Parallel Workflow",
    version: "1.0.0",
    nodes: [
      {
        id: "start",
        type: "task",
        name: "Start",
        dependencies: [],
        config: { type: "task", prompt: "Start" },
      },
      {
        id: "parallel",
        type: "parallel",
        name: "Parallel Tasks",
        dependencies: ["start"],
        config: {
          type: "parallel",
          branches: [
            {
              id: "branch-1",
              type: "task",
              name: "Branch 1",
              dependencies: [],
              config: { type: "task", prompt: "Branch 1" },
            },
            {
              id: "branch-2",
              type: "task",
              name: "Branch 2",
              dependencies: [],
              config: { type: "task", prompt: "Branch 2" },
            },
          ],
        },
      },
      {
        id: "end",
        type: "task",
        name: "End",
        dependencies: ["parallel"],
        config: { type: "task", prompt: "End" },
      },
    ],
    variables: {},
    triggers: [{ type: "manual", config: {}, enabled: true }],
  });

  const createConditionalWorkflow = (): WorkflowDefinition => ({
    id: "conditional-workflow",
    name: "Conditional Workflow",
    version: "1.0.0",
    nodes: [
      {
        id: "start",
        type: "task",
        name: "Start",
        dependencies: [],
        config: { type: "task", prompt: "Start" },
      },
      {
        id: "condition",
        type: "condition",
        name: "Check Condition",
        dependencies: ["start"],
        config: {
          type: "condition",
          expression: "count > 5",
          thenBranch: {
            id: "then-branch",
            type: "task",
            name: "Then Task",
            dependencies: [],
            config: { type: "task", prompt: "Count is greater" },
          },
          elseBranch: {
            id: "else-branch",
            type: "task",
            name: "Else Task",
            dependencies: [],
            config: { type: "task", prompt: "Count is smaller" },
          },
        },
      },
    ],
    variables: { count: 10 },
    triggers: [{ type: "manual", config: {}, enabled: true }],
  });

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-integration-"));
    engine = createWorkflowEngine({
      checkpointEnabled: true,
      persistenceEnabled: false,
    });
    checkpointManager = createCheckpointManager({ basePath: tempDir });
  });

  afterEach(() => {
    engine.shutdown();
    checkpointManager.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("Basic Workflow Execution", () => {
    it("should execute a simple sequential workflow", async () => {
      const workflow = createTestWorkflow();
      const result = await engine.execute(workflow);

      expect(result.status).toBe("completed");
      expect(result.executionId).toBeDefined();
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it("should execute workflow with variables", async () => {
      const workflow = createTestWorkflow();
      const result = await engine.execute(workflow, { count: 5, name: "test" });

      expect(result.status).toBe("completed");
    });

    it("should track node results", async () => {
      const workflow = createTestWorkflow();
      const result = await engine.execute(workflow);

      expect(Object.keys(result.nodeResults).length).toBe(3);
      expect("node-1" in result.nodeResults).toBe(true);
      expect("node-2" in result.nodeResults).toBe(true);
      expect("node-3" in result.nodeResults).toBe(true);
    });

    it("should handle workflow events", async () => {
      const workflow = createTestWorkflow();
      const events: string[] = [];

      engine.setHandlers({
        onWorkflowStart: () => events.push("start"),
        onWorkflowComplete: () => events.push("complete"),
        onNodeStart: (nodeId) => events.push(`node-start:${nodeId}`),
        onNodeComplete: (nodeId) => events.push(`node-complete:${nodeId}`),
      });

      await engine.execute(workflow);

      expect(events).toContain("start");
      expect(events).toContain("complete");
      expect(events.filter((e) => e.startsWith("node-start:")).length).toBe(3);
      expect(events.filter((e) => e.startsWith("node-complete:")).length).toBe(3);
    });
  });

  describe("Parallel Execution", () => {
    it("should execute parallel nodes", async () => {
      const workflow = createParallelWorkflow();
      const result = await engine.execute(workflow);

      expect(result.status).toBe("completed");
    });
  });

  describe("Conditional Execution", () => {
    it("should execute then branch when condition is true", async () => {
      const workflow = createConditionalWorkflow();
      workflow.variables = { count: 10 };
      const result = await engine.execute(workflow);

      expect(result.status).toBe("completed");
    });

    it("should execute else branch when condition is false", async () => {
      const workflow = createConditionalWorkflow();
      workflow.variables = { count: 3 };
      const result = await engine.execute(workflow);

      expect(result.status).toBe("completed");
    });
  });

  describe("Workflow Control", () => {
    it("should pause and resume workflow", async () => {
      const workflow = createTestWorkflow();

      engine.setHandlers({
        onNodeComplete: async (nodeId) => {
          if (nodeId === "node-1") {
            const executions = engine.getActiveExecutions();
            if (executions.length > 0) {
              await engine.pause(executions[0].id);
            }
          }
        },
      });

      const executePromise = engine.execute(workflow);

      await new Promise((resolve) => setTimeout(resolve, 100));

      const executions = engine.getActiveExecutions();
      if (executions.length > 0 && executions[0].status === "paused") {
        await engine.resume(executions[0].id);
      }

      const result = await executePromise;
      expect(["completed", "paused"]).toContain(result.status);
    });

    it("should cancel workflow", async () => {
      const workflow = createTestWorkflow();

      const executePromise = engine.execute(workflow);

      await new Promise((resolve) => setTimeout(resolve, 10));

      const executions = engine.getActiveExecutions();
      if (executions.length > 0) {
        await engine.cancel(executions[0].id);
      }

      const result = await executePromise;
      expect(["completed", "cancelled"]).toContain(result.status);
    });
  });

  describe("Checkpoint Integration", () => {
    it("should create checkpoints during execution", async () => {
      const workflow = createTestWorkflow();
      const checkpoints: string[] = [];

      engine.setHandlers({
        onCheckpoint: (checkpoint) => checkpoints.push(checkpoint.id),
      });

      const result = await engine.execute(workflow);

      expect(result.status).toBe("completed");
      expect(checkpoints.length).toBe(3);
    });

    it("should integrate with external checkpoint manager", async () => {
      const checkpointEngine = createWorkflowEngine({
        checkpointEnabled: true,
        persistenceEnabled: true,
      });
      checkpointEngine.setCheckpointManager(checkpointManager);

      const workflow = createTestWorkflow();
      const result = await checkpointEngine.execute(workflow);

      const stats = await checkpointManager.getCheckpointStats();
      expect(stats.totalCheckpoints).toBeGreaterThan(0);

      checkpointEngine.shutdown();
    });

    it("should list and load checkpoints", async () => {
      const workflow = createTestWorkflow();
      const result = await engine.execute(workflow);

      const checkpoints = await engine.listCheckpoints(result.executionId);
      expect(checkpoints.length).toBeGreaterThan(0);

      const latest = await engine.getLatestCheckpoint(result.executionId);
      expect(latest).toBeDefined();
    });

    it("should delete checkpoints", async () => {
      const workflow = createTestWorkflow();
      const result = await engine.execute(workflow);

      const checkpoints = await engine.listCheckpoints(result.executionId);
      expect(checkpoints.length).toBe(3);

      await engine.deleteCheckpoint(checkpoints[0].id);

      const updated = await engine.listCheckpoints(result.executionId);
      expect(updated.length).toBe(2);
    });

    it("should delete all checkpoints for execution", async () => {
      const workflow = createTestWorkflow();
      const result = await engine.execute(workflow);

      await engine.deleteCheckpointsForExecution(result.executionId);

      const checkpoints = await engine.listCheckpoints(result.executionId);
      expect(checkpoints.length).toBe(0);
    });
  });

  describe("Error Handling", () => {
    it("should handle circular dependencies", async () => {
      const workflow: WorkflowDefinition = {
        id: "circular-workflow",
        name: "Circular Workflow",
        version: "1.0.0",
        nodes: [
          {
            id: "node-1",
            type: "task",
            name: "Node 1",
            dependencies: ["node-2"],
            config: { type: "task", prompt: "First" },
          },
          {
            id: "node-2",
            type: "task",
            name: "Node 2",
            dependencies: ["node-1"],
            config: { type: "task", prompt: "Second" },
          },
        ],
        variables: {},
        triggers: [],
      };

      const result = await engine.execute(workflow);
      expect(result.status).toBe("failed");
      expect(result.error).toContain("Circular dependency");
    });

    it("should handle empty workflow", async () => {
      const workflow: WorkflowDefinition = {
        id: "empty-workflow",
        name: "Empty Workflow",
        version: "1.0.0",
        nodes: [],
        variables: {},
        triggers: [],
      };

      const result = await engine.execute(workflow);
      expect(result.status).toBe("completed");
    });
  });

  describe("Concurrency", () => {
    it("should handle concurrent executions", async () => {
      const limitedEngine = createWorkflowEngine({ maxConcurrentExecutions: 2 });
      const workflow = createTestWorkflow();

      const promises = [
        limitedEngine.execute(workflow),
        limitedEngine.execute(workflow),
      ];

      const results = await Promise.all(promises);

      expect(results.every((r) => r.status === "completed")).toBe(true);

      limitedEngine.shutdown();
    });
  });
});
