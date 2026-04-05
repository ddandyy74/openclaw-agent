/**
 * Prompt Optimizer Implementation
 * 
 * Optimizes agent prompts based on collected experiences.
 */

import type {
  Experience,
  PromptVariant,
  PromptMutation,
  EvolutionOptions,
  CostEstimate,
  PromptAnalysis,
  ImprovementSuggestion,
  MutationType,
} from "./types.js";
import type { IStateStore } from "../persistence/types.js";

export class PromptOptimizer {
  private variants: Map<string, PromptVariant> = new Map();
  private basePrompts: Map<string, string> = new Map();
  private stateStore: IStateStore | null = null;
  private options: EvolutionOptions;

  constructor(options?: { stateStore?: IStateStore; evolutionOptions?: EvolutionOptions }) {
    this.stateStore = options?.stateStore ?? null;
    this.options = {
      maxGenerations: options?.evolutionOptions?.maxGenerations ?? 5,
      populationSize: options?.evolutionOptions?.populationSize ?? 10,
      mutationRate: options?.evolutionOptions?.mutationRate ?? 0.3,
      crossoverRate: options?.evolutionOptions?.crossoverRate ?? 0.5,
      elitismCount: options?.evolutionOptions?.elitismCount ?? 2,
      evaluationSampleSize: options?.evolutionOptions?.evaluationSampleSize ?? 50,
      useCache: options?.evolutionOptions?.useCache ?? true,
    };
  }

  setBasePrompt(agentType: string, prompt: string): void {
    this.basePrompts.set(agentType, prompt);
  }

  getBasePrompt(agentType: string): string | undefined {
    return this.basePrompts.get(agentType);
  }

  async evolve(
    agentType: string,
    experiences: Experience[],
    generation?: number
  ): Promise<PromptVariant> {
    const basePrompt = this.basePrompts.get(agentType);
    if (!basePrompt) {
      throw new Error(`No base prompt set for agent type: ${agentType}`);
    }

    const currentGen = generation ?? 0;

    const analysis = await this.analyzeExperiences(experiences);
    const improvements = await this.generateImprovements(analysis, experiences);
    const mutations = this.createMutations(improvements, basePrompt);

    const variant: PromptVariant = {
      id: this.generateVariantId(agentType, currentGen),
      basePrompt,
      mutations,
      performance: {
        score: 0,
        samples: 0,
      },
      generation: currentGen,
      createdAt: Date.now(),
    };

    this.variants.set(variant.id, variant);

    if (this.stateStore) {
      await this.stateStore.set(variant.id, variant, "agent", "prompts");
    }

    return variant;
  }

  async deploy(agentType: string, variant: PromptVariant): Promise<void> {
    const optimizedPrompt = this.applyMutations(variant.basePrompt, variant.mutations);

    this.basePrompts.set(agentType, optimizedPrompt);

    if (this.stateStore) {
      await this.stateStore.set(
        `${agentType}:current`,
        { prompt: optimizedPrompt, variantId: variant.id, deployedAt: Date.now() },
        "agent",
        "prompts"
      );
    }
  }

  async estimateEvolutionCost(
    experiences: Experience[],
    options?: EvolutionOptions
  ): Promise<CostEstimate> {
    const opts = { ...this.options, ...options };

    const analysisTokens = this.estimateAnalysisTokens(experiences);
    const generationTokens = opts.populationSize! * 500;
    const evaluationTokens = opts.evaluationSampleSize! * experiences.length * 100;

    const totalInput = analysisTokens + evaluationTokens;
    const totalOutput = generationTokens;

    const costPer1kInput = 0.00025;
    const costPer1kOutput = 0.001;

    const estimatedCost =
      (totalInput / 1000) * costPer1kInput + (totalOutput / 1000) * costPer1kOutput;

    return {
      inputTokens: totalInput,
      outputTokens: totalOutput,
      estimatedCost,
      confidence: 0.8,
      breakdown: {
        analysis: analysisTokens,
        generation: generationTokens,
        evaluation: evaluationTokens,
      },
    };
  }

  async evaluateVariant(
    variant: PromptVariant,
    experiences: Experience[]
  ): Promise<number> {
    let totalScore = 0;
    let relevantExperiences = 0;

    for (const exp of experiences) {
      const relevanceScore = this.calculateRelevanceScore(
        variant.mutations,
        exp.learnings
      );

      if (relevanceScore > 0.5) {
        const outcomeScore = this.calculateOutcomeScore(exp.outcome.status);
        totalScore += relevanceScore * outcomeScore;
        relevantExperiences++;
      }
    }

    const avgScore = relevantExperiences > 0 ? totalScore / relevantExperiences : 0;

    variant.performance.score = avgScore;
    variant.performance.samples = relevantExperiences;

    return avgScore;
  }

  async getVariant(variantId: string): Promise<PromptVariant | undefined> {
    if (this.variants.has(variantId)) {
      return this.variants.get(variantId);
    }

    if (this.stateStore) {
      const variant = await this.stateStore.get(variantId, "agent", "prompts");
      if (variant && typeof variant === "object") {
        this.variants.set(variantId, variant as PromptVariant);
        return variant as PromptVariant;
      }
    }

    return undefined;
  }

  async getVariantsForAgent(agentType: string): Promise<PromptVariant[]> {
    const variants: PromptVariant[] = [];

    for (const variant of this.variants.values()) {
      if (variant.id.startsWith(`prompt-${agentType}`)) {
        variants.push(variant);
      }
    }

    return variants.sort((a, b) => b.performance.score - a.performance.score);
  }

  private async analyzeExperiences(experiences: Experience[]): Promise<PromptAnalysis> {
    const strengths: string[] = [];
    const weaknesses: string[] = [];
    const opportunities: string[] = [];
    const threats: string[] = [];

    const patterns: Map<string, { occurrences: number; effectiveness: number; contexts: string[] }> = new Map();
    const antiPatterns: Map<string, { occurrences: number; impact: "high" | "medium" | "low"; suggestions: string[] }> = new Map();

    for (const exp of experiences) {
      for (const learning of exp.learnings) {
        if (learning.type === "pattern") {
          const existing = patterns.get(learning.description) ?? {
            occurrences: 0,
            effectiveness: 0,
            contexts: [],
          };
          existing.occurrences++;
          existing.effectiveness += learning.confidence;
          existing.contexts.push(...learning.applicableScenarios);
          patterns.set(learning.description, existing);

          if (learning.confidence > 0.8) {
            strengths.push(learning.description);
          }
        }

        if (learning.type === "anti-pattern") {
          const existing = antiPatterns.get(learning.description) ?? {
            occurrences: 0,
            impact: "medium" as const,
            suggestions: [],
          };
          existing.occurrences++;
          existing.suggestions.push(...learning.evidence);
          antiPatterns.set(learning.description, existing);

          if (learning.confidence > 0.7) {
            weaknesses.push(learning.description);
          }
        }

        if (learning.type === "optimization") {
          opportunities.push(learning.description);
        }

        if (exp.outcome.status === "failure") {
          threats.push(...learning.evidence);
        }
      }
    }

    const patternMatches = Array.from(patterns.entries()).map(([pattern, data]) => ({
      pattern,
      occurrences: data.occurrences,
      effectiveness: data.effectiveness / data.occurrences,
      contexts: [...new Set(data.contexts)],
    }));

    const antiPatternMatches = Array.from(antiPatterns.entries()).map(([antiPattern, data]) => ({
      antiPattern,
      occurrences: data.occurrences,
      impact: data.impact,
      suggestions: [...new Set(data.suggestions)],
    }));

    return {
      strengths: [...new Set(strengths)],
      weaknesses: [...new Set(weaknesses)],
      opportunities: [...new Set(opportunities)],
      threats: [...new Set(threats)],
      patterns: patternMatches,
      antiPatterns: antiPatternMatches,
    };
  }

  private async generateImprovements(
    analysis: PromptAnalysis,
    experiences: Experience[]
  ): Promise<ImprovementSuggestion[]> {
    const suggestions: ImprovementSuggestion[] = [];

    for (const weakness of analysis.weaknesses) {
      suggestions.push({
        section: "general",
        type: "modification",
        current: undefined,
        suggested: `Address: ${weakness}`,
        rationale: "Identified weakness from experience analysis",
        priority: "high",
        evidence: [weakness],
      });
    }

    for (const opportunity of analysis.opportunities) {
      suggestions.push({
        section: "general",
        type: "addition",
        current: undefined,
        suggested: `Optimize: ${opportunity}`,
        rationale: "Identified optimization opportunity",
        priority: "medium",
        evidence: [opportunity],
      });
    }

    for (const pattern of analysis.patterns) {
      if (pattern.effectiveness > 0.8 && pattern.occurrences >= 3) {
        suggestions.push({
          section: "instructions",
          type: "addition",
          suggested: `Reinforce pattern: ${pattern.pattern}`,
          rationale: `Highly effective pattern (${pattern.effectiveness.toFixed(2)} effectiveness)`,
          priority: "high",
          evidence: pattern.contexts,
        });
      }
    }

    for (const antiPattern of analysis.antiPatterns) {
      if (antiPattern.occurrences >= 2) {
        suggestions.push({
          section: "constraints",
          type: "addition",
          suggested: `Avoid: ${antiPattern.antiPattern}`,
          rationale: `Common anti-pattern (${antiPattern.occurrences} occurrences)`,
          priority: antiPattern.impact === "high" ? "high" : "medium",
          evidence: antiPattern.suggestions,
        });
      }
    }

    return suggestions.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }

  private createMutations(
    improvements: ImprovementSuggestion[],
    basePrompt: string
  ): PromptMutation[] {
    return improvements.slice(0, 10).map((improvement) => {
      const mutationType: MutationType =
        improvement.type === "addition"
          ? "addition"
          : improvement.type === "removal"
            ? "deletion"
            : improvement.type === "reordering"
              ? "reordering"
              : "modification";

      return {
        type: mutationType,
        section: improvement.section,
        original: improvement.current,
        mutated: improvement.suggested,
        rationale: improvement.rationale,
      };
    });
  }

  private applyMutations(basePrompt: string, mutations: PromptMutation[]): string {
    let result = basePrompt;

    for (const mutation of mutations) {
      if (mutation.type === "addition") {
        result = this.applyAddition(result, mutation);
      } else if (mutation.type === "modification") {
        result = this.applyModification(result, mutation);
      } else if (mutation.type === "deletion") {
        result = this.applyDeletion(result, mutation);
      }
    }

    return result;
  }

  private applyAddition(prompt: string, mutation: PromptMutation): string {
    const section = mutation.section.toLowerCase();
    const lines = prompt.split("\n");

    if (section === "instructions" || section === "general") {
      lines.push("");
      lines.push(mutation.mutated);
    } else if (section === "constraints") {
      const constraintIndex = lines.findIndex((l) =>
        l.toLowerCase().includes("constraint") || l.toLowerCase().includes("avoid")
      );
      if (constraintIndex >= 0) {
        lines.splice(constraintIndex + 1, 0, mutation.mutated);
      } else {
        lines.push("");
        lines.push("## Constraints");
        lines.push(mutation.mutated);
      }
    } else {
      lines.push("");
      lines.push(mutation.mutated);
    }

    return lines.join("\n");
  }

  private applyModification(prompt: string, mutation: PromptMutation): string {
    if (!mutation.original) {
      return prompt;
    }
    return prompt.replace(mutation.original, mutation.mutated);
  }

  private applyDeletion(prompt: string, mutation: PromptMutation): string {
    if (!mutation.original) {
      return prompt;
    }
    return prompt.replace(mutation.original, "");
  }

  private calculateRelevanceScore(
    mutations: PromptMutation[],
    learnings: Array<{ type: string; description: string; confidence: number }>
  ): number {
    if (mutations.length === 0 || learnings.length === 0) {
      return 0;
    }

    let relevanceScore = 0;

    for (const mutation of mutations) {
      for (const learning of learnings) {
        const similarity = this.textSimilarity(mutation.mutated, learning.description);
        if (similarity > 0.5) {
          relevanceScore += similarity * learning.confidence;
        }
      }
    }

    return Math.min(1, relevanceScore / mutations.length);
  }

  private calculateOutcomeScore(status: string): number {
    switch (status) {
      case "success":
        return 1;
      case "partial":
        return 0.5;
      case "failure":
        return 0;
      default:
        return 0.25;
    }
  }

  private textSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/));
    const wordsB = new Set(b.toLowerCase().split(/\s+/));

    const intersection = new Set([...wordsA].filter((x) => wordsB.has(x)));
    const union = new Set([...wordsA, ...wordsB]);

    return intersection.size / union.size;
  }

  private estimateAnalysisTokens(experiences: Experience[]): number {
    const avgTokensPerExperience = 500;
    return experiences.length * avgTokensPerExperience;
  }

  private generateVariantId(agentType: string, generation: number): string {
    return `prompt-${agentType}-gen${generation}-${Math.random().toString(36).slice(2, 7)}`;
  }
}

export function createPromptOptimizer(options?: {
  stateStore?: IStateStore;
  evolutionOptions?: EvolutionOptions;
}): PromptOptimizer {
  return new PromptOptimizer(options);
}
