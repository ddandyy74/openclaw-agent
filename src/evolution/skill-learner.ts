/**
 * Skill Learner Implementation
 * 
 * Learns new skills from agent experiences.
 */

import type {
  Experience,
  Skill,
  SkillStep,
  TriggerCondition,
  SkillExample,
  Learning,
} from "./types.js";
import type { IStateStore } from "../persistence/types.js";

type Pattern = {
  id: string;
  name: string;
  category: string;
  description: string;
  steps: SkillStep[];
  tools: Set<string>;
  successCount: number;
  failureCount: number;
  contexts: string[];
  confidence: number;
};

export class SkillLearner {
  private skills: Map<string, Skill> = new Map();
  private patterns: Map<string, Pattern> = new Map();
  private stateStore: IStateStore | null = null;
  private minOccurrences: number;
  private minSuccessRate: number;
  private minConfidence: number;

  constructor(options?: {
    stateStore?: IStateStore;
    minOccurrences?: number;
    minSuccessRate?: number;
    minConfidence?: number;
  }) {
    this.stateStore = options?.stateStore ?? null;
    this.minOccurrences = options?.minOccurrences ?? 3;
    this.minSuccessRate = options?.minSuccessRate ?? 0.7;
    this.minConfidence = options?.minConfidence ?? 0.6;
  }

  async learn(experiences: Experience[]): Promise<Skill[]> {
    const newSkills: Skill[] = [];

    for (const exp of experiences) {
      if (exp.outcome.status === "success") {
        const patterns = this.extractPatterns(exp);
        for (const pattern of patterns) {
          this.updatePattern(pattern);
        }
      }
    }

    const validPatterns = this.validatePatterns();

    for (const pattern of validPatterns) {
      const skill = await this.createSkill(pattern, experiences);
      if (skill && !this.skills.has(skill.id)) {
        this.skills.set(skill.id, skill);
        newSkills.push(skill);

        if (this.stateStore) {
          await this.stateStore.set(skill.id, skill, "agent", "skills");
        }
      }
    }

    return newSkills;
  }

  async optimize(skillId: string, experiences: Experience[]): Promise<Skill> {
    const skill = this.skills.get(skillId);
    if (!skill) {
      throw new Error(`Skill ${skillId} not found`);
    }

    const relevantExperiences = this.filterRelevantExperiences(skill, experiences);

    const stepPerformance = this.analyzeStepPerformance(skill, relevantExperiences);

    const optimizedSteps = this.optimizeSteps(skill.definition.steps, stepPerformance);

    const updatedSkill: Skill = {
      ...skill,
      definition: {
        ...skill.definition,
        steps: optimizedSteps,
      },
      metadata: {
        ...skill.metadata,
        updatedAt: Date.now(),
        version: skill.metadata.version + 1,
      },
    };

    updatedSkill.metadata.successRate = this.calculateSuccessRate(
      updatedSkill,
      relevantExperiences
    );

    this.skills.set(skillId, updatedSkill);

    if (this.stateStore) {
      await this.stateStore.set(skillId, updatedSkill, "agent", "skills");
    }

    return updatedSkill;
  }

  async getSkill(skillId: string): Promise<Skill | undefined> {
    if (this.skills.has(skillId)) {
      return this.skills.get(skillId);
    }

    if (this.stateStore) {
      const skill = await this.stateStore.get(skillId, "agent", "skills");
      if (skill && typeof skill === "object") {
        this.skills.set(skillId, skill as Skill);
        return skill as Skill;
      }
    }

    return undefined;
  }

  async listSkills(filter?: {
    category?: string;
    minSuccessRate?: number;
  }): Promise<Skill[]> {
    let skills = Array.from(this.skills.values());

    if (filter?.category) {
      skills = skills.filter((s) => s.category === filter.category);
    }

    if (filter?.minSuccessRate !== undefined) {
      const minRate = filter.minSuccessRate;
      skills = skills.filter((s) => s.metadata.successRate >= minRate);
    }

    return skills.sort((a, b) => b.metadata.successRate - a.metadata.successRate);
  }

  private extractPatterns(experience: Experience): Pattern[] {
    const patterns: Pattern[] = [];

    const toolSequence = this.extractToolSequence(experience);
    if (toolSequence.length >= 2) {
      patterns.push({
        id: this.generatePatternId("tool-sequence", toolSequence),
        name: `Tool Sequence: ${toolSequence.slice(0, 3).join(" -> ")}`,
        category: "tool-sequence",
        description: `Common tool sequence: ${toolSequence.join(" -> ")}`,
        steps: this.createStepsFromToolSequence(toolSequence),
        tools: new Set(toolSequence),
        successCount: 1,
        failureCount: 0,
        contexts: [experience.context.prompt.substring(0, 100)],
        confidence: 0.5,
      });
    }

    const decisionPatterns = this.extractDecisionPatterns(experience);
    for (const dp of decisionPatterns) {
      patterns.push({
        id: this.generatePatternId("decision", [dp.chosen]),
        name: `Decision Pattern: ${dp.chosen}`,
        category: "decision-making",
        description: `Decision pattern where "${dp.chosen}" is chosen from options: ${dp.options.join(", ")}`,
        steps: [
          {
            description: `Evaluate options: ${dp.options.join(", ")}`,
            decisionPoints: dp.options,
            inputTemplate: "{{context}}",
          },
          {
            description: `Choose: ${dp.chosen}`,
            inputTemplate: "{{decision}}",
          },
        ],
        tools: new Set(),
        successCount: 1,
        failureCount: 0,
        contexts: [dp.context],
        confidence: 0.5,
      });
    }

    const recoveryPatterns = this.extractRecoveryPatterns(experience);
    for (const rp of recoveryPatterns) {
      patterns.push({
        id: this.generatePatternId("recovery", [rp.action]),
        name: `Recovery Pattern: ${rp.action}`,
        category: "error-recovery",
        description: `Recovery action: ${rp.action}`,
        steps: [
          {
            description: "Detect error",
            inputTemplate: "{{error}}",
          },
          {
            description: rp.action,
            inputTemplate: "{{recovery_input}}",
          },
        ],
        tools: new Set(),
        successCount: rp.success ? 1 : 0,
        failureCount: rp.success ? 0 : 1,
        contexts: [rp.errorType],
        confidence: rp.success ? 0.6 : 0.3,
      });
    }

    return patterns;
  }

  private extractToolSequence(experience: Experience): string[] {
    return experience.execution.toolCalls
      .filter((call) => call.success)
      .map((call) => call.tool);
  }

  private extractDecisionPatterns(experience: Experience): Array<{
    chosen: string;
    options: string[];
    context: string;
  }> {
    return experience.execution.decisions.map((d) => ({
      chosen: d.chosen,
      options: d.options,
      context: d.context,
    }));
  }

  private extractRecoveryPatterns(experience: Experience): Array<{
    action: string;
    success: boolean;
    errorType: string;
  }> {
    return experience.execution.recoveries.map((r) => {
      const error = experience.execution.errors.find((e) => e.id === r.errorId);
      return {
        action: r.action,
        success: r.success,
        errorType: error?.error ?? "unknown",
      };
    });
  }

  private createStepsFromToolSequence(tools: string[]): SkillStep[] {
    return tools.map((tool, index) => ({
      description: `Step ${index + 1}: Use ${tool}`,
      tool,
      inputTemplate: `{{${tool}_input}}`,
    }));
  }

  private generatePatternId(type: string, elements: string[]): string {
    const hash = elements.join("-").split("").reduce((acc, char) => {
      return ((acc << 5) - acc + char.charCodeAt(0)) | 0;
    }, 0);
    return `pattern-${type}-${Math.abs(hash).toString(36)}`;
  }

  private updatePattern(pattern: Pattern): void {
    const existing = this.patterns.get(pattern.id);

    if (existing) {
      existing.successCount += pattern.successCount;
      existing.failureCount += pattern.failureCount;
      existing.contexts.push(...pattern.contexts);
      existing.contexts = [...new Set(existing.contexts)];
      existing.confidence = this.calculatePatternConfidence(existing);

      for (const tool of pattern.tools) {
        existing.tools.add(tool);
      }
    } else {
      this.patterns.set(pattern.id, pattern);
    }
  }

  private calculatePatternConfidence(pattern: Pattern): number {
    const total = pattern.successCount + pattern.failureCount;
    if (total === 0) return 0;

    const successRate = pattern.successCount / total;
    const frequencyBonus = Math.min(total / 10, 0.2);

    return Math.min(1, successRate * 0.8 + frequencyBonus);
  }

  private validatePatterns(): Pattern[] {
    const validPatterns: Pattern[] = [];

    for (const pattern of this.patterns.values()) {
      const total = pattern.successCount + pattern.failureCount;

      if (total < this.minOccurrences) {
        continue;
      }

      const successRate = pattern.successCount / total;

      if (successRate < this.minSuccessRate) {
        continue;
      }

      if (pattern.confidence < this.minConfidence) {
        continue;
      }

      validPatterns.push(pattern);
    }

    return validPatterns;
  }

  private async createSkill(pattern: Pattern, experiences: Experience[]): Promise<Skill | null> {
    const relevantExperiences = this.filterRelevantExperiencesForPattern(pattern, experiences);

    const examples = this.generateExamples(relevantExperiences);

    const trigger = this.determineTrigger(pattern, relevantExperiences);

    const skill: Skill = {
      id: `skill-${pattern.category}-${Date.now()}`,
      name: pattern.name,
      description: pattern.description,
      category: pattern.category,
      definition: {
        trigger,
        steps: pattern.steps,
        tools: Array.from(pattern.tools),
        examples,
      },
      metadata: {
        createdAt: Date.now(),
        updatedAt: Date.now(),
        version: 1,
        author: "agent",
        sourceExperience: relevantExperiences[0]?.id ?? "",
        confidence: pattern.confidence,
        usageCount: 0,
        successRate: this.calculateSuccessRateFromPattern(pattern),
      },
    };

    return skill;
  }

  private filterRelevantExperiences(skill: Skill, experiences: Experience[]): Experience[] {
    return experiences.filter((exp) => {
      const skillTools = new Set(skill.definition.tools);
      const expTools = new Set(exp.execution.toolCalls.map((c) => c.tool));
      const overlap = [...skillTools].filter((t) => expTools.has(t));
      return overlap.length >= skill.definition.tools.length * 0.5;
    });
  }

  private filterRelevantExperiencesForPattern(
    pattern: Pattern,
    experiences: Experience[]
  ): Experience[] {
    return experiences.filter((exp) => {
      for (const context of pattern.contexts) {
        if (exp.context.prompt.includes(context)) {
          return true;
        }
      }
      return false;
    });
  }

  private analyzeStepPerformance(
    skill: Skill,
    experiences: Experience[]
  ): Map<number, { success: number; failure: number }> {
    const performance = new Map<number, { success: number; failure: number }>();

    skill.definition.steps.forEach((_, index) => {
      performance.set(index, { success: 0, failure: 0 });
    });

    return performance;
  }

  private optimizeSteps(
    steps: SkillStep[],
    performance: Map<number, { success: number; failure: number }>
  ): SkillStep[] {
    return steps.filter((step, index) => {
      const perf = performance.get(index);
      if (!perf) return true;

      const total = perf.success + perf.failure;
      if (total < 5) return true;

      const successRate = perf.success / total;
      return successRate >= 0.5;
    });
  }

  private calculateSuccessRate(skill: Skill, experiences: Experience[]): number {
    if (experiences.length === 0) return 0;

    let successCount = 0;
    for (const exp of experiences) {
      if (exp.outcome.status === "success") {
        successCount++;
      }
    }

    return successCount / experiences.length;
  }

  private calculateSuccessRateFromPattern(pattern: Pattern): number {
    const total = pattern.successCount + pattern.failureCount;
    return total > 0 ? pattern.successCount / total : 0;
  }

  private generateExamples(experiences: Experience[]): SkillExample[] {
    const examples: SkillExample[] = [];

    for (const exp of experiences.slice(0, 5)) {
      const successfulTools = exp.execution.toolCalls
        .filter((c) => c.success)
        .slice(0, 3);

      if (successfulTools.length > 0) {
        examples.push({
          input: exp.context.prompt.substring(0, 200),
          expectedOutput: successfulTools.map((t) => t.tool).join(" -> "),
        });
      }
    }

    return examples;
  }

  private determineTrigger(pattern: Pattern, experiences: Experience[]): TriggerCondition {
    const contexts = pattern.contexts.join(" ");

    const keywords = this.extractKeywords(contexts);

    if (keywords.length > 0) {
      return {
        type: "keyword",
        condition: keywords.slice(0, 3).join(" OR "),
      };
    }

    return {
      type: "context",
      condition: pattern.category,
    };
  }

  private extractKeywords(text: string): string[] {
    const stopWords = new Set([
      "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
      "of", "with", "by", "from", "is", "are", "was", "were", "be", "been",
    ]);

    const words = text.toLowerCase().split(/\s+/);

    const wordFreq = new Map<string, number>();
    for (const word of words) {
      if (word.length > 3 && !stopWords.has(word)) {
        wordFreq.set(word, (wordFreq.get(word) ?? 0) + 1);
      }
    }

    return Array.from(wordFreq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word]) => word);
  }
}

export function createSkillLearner(options?: {
  stateStore?: IStateStore;
  minOccurrences?: number;
  minSuccessRate?: number;
  minConfidence?: number;
}): SkillLearner {
  return new SkillLearner(options);
}
