/**
 * Persistence Integration Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { FileStateStore } from "./state-store.js";
import { CheckpointManager, createCheckpointManager } from "./checkpoint-manager.js";
import { RecoveryManager, createRecoveryManager } from "./recovery-manager.js";

describe("Persistence Integration", () => {
  let tempDir: string;
  let stateStore: FileStateStore;
  let checkpointManager: CheckpointManager;
  let recoveryManager: RecoveryManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "persistence-integration-"));
    stateStore = new FileStateStore({ basePath: tempDir });
    checkpointManager = createCheckpointManager({ basePath: tempDir });
    recoveryManager = createRecoveryManager({ basePath: tempDir, stateStore });
  });

  afterEach(() => {
    checkpointManager.close();
    recoveryManager.close();
    stateStore.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("StateStore + CheckpointManager Integration", () => {
    it("should persist workflow state and create checkpoints", async () => {
      await stateStore.set("workflow:status", "running", "workflow", "wf-1");
      await stateStore.set("workflow:currentNode", "node-3", "workflow", "wf-1");

      const checkpoint = await checkpointManager.createCheckpoint(
        "exec-1",
        "node-3",
        { count: 5, items: ["a", "b"] },
        { "node-1": { status: "completed" }, "node-2": { status: "completed" } }
      );

      expect(checkpoint.executionId).toBe("exec-1");
      expect(checkpoint.nodeId).toBe("node-3");
      expect(checkpoint.variables.count).toBe(5);

      const loaded = await checkpointManager.loadCheckpoint(checkpoint.id);
      expect(loaded?.variables.count).toBe(5);
    });

    it("should restore state from recovery point", async () => {
      await stateStore.set("agent:status", "active", "agent", "agent-1");
      await stateStore.set("agent:tasks", 10, "agent", "agent-1");

      const recoveryPoint = await recoveryManager.createRecoveryPoint(
        "checkpoint",
        "agent",
        "agent-1"
      );

      await stateStore.set("agent:status", "inactive", "agent", "agent-1");
      await stateStore.set("agent:tasks", 5, "agent", "agent-1");

      const plan = await recoveryManager.createRecoveryPlan(recoveryPoint.id);
      await recoveryManager.executeRecoveryPlan(plan);

      const status = await stateStore.get("agent:status", "agent", "agent-1");
      const tasks = await stateStore.get("agent:tasks", "agent", "agent-1");

      expect(status).toBe("active");
      expect(tasks).toBe(10);
    });
  });

  describe("CheckpointManager + RecoveryManager Integration", () => {
    it("should create recovery points from checkpoints", async () => {
      const checkpoint = await checkpointManager.createCheckpoint(
        "exec-1",
        "node-5",
        { step: 5 },
        { "node-1": { status: "completed" } }
      );

      const recoveryPoint = await recoveryManager.createRecoveryPoint(
        "checkpoint",
        "workflow",
        "exec-1",
        { workflowId: "wf-1" }
      );

      expect(recoveryPoint.type).toBe("checkpoint");
      expect(recoveryPoint.scope).toBe("workflow");
    });

    it("should list checkpoints and recovery points together", async () => {
      await checkpointManager.createCheckpoint("exec-1", "node-1");
      await checkpointManager.createCheckpoint("exec-1", "node-2");
      await checkpointManager.createCheckpoint("exec-2", "node-1");

      await recoveryManager.createRecoveryPoint("checkpoint", "workflow", "exec-1");
      await recoveryManager.createRecoveryPoint("snapshot", "workflow", "exec-2");

      const checkpoints = await checkpointManager.listCheckpoints("exec-1");
      const recoveryPoints = await recoveryManager.listRecoveryPoints("workflow");

      expect(checkpoints).toHaveLength(2);
      expect(recoveryPoints).toHaveLength(2);
    });
  });

  describe("Full Recovery Flow", () => {
    it("should recover from crash with state restoration", async () => {
      await stateStore.set("session:data", { user: "test", progress: 50 }, "session", "s1");

      const recoveryPoint = await recoveryManager.createRecoveryPoint("backup", "session", "s1");

      await stateStore.set("session:data", { user: "test", progress: 0 }, "session", "s1");

      const plan = await recoveryManager.createRecoveryPlan(recoveryPoint.id);

      expect(plan.steps.length).toBeGreaterThan(0);
      expect(plan.steps[0].action).toBe("restore_state");

      await recoveryManager.executeRecoveryPlan(plan);

      const data = await stateStore.get("session:data", "session", "s1");
      expect((data as { progress: number }).progress).toBe(50);
    });

    it("should handle multiple recovery points", async () => {
      await stateStore.set("data", "v1", "session", "s1");
      const rp1 = await recoveryManager.createRecoveryPoint("checkpoint", "session", "s1");

      await stateStore.set("data", "v2", "session", "s1");
      const rp2 = await recoveryManager.createRecoveryPoint("checkpoint", "session", "s1");

      await stateStore.set("data", "v3", "session", "s1");

      const plan1 = await recoveryManager.createRecoveryPlan(rp1.id);
      await recoveryManager.executeRecoveryPlan(plan1);
      expect(await stateStore.get("data", "session", "s1")).toBe("v1");

      const plan2 = await recoveryManager.createRecoveryPlan(rp2.id);
      await recoveryManager.executeRecoveryPlan(plan2);
      expect(await stateStore.get("data", "session", "s1")).toBe("v2");
    });
  });

  describe("Persistence Across Sessions", () => {
    it("should persist data across manager instances", async () => {
      await stateStore.set("persistent:key", "value", "global", "app");
      await checkpointManager.createCheckpoint("exec-1", "node-1", { data: "test" });
      await recoveryManager.createRecoveryPoint("snapshot", "global", "app");

      stateStore.close();
      checkpointManager.close();
      recoveryManager.close();

      const newStateStore = new FileStateStore({ basePath: tempDir });
      const newCheckpointManager = createCheckpointManager({ basePath: tempDir });
      const newRecoveryManager = createRecoveryManager({
        basePath: tempDir,
        stateStore: newStateStore,
      });

      const value = await newStateStore.get("persistent:key", "global", "app");
      const checkpoints = await newCheckpointManager.listCheckpoints("exec-1");
      const recoveryPoints = await newRecoveryManager.listRecoveryPoints("global");

      expect(value).toBe("value");
      expect(checkpoints).toHaveLength(1);
      expect(recoveryPoints).toHaveLength(1);

      newStateStore.close();
      newCheckpointManager.close();
      newRecoveryManager.close();
    });
  });
});
