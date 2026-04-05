/**
 * Orchestrator Integration Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Orchestrator, createOrchestrator } from "./orchestrator.js";
import { FileStateStore } from "../persistence/state-store.js";
import { RecoveryManager } from "../persistence/recovery-manager.js";
import { CheckpointManager } from "../persistence/checkpoint-manager.js";
import type { OrchestratorConfig, TaskDefinition, TaskResult } from "./types.js";

describe("Orchestrator Integration", () => {
  let tempDir: string;
  let stateStore: FileStateStore;
  let checkpointManager: CheckpointManager;
  let recoveryManager: RecoveryManager;
  let orchestrator: Orchestrator;

  const createConfig = (): OrchestratorConfig => ({
    mode: "coordinator-worker",
    maxAgents: 10,
    taskTimeout: 300000,
    heartbeatInterval: 30000,
    retryDelay: 5000,
    maxRetries: 3,
  });

  const createTask = (overrides?: Partial<TaskDefinition>): TaskDefinition => ({
    id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    prompt: "Test task",
    priority: "normal",
    ...overrides,
  });

  const createTaskResult = (taskId: string, agentId: string): TaskResult => ({
    taskId,
    agentId,
    status: "completed",
    output: { result: "success" },
    duration: 1000,
  });

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "orchestrator-integration-"));
    stateStore = new FileStateStore({ basePath: tempDir });
    checkpointManager = new CheckpointManager({ basePath: tempDir });
    recoveryManager = new RecoveryManager({ basePath: tempDir, stateStore });
    orchestrator = createOrchestrator({ stateStore, checkpointManager });
  });

  afterEach(async () => {
    await orchestrator.shutdown();
    stateStore.close();
    checkpointManager.close();
    recoveryManager.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("Initialization and Shutdown", () => {
    it("should initialize and shutdown correctly", async () => {
      const config = createConfig();
      await orchestrator.initialize(config);

      const state = await orchestrator.getState();
      expect(state.agents.size).toBe(0);
      expect(state.tasks.size).toBe(0);
      expect(state.teams.size).toBe(0);

      await orchestrator.shutdown();
    });

    it("should throw error when not initialized", async () => {
      const task = createTask();
      await expect(orchestrator.submitTask(task)).rejects.toThrow("not initialized");
    });

    it("should support dependency injection", async () => {
      orchestrator.setStateStore(stateStore);
      orchestrator.setRecoveryManager(recoveryManager);
      orchestrator.setCheckpointManager(checkpointManager);

      await orchestrator.initialize(createConfig());
      await orchestrator.shutdown();
    });
  });

  describe("Agent Management", () => {
    beforeEach(async () => {
      await orchestrator.initialize(createConfig());
    });

    it("should register and unregister agents", async () => {
      const agentManager = orchestrator.getAgentManager();

      const agentId = await agentManager.registerAgent({
        id: "agent-1",
        role: "worker",
        status: "idle",
        capabilities: ["read", "write"],
        maxConcurrentTasks: 5,
        currentTasks: 0,
      });

      expect(agentId).toBe("agent-1");

      const agent = await agentManager.getAgent(agentId);
      expect(agent?.role).toBe("worker");
      expect(agent?.capabilities).toContain("read");

      await agentManager.unregisterAgent(agentId);

      const deleted = await agentManager.getAgent(agentId);
      expect(deleted).toBeUndefined();
    });

    it("should list agents with filters", async () => {
      const agentManager = orchestrator.getAgentManager();

      await agentManager.registerAgent({
        id: "agent-1",
        role: "coordinator",
        status: "idle",
        capabilities: [],
        maxConcurrentTasks: 10,
        currentTasks: 0,
      });

      await agentManager.registerAgent({
        id: "agent-2",
        role: "worker",
        status: "busy",
        capabilities: [],
        maxConcurrentTasks: 5,
        currentTasks: 2,
      });

      const allAgents = await agentManager.listAgents();
      expect(allAgents.length).toBe(2);

      const workers = await agentManager.listAgents({ role: "worker" });
      expect(workers.length).toBe(1);
      expect(workers[0].id).toBe("agent-2");

      const idleAgents = await agentManager.listAgents({ status: "idle" });
      expect(idleAgents.length).toBe(1);
    });

    it("should process heartbeats", async () => {
      const agentManager = orchestrator.getAgentManager();

      await agentManager.registerAgent({
        id: "agent-1",
        role: "worker",
        status: "idle",
        capabilities: [],
        maxConcurrentTasks: 5,
        currentTasks: 0,
      });

      await agentManager.processHeartbeat({
        agentId: "agent-1",
        timestamp: Date.now(),
        status: "busy",
        currentTasks: 3,
        metrics: { cpuUsage: 50, memoryUsage: 60 },
      });

      const agent = await agentManager.getAgent("agent-1");
      expect(agent?.status).toBe("busy");
      expect(agent?.currentTasks).toBe(3);
    });
  });

  describe("Task Management", () => {
    beforeEach(async () => {
      await orchestrator.initialize(createConfig());
    });

    it("should submit and track tasks", async () => {
      const task = createTask({ prompt: "Test task 1" });

      const taskId = await orchestrator.submitTask(task);
      expect(taskId).toBe(task.id);

      const taskStatus = await orchestrator.getTaskStatus(taskId);
      expect(taskStatus?.status).toBe("pending");
      expect(taskStatus?.definition.prompt).toBe("Test task 1");
    });

    it("should cancel tasks", async () => {
      const task = createTask();
      await orchestrator.submitTask(task);

      await orchestrator.cancelTask(task.id);

      const taskStatus = await orchestrator.getTaskStatus(task.id);
      expect(taskStatus?.status).toBe("cancelled");
    });

    it("should handle task priorities", async () => {
      const lowTask = createTask({ id: "task-low", priority: "low" });
      const normalTask = createTask({ id: "task-normal", priority: "normal" });
      const highTask = createTask({ id: "task-high", priority: "high" });
      const urgentTask = createTask({ id: "task-urgent", priority: "urgent" });

      await orchestrator.submitTask(lowTask);
      await orchestrator.submitTask(normalTask);
      await orchestrator.submitTask(urgentTask);
      await orchestrator.submitTask(highTask);

      const taskQueue = orchestrator.getTaskQueue();
      const size = await taskQueue.size();
      expect(size).toBe(4);

      const peeked = await taskQueue.peek();
      expect(peeked?.definition.priority).toBe("urgent");
    });

    it("should assign and complete tasks", async () => {
      const agentManager = orchestrator.getAgentManager();
      await agentManager.registerAgent({
        id: "agent-1",
        role: "worker",
        status: "idle",
        capabilities: ["read", "write"],
        maxConcurrentTasks: 5,
        currentTasks: 0,
      });

      const task = createTask();
      await orchestrator.submitTask(task);

      const nextTask = await orchestrator.processNextTask();
      expect(nextTask).toBeDefined();
      expect(nextTask?.assignedAgent).toBe("agent-1");

      const result = createTaskResult(task.id, "agent-1");
      await orchestrator.completeTask(task.id, result);

      const taskStatus = await orchestrator.getTaskStatus(task.id);
      expect(taskStatus?.status).toBe("completed");
      expect(taskStatus?.result?.output).toEqual({ result: "success" });
    });

    it("should handle task dependencies", async () => {
      const taskQueue = orchestrator.getTaskQueue();

      const task1 = createTask({ id: "task-1", dependencies: [] });
      const task2 = createTask({ id: "task-2", dependencies: ["task-1"] });
      const task3 = createTask({ id: "task-3", dependencies: ["task-2"] });

      await taskQueue.enqueue(task1);
      await taskQueue.enqueue(task2);
      await taskQueue.enqueue(task3);

      expect(taskQueue.areDependenciesMet("task-1")).toBe(true);
      expect(taskQueue.areDependenciesMet("task-2")).toBe(false);
      expect(taskQueue.areDependenciesMet("task-3")).toBe(false);
    });
  });

  describe("Team Management", () => {
    beforeEach(async () => {
      await orchestrator.initialize(createConfig());
    });

    it("should create and manage teams", async () => {
      const teamManager = orchestrator.getTeamManager();

      const team = await teamManager.createTeam("Development Team", "teammate");
      expect(team.name).toBe("Development Team");
      expect(team.mode).toBe("teammate");
      expect(team.members).toHaveLength(0);

      await teamManager.addMember(team.id, "agent-1");
      await teamManager.addMember(team.id, "agent-2");

      const updated = await teamManager.getTeam(team.id);
      expect(updated?.members).toHaveLength(2);

      await teamManager.setLeader(team.id, "agent-1");
      const withLeader = await teamManager.getTeam(team.id);
      expect(withLeader?.leaderId).toBe("agent-1");

      await teamManager.removeMember(team.id, "agent-2");
      const afterRemoval = await teamManager.getTeam(team.id);
      expect(afterRemoval?.members).toHaveLength(1);

      await teamManager.deleteTeam(team.id);
      const deleted = await teamManager.getTeam(team.id);
      expect(deleted).toBeUndefined();
    });

    it("should list teams", async () => {
      const teamManager = orchestrator.getTeamManager();

      await teamManager.createTeam("Team 1", "coordinator-worker");
      await teamManager.createTeam("Team 2", "teammate");
      await teamManager.createTeam("Team 3", "swarm");

      const teams = await teamManager.listTeams();
      expect(teams.length).toBe(3);
    });
  });

  describe("Messaging", () => {
    beforeEach(async () => {
      await orchestrator.initialize(createConfig());
    });

    it("should send direct messages", async () => {
      const received: unknown[] = [];

      orchestrator.registerMessageHandler("agent-2", async (message) => {
        received.push(message);
      });

      await orchestrator.sendMessage("agent-1", "agent-2", { type: "test", data: "hello" });

      expect(received.length).toBe(1);
      expect((received[0] as { type: string }).type).toBe("direct");
    });

    it("should broadcast messages to team", async () => {
      const teamManager = orchestrator.getTeamManager();
      const team = await teamManager.createTeam("Test Team", "teammate");

      await teamManager.addMember(team.id, "agent-1");
      await teamManager.addMember(team.id, "agent-2");
      await teamManager.addMember(team.id, "agent-3");

      const received: string[] = [];

      orchestrator.registerMessageHandler("agent-1", async () => { received.push("agent-1"); });
      orchestrator.registerMessageHandler("agent-2", async () => { received.push("agent-2"); });
      orchestrator.registerMessageHandler("agent-3", async () => { received.push("agent-3"); });

      await orchestrator.broadcastMessage(team.id, { type: "announcement" });

      expect(received.length).toBe(3);
    });
  });

  describe("Persistence", () => {
    beforeEach(async () => {
      orchestrator.setStateStore(stateStore);
      await orchestrator.initialize(createConfig());
    });

    it("should save and load state", async () => {
      const agentManager = orchestrator.getAgentManager();
      await agentManager.registerAgent({
        id: "agent-1",
        role: "worker",
        status: "idle",
        capabilities: ["read"],
        maxConcurrentTasks: 5,
        currentTasks: 0,
      });

      const task = createTask();
      await orchestrator.submitTask(task);

      await orchestrator.saveState();

      await orchestrator.shutdown();
      orchestrator = createOrchestrator({ stateStore, checkpointManager });
      await orchestrator.initialize(createConfig());

      const state = await orchestrator.getState();
      expect(state.agents.size).toBe(1);
    });

    it("should create and use recovery points", async () => {
      const agentManager = orchestrator.getAgentManager();
      await agentManager.registerAgent({
        id: "agent-1",
        role: "worker",
        status: "idle",
        capabilities: [],
        maxConcurrentTasks: 5,
        currentTasks: 0,
      });

      orchestrator.setRecoveryManager(recoveryManager);

      const recoveryPointId = await orchestrator.createRecoveryPoint();
      expect(recoveryPointId).toBeDefined();
    });
  });

  describe("State Management", () => {
    beforeEach(async () => {
      await orchestrator.initialize(createConfig());
    });

    it("should return current state", async () => {
      const agentManager = orchestrator.getAgentManager();
      const taskQueue = orchestrator.getTaskQueue();
      const teamManager = orchestrator.getTeamManager();

      await agentManager.registerAgent({
        id: "agent-1",
        role: "worker",
        status: "idle",
        capabilities: [],
        maxConcurrentTasks: 5,
        currentTasks: 0,
      });

      await taskQueue.enqueue(createTask({ id: "task-1" }));
      await teamManager.createTeam("Team 1", "teammate");

      const state = await orchestrator.getState();

      expect(state.agents.size).toBe(1);
      expect(state.tasks.size).toBe(1);
      expect(state.teams.size).toBe(1);
      expect(state.taskQueue.length).toBe(1);
    });
  });
});
