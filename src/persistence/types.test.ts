import { describe, it, expect } from "vitest";
import type {
  PersistenceScope,
  StateSnapshot,
  PersistedState,
  RecoveryPoint,
  RecoveryPlan,
  PersistenceConfig,
  Checkpoint,
} from "./types.js";

describe("Persistence Types", () => {
  describe("PersistenceScope", () => {
    it("should support all scopes", () => {
      const scopes: PersistenceScope[] = ["global", "agent", "session", "workflow"];
      expect(scopes).toHaveLength(4);
    });
  });

  describe("StateSnapshot", () => {
    it("should create a valid state snapshot", () => {
      const snapshot: StateSnapshot = {
        id: "snapshot-1",
        scope: "session",
        scopeId: "session-123",
        timestamp: Date.now(),
        version: "1.0.0",
        data: {
          variables: { count: 10 },
          status: "running",
        },
        checksum: "abc123",
      };

      expect(snapshot.id).toBe("snapshot-1");
      expect(snapshot.scope).toBe("session");
      expect((snapshot.data.variables as { count: number }).count).toBe(10);
    });
  });

  describe("PersistedState", () => {
    it("should create a valid persisted state", () => {
      const state: PersistedState = {
        key: "user-preferences",
        scope: "agent",
        scopeId: "agent-1",
        value: { theme: "dark", language: "en" },
        updatedAt: Date.now(),
      };

      expect(state.key).toBe("user-preferences");
      expect(state.scope).toBe("agent");
      expect((state.value as { theme: string }).theme).toBe("dark");
    });

    it("should support state expiration", () => {
      const now = Date.now();
      const state: PersistedState = {
        key: "temp-cache",
        scope: "global",
        scopeId: "",
        value: { data: "cached" },
        updatedAt: now,
        expiresAt: now + 3600000,
      };

      expect(state.expiresAt).toBeDefined();
      expect(state.expiresAt).toBeGreaterThan(state.updatedAt);
    });

    it("should support state metadata", () => {
      const state: PersistedState = {
        key: "workflow-state",
        scope: "workflow",
        scopeId: "wf-1",
        value: { step: 3 },
        updatedAt: Date.now(),
        metadata: {
          source: "checkpoint",
          nodeId: "node-5",
        },
      };

      expect(state.metadata).toBeDefined();
      expect(state.metadata?.source).toBe("checkpoint");
    });
  });

  describe("RecoveryPoint", () => {
    it("should create a valid recovery point", () => {
      const recoveryPoint: RecoveryPoint = {
        id: "rp-1",
        type: "checkpoint",
        scope: "workflow",
        scopeId: "wf-1",
        timestamp: Date.now(),
        data: {
          currentNodeId: "node-5",
          variables: { count: 10 },
        },
      };

      expect(recoveryPoint.id).toBe("rp-1");
      expect(recoveryPoint.type).toBe("checkpoint");
    });

    it("should support all recovery point types", () => {
      const types: RecoveryPoint["type"][] = ["checkpoint", "snapshot", "backup"];
      expect(types).toHaveLength(3);
    });
  });

  describe("RecoveryPlan", () => {
    it("should create a valid recovery plan", () => {
      const plan: RecoveryPlan = {
        recoveryPointId: "rp-1",
        steps: [
          {
            order: 1,
            action: "restore_state",
            target: "workflow-1",
            params: { checkpointId: "cp-1" },
          },
          {
            order: 2,
            action: "resume_workflow",
            target: "workflow-1",
            params: { nodeId: "node-5" },
          },
        ],
        estimatedDuration: 5000,
        riskLevel: "low",
      };

      expect(plan.steps).toHaveLength(2);
      expect(plan.riskLevel).toBe("low");
    });

    it("should support all recovery actions", () => {
      const actions: RecoveryPlan["steps"][0]["action"][] = [
        "restore_state",
        "restart_agent",
        "resume_workflow",
        "replay_events",
      ];
      expect(actions).toHaveLength(4);
    });

    it("should support all risk levels", () => {
      const levels: RecoveryPlan["riskLevel"][] = ["low", "medium", "high"];
      expect(levels).toHaveLength(3);
    });
  });

  describe("PersistenceConfig", () => {
    it("should create a valid config", () => {
      const config: PersistenceConfig = {
        backend: "file",
        basePath: "/tmp/persistence",
        enableEncryption: false,
        autoSave: true,
        autoSaveInterval: 60000,
        maxBackups: 10,
      };

      expect(config.backend).toBe("file");
      expect(config.autoSave).toBe(true);
    });

    it("should support all storage backends", () => {
      const backends: PersistenceConfig["backend"][] = ["file", "sqlite", "memory"];
      expect(backends).toHaveLength(3);
    });

    it("should support encryption config", () => {
      const config: PersistenceConfig = {
        backend: "sqlite",
        basePath: "/tmp/persistence",
        enableEncryption: true,
        encryptionKey: "secret-key-123",
        autoSave: true,
        autoSaveInterval: 30000,
        maxBackups: 5,
      };

      expect(config.enableEncryption).toBe(true);
      expect(config.encryptionKey).toBe("secret-key-123");
    });
  });

  describe("Checkpoint", () => {
    it("should create a valid checkpoint", () => {
      const checkpoint: Checkpoint = {
        id: "cp-1",
        executionId: "exec-1",
        nodeId: "node-5",
        timestamp: Date.now(),
        variables: {
          count: 10,
          items: ["a", "b", "c"],
        },
        nodeStates: {
          "node-1": { status: "completed" },
          "node-2": { status: "completed" },
          "node-3": { status: "completed" },
          "node-4": { status: "completed" },
          "node-5": { status: "running" },
        },
      };

      expect(checkpoint.id).toBe("cp-1");
      expect(checkpoint.executionId).toBe("exec-1");
      expect(checkpoint.nodeId).toBe("node-5");
      expect(checkpoint.variables.count).toBe(10);
    });
  });
});
