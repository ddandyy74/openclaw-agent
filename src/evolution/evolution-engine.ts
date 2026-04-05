/**
 * Evolution Engine Implementation
 * 
 * Core engine for agent self-evolution through experience collection,
 * prompt optimization, and skill learning.
 */

import type {
  EvolutionConfig,
  EvolutionReport,
  Experience,
  Skill,
  PromptVariant,
  Recommendation,
  EvolutionEngineDeps,
  IExperienceCollector,
  IPromptOptimizer,
  ISkillLearner,
  ISkillLibrary,
  UserFeedback,
} from "./types.js";
import type { IStateStore } from "../persistence/types.js";
import { ExperienceCollector, createExperienceCollector } from "./experience-collector.js";
import { PromptOptimizer, createPromptOptimizer } from "./prompt-optimizer.js";
import { SkillLearner, createSkillLearner } from "./skill-learner.js";
import { SkillLibrary, createSkillLibrary } from "./skill-library.js";

type Session = {
  taskId: string;
  agentType: string;
  prompt: string;
  systemPrompt: string;
  tools: string[];
  model: string;
  steps: Array<{
    id: string;
    timestamp: number;
    action: string;
    input: unknown;
    output?: unknown;
    duration?: number;
  }>;
  toolCalls: Array<{
    tool: string;
    input: unknown;
    output?: unknown;
    timestamp: number;
    duration?: number;
    success: boolean;
    error?: string;
  }>;
  decisions: Array<{
    id: string;
    context: string;
    options: string[];
    chosen: string;
    reason?: string;
    timestamp: number;
  }>;
  errors: Array<{
    id: string;
    error: string;
    stack?: string;
    timestamp: number;
    recovered: boolean;
    recoveryAction?: string;
  }>;
  recoveries: Array<{
    errorId: string;
    action: string;
    success: boolean;
    timestamp: number;
  }>;
  outcome: {
    status: "success" | "partial" | "failure";
    tokensUsed: number;
    duration: number;
    userInterventions: number;
  };
};

export class EvolutionEngine {
  private config: EvolutionConfig | null = null;
  private running = false;
  private evolutionTimer: NodeJS.Timeout | null = null;
  private reports: EvolutionReport[] = [];

  private experienceCollector: IExperienceCollector;
  private promptOptimizer: IPromptOptimizer;
  private skillLearner: ISkillLearner;
  private skillLibrary: ISkillLibrary;
  private stateStore: IStateStore | undefined;

  private costTracker = {
    totalCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalCost: 0,
  };

  constructor(options?: EvolutionEngineDeps | { stateStore?: IStateStore }) {
    const deps = options as EvolutionEngineDeps | undefined;
    this.stateStore = deps?.stateStore ?? undefined;
    this.experienceCollector = deps?.experienceCollector ?? createExperienceCollector({ stateStore: this.stateStore });
    this.promptOptimizer = deps?.promptOptimizer ?? createPromptOptimizer({ stateStore: this.stateStore });
    this.skillLearner = deps?.skillLearner ?? createSkillLearner({ stateStore: this.stateStore });
    this.skillLibrary = deps?.skillLibrary ?? createSkillLibrary({ stateStore: this.stateStore });
  }

  async initialize(config: EvolutionConfig): Promise<void> {
    this.config = config;

    if (this.stateStore) {
      await this.loadState();
    }
  }

  async start(): Promise<void> {
    if (!this.config) {
      throw new Error("EvolutionEngine not initialized");
    }

    if (!this.config.enabled) {
      return;
    }

    this.running = true;

    if (this.config.evolutionInterval > 0) {
      this.evolutionTimer = setInterval(() => {
        this.runEvolutionCycle().catch((err) => {
          console.error("Evolution cycle failed:", err);
        });
      }, this.config.evolutionInterval);
    }
  }

  async stop(): Promise<void> {
    this.running = false;

    if (this.evolutionTimer) {
      clearInterval(this.evolutionTimer);
      this.evolutionTimer = null;
    }

    if (this.stateStore) {
      await this.saveState();
    }
  }

  async runEvolutionCycle(): Promise<EvolutionReport> {
    if (!this.config) {
      throw new Error("EvolutionEngine not initialized");
    }

    const reportId = this.generateReportId();
    const startTime = Date.now();

    const report: EvolutionReport = {
      id: reportId,
      timestamp: startTime,
      agentType: "all",
      status: "running",
      experiences: {
        collected: 0,
        analyzed: 0,
      },
      prompts: {
        optimized: 0,
        deployed: 0,
      },
      skills: {
        learned: 0,
        optimized: 0,
      },
      recommendations: [],
      cost: {
        totalCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalCost: 0,
      },
    };

    try {
      const experiences = await this.experienceCollector.getExperiences({
        since: startTime - this.config.evolutionInterval,
      });

      report.experiences.collected = experiences.length;

      if (experiences.length < this.config.minExperiencesForEvolution) {
        report.status = "completed";
        report.experiences.analyzed = 0;
        this.reports.push(report);
        return report;
      }

      report.experiences.analyzed = experiences.length;

      if (this.config.promptOptimizationEnabled) {
        const agentTypes = this.extractAgentTypes(experiences);

        for (const agentType of agentTypes) {
          const agentExperiences = experiences.filter((e) => e.agentType === agentType);

          const variant = await this.promptOptimizer.evolve(agentType, agentExperiences);
          report.prompts.optimized++;

          if (variant.performance.score >= this.config.autoDeployThreshold) {
            await this.promptOptimizer.deploy(agentType, variant);
            report.prompts.deployed++;
          }
        }
      }

      if (this.config.skillLearningEnabled) {
        const newSkills = await this.skillLearner.learn(experiences);
        report.skills.learned = newSkills.length;

        for (const skill of newSkills) {
          await this.skillLibrary.add(skill);
        }

        const existingSkills = await this.skillLibrary.list({
          minUsageCount: this.config.minUsageForOptimization,
        });

        for (const skill of existingSkills) {
          const optimized = await this.skillLearner.optimize(skill.id, experiences);
          if (optimized && optimized.metadata.successRate > skill.metadata.successRate) {
            report.skills.optimized++;
          }
        }
      }

      report.recommendations = this.generateRecommendations(experiences, report);

      report.cost = {
        totalCalls: this.costTracker.totalCalls,
        inputTokens: this.costTracker.inputTokens,
        outputTokens: this.costTracker.outputTokens,
        totalCost: this.costTracker.totalCost,
      };

      report.status = "completed";
    } catch (error) {
      report.status = "failed";
      report.recommendations.push({
        type: "performance",
        priority: "high",
        description: `Evolution cycle failed: ${error instanceof Error ? error.message : String(error)}`,
        suggestedAction: "Check error logs and retry",
        evidence: [],
      });
    }

    report.cost.totalCost = this.calculateCost(
      report.cost.inputTokens,
      report.cost.outputTokens
    );

    this.reports.push(report);

    if (this.stateStore) {
      await this.stateStore.set(report.id, report, "agent", "evolution-reports");
    }

    return report;
  }

  async collectExperience(session: Session): Promise<Experience> {
    if (!this.config?.enabled) {
      throw new Error("Evolution engine is disabled");
    }

    const experience = await this.experienceCollector.collect(session);

    this.costTracker.totalCalls++;
    this.costTracker.inputTokens += experience.outcome.metrics.tokensUsed;

    return experience;
  }

  async recordFeedback(feedback: UserFeedback): Promise<void> {
    await this.experienceCollector.collectFeedback(feedback);
  }

  async getLatestReport(): Promise<EvolutionReport | undefined> {
    if (this.reports.length === 0) {
      return undefined;
    }

    return this.reports[this.reports.length - 1];
  }

  async getReports(filter?: {
    agentType?: string;
    status?: "pending" | "running" | "completed" | "failed" | "cancelled";
    limit?: number;
  }): Promise<EvolutionReport[]> {
    let reports = [...this.reports];

    if (filter?.agentType && filter.agentType !== "all") {
      reports = reports.filter((r) => r.agentType === filter.agentType);
    }

    if (filter?.status) {
      reports = reports.filter((r) => r.status === filter.status);
    }

    reports.sort((a, b) => b.timestamp - a.timestamp);

    if (filter?.limit) {
      reports = reports.slice(0, filter.limit);
    }

    return reports;
  }

  getExperienceCollector(): IExperienceCollector {
    return this.experienceCollector;
  }

  getPromptOptimizer(): IPromptOptimizer {
    return this.promptOptimizer;
  }

  getSkillLearner(): ISkillLearner {
    return this.skillLearner;
  }

  getSkillLibrary(): ISkillLibrary {
    return this.skillLibrary;
  }

  async getStats(): Promise<{
    experiences: {
      total: number;
      byStatus: Record<string, number>;
      byAgentType: Record<string, number>;
    };
    skills: {
      total: number;
      byCategory: Record<string, number>;
      averageSuccessRate: number;
    };
    reports: {
      total: number;
      successful: number;
      failed: number;
    };
    cost: {
      totalCalls: number;
      inputTokens: number;
      outputTokens: number;
      totalCost: number;
    };
  }> {
    const expStats = await this.experienceCollector.getStats();
    const skillStats = await this.skillLibrary.getStats();

    const successfulReports = this.reports.filter((r) => r.status === "completed").length;
    const failedReports = this.reports.filter((r) => r.status === "failed").length;

    return {
      experiences: {
        total: expStats.total,
        byStatus: expStats.byStatus,
        byAgentType: expStats.byAgentType,
      },
      skills: {
        total: skillStats.totalSkills,
        byCategory: skillStats.byCategory,
        averageSuccessRate: skillStats.averageSuccessRate,
      },
      reports: {
        total: this.reports.length,
        successful: successfulReports,
        failed: failedReports,
      },
      cost: {
        totalCalls: this.costTracker.totalCalls,
        inputTokens: this.costTracker.inputTokens,
        outputTokens: this.costTracker.outputTokens,
        totalCost: this.costTracker.totalCost,
      },
    };
  }

  private extractAgentTypes(experiences: Experience[]): string[] {
    const types = new Set<string>();
    for (const exp of experiences) {
      types.add(exp.agentType);
    }
    return Array.from(types);
  }

  private generateRecommendations(
    experiences: Experience[],
    report: EvolutionReport
  ): Recommendation[] {
    const recommendations: Recommendation[] = [];

    const failureRate =
      experiences.length > 0
        ? experiences.filter((e) => e.outcome.status === "failure").length / experiences.length
        : 0;

    if (failureRate > 0.2) {
      recommendations.push({
        type: "performance",
        priority: "high",
        description: `High failure rate detected: ${(failureRate * 100).toFixed(1)}%`,
        suggestedAction: "Review error patterns and adjust agent configuration",
        evidence: [`Failures: ${experiences.filter((e) => e.outcome.status === "failure").length}`],
      });
    }

    const avgErrorCount =
      experiences.length > 0
        ? experiences.reduce((sum, e) => sum + e.outcome.metrics.errorCount, 0) / experiences.length
        : 0;

    if (avgErrorCount > 2) {
      recommendations.push({
        type: "tool-inefficiency",
        priority: "medium",
        description: `High average error count: ${avgErrorCount.toFixed(1)} per execution`,
        suggestedAction: "Improve error handling and recovery strategies",
        evidence: [`Total errors: ${experiences.reduce((sum, e) => sum + e.outcome.metrics.errorCount, 0)}`],
      });
    }

    const userInterventions = experiences.reduce(
      (sum, e) => sum + e.outcome.metrics.userInterventions,
      0
    );

    if (userInterventions > experiences.length * 0.1) {
      recommendations.push({
        type: "user-experience",
        priority: "medium",
        description: `Frequent user interventions detected: ${userInterventions}`,
        suggestedAction: "Improve agent autonomy and decision making",
        evidence: [`Interventions: ${userInterventions}`],
      });
    }

    if (report.skills.learned === 0 && experiences.length > 10) {
      recommendations.push({
        type: "capability-gap",
        priority: "low",
        description: "No new skills learned despite sufficient experiences",
        suggestedAction: "Review skill learning parameters and experience quality",
        evidence: [`Experiences: ${experiences.length}`],
      });
    }

    return recommendations;
  }

  private calculateCost(inputTokens: number, outputTokens: number): number {
    const inputCostPer1k = 0.00025;
    const outputCostPer1k = 0.001;

    return (inputTokens / 1000) * inputCostPer1k + (outputTokens / 1000) * outputCostPer1k;
  }

  private async loadState(): Promise<void> {
    if (!this.stateStore) {
      return;
    }

    const costData = await this.stateStore.get("costTracker", "agent", "evolution");
    if (costData && typeof costData === "object") {
      this.costTracker = costData as typeof this.costTracker;
    }
  }

  private async saveState(): Promise<void> {
    if (!this.stateStore) {
      return;
    }

    await this.stateStore.set("costTracker", this.costTracker, "agent", "evolution");
  }

  private generateReportId(): string {
    return `evo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  }
}

export function createEvolutionEngine(options?: EvolutionEngineDeps): EvolutionEngine {
  return new EvolutionEngine(options);
}
