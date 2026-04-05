/**
 * Agent Integration with Multi-Agent Modules
 * 
 * Provides integration points between OpenClaw agents and:
 * - Orchestrator (multi-agent coordination)
 * - Mailbox (inter-agent messaging)
 * - Workflow (task workflows)
 * - Evolution (self-improvement)
 */

import type { AgentInfo, IOrchestrator, CollaborationMode } from "../orchestrator/index.js";
import type { IMailboxManager, MailboxMessage } from "../mailbox/index.js";
import type { IStateStore } from "../persistence/types.js";
import type { EvolutionEngine, EvolutionEngineDeps } from "../evolution/index.js";

export interface AgentOrchestrationConfig {
  agentId: string;
  role: "coordinator" | "worker" | "teammate" | "leader";
  capabilities: string[];
  maxConcurrentTasks?: number;
  collaborationMode?: CollaborationMode;
}

export interface AgentMailboxConfig {
  agentId: string;
  handlers?: Map<string, (message: MailboxMessage) => Promise<void>>;
}

export interface AgentEvolutionConfig {
  agentType: string;
  basePrompt?: string;
  evolutionEnabled?: boolean;
}

export class AgentIntegration {
  private orchestrator: IOrchestrator | null = null;
  private mailboxManager: IMailboxManager | null = null;
  private evolutionEngine: EvolutionEngine | null = null;
  private stateStore: IStateStore | null = null;
  private agentId: string;

  constructor(agentId: string) {
    this.agentId = agentId;
  }

  setOrchestrator(orchestrator: IOrchestrator): void {
    this.orchestrator = orchestrator;
  }

  setMailboxManager(mailboxManager: IMailboxManager): void {
    this.mailboxManager = mailboxManager;
  }

  setEvolutionEngine(evolutionEngine: EvolutionEngine): void {
    this.evolutionEngine = evolutionEngine;
  }

  setStateStore(stateStore: IStateStore): void {
    this.stateStore = stateStore;
  }

  async registerWithOrchestrator(config: AgentOrchestrationConfig): Promise<void> {
    if (!this.orchestrator) {
      throw new Error("Orchestrator not set");
    }

    const agentInfo: Omit<AgentInfo, "createdAt" | "lastHeartbeat"> = {
      id: config.agentId,
      role: config.role,
      status: "idle",
      capabilities: config.capabilities,
      maxConcurrentTasks: config.maxConcurrentTasks ?? 1,
      currentTasks: 0,
    };

    await this.orchestrator.getAgentManager().registerAgent(agentInfo);
  }

  async unregisterFromOrchestrator(): Promise<void> {
    if (!this.orchestrator) {
      return;
    }

    await this.orchestrator.getAgentManager().unregisterAgent(this.agentId);
  }

  async setupMailbox(config: AgentMailboxConfig): Promise<void> {
    if (!this.mailboxManager) {
      throw new Error("Mailbox manager not set");
    }

    await this.mailboxManager.createMailbox(config.agentId);

    if (config.handlers) {
      for (const [type, handler] of config.handlers) {
        await this.mailboxManager.subscribe(config.agentId, handler, { type: type as any });
      }
    }
  }

  async sendMessage(to: string, type: string, body: unknown): Promise<void> {
    if (!this.mailboxManager) {
      throw new Error("Mailbox manager not set");
    }

    await this.mailboxManager.sendMessage(this.agentId, to, {
      type: type as any,
      priority: "normal",
      body,
    });
  }

  async broadcastMessage(teamId: string, type: string, body: unknown): Promise<void> {
    if (!this.mailboxManager) {
      throw new Error("Mailbox manager not set");
    }

    await this.mailboxManager.broadcast(this.agentId, teamId, {
      type: type as any,
      priority: "normal",
      body,
    });
  }

  async initializeEvolution(config: AgentEvolutionConfig): Promise<void> {
    if (!this.evolutionEngine) {
      throw new Error("Evolution engine not set");
    }

    const deps: EvolutionEngineDeps = {
      stateStore: this.stateStore ?? undefined,
    };

    await this.evolutionEngine.initialize({
      enabled: config.evolutionEnabled ?? true,
      evolutionInterval: 3600000, // 1 hour
      minExperiencesForEvolution: 10,
      minUsageForOptimization: 5,
      promptOptimizationEnabled: true,
      skillLearningEnabled: true,
      autoDeployThreshold: 0.8,
      maxCostPerEvolution: 1.0,
      cacheEnabled: true,
    });

    if (config.basePrompt) {
      // Note: PromptOptimizer is internal to EvolutionEngine
      // In the future, we could expose setBasePrompt through the engine
    }
  }

  async collectExperience(session: {
    taskId: string;
    prompt: string;
    steps: unknown[];
    toolCalls: unknown[];
    decisions: unknown[];
    errors: unknown[];
    outcome: { status: string; tokensUsed: number; duration: number };
  }): Promise<void> {
    if (!this.evolutionEngine) {
      return;
    }

    await this.evolutionEngine.collectExperience({
      taskId: session.taskId,
      agentType: this.agentId,
      prompt: session.prompt,
      systemPrompt: "",
      tools: [],
      model: "default",
      steps: session.steps as any[],
      toolCalls: session.toolCalls as any[],
      decisions: session.decisions as any[],
      errors: session.errors as any[],
      recoveries: [],
      outcome: { ...session.outcome, userInterventions: 0 } as any,
    });
  }

  async shutdown(): Promise<void> {
    await this.unregisterFromOrchestrator();

    if (this.evolutionEngine) {
      await this.evolutionEngine.stop();
    }
  }
}

export function createAgentIntegration(
  agentId: string,
  options?: {
    orchestrator?: IOrchestrator;
    mailboxManager?: IMailboxManager;
    evolutionEngine?: EvolutionEngine;
    stateStore?: IStateStore;
  },
): AgentIntegration {
  const integration = new AgentIntegration(agentId);

  if (options?.orchestrator) {
    integration.setOrchestrator(options.orchestrator);
  }

  if (options?.mailboxManager) {
    integration.setMailboxManager(options.mailboxManager);
  }

  if (options?.evolutionEngine) {
    integration.setEvolutionEngine(options.evolutionEngine);
  }

  if (options?.stateStore) {
    integration.setStateStore(options.stateStore);
  }

  return integration;
}
