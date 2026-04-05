import { describe, it, expect } from "vitest";
import type {
  Experience,
  Learning,
  Skill,
  PromptVariant,
  PromptMutation,
  EvolutionReport,
  EvolutionConfig,
} from "./types.js";

describe("Evolution Types", () => {
  describe("Experience", () => {
    it("should create a valid experience", () => {
      const experience: Experience = {
        id: "exp-1",
        timestamp: Date.now(),
        taskId: "task-1",
        agentType: "worker",
        context: {
          prompt: "Write a function",
          systemPrompt: "You are a coder",
          tools: ["code", "test"],
          model: "claude-3-sonnet",
        },
        execution: {
          steps: [],
          toolCalls: [],
          decisions: [],
          errors: [],
          recoveries: [],
        },
        outcome: {
          status: "success",
          metrics: {
            tokensUsed: 1000,
            duration: 5000,
            toolCallsCount: 5,
            errorCount: 0,
            retryCount: 0,
            userInterventions: 0,
          },
        },
        learnings: [],
      };

      expect(experience.id).toBe("exp-1");
      expect(experience.outcome.status).toBe("success");
      expect(experience.outcome.metrics.tokensUsed).toBe(1000);
    });

    it("should support partial and failure outcomes", () => {
      const partialExperience: Experience = {
        id: "exp-2",
        timestamp: Date.now(),
        taskId: "task-2",
        agentType: "coordinator",
        context: {
          prompt: "Coordinate tasks",
          systemPrompt: "You are a coordinator",
          tools: ["assign", "monitor"],
          model: "claude-3-sonnet",
        },
        execution: {
          steps: [],
          toolCalls: [],
          decisions: [],
          errors: [{ id: "err-1", error: "Timeout", timestamp: Date.now(), recovered: false }],
          recoveries: [],
        },
        outcome: {
          status: "partial",
          metrics: {
            tokensUsed: 500,
            duration: 3000,
            toolCallsCount: 2,
            errorCount: 1,
            retryCount: 1,
            userInterventions: 1,
          },
        },
        learnings: [],
      };

      expect(partialExperience.outcome.status).toBe("partial");
      expect(partialExperience.execution.errors).toHaveLength(1);
    });
  });

  describe("Learning", () => {
    it("should create a valid learning", () => {
      const learning: Learning = {
        type: "pattern",
        category: "code-quality",
        description: "Use descriptive variable names",
        evidence: ["task-1", "task-2"],
        confidence: 0.85,
        applicableScenarios: ["writing-functions", "refactoring"],
      };

      expect(learning.type).toBe("pattern");
      expect(learning.confidence).toBe(0.85);
    });

    it("should support all learning types", () => {
      const types: Learning["type"][] = [
        "pattern",
        "anti-pattern",
        "optimization",
        "user-feedback",
      ];

      expect(types).toHaveLength(4);
    });
  });

  describe("Skill", () => {
    it("should create a valid skill", () => {
      const skill: Skill = {
        id: "skill-1",
        name: "code-review",
        description: "Review code for quality and bugs",
        category: "quality",
        definition: {
          trigger: {
            type: "keyword",
            condition: "review code",
          },
          steps: [
            {
              description: "Analyze code structure",
              inputTemplate: "Analyze ${code}",
            },
            {
              description: "Check for common issues",
              inputTemplate: "Check ${code} for issues",
            },
          ],
          tools: ["code", "analyze"],
          examples: [
            {
              input: "Review this function",
              expectedOutput: "The function has X issues...",
            },
          ],
        },
        metadata: {
          createdAt: Date.now(),
          updatedAt: Date.now(),
          version: 1,
          author: "agent",
          sourceExperience: "exp-1",
          confidence: 0.9,
          usageCount: 0,
          successRate: 0.85,
        },
      };

      expect(skill.id).toBe("skill-1");
      expect(skill.definition.steps).toHaveLength(2);
      expect(skill.metadata.confidence).toBe(0.9);
    });
  });

  describe("PromptVariant", () => {
    it("should create a valid prompt variant", () => {
      const variant: PromptVariant = {
        id: "variant-1",
        basePrompt: "You are an assistant",
        mutations: [
          {
            type: "addition",
            section: "instructions",
            mutated: "You are a helpful assistant",
            rationale: "Add helpfulness trait",
          },
        ],
        performance: {
          score: 0.85,
          samples: 10,
        },
        generation: 1,
        createdAt: Date.now(),
      };

      expect(variant.id).toBe("variant-1");
      expect(variant.mutations).toHaveLength(1);
      expect(variant.performance.score).toBe(0.85);
    });
  });

  describe("PromptMutation", () => {
    it("should support all mutation types", () => {
      const types: PromptMutation["type"][] = [
        "addition",
        "deletion",
        "modification",
        "reordering",
      ];

      expect(types).toHaveLength(4);
    });
  });

  describe("EvolutionReport", () => {
    it("should create a valid evolution report", () => {
      const report: EvolutionReport = {
        id: "report-1",
        timestamp: Date.now(),
        agentType: "worker",
        status: "completed",
        experiences: {
          collected: 100,
          analyzed: 95,
        },
        prompts: {
          optimized: 3,
          deployed: 2,
        },
        skills: {
          learned: 5,
          optimized: 3,
        },
        recommendations: [],
        cost: {
          totalCalls: 150,
          inputTokens: 300000,
          outputTokens: 50000,
          totalCost: 1.25,
        },
      };

      expect(report.status).toBe("completed");
      expect(report.experiences.collected).toBe(100);
      expect(report.cost.totalCost).toBe(1.25);
    });
  });

  describe("EvolutionConfig", () => {
    it("should create a valid evolution config", () => {
      const config: EvolutionConfig = {
        enabled: true,
        evolutionInterval: 7 * 24 * 60 * 60 * 1000,
        minExperiencesForEvolution: 100,
        minUsageForOptimization: 50,
        promptOptimizationEnabled: true,
        skillLearningEnabled: true,
        autoDeployThreshold: 0.05,
        maxCostPerEvolution: 2.0,
        cacheEnabled: true,
      };

      expect(config.enabled).toBe(true);
      expect(config.evolutionInterval).toBe(604800000);
    });
  });
});
