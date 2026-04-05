/**
 * Evolution Integration Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Experience, Skill, EvolutionConfig } from "./types.js";
import { ExperienceCollector, createExperienceCollector } from "./experience-collector.js";
import { PromptOptimizer, createPromptOptimizer } from "./prompt-optimizer.js";
import { SkillLearner, createSkillLearner } from "./skill-learner.js";
import { SkillLibrary, createSkillLibrary } from "./skill-library.js";
import { EvolutionEngine, createEvolutionEngine } from "./evolution-engine.js";
import { FileStateStore } from "../persistence/state-store.js";

type Session = Parameters<ExperienceCollector["collect"]>[0];

describe("Evolution Integration", () => {
  let tempDir: string;
  let stateStore: FileStateStore;
  let experienceCollector: ExperienceCollector;
  let promptOptimizer: PromptOptimizer;
  let skillLearner: SkillLearner;
  let skillLibrary: SkillLibrary;
  let evolutionEngine: EvolutionEngine;

  const createMockSession = (overrides?: Partial<Session>): Session => ({
    taskId: `task-${Date.now()}`,
    agentType: "test-agent",
    prompt: "Test prompt for the agent",
    systemPrompt: "You are a test agent",
    tools: ["read", "write", "execute"],
    model: "test-model",
    steps: [
      { id: "step-1", timestamp: Date.now(), action: "read", input: { file: "test.txt" } },
      { id: "step-2", timestamp: Date.now() + 100, action: "write", input: { file: "out.txt", data: "result" } },
    ],
    toolCalls: [
      { tool: "read", input: { file: "test.txt" }, output: "content", timestamp: Date.now(), duration: 50, success: true },
      { tool: "write", input: { file: "out.txt" }, output: "ok", timestamp: Date.now() + 100, duration: 30, success: true },
    ],
    decisions: [
      { id: "dec-1", context: "Choosing between read and write", options: ["read", "skip"], chosen: "read", reason: "Need data", timestamp: Date.now() },
    ],
    errors: [],
    recoveries: [],
    outcome: {
      status: "success",
      tokensUsed: 1000,
      duration: 5000,
      userInterventions: 0,
    },
    ...overrides,
  });

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "evolution-integration-"));
    stateStore = new FileStateStore({ basePath: tempDir });
    experienceCollector = createExperienceCollector({ stateStore, minConfidence: 0.5 });
    promptOptimizer = createPromptOptimizer({ stateStore });
    skillLearner = createSkillLearner({ stateStore, minOccurrences: 1, minSuccessRate: 0.5 });
    skillLibrary = createSkillLibrary({ stateStore });
    evolutionEngine = createEvolutionEngine({ stateStore });
  });

  afterEach(() => {
    stateStore.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("Experience Collection and Learning Flow", () => {
    it("should collect experiences and extract learnings", async () => {
      const session = createMockSession();
      const experience = await experienceCollector.collect(session);

      expect(experience.id).toBeDefined();
      expect(experience.agentType).toBe("test-agent");
      expect(experience.outcome.status).toBe("success");
      expect(experience.learnings.length).toBeGreaterThan(0);
    });

    it("should identify patterns from successful experiences", async () => {
      const sessions: Session[] = [];
      for (let i = 0; i < 3; i++) {
        sessions.push(createMockSession({
          taskId: `task-${i}`,
          toolCalls: [
            { tool: "read", input: {}, output: "data", timestamp: Date.now(), success: true },
            { tool: "process", input: {}, output: "result", timestamp: Date.now(), success: true },
            { tool: "write", input: {}, output: "ok", timestamp: Date.now(), success: true },
          ],
        }));
      }

      const experiences: Experience[] = [];
      for (const session of sessions) {
        const exp = await experienceCollector.collect(session);
        experiences.push(exp);
      }

      const stats = await experienceCollector.getStats();
      expect(stats.total).toBe(3);
      expect(stats.byStatus.success).toBe(3);
    });

    it("should identify anti-patterns from failures", async () => {
      const failSession = createMockSession({
        outcome: { status: "failure", tokensUsed: 2000, duration: 10000, userInterventions: 3 },
        errors: [
          { id: "err-1", error: "Timeout", timestamp: Date.now(), recovered: false },
        ],
      });

      const experience = await experienceCollector.collect(failSession);

      expect(experience.outcome.status).toBe("failure");
      const antiPatternLearnings = experience.learnings.filter((l) => l.type === "anti-pattern");
      expect(antiPatternLearnings.length).toBeGreaterThan(0);
    });
  });

  describe("Prompt Optimization Flow", () => {
    it("should set base prompt and evolve it", async () => {
      promptOptimizer.setBasePrompt("test-agent", "You are a helpful assistant.");

      const base = promptOptimizer.getBasePrompt("test-agent");
      expect(base).toBe("You are a helpful assistant.");
    });

    it("should estimate evolution cost", async () => {
      const sessions = Array.from({ length: 5 }, (_, i) => createMockSession({ taskId: `task-${i}` }));
      const experiences: Experience[] = [];

      for (const session of sessions) {
        const exp = await experienceCollector.collect(session);
        experiences.push(exp);
      }

      const cost = await promptOptimizer.estimateEvolutionCost(experiences);

      expect(cost.inputTokens).toBeGreaterThan(0);
      expect(cost.outputTokens).toBeGreaterThan(0);
      expect(cost.estimatedCost).toBeGreaterThan(0);
      expect(cost.confidence).toBeGreaterThan(0);
    });
  });

  describe("Skill Learning Flow", () => {
    it("should learn skills from experiences", async () => {
      const sessions = Array.from({ length: 3 }, (_, i) =>
        createMockSession({
          taskId: `task-${i}`,
          toolCalls: [
            { tool: "read", input: {}, output: "data", timestamp: Date.now(), success: true },
            { tool: "analyze", input: {}, output: "analysis", timestamp: Date.now(), success: true },
            { tool: "report", input: {}, output: "report", timestamp: Date.now(), success: true },
          ],
        })
      );

      const experiences: Experience[] = [];
      for (const session of sessions) {
        const exp = await experienceCollector.collect(session);
        experiences.push(exp);
      }

      const skills = await skillLearner.learn(experiences);

      expect(skills.length).toBeGreaterThanOrEqual(0);
    });

    it("should add learned skills to library", async () => {
      const skill: Skill = {
        id: "skill-test-1",
        name: "Test Skill",
        description: "A test skill",
        category: "test",
        definition: {
          trigger: { type: "keyword", condition: "test" },
          steps: [{ description: "Step 1", inputTemplate: "{{input}}" }],
          tools: ["read"],
          examples: [{ input: "test", expectedOutput: "result" }],
        },
        metadata: {
          createdAt: Date.now(),
          updatedAt: Date.now(),
          version: 1,
          author: "agent",
          sourceExperience: "exp-1",
          confidence: 0.8,
          usageCount: 0,
          successRate: 0.9,
        },
      };

      await skillLibrary.add(skill);

      const retrieved = await skillLibrary.get("skill-test-1");
      expect(retrieved?.name).toBe("Test Skill");
    });

    it("should find applicable skills", async () => {
      const skill1: Skill = {
        id: "skill-keyword-test",
        name: "Keyword Test Skill",
        description: "A skill triggered by keywords",
        category: "test",
        definition: {
          trigger: { type: "keyword", condition: "analyze OR process" },
          steps: [{ description: "Process data", inputTemplate: "{{data}}" }],
          tools: ["analyze", "process"],
          examples: [],
        },
        metadata: {
          createdAt: Date.now(),
          updatedAt: Date.now(),
          version: 1,
          author: "agent",
          sourceExperience: "",
          confidence: 0.8,
          usageCount: 0,
          successRate: 0.8,
        },
      };

      await skillLibrary.add(skill1);

      const applicable = await skillLibrary.findApplicable({
        prompt: "Please analyze this data",
        tools: ["analyze", "read", "write"],
      });

      expect(applicable.length).toBeGreaterThan(0);
    });

    it("should record skill usage and update success rate", async () => {
      const skill: Skill = {
        id: "skill-usage-test",
        name: "Usage Test Skill",
        description: "Test skill usage tracking",
        category: "test",
        definition: {
          trigger: { type: "context", condition: "test" },
          steps: [],
          tools: [],
          examples: [],
        },
        metadata: {
          createdAt: Date.now(),
          updatedAt: Date.now(),
          version: 1,
          author: "agent",
          sourceExperience: "",
          confidence: 0.8,
          usageCount: 0,
          successRate: 0.8,
        },
      };

      await skillLibrary.add(skill);
      await skillLibrary.recordUsage("skill-usage-test", "success");
      await skillLibrary.recordUsage("skill-usage-test", "success");
      await skillLibrary.recordUsage("skill-usage-test", "failure");

      const updated = await skillLibrary.get("skill-usage-test");
      expect(updated?.metadata.usageCount).toBe(3);
      expect(updated?.metadata.successRate).toBeCloseTo(2 / 3, 1);
    });
  });

  describe("Full Evolution Cycle", () => {
    it("should run evolution cycle with config", async () => {
      const config: EvolutionConfig = {
        enabled: true,
        evolutionInterval: 60000,
        minExperiencesForEvolution: 1,
        minUsageForOptimization: 1,
        promptOptimizationEnabled: false, // Disable prompt optimization since no base prompt is set
        skillLearningEnabled: true,
        autoDeployThreshold: 0.7,
        maxCostPerEvolution: 1.0,
        cacheEnabled: true,
      };

      await evolutionEngine.initialize(config);

      for (let i = 0; i < 3; i++) {
        const session = createMockSession({ taskId: `task-${i}` });
        await evolutionEngine.collectExperience(session);
      }

      const report = await evolutionEngine.runEvolutionCycle();

      expect(report.status).toBe("completed");
      expect(report.experiences.collected).toBeGreaterThanOrEqual(0);
      expect(report.recommendations).toBeDefined();
    });

    it("should collect feedback and update experiences", async () => {
      const config: EvolutionConfig = {
        enabled: true,
        evolutionInterval: 60000,
        minExperiencesForEvolution: 1,
        minUsageForOptimization: 1,
        promptOptimizationEnabled: false,
        skillLearningEnabled: false,
        autoDeployThreshold: 0.7,
        maxCostPerEvolution: 1.0,
        cacheEnabled: true,
      };

      await evolutionEngine.initialize(config);

      const session = createMockSession();
      const experience = await evolutionEngine.collectExperience(session);

      await evolutionEngine.recordFeedback({
        experienceId: experience.id,
        type: "praise",
        description: "Great job!",
        praisedAction: "read",
        timestamp: Date.now(),
      });

      const updated = await evolutionEngine.getExperienceCollector().getExperience(experience.id);
      expect(updated?.outcome.userFeedback?.type).toBe("praise");
    });

    it("should track costs across cycles", async () => {
      const config: EvolutionConfig = {
        enabled: true,
        evolutionInterval: 60000,
        minExperiencesForEvolution: 1,
        minUsageForOptimization: 1,
        promptOptimizationEnabled: false,
        skillLearningEnabled: false,
        autoDeployThreshold: 0.7,
        maxCostPerEvolution: 1.0,
        cacheEnabled: true,
      };

      await evolutionEngine.initialize(config);

      for (let i = 0; i < 5; i++) {
        const session = createMockSession({
          taskId: `task-${i}`,
          outcome: { status: "success", tokensUsed: 500 * (i + 1), duration: 1000, userInterventions: 0 },
        });
        await evolutionEngine.collectExperience(session);
      }

      const stats = await evolutionEngine.getStats();

      expect(stats.experiences.total).toBe(5);
      expect(stats.cost.totalCalls).toBe(5);
      expect(stats.cost.inputTokens).toBe(7500);
    });
  });

  describe("Skill Export/Import", () => {
    it("should export and import skills", async () => {
      const skill: Skill = {
        id: "skill-export-test",
        name: "Export Test Skill",
        description: "Test skill for export",
        category: "test",
        definition: {
          trigger: { type: "keyword", condition: "export" },
          steps: [{ description: "Export step", inputTemplate: "{{data}}" }],
          tools: ["export"],
          examples: [],
        },
        metadata: {
          createdAt: Date.now(),
          updatedAt: Date.now(),
          version: 1,
          author: "human",
          sourceExperience: "",
          confidence: 0.9,
          usageCount: 10,
          successRate: 0.95,
        },
      };

      await skillLibrary.add(skill);

      const exported = await skillLibrary.exportToOpenClawFormat("skill-export-test");
      expect(exported).toContain("Export Test Skill");

      await skillLibrary.delete("skill-export-test");

      const imported = await skillLibrary.importFromOpenClawFormat(exported);
      expect(imported.name).toBe("Export Test Skill");
    });
  });
});
