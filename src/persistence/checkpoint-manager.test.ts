import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { CheckpointManager, createCheckpointManager } from "./checkpoint-manager.js";
import type { Checkpoint } from "./types.js";

describe("CheckpointManager", () => {
  let tempDir: string;
  let manager: CheckpointManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "checkpoint-test-"));
    manager = createCheckpointManager({ basePath: tempDir });
  });

  afterEach(() => {
    manager.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("createCheckpoint", () => {
    it("should create a checkpoint", async () => {
      const checkpoint = await manager.createCheckpoint(
        "exec-1",
        "node-1",
        { count: 10 },
        { "node-1": { status: "completed" } }
      );

      expect(checkpoint.id).toBeDefined();
      expect(checkpoint.id).toMatch(/^checkpoint-/);
      expect(checkpoint.executionId).toBe("exec-1");
      expect(checkpoint.nodeId).toBe("node-1");
      expect(checkpoint.timestamp).toBeGreaterThan(0);
      expect(checkpoint.variables.count).toBe(10);
      expect((checkpoint.nodeStates["node-1"] as { status: string }).status).toBe("completed");
    });

    it("should create checkpoint with empty state", async () => {
      const checkpoint = await manager.createCheckpoint("exec-2", "node-2");

      expect(checkpoint.variables).toEqual({});
      expect(checkpoint.nodeStates).toEqual({});
    });
  });

  describe("loadCheckpoint", () => {
    it("should load an existing checkpoint", async () => {
      const created = await manager.createCheckpoint(
        "exec-1",
        "node-1",
        { key: "value" }
      );

      const loaded = await manager.loadCheckpoint(created.id);

      expect(loaded).toBeDefined();
      expect(loaded?.id).toBe(created.id);
      expect(loaded?.executionId).toBe("exec-1");
      expect(loaded?.variables.key).toBe("value");
    });

    it("should return undefined for non-existent checkpoint", async () => {
      const loaded = await manager.loadCheckpoint("non-existent");

      expect(loaded).toBeUndefined();
    });
  });

  describe("listCheckpoints", () => {
    it("should list checkpoints for an execution", async () => {
      await manager.createCheckpoint("exec-1", "node-1", { step: 1 });
      await manager.createCheckpoint("exec-1", "node-2", { step: 2 });
      await manager.createCheckpoint("exec-2", "node-1", { step: 1 });

      const checkpoints = await manager.listCheckpoints("exec-1");

      expect(checkpoints).toHaveLength(2);
      expect(checkpoints[0].executionId).toBe("exec-1");
    });

    it("should return empty array for non-existent execution", async () => {
      const checkpoints = await manager.listCheckpoints("non-existent");

      expect(checkpoints).toHaveLength(0);
    });

    it("should list checkpoints in descending order by timestamp", async () => {
      const cp1 = await manager.createCheckpoint("exec-1", "node-1");
      await new Promise((resolve) => setTimeout(resolve, 10));
      const cp2 = await manager.createCheckpoint("exec-1", "node-2");
      await new Promise((resolve) => setTimeout(resolve, 10));
      const cp3 = await manager.createCheckpoint("exec-1", "node-3");

      const checkpoints = await manager.listCheckpoints("exec-1");

      expect(checkpoints[0].id).toBe(cp3.id);
      expect(checkpoints[1].id).toBe(cp2.id);
      expect(checkpoints[2].id).toBe(cp1.id);
    });
  });

  describe("getLatestCheckpoint", () => {
    it("should return the most recent checkpoint", async () => {
      await manager.createCheckpoint("exec-1", "node-1", { step: 1 });
      await new Promise((resolve) => setTimeout(resolve, 10));
      const latest = await manager.createCheckpoint("exec-1", "node-2", { step: 2 });

      const result = await manager.getLatestCheckpoint("exec-1");

      expect(result?.id).toBe(latest.id);
    });

    it("should return undefined for non-existent execution", async () => {
      const result = await manager.getLatestCheckpoint("non-existent");

      expect(result).toBeUndefined();
    });
  });

  describe("deleteCheckpoint", () => {
    it("should delete a checkpoint", async () => {
      const checkpoint = await manager.createCheckpoint("exec-1", "node-1");

      await manager.deleteCheckpoint(checkpoint.id);

      const loaded = await manager.loadCheckpoint(checkpoint.id);
      expect(loaded).toBeUndefined();
    });

    it("should not throw for non-existent checkpoint", async () => {
      await expect(manager.deleteCheckpoint("non-existent")).resolves.not.toThrow();
    });
  });

  describe("deleteCheckpointsForExecution", () => {
    it("should delete all checkpoints for an execution", async () => {
      await manager.createCheckpoint("exec-1", "node-1");
      await manager.createCheckpoint("exec-1", "node-2");
      await manager.createCheckpoint("exec-2", "node-1");

      await manager.deleteCheckpointsForExecution("exec-1");

      const exec1Checkpoints = await manager.listCheckpoints("exec-1");
      const exec2Checkpoints = await manager.listCheckpoints("exec-2");

      expect(exec1Checkpoints).toHaveLength(0);
      expect(exec2Checkpoints).toHaveLength(1);
    });
  });

  describe("pruneOldCheckpoints", () => {
    it("should keep only the specified number of checkpoints", async () => {
      await manager.createCheckpoint("exec-1", "node-1");
      await manager.createCheckpoint("exec-1", "node-2");
      await manager.createCheckpoint("exec-1", "node-3");
      await manager.createCheckpoint("exec-1", "node-4");
      await manager.createCheckpoint("exec-1", "node-5");

      const deleted = await manager.pruneOldCheckpoints("exec-1", 3);

      expect(deleted).toBe(2);
      const checkpoints = await manager.listCheckpoints("exec-1");
      expect(checkpoints).toHaveLength(3);
    });

    it("should not delete if under the limit", async () => {
      await manager.createCheckpoint("exec-1", "node-1");
      await manager.createCheckpoint("exec-1", "node-2");

      const deleted = await manager.pruneOldCheckpoints("exec-1", 5);

      expect(deleted).toBe(0);
      const checkpoints = await manager.listCheckpoints("exec-1");
      expect(checkpoints).toHaveLength(2);
    });
  });

  describe("validateCheckpoint", () => {
    it("should validate a valid checkpoint", async () => {
      const checkpoint = await manager.createCheckpoint("exec-1", "node-1");

      const isValid = await manager.validateCheckpoint(checkpoint.id);

      expect(isValid).toBe(true);
    });

    it("should return false for invalid checkpoint", async () => {
      const isValid = await manager.validateCheckpoint("non-existent");

      expect(isValid).toBe(false);
    });
  });

  describe("getCheckpointStats", () => {
    it("should return correct stats", async () => {
      await manager.createCheckpoint("exec-1", "node-1");
      await manager.createCheckpoint("exec-1", "node-2");
      await manager.createCheckpoint("exec-2", "node-1");

      const stats = await manager.getCheckpointStats();

      expect(stats.totalCheckpoints).toBe(3);
      expect(stats.executions).toHaveLength(2);
      expect(stats.executions).toContain("exec-1");
      expect(stats.executions).toContain("exec-2");
      expect(stats.oldestCheckpoint).toBeDefined();
      expect(stats.newestCheckpoint).toBeDefined();
    });

    it("should return empty stats for no checkpoints", async () => {
      const stats = await manager.getCheckpointStats();

      expect(stats.totalCheckpoints).toBe(0);
      expect(stats.executions).toHaveLength(0);
      expect(stats.oldestCheckpoint).toBeUndefined();
      expect(stats.newestCheckpoint).toBeUndefined();
    });
  });

  describe("persistence", () => {
    it("should persist checkpoints to disk", async () => {
      const checkpoint = await manager.createCheckpoint("exec-1", "node-1", { key: "value" });
      manager.close();

      const newManager = createCheckpointManager({ basePath: tempDir });
      const loaded = await newManager.loadCheckpoint(checkpoint.id);
      
      expect(loaded?.id).toBe(checkpoint.id);
      expect(loaded?.variables.key).toBe("value");
      
      newManager.close();
    });
  });
});
