import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AgentManager } from "./agent-manager.js";
import type { AgentInfo, AgentRole, AgentStatus, Heartbeat } from "./types.js";

describe("AgentManager", () => {
  let manager: AgentManager;

  beforeEach(() => {
    manager = new AgentManager({ heartbeatTimeout: 60000 });
  });

  describe("registerAgent", () => {
    it("should register a new agent with generated id", async () => {
      const agentId = await manager.registerAgent({
        id: "",
        role: "worker",
        status: "idle",
        capabilities: ["code", "test"],
        maxConcurrentTasks: 3,
        currentTasks: 0,
      });

      expect(agentId).toBeDefined();
      expect(agentId).toMatch(/^agent-/);

      const agent = await manager.getAgent(agentId);
      expect(agent).toBeDefined();
      expect(agent?.role).toBe("worker");
      expect(agent?.status).toBe("idle");
      expect(agent?.createdAt).toBeDefined();
      expect(agent?.lastHeartbeat).toBeDefined();
    });

    it("should register a new agent with specified id", async () => {
      const agentId = await manager.registerAgent({
        id: "test-agent-1",
        role: "coordinator",
        status: "idle",
        capabilities: ["orchestrate"],
        maxConcurrentTasks: 10,
        currentTasks: 0,
      });

      expect(agentId).toBe("test-agent-1");
    });

    it("should track agent capabilities", async () => {
      const agentId = await manager.registerAgent({
        id: "capable-agent",
        role: "worker",
        status: "idle",
        capabilities: ["code", "test", "deploy"],
        maxConcurrentTasks: 5,
        currentTasks: 0,
      });

      const agent = await manager.getAgent(agentId);
      expect(agent?.capabilities).toEqual(["code", "test", "deploy"]);
    });
  });

  describe("unregisterAgent", () => {
    it("should unregister an existing agent", async () => {
      const agentId = await manager.registerAgent({
        id: "to-remove",
        role: "worker",
        status: "idle",
        capabilities: [],
        maxConcurrentTasks: 1,
        currentTasks: 0,
      });

      await manager.unregisterAgent(agentId);
      const agent = await manager.getAgent(agentId);
      expect(agent).toBeUndefined();
    });

    it("should not throw when unregistering non-existent agent", async () => {
      await expect(manager.unregisterAgent("non-existent")).resolves.not.toThrow();
    });
  });

  describe("getAgent", () => {
    it("should return undefined for non-existent agent", async () => {
      const agent = await manager.getAgent("non-existent");
      expect(agent).toBeUndefined();
    });

    it("should return agent info for existing agent", async () => {
      await manager.registerAgent({
        id: "existing-agent",
        role: "worker",
        status: "busy",
        capabilities: ["code"],
        maxConcurrentTasks: 2,
        currentTasks: 1,
      });

      const agent = await manager.getAgent("existing-agent");
      expect(agent).toBeDefined();
      expect(agent?.id).toBe("existing-agent");
      expect(agent?.role).toBe("worker");
      expect(agent?.currentTasks).toBe(1);
    });
  });

  describe("listAgents", () => {
    beforeEach(async () => {
      await manager.registerAgent({
        id: "worker-1",
        role: "worker",
        status: "idle",
        capabilities: [],
        maxConcurrentTasks: 3,
        currentTasks: 0,
      });
      await manager.registerAgent({
        id: "worker-2",
        role: "worker",
        status: "busy",
        capabilities: [],
        maxConcurrentTasks: 3,
        currentTasks: 2,
      });
      await manager.registerAgent({
        id: "coordinator-1",
        role: "coordinator",
        status: "idle",
        capabilities: [],
        maxConcurrentTasks: 10,
        currentTasks: 0,
      });
    });

    it("should list all agents without filter", async () => {
      const agents = await manager.listAgents();
      expect(agents).toHaveLength(3);
    });

    it("should filter by role", async () => {
      const workers = await manager.listAgents({ role: "worker" });
      expect(workers).toHaveLength(2);
      expect(workers.every((a) => a.role === "worker")).toBe(true);

      const coordinators = await manager.listAgents({ role: "coordinator" });
      expect(coordinators).toHaveLength(1);
    });

    it("should filter by status", async () => {
      const idleAgents = await manager.listAgents({ status: "idle" });
      expect(idleAgents).toHaveLength(2);

      const busyAgents = await manager.listAgents({ status: "busy" });
      expect(busyAgents).toHaveLength(1);
    });

    it("should filter by role and status", async () => {
      const idleWorkers = await manager.listAgents({
        role: "worker",
        status: "idle",
      });
      expect(idleWorkers).toHaveLength(1);
      expect(idleWorkers[0]?.id).toBe("worker-1");
    });
  });

  describe("updateAgentStatus", () => {
    it("should update agent status", async () => {
      await manager.registerAgent({
        id: "status-agent",
        role: "worker",
        status: "idle",
        capabilities: [],
        maxConcurrentTasks: 3,
        currentTasks: 0,
      });

      await manager.updateAgentStatus("status-agent", "busy");

      const agent = await manager.getAgent("status-agent");
      expect(agent?.status).toBe("busy");
    });

    it("should not throw when updating non-existent agent", async () => {
      await expect(
        manager.updateAgentStatus("non-existent", "idle")
      ).resolves.not.toThrow();
    });
  });

  describe("processHeartbeat", () => {
    it("should process heartbeat and update agent status", async () => {
      await manager.registerAgent({
        id: "heartbeat-agent",
        role: "worker",
        status: "idle",
        capabilities: [],
        maxConcurrentTasks: 3,
        currentTasks: 0,
      });

      const heartbeat: Heartbeat = {
        agentId: "heartbeat-agent",
        timestamp: Date.now(),
        status: "busy",
        currentTasks: 2,
        metrics: {
          cpuUsage: 50,
          memoryUsage: 60,
        },
      };

      await manager.processHeartbeat(heartbeat);

      const agent = await manager.getAgent("heartbeat-agent");
      expect(agent?.status).toBe("busy");
      expect(agent?.currentTasks).toBe(2);
      expect(agent?.lastHeartbeat).toBe(heartbeat.timestamp);
      expect(agent?.metadata?.metrics).toEqual({
        cpuUsage: 50,
        memoryUsage: 60,
      });
    });

    it("should ignore heartbeat for non-existent agent", async () => {
      const heartbeat: Heartbeat = {
        agentId: "non-existent",
        timestamp: Date.now(),
        status: "idle",
        currentTasks: 0,
      };

      await expect(manager.processHeartbeat(heartbeat)).resolves.not.toThrow();
    });
  });

  describe("getAvailableAgents", () => {
    beforeEach(async () => {
      await manager.registerAgent({
        id: "available-1",
        role: "worker",
        status: "idle",
        capabilities: ["code"],
        maxConcurrentTasks: 3,
        currentTasks: 0,
      });
      await manager.registerAgent({
        id: "available-2",
        role: "worker",
        status: "busy",
        capabilities: ["code"],
        maxConcurrentTasks: 3,
        currentTasks: 3,
      });
      await manager.registerAgent({
        id: "available-3",
        role: "coordinator",
        status: "idle",
        capabilities: ["orchestrate"],
        maxConcurrentTasks: 10,
        currentTasks: 0,
      });
    });

    it("should return idle agents with capacity", () => {
      const available = manager.getAvailableAgents();
      expect(available).toHaveLength(2);
      expect(available.map((a) => a.id)).toContain("available-1");
      expect(available.map((a) => a.id)).toContain("available-3");
    });

    it("should filter by role", () => {
      const workers = manager.getAvailableAgents("worker");
      expect(workers).toHaveLength(1);
      expect(workers[0]?.id).toBe("available-1");
    });

    it("should respect maxTasks parameter", () => {
      const available = manager.getAvailableAgents(undefined, 0);
      expect(available).toHaveLength(2);
    });
  });

  describe("checkStaleAgents", () => {
    it("should mark agents as offline when heartbeat times out", async () => {
      const shortTimeoutManager = new AgentManager({ heartbeatTimeout: 100 });
      
      await shortTimeoutManager.registerAgent({
        id: "stale-agent",
        role: "worker",
        status: "idle",
        capabilities: [],
        maxConcurrentTasks: 3,
        currentTasks: 0,
      });

      // Wait for timeout
      await new Promise((resolve) => setTimeout(resolve, 150));

      const staleAgents = shortTimeoutManager.checkStaleAgents();
      expect(staleAgents).toContain("stale-agent");

      const agent = await shortTimeoutManager.getAgent("stale-agent");
      expect(agent?.status).toBe("offline");
    });

    it("should not mark active agents as stale", async () => {
      await manager.registerAgent({
        id: "active-agent",
        role: "worker",
        status: "idle",
        capabilities: [],
        maxConcurrentTasks: 3,
        currentTasks: 0,
      });

      const staleAgents = manager.checkStaleAgents();
      expect(staleAgents).not.toContain("active-agent");

      const agent = await manager.getAgent("active-agent");
      expect(agent?.status).toBe("idle");
    });
  });
});
