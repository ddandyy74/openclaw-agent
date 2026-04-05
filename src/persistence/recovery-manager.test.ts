import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { RecoveryManager, createRecoveryManager } from "./recovery-manager.js";
import { FileStateStore } from "./state-store.js";
import type { RecoveryPoint, RecoveryPlan, PersistenceScope } from "./types.js";

describe("RecoveryManager", () => {
  let tempDir: string;
  let stateStore: FileStateStore;
  let manager: RecoveryManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "recovery-test-"));
    stateStore = new FileStateStore({ basePath: tempDir });
    manager = createRecoveryManager({ basePath: tempDir, stateStore });
  });

  afterEach(() => {
    manager.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("createRecoveryPoint", () => {
    it("should create a recovery point", async () => {
      await stateStore.set("key1", "value1", "session", "session-1");

      const point = await manager.createRecoveryPoint("checkpoint", "session", "session-1");

      expect(point.id).toBeDefined();
      expect(point.id).toMatch(/^recovery-/);
      expect(point.type).toBe("checkpoint");
      expect(point.scope).toBe("session");
      expect(point.scopeId).toBe("session-1");
      expect(point.timestamp).toBeGreaterThan(0);
    });

    it("should capture state from state store", async () => {
      await stateStore.set("var1", "value1", "workflow", "wf-1");
      await stateStore.set("var2", { nested: true }, "workflow", "wf-1");

      const point = await manager.createRecoveryPoint("snapshot", "workflow", "wf-1");

      expect(point.data.var1).toBe("value1");
      expect((point.data.var2 as { nested: boolean }).nested).toBe(true);
    });

    it("should create different types of recovery points", async () => {
      const checkpoint = await manager.createRecoveryPoint("checkpoint", "session", "s1");
      const snapshot = await manager.createRecoveryPoint("snapshot", "session", "s2");
      const backup = await manager.createRecoveryPoint("backup", "session", "s3");

      expect(checkpoint.type).toBe("checkpoint");
      expect(snapshot.type).toBe("snapshot");
      expect(backup.type).toBe("backup");
    });

    it("should include context metadata", async () => {
      const point = await manager.createRecoveryPoint(
        "checkpoint",
        "workflow",
        "wf-1",
        {
          agentId: "agent-1",
          sessionId: "session-1",
          workflowId: "wf-1",
          metadata: { custom: "data" },
        }
      );

      expect(point.metadata?.agentId).toBe("agent-1");
      expect(point.metadata?.sessionId).toBe("session-1");
      expect(point.metadata?.workflowId).toBe("wf-1");
      expect(point.metadata?.custom).toBe("data");
    });
  });

  describe("loadRecoveryPoint", () => {
    it("should load an existing recovery point", async () => {
      const created = await manager.createRecoveryPoint("checkpoint", "session", "s1");

      const loaded = await manager.loadRecoveryPoint(created.id);

      expect(loaded).toBeDefined();
      expect(loaded?.id).toBe(created.id);
    });

    it("should return undefined for non-existent recovery point", async () => {
      const loaded = await manager.loadRecoveryPoint("non-existent");

      expect(loaded).toBeUndefined();
    });
  });

  describe("listRecoveryPoints", () => {
    it("should list all recovery points", async () => {
      await manager.createRecoveryPoint("checkpoint", "session", "s1");
      await manager.createRecoveryPoint("snapshot", "session", "s2");

      const points = await manager.listRecoveryPoints();

      expect(points).toHaveLength(2);
    });

    it("should filter by scope", async () => {
      await manager.createRecoveryPoint("checkpoint", "session", "s1");
      await manager.createRecoveryPoint("checkpoint", "workflow", "w1");

      const sessionPoints = await manager.listRecoveryPoints("session");
      const workflowPoints = await manager.listRecoveryPoints("workflow");

      expect(sessionPoints).toHaveLength(1);
      expect(sessionPoints[0].scope).toBe("session");
      expect(workflowPoints).toHaveLength(1);
      expect(workflowPoints[0].scope).toBe("workflow");
    });

    it("should filter by scope and scopeId", async () => {
      await manager.createRecoveryPoint("checkpoint", "session", "s1");
      await manager.createRecoveryPoint("checkpoint", "session", "s2");

      const points = await manager.listRecoveryPoints("session", "s1");

      expect(points).toHaveLength(1);
      expect(points[0].scopeId).toBe("s1");
    });

    it("should list in descending order by timestamp", async () => {
      const p1 = await manager.createRecoveryPoint("checkpoint", "session", "s1");
      await new Promise((resolve) => setTimeout(resolve, 10));
      const p2 = await manager.createRecoveryPoint("checkpoint", "session", "s2");
      await new Promise((resolve) => setTimeout(resolve, 10));
      const p3 = await manager.createRecoveryPoint("checkpoint", "session", "s3");

      const points = await manager.listRecoveryPoints();

      expect(points[0].id).toBe(p3.id);
      expect(points[1].id).toBe(p2.id);
      expect(points[2].id).toBe(p1.id);
    });
  });

  describe("createRecoveryPlan", () => {
    it("should create a recovery plan", async () => {
      const point = await manager.createRecoveryPoint("checkpoint", "session", "s1");

      const plan = await manager.createRecoveryPlan(point.id);

      expect(plan.recoveryPointId).toBe(point.id);
      expect(plan.steps.length).toBeGreaterThan(0);
      expect(plan.estimatedDuration).toBeGreaterThan(0);
      expect(["low", "medium", "high"]).toContain(plan.riskLevel);
    });

    it("should include restore_state step", async () => {
      const point = await manager.createRecoveryPoint("checkpoint", "session", "s1");

      const plan = await manager.createRecoveryPlan(point.id);

      const restoreStep = plan.steps.find((s) => s.action === "restore_state");
      expect(restoreStep).toBeDefined();
      expect(restoreStep?.target).toBe("session:s1");
    });

    it("should include restart_agent step if agentId in metadata", async () => {
      const point = await manager.createRecoveryPoint("checkpoint", "session", "s1", {
        agentId: "agent-1",
      });

      const plan = await manager.createRecoveryPlan(point.id);

      const agentStep = plan.steps.find((s) => s.action === "restart_agent");
      expect(agentStep).toBeDefined();
      expect(agentStep?.target).toBe("agent-1");
    });

    it("should include resume_workflow step if workflowId in metadata", async () => {
      const point = await manager.createRecoveryPoint("checkpoint", "workflow", "wf-1", {
        workflowId: "wf-1",
      });

      const plan = await manager.createRecoveryPlan(point.id);

      const workflowStep = plan.steps.find((s) => s.action === "resume_workflow");
      expect(workflowStep).toBeDefined();
      expect(workflowStep?.target).toBe("wf-1");
    });

    it("should assess risk level based on age", async () => {
      const recent = await manager.createRecoveryPoint("checkpoint", "session", "s1");

      const plan = await manager.createRecoveryPlan(recent.id);

      expect(plan.riskLevel).toBe("low");
    });

    it("should throw for non-existent recovery point", async () => {
      await expect(manager.createRecoveryPlan("non-existent")).rejects.toThrow(
        "Recovery point not found"
      );
    });
  });

  describe("executeRecoveryPlan", () => {
    it("should execute restore_state step", async () => {
      await stateStore.set("key1", "original", "session", "s1");
      const point = await manager.createRecoveryPoint("checkpoint", "session", "s1");
      
      await stateStore.set("key1", "modified", "session", "s1");

      const plan = await manager.createRecoveryPlan(point.id);
      await manager.executeRecoveryPlan(plan);

      const restored = await stateStore.get("key1", "session", "s1");
      expect(restored).toBe("original");
    });

    it("should execute steps in order", async () => {
      const point = await manager.createRecoveryPoint("checkpoint", "session", "s1");
      const plan = await manager.createRecoveryPlan(point.id);

      const order: number[] = [];
      for (const step of plan.steps) {
        order.push(step.order);
      }

      for (let i = 1; i < order.length; i++) {
        expect(order[i]).toBeGreaterThan(order[i - 1]);
      }
    });
  });

  describe("deleteRecoveryPoint", () => {
    it("should delete a recovery point", async () => {
      const point = await manager.createRecoveryPoint("checkpoint", "session", "s1");

      await manager.deleteRecoveryPoint(point.id);

      const loaded = await manager.loadRecoveryPoint(point.id);
      expect(loaded).toBeUndefined();
    });
  });

  describe("createSnapshot", () => {
    it("should create a state snapshot", async () => {
      await stateStore.set("var1", "value1", "workflow", "wf-1");
      await stateStore.set("var2", { nested: true }, "workflow", "wf-1");

      const snapshot = await manager.createSnapshot("workflow", "wf-1");

      expect(snapshot.id).toMatch(/^snapshot-/);
      expect(snapshot.scope).toBe("workflow");
      expect(snapshot.scopeId).toBe("wf-1");
      expect(snapshot.timestamp).toBeGreaterThan(0);
      expect(snapshot.version).toBe("1.0.0");
      expect(snapshot.checksum).toBeDefined();
      expect(snapshot.data.var1).toBe("value1");
      expect((snapshot.data.var2 as { nested: boolean }).nested).toBe(true);
    });
  });

  describe("restoreFromSnapshot", () => {
    it("should restore state from snapshot", async () => {
      await stateStore.set("key1", "original", "session", "s1");
      const snapshot = await manager.createSnapshot("session", "s1");

      await stateStore.set("key1", "modified", "session", "s1");

      await manager.restoreFromSnapshot(snapshot);

      const restored = await stateStore.get("key1", "session", "s1");
      expect(restored).toBe("original");
    });

    it("should throw on checksum mismatch", async () => {
      await stateStore.set("key1", "value1", "session", "s1");
      const snapshot = await manager.createSnapshot("session", "s1");

      snapshot.checksum = "invalid-checksum";

      await expect(manager.restoreFromSnapshot(snapshot)).rejects.toThrow("checksum mismatch");
    });
  });

  describe("getRecoveryStats", () => {
    it("should return correct stats", async () => {
      await manager.createRecoveryPoint("checkpoint", "session", "s1");
      await manager.createRecoveryPoint("checkpoint", "session", "s2");
      await manager.createRecoveryPoint("snapshot", "workflow", "w1");

      const stats = await manager.getRecoveryStats();

      expect(stats.totalRecoveryPoints).toBe(3);
      expect(stats.byType.checkpoint).toBe(2);
      expect(stats.byType.snapshot).toBe(1);
      expect(stats.byScope.session).toBe(2);
      expect(stats.byScope.workflow).toBe(1);
      expect(stats.oldestPoint).toBeDefined();
      expect(stats.newestPoint).toBeDefined();
    });

    it("should return empty stats for no recovery points", async () => {
      const stats = await manager.getRecoveryStats();

      expect(stats.totalRecoveryPoints).toBe(0);
      expect(stats.byType).toEqual({});
      expect(stats.byScope).toEqual({});
    });
  });

  describe("pruneExpiredRecoveryPoints", () => {
    it("should remove expired recovery points", async () => {
      await manager.createRecoveryPoint("checkpoint", "session", "s1", {
        metadata: { expiresAt: Date.now() - 1000 },
      });
      await manager.createRecoveryPoint("checkpoint", "session", "s2", {
        metadata: { expiresAt: Date.now() + 10000 },
      });

      const pruned = await manager.pruneExpiredRecoveryPoints();

      expect(pruned).toBe(1);
      const points = await manager.listRecoveryPoints();
      expect(points).toHaveLength(1);
      expect(points[0].scopeId).toBe("s2");
    });

    it("should return 0 if nothing to prune", async () => {
      await manager.createRecoveryPoint("checkpoint", "session", "s1");

      const pruned = await manager.pruneExpiredRecoveryPoints();

      expect(pruned).toBe(0);
    });
  });

  describe("persistence", () => {
    it("should persist recovery points to disk", async () => {
      const point = await manager.createRecoveryPoint("checkpoint", "session", "s1");
      manager.close();

      const newManager = createRecoveryManager({ basePath: tempDir });
      const loaded = await newManager.loadRecoveryPoint(point.id);

      expect(loaded?.id).toBe(point.id);
      expect(loaded?.type).toBe("checkpoint");

      newManager.close();
    });
  });
});
