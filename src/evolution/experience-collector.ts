/**
 * Experience Collector Implementation
 * 
 * Collects and analyzes agent execution experiences for learning.
 */

import type {
  Experience,
  ExperienceType,
  Learning,
  UserFeedback,
  ExecutionStep,
  ToolCallRecord,
  DecisionPoint,
  ErrorRecord,
  RecoveryAction,
} from "./types.js";
import type { IStateStore } from "../persistence/types.js";

type Session = {
  taskId: string;
  agentType: string;
  prompt: string;
  systemPrompt: string;
  tools: string[];
  model: string;
  steps: ExecutionStep[];
  toolCalls: ToolCallRecord[];
  decisions: DecisionPoint[];
  errors: ErrorRecord[];
  recoveries: RecoveryAction[];
  outcome: {
    status: ExperienceType;
    tokensUsed: number;
    duration: number;
    userInterventions: number;
  };
};

export class ExperienceCollector {
  private experiences: Map<string, Experience> = new Map();
  private stateStore: IStateStore | null = null;
  private minConfidence: number;

  constructor(options?: { stateStore?: IStateStore; minConfidence?: number }) {
    this.stateStore = options?.stateStore ?? null;
    this.minConfidence = options?.minConfidence ?? 0.6;
  }

  async collect(session: Session): Promise<Experience> {
    const id = this.generateId();
    const timestamp = Date.now();

    const experience: Experience = {
      id,
      timestamp,
      taskId: session.taskId,
      agentType: session.agentType,
      context: {
        prompt: session.prompt,
        systemPrompt: session.systemPrompt,
        tools: session.tools,
        model: session.model,
      },
      execution: {
        steps: session.steps,
        toolCalls: session.toolCalls,
        decisions: session.decisions,
        errors: session.errors,
        recoveries: session.recoveries,
      },
      outcome: {
        status: session.outcome.status,
        metrics: {
          tokensUsed: session.outcome.tokensUsed,
          duration: session.outcome.duration,
          toolCallsCount: session.toolCalls.length,
          errorCount: session.errors.length,
          retryCount: session.recoveries.length,
          userInterventions: session.outcome.userInterventions,
        },
      },
      learnings: [],
    };

    experience.learnings = await this.extractLearnings(experience);

    this.experiences.set(id, experience);

    if (this.stateStore) {
      await this.persist(experience);
    }

    return experience;
  }

  async collectFeedback(feedback: UserFeedback): Promise<void> {
    const experience = this.experiences.get(feedback.experienceId);
    if (!experience) {
      throw new Error(`Experience ${feedback.experienceId} not found`);
    }

    experience.outcome.userFeedback = feedback;

    const newLearnings = await this.extractLearningsFromFeedback(experience, feedback);
    experience.learnings.push(...newLearnings);

    if (this.stateStore) {
      await this.persist(experience);
    }
  }

  async getExperiences(filter?: {
    agentType?: string;
    since?: number;
    status?: ExperienceType;
    limit?: number;
  }): Promise<Experience[]> {
    let experiences = Array.from(this.experiences.values());

    if (filter?.agentType) {
      experiences = experiences.filter((e) => e.agentType === filter.agentType);
    }

    if (filter?.since !== undefined) {
      const since = filter.since;
      experiences = experiences.filter((e) => e.timestamp >= since);
    }

    if (filter?.status) {
      experiences = experiences.filter((e) => e.outcome.status === filter.status);
    }

    experiences.sort((a, b) => b.timestamp - a.timestamp);

    if (filter?.limit) {
      experiences = experiences.slice(0, filter.limit);
    }

    return experiences;
  }

  async getExperience(id: string): Promise<Experience | undefined> {
    return this.experiences.get(id);
  }

  async deleteExperience(id: string): Promise<void> {
    this.experiences.delete(id);

    if (this.stateStore) {
      await this.stateStore.delete(id, "agent", "experiences");
    }
  }

  async getStats(): Promise<{
    total: number;
    byStatus: Record<ExperienceType, number>;
    byAgentType: Record<string, number>;
    averageMetrics: {
      tokensUsed: number;
      duration: number;
      errorCount: number;
    };
  }> {
    const experiences = Array.from(this.experiences.values());
    const byStatus: Record<ExperienceType, number> = {
      success: 0,
      partial: 0,
      failure: 0,
    };
    const byAgentType: Record<string, number> = {};

    let totalTokens = 0;
    let totalDuration = 0;
    let totalErrors = 0;

    for (const exp of experiences) {
      byStatus[exp.outcome.status]++;
      byAgentType[exp.agentType] = (byAgentType[exp.agentType] ?? 0) + 1;
      totalTokens += exp.outcome.metrics.tokensUsed;
      totalDuration += exp.outcome.metrics.duration;
      totalErrors += exp.outcome.metrics.errorCount;
    }

    return {
      total: experiences.length,
      byStatus,
      byAgentType,
      averageMetrics: {
        tokensUsed: experiences.length > 0 ? totalTokens / experiences.length : 0,
        duration: experiences.length > 0 ? totalDuration / experiences.length : 0,
        errorCount: experiences.length > 0 ? totalErrors / experiences.length : 0,
      },
    };
  }

  private async extractLearnings(experience: Experience): Promise<Learning[]> {
    const learnings: Learning[] = [];

    // Extract patterns from successful executions
    if (experience.outcome.status === "success") {
      const patterns = this.identifySuccessPatterns(experience);
      for (const pattern of patterns) {
        learnings.push({
          type: "pattern",
          category: pattern.category,
          description: pattern.description,
          evidence: pattern.evidence,
          confidence: pattern.confidence,
          applicableScenarios: pattern.scenarios,
        });
      }
    }

    // Extract anti-patterns from failures
    if (experience.outcome.status === "failure") {
      const antiPatterns = this.identifyAntiPatterns(experience);
      for (const ap of antiPatterns) {
        learnings.push({
          type: "anti-pattern",
          category: ap.category,
          description: ap.description,
          evidence: ap.evidence,
          confidence: ap.confidence,
          applicableScenarios: ap.scenarios,
        });
      }
    }

    // Extract optimization opportunities
    const optimizations = this.identifyOptimizations(experience);
    for (const opt of optimizations) {
      learnings.push({
        type: "optimization",
        category: opt.category,
        description: opt.description,
        evidence: opt.evidence,
        confidence: opt.confidence,
        applicableScenarios: opt.scenarios,
      });
    }

    return learnings.filter((l) => l.confidence >= this.minConfidence);
  }

  private async extractLearningsFromFeedback(
    experience: Experience,
    feedback: UserFeedback
  ): Promise<Learning[]> {
    const learnings: Learning[] = [];

    if (feedback.type === "correction" && feedback.correctedAction) {
      learnings.push({
        type: "user-feedback",
        category: "correction",
        description: `User corrected action: ${feedback.originalAction} -> ${feedback.correctedAction}`,
        evidence: [feedback.description],
        confidence: 0.9,
        applicableScenarios: [feedback.context ?? "general"],
      });
    }

    if (feedback.type === "praise" && feedback.praisedAction) {
      learnings.push({
        type: "user-feedback",
        category: "praise",
        description: `User praised action: ${feedback.praisedAction}`,
        evidence: [feedback.description],
        confidence: 0.85,
        applicableScenarios: [feedback.context ?? "general"],
      });
    }

    if (feedback.type === "suggestion") {
      learnings.push({
        type: "user-feedback",
        category: "suggestion",
        description: `User suggestion: ${feedback.description}`,
        evidence: [feedback.description],
        confidence: 0.75,
        applicableScenarios: [feedback.context ?? "general"],
      });
    }

    return learnings;
  }

  private identifySuccessPatterns(experience: Experience): Array<{
    category: string;
    description: string;
    evidence: string[];
    confidence: number;
    scenarios: string[];
  }> {
    const patterns: Array<{
      category: string;
      description: string;
      evidence: string[];
      confidence: number;
      scenarios: string[];
    }> = [];

    // Analyze successful tool usage patterns
    const toolSuccess = new Map<string, { success: number; total: number }>();
    for (const call of experience.execution.toolCalls) {
      const stats = toolSuccess.get(call.tool) ?? { success: 0, total: 0 };
      stats.total++;
      if (call.success) {
        stats.success++;
      }
      toolSuccess.set(call.tool, stats);
    }

    for (const [tool, stats] of toolSuccess) {
      if (stats.success === stats.total && stats.total > 1) {
        patterns.push({
          category: "tool-usage",
          description: `Consistent successful usage of ${tool}`,
          evidence: [`${stats.success} successful calls`],
          confidence: 0.8,
          scenarios: [experience.context.prompt.substring(0, 100)],
        });
      }
    }

    // Analyze efficient decision patterns
    if (experience.execution.decisions.length > 0 && experience.execution.errors.length === 0) {
      patterns.push({
        category: "decision-making",
        description: "Error-free decision sequence",
        evidence: experience.execution.decisions.map((d) => d.chosen),
        confidence: 0.75,
        scenarios: [experience.context.prompt.substring(0, 100)],
      });
    }

    return patterns;
  }

  private identifyAntiPatterns(experience: Experience): Array<{
    category: string;
    description: string;
    evidence: string[];
    confidence: number;
    scenarios: string[];
  }> {
    const antiPatterns: Array<{
      category: string;
      description: string;
      evidence: string[];
      confidence: number;
      scenarios: string[];
    }> = [];

    // Analyze error patterns
    for (const error of experience.execution.errors) {
      if (!error.recovered) {
        antiPatterns.push({
          category: "error-handling",
          description: `Unrecovered error: ${error.error}`,
          evidence: [error.stack ?? error.error],
          confidence: 0.9,
          scenarios: [experience.context.prompt.substring(0, 100)],
        });
      }
    }

    // Analyze retry patterns
    if (experience.outcome.metrics.retryCount > 2) {
      antiPatterns.push({
        category: "reliability",
        description: "High retry count indicates instability",
        evidence: [`${experience.outcome.metrics.retryCount} retries`],
        confidence: 0.85,
        scenarios: [experience.context.prompt.substring(0, 100)],
      });
    }

    return antiPatterns;
  }

  private identifyOptimizations(experience: Experience): Array<{
    category: string;
    description: string;
    evidence: string[];
    confidence: number;
    scenarios: string[];
  }> {
    const optimizations: Array<{
      category: string;
      description: string;
      evidence: string[];
      confidence: number;
      scenarios: string[];
    }> = [];

    // Analyze token efficiency
    const avgTokensPerToolCall =
      experience.execution.toolCalls.length > 0
        ? experience.outcome.metrics.tokensUsed / experience.execution.toolCalls.length
        : 0;

    if (avgTokensPerToolCall > 1000) {
      optimizations.push({
        category: "token-efficiency",
        description: "High token usage per tool call",
        evidence: [`${Math.round(avgTokensPerToolCall)} tokens per call`],
        confidence: 0.7,
        scenarios: [experience.context.prompt.substring(0, 100)],
      });
    }

    // Analyze time efficiency
    const avgDurationPerStep =
      experience.execution.steps.length > 0
        ? experience.outcome.metrics.duration / experience.execution.steps.length
        : 0;

    if (avgDurationPerStep > 5000) {
      optimizations.push({
        category: "time-efficiency",
        description: "Slow step execution detected",
        evidence: [`${Math.round(avgDurationPerStep)}ms per step`],
        confidence: 0.65,
        scenarios: [experience.context.prompt.substring(0, 100)],
      });
    }

    return optimizations;
  }

  private async persist(experience: Experience): Promise<void> {
    if (!this.stateStore) {
      return;
    }

    await this.stateStore.set(
      experience.id,
      experience,
      "agent",
      "experiences"
    );
  }

  private generateId(): string {
    return `exp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
}

export function createExperienceCollector(options?: {
  stateStore?: IStateStore;
  minConfidence?: number;
}): ExperienceCollector {
  return new ExperienceCollector(options);
}
