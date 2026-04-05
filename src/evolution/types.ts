/**
 * Evolution Types
 * 
 * Core types for the agent self-evolution system.
 */

export type ExperienceType = "success" | "partial" | "failure";

export type LearningType = "pattern" | "anti-pattern" | "optimization" | "user-feedback";

export type EvolutionStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export type MutationType = "addition" | "deletion" | "modification" | "reordering";

export interface Experience {
  id: string;
  timestamp: number;
  taskId: string;
  agentType: string;
  
  context: {
    prompt: string;
    systemPrompt: string;
    tools: string[];
    model: string;
  };
  
  execution: {
    steps: ExecutionStep[];
    toolCalls: ToolCallRecord[];
    decisions: DecisionPoint[];
    errors: ErrorRecord[];
    recoveries: RecoveryAction[];
  };
  
  outcome: {
    status: ExperienceType;
    userFeedback?: UserFeedback;
    metrics: {
      tokensUsed: number;
      duration: number;
      toolCallsCount: number;
      errorCount: number;
      retryCount: number;
      userInterventions: number;
    };
  };
  
  learnings: Learning[];
}

export interface ExecutionStep {
  id: string;
  timestamp: number;
  action: string;
  input: unknown;
  output?: unknown;
  duration?: number;
}

export interface ToolCallRecord {
  tool: string;
  input: unknown;
  output?: unknown;
  timestamp: number;
  duration?: number;
  success: boolean;
  error?: string;
}

export interface DecisionPoint {
  id: string;
  context: string;
  options: string[];
  chosen: string;
  reason?: string;
  timestamp: number;
}

export interface ErrorRecord {
  id: string;
  error: string;
  stack?: string;
  timestamp: number;
  recovered: boolean;
  recoveryAction?: string;
}

export interface RecoveryAction {
  errorId: string;
  action: string;
  success: boolean;
  timestamp: number;
}

export interface UserFeedback {
  experienceId: string;
  type: "praise" | "correction" | "suggestion" | "complaint";
  description: string;
  originalAction?: string;
  correctedAction?: string;
  praisedAction?: string;
  context?: string;
  timestamp: number;
}

export interface Learning {
  type: LearningType;
  category: string;
  description: string;
  evidence: string[];
  confidence: number;
  applicableScenarios: string[];
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  category: string;
  
  definition: {
    trigger: TriggerCondition;
    steps: SkillStep[];
    tools: string[];
    examples: SkillExample[];
  };
  
  metadata: {
    createdAt: number;
    updatedAt: number;
    version: number;
    author: "human" | "agent";
    sourceExperience: string;
    confidence: number;
    usageCount: number;
    successRate: number;
  };
}

export interface TriggerCondition {
  type: "keyword" | "intent" | "context" | "pattern";
  condition: string;
}

export interface SkillStep {
  description: string;
  tool?: string;
  inputTemplate: string;
  decisionPoints?: string[];
}

export interface SkillExample {
  input: string;
  expectedOutput: string;
}

export interface PromptVariant {
  id: string;
  basePrompt: string;
  mutations: PromptMutation[];
  performance: {
    score: number;
    samples: number;
    offlineScore?: number;
    onlineScore?: number;
  };
  generation: number;
  createdAt: number;
}

export interface PromptMutation {
  type: MutationType;
  section: string;
  original?: string;
  mutated: string;
  rationale: string;
  performanceDelta?: number;
}

export interface EvolutionReport {
  id: string;
  timestamp: number;
  agentType: string;
  status: EvolutionStatus;
  experiences: {
    collected: number;
    analyzed: number;
  };
  prompts: {
    optimized: number;
    deployed: number;
  };
  skills: {
    learned: number;
    optimized: number;
  };
  recommendations: Recommendation[];
  cost: {
    totalCalls: number;
    inputTokens: number;
    outputTokens: number;
    totalCost: number;
  };
}

export interface Recommendation {
  type: "capability-gap" | "tool-inefficiency" | "user-experience" | "performance";
  priority: "high" | "medium" | "low";
  description: string;
  suggestedAction: string;
  evidence: string[];
}

export interface EvolutionConfig {
  enabled: boolean;
  evolutionInterval: number;
  minExperiencesForEvolution: number;
  minUsageForOptimization: number;
  promptOptimizationEnabled: boolean;
  skillLearningEnabled: boolean;
  autoDeployThreshold: number;
  maxCostPerEvolution: number;
  cacheEnabled: boolean;
}

export interface EvolutionOptions {
  maxGenerations?: number;
  populationSize?: number;
  mutationRate?: number;
  crossoverRate?: number;
  elitismCount?: number;
  evaluationSampleSize?: number;
  useCache?: boolean;
}

export interface CostEstimate {
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  confidence: number;
  breakdown: {
    analysis: number;
    generation: number;
    evaluation: number;
  };
}

export interface PromptAnalysis {
  strengths: string[];
  weaknesses: string[];
  opportunities: string[];
  threats: string[];
  patterns: PatternMatch[];
  antiPatterns: AntiPatternMatch[];
}

export interface PatternMatch {
  pattern: string;
  occurrences: number;
  effectiveness: number;
  contexts: string[];
}

export interface AntiPatternMatch {
  antiPattern: string;
  occurrences: number;
  impact: "high" | "medium" | "low";
  suggestions: string[];
}

export interface ImprovementSuggestion {
  section: string;
  type: "addition" | "modification" | "removal" | "reordering";
  current?: string;
  suggested: string;
  rationale: string;
  priority: "high" | "medium" | "low";
  evidence: string[];
}

export interface ExperienceFilter {
  agentType?: string;
  type?: ExperienceType;
  since?: number;
  until?: number;
  limit?: number;
}

export interface Feedback {
  experienceId: string;
  type: "praise" | "correction" | "suggestion" | "complaint";
  description: string;
  timestamp: number;
}

export interface Pattern {
  id: string;
  type: "success" | "anti-pattern";
  name: string;
  description: string;
  occurrences: number;
  contexts: string[];
}

export interface SkillFilter {
  category?: string;
  tool?: string;
  minConfidence?: number;
}

export interface IExperienceCollector {
  collect(session: unknown): Promise<Experience>;
  getExperience(id: string): Promise<Experience | undefined>;
  getExperiences(filter?: { agentType?: string; since?: number; status?: ExperienceType; limit?: number }): Promise<Experience[]>;
  collectFeedback(feedback: UserFeedback): Promise<void>;
  deleteExperience(id: string): Promise<void>;
  getStats(): Promise<{
    total: number;
    byStatus: Record<ExperienceType, number>;
    byAgentType: Record<string, number>;
    averageMetrics: { tokensUsed: number; duration: number; errorCount: number };
  }>;
}

export interface IPromptOptimizer {
  setBasePrompt(agentType: string, prompt: string): void;
  getBasePrompt(agentType: string): string | undefined;
  evolve(agentType: string, experiences: Experience[]): Promise<PromptVariant>;
  deploy(agentType: string, variant: PromptVariant): Promise<void>;
  getVariantsForAgent(agentType: string): Promise<PromptVariant[]>;
}

export interface ISkillLearner {
  learn(experiences: Experience[]): Promise<Skill[]>;
  optimize(skillId: string, experiences: Experience[]): Promise<Skill | undefined>;
  listSkills(filter?: { category?: string; minSuccessRate?: number }): Promise<Skill[]>;
}

export interface ISkillLibrary {
  add(skill: Skill): Promise<void>;
  get(skillId: string): Promise<Skill | undefined>;
  list(filter?: { category?: string; minSuccessRate?: number; minUsageCount?: number; author?: "human" | "agent" }): Promise<Skill[]>;
  update(skill: Skill): Promise<void>;
  delete(skillId: string): Promise<void>;
  recordUsage(skillId: string, outcome: "success" | "failure"): Promise<void>;
  search(query: string): Promise<Skill[]>;
  getCategories(): Promise<string[]>;
  getStats(): Promise<{
    totalSkills: number;
    byCategory: Record<string, number>;
    byAuthor: Record<string, number>;
    averageSuccessRate: number;
    averageUsageCount: number;
  }>;
}

export interface EvolutionEngineDeps {
  stateStore?: import("../persistence/types.js").IStateStore;
  experienceCollector?: IExperienceCollector;
  promptOptimizer?: IPromptOptimizer;
  skillLearner?: ISkillLearner;
  skillLibrary?: ISkillLibrary;
}
