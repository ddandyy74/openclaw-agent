/**
 * Skill Library Implementation
 * 
 * Manages a library of learned and optimized skills.
 */

import type { Skill, TriggerCondition, SkillExample } from "./types.js";
import type { IStateStore } from "../persistence/types.js";

export class SkillLibrary {
  private skills: Map<string, Skill> = new Map();
  private categoryIndex: Map<string, Set<string>> = new Map();
  private toolIndex: Map<string, Set<string>> = new Map();
  private stateStore: IStateStore | null = null;

  constructor(options?: { stateStore?: IStateStore }) {
    this.stateStore = options?.stateStore ?? null;
  }

  async add(skill: Skill): Promise<void> {
    this.skills.set(skill.id, skill);
    this.updateIndexes(skill);

    if (this.stateStore) {
      await this.stateStore.set(skill.id, skill, "agent", "skills");
    }
  }

  async update(skill: Skill): Promise<void> {
    const existing = this.skills.get(skill.id);
    if (!existing) {
      throw new Error(`Skill ${skill.id} not found`);
    }

    this.removeFromIndexes(existing);
    this.skills.set(skill.id, skill);
    this.updateIndexes(skill);

    if (this.stateStore) {
      await this.stateStore.set(skill.id, skill, "agent", "skills");
    }
  }

  async get(skillId: string): Promise<Skill | undefined> {
    if (this.skills.has(skillId)) {
      return this.skills.get(skillId);
    }

    if (this.stateStore) {
      const skill = await this.stateStore.get(skillId, "agent", "skills");
      if (skill && typeof skill === "object" && "id" in skill) {
        const s = skill as Skill;
        this.skills.set(skillId, s);
        this.updateIndexes(s);
        return s;
      }
    }

    return undefined;
  }

  async delete(skillId: string): Promise<void> {
    const skill = this.skills.get(skillId);
    if (skill) {
      this.removeFromIndexes(skill);
    }

    this.skills.delete(skillId);

    if (this.stateStore) {
      await this.stateStore.delete(skillId, "agent", "skills");
    }
  }

  async findApplicable(context: {
    prompt: string;
    tools: string[];
    category?: string;
  }): Promise<Skill[]> {
    const candidates = new Map<string, number>();

    if (context.category) {
      const categorySkills = this.categoryIndex.get(context.category);
      if (categorySkills) {
        for (const skillId of categorySkills) {
          candidates.set(skillId, (candidates.get(skillId) ?? 0) + 10);
        }
      }
    }

    for (const tool of context.tools) {
      const toolSkills = this.toolIndex.get(tool);
      if (toolSkills) {
        for (const skillId of toolSkills) {
          candidates.set(skillId, (candidates.get(skillId) ?? 0) + 5);
        }
      }
    }

    for (const [skillId, skill] of this.skills) {
      const matchScore = this.evaluateTriggerMatch(skill.definition.trigger, context);
      if (matchScore > 0) {
        candidates.set(skillId, (candidates.get(skillId) ?? 0) + matchScore);
      }
    }

    const sortedSkillIds = Array.from(candidates.entries())
      .filter(([, score]) => score > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([skillId]) => skillId);

    const skills: Skill[] = [];
    for (const skillId of sortedSkillIds) {
      const skill = this.skills.get(skillId);
      if (skill) {
        skills.push(skill);
      }
    }

    return skills;
  }

  async recordUsage(skillId: string, outcome: "success" | "failure"): Promise<void> {
    const skill = this.skills.get(skillId);
    if (!skill) {
      throw new Error(`Skill ${skillId} not found`);
    }

    skill.metadata.usageCount++;

    const totalSuccesses = skill.metadata.successRate * (skill.metadata.usageCount - 1);
    if (outcome === "success") {
      skill.metadata.successRate = (totalSuccesses + 1) / skill.metadata.usageCount;
    } else {
      skill.metadata.successRate = totalSuccesses / skill.metadata.usageCount;
    }

    skill.metadata.updatedAt = Date.now();

    if (this.stateStore) {
      await this.stateStore.set(skillId, skill, "agent", "skills");
    }
  }

  async list(filter?: {
    category?: string;
    minSuccessRate?: number;
    minUsageCount?: number;
    author?: "human" | "agent";
  }): Promise<Skill[]> {
    let skills = Array.from(this.skills.values());

    if (filter?.category) {
      skills = skills.filter((s) => s.category === filter.category);
    }

    if (filter?.minSuccessRate !== undefined) {
      const minRate = filter.minSuccessRate;
      skills = skills.filter((s) => s.metadata.successRate >= minRate);
    }

    if (filter?.minUsageCount !== undefined) {
      const minCount = filter.minUsageCount;
      skills = skills.filter((s) => s.metadata.usageCount >= minCount);
    }

    if (filter?.author) {
      skills = skills.filter((s) => s.metadata.author === filter.author);
    }

    return skills.sort((a, b) => b.metadata.successRate - a.metadata.successRate);
  }

  async search(query: string): Promise<Skill[]> {
    const queryLower = query.toLowerCase();
    const results: Array<{ skill: Skill; score: number }> = [];

    for (const skill of this.skills.values()) {
      let score = 0;

      if (skill.name.toLowerCase().includes(queryLower)) {
        score += 10;
      }

      if (skill.description.toLowerCase().includes(queryLower)) {
        score += 5;
      }

      if (skill.category.toLowerCase().includes(queryLower)) {
        score += 3;
      }

      for (const step of skill.definition.steps) {
        if (step.description.toLowerCase().includes(queryLower)) {
          score += 2;
        }
      }

      if (score > 0) {
        results.push({ skill, score });
      }
    }

    return results.sort((a, b) => b.score - a.score).map((r) => r.skill);
  }

  async getCategories(): Promise<string[]> {
    return Array.from(this.categoryIndex.keys()).sort();
  }

  async getStats(): Promise<{
    totalSkills: number;
    byCategory: Record<string, number>;
    byAuthor: Record<string, number>;
    averageSuccessRate: number;
    averageUsageCount: number;
  }> {
    const byCategory: Record<string, number> = {};
    const byAuthor: Record<string, number> = {};
    let totalSuccessRate = 0;
    let totalUsageCount = 0;

    for (const skill of this.skills.values()) {
      byCategory[skill.category] = (byCategory[skill.category] ?? 0) + 1;
      byAuthor[skill.metadata.author] = (byAuthor[skill.metadata.author] ?? 0) + 1;
      totalSuccessRate += skill.metadata.successRate;
      totalUsageCount += skill.metadata.usageCount;
    }

    const count = this.skills.size;

    return {
      totalSkills: count,
      byCategory,
      byAuthor,
      averageSuccessRate: count > 0 ? totalSuccessRate / count : 0,
      averageUsageCount: count > 0 ? totalUsageCount / count : 0,
    };
  }

  async exportToOpenClawFormat(skillId: string): Promise<string> {
    const skill = this.skills.get(skillId);
    if (!skill) {
      throw new Error(`Skill ${skillId} not found`);
    }

    const skillData = {
      name: skill.name,
      description: skill.description,
      trigger: skill.definition.trigger,
      steps: skill.definition.steps,
      tools: skill.definition.tools,
      examples: skill.definition.examples,
      metadata: {
        category: skill.category,
        version: skill.metadata.version,
        confidence: skill.metadata.confidence,
        successRate: skill.metadata.successRate,
        usageCount: skill.metadata.usageCount,
      },
    };

    return JSON.stringify(skillData, null, 2);
  }

  async importFromOpenClawFormat(content: string): Promise<Skill> {
    const data = JSON.parse(content);

    const skill: Skill = {
      id: `skill-${data.name.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`,
      name: data.name,
      description: data.description,
      category: data.metadata?.category ?? "imported",
      definition: {
        trigger: data.trigger,
        steps: data.steps,
        tools: data.tools ?? [],
        examples: data.examples ?? [],
      },
      metadata: {
        createdAt: Date.now(),
        updatedAt: Date.now(),
        version: data.metadata?.version ?? 1,
        author: "human",
        sourceExperience: "",
        confidence: data.metadata?.confidence ?? 0.5,
        usageCount: data.metadata?.usageCount ?? 0,
        successRate: data.metadata?.successRate ?? 0,
      },
    };

    await this.add(skill);
    return skill;
  }

  async exportAll(): Promise<string> {
    const allSkills = Array.from(this.skills.values());
    return JSON.stringify(allSkills, null, 2);
  }

  async importAll(content: string): Promise<number> {
    const skills: Skill[] = JSON.parse(content);
    let imported = 0;

    for (const skill of skills) {
      try {
        await this.add(skill);
        imported++;
      } catch {
        // Skip invalid skills
      }
    }

    return imported;
  }

  private updateIndexes(skill: Skill): void {
    if (!this.categoryIndex.has(skill.category)) {
      this.categoryIndex.set(skill.category, new Set());
    }
    this.categoryIndex.get(skill.category)!.add(skill.id);

    for (const tool of skill.definition.tools) {
      if (!this.toolIndex.has(tool)) {
        this.toolIndex.set(tool, new Set());
      }
      this.toolIndex.get(tool)!.add(skill.id);
    }
  }

  private removeFromIndexes(skill: Skill): void {
    const categorySkills = this.categoryIndex.get(skill.category);
    if (categorySkills) {
      categorySkills.delete(skill.id);
      if (categorySkills.size === 0) {
        this.categoryIndex.delete(skill.category);
      }
    }

    for (const tool of skill.definition.tools) {
      const toolSkills = this.toolIndex.get(tool);
      if (toolSkills) {
        toolSkills.delete(skill.id);
        if (toolSkills.size === 0) {
          this.toolIndex.delete(tool);
        }
      }
    }
  }

  private evaluateTriggerMatch(
    trigger: TriggerCondition,
    context: { prompt: string; tools: string[] }
  ): number {
    switch (trigger.type) {
      case "keyword": {
        const keywords = trigger.condition.toLowerCase().split(/\s+or\s+/);
        const promptLower = context.prompt.toLowerCase();
        for (const keyword of keywords) {
          if (promptLower.includes(keyword.trim())) {
            return 8;
          }
        }
        return 0;
      }

      case "intent": {
        const promptLower = context.prompt.toLowerCase();
        if (promptLower.includes(trigger.condition.toLowerCase())) {
          return 6;
        }
        return 0;
      }

      case "context": {
        const promptLower = context.prompt.toLowerCase();
        if (promptLower.includes(trigger.condition.toLowerCase())) {
          return 4;
        }
        return 0;
      }

      case "pattern": {
        try {
          const regex = new RegExp(trigger.condition, "i");
          if (regex.test(context.prompt)) {
            return 9;
          }
        } catch {
          // Invalid regex
        }
        return 0;
      }

      default:
        return 0;
    }
  }
}

export function createSkillLibrary(options?: {
  stateStore?: IStateStore;
}): SkillLibrary {
  return new SkillLibrary(options);
}
