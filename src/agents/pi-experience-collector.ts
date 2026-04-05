import type { Experience, ExecutionStep, ToolCallRecord, DecisionPoint, ErrorRecord, RecoveryAction, ExperienceType } from "../evolution/types.js";
import type { EvolutionEngine } from "../evolution/index.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("agent/experience");

export type PiSessionEvent = {
  type: "session_start";
  sessionId: string;
  agentId: string;
  prompt: string;
  systemPrompt?: string;
  tools: string[];
  model: string;
} | {
  type: "session_end";
  sessionId: string;
  status: "success" | "partial" | "failure";
  tokensUsed: number;
  duration: number;
  userInterventions: number;
} | {
  type: "tool_call";
  sessionId: string;
  tool: string;
  input: unknown;
  output?: unknown;
  duration?: number;
  success: boolean;
  error?: string;
} | {
  type: "decision";
  sessionId: string;
  context: string;
  options: string[];
  chosen: string;
  reason?: string;
} | {
  type: "error";
  sessionId: string;
  error: string;
  stack?: string;
  recovered: boolean;
  recoveryAction?: string;
};

export type PiExperienceCollectorOptions = {
  evolutionEngine?: EvolutionEngine;
  enabled?: boolean;
  minDuration?: number;
  excludedAgents?: Set<string>;
};

type SessionState = {
  sessionId: string;
  agentId: string;
  prompt: string;
  systemPrompt: string;
  tools: string[];
  model: string;
  startTime: number;
  steps: ExecutionStep[];
  toolCalls: ToolCallRecord[];
  decisions: DecisionPoint[];
  errors: ErrorRecord[];
  recoveries: RecoveryAction[];
};

export class PiExperienceCollector {
  private evolutionEngine: EvolutionEngine | null;
  private enabled: boolean;
  private minDuration: number;
  private excludedAgents: Set<string>;
  private activeSessions: Map<string, SessionState> = new Map();

  constructor(options: PiExperienceCollectorOptions = {}) {
    this.evolutionEngine = options.evolutionEngine ?? null;
    this.enabled = options.enabled ?? true;
    this.minDuration = options.minDuration ?? 1000;
    this.excludedAgents = options.excludedAgents ?? new Set();
  }

  setEvolutionEngine(engine: EvolutionEngine): void {
    this.evolutionEngine = engine;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  handleEvent(event: PiSessionEvent): void {
    if (!this.enabled) {
      return;
    }

    switch (event.type) {
      case "session_start":
        this.handleSessionStart(event);
        break;
      case "session_end":
        this.handleSessionEnd(event);
        break;
      case "tool_call":
        this.handleToolCall(event);
        break;
      case "decision":
        this.handleDecision(event);
        break;
      case "error":
        this.handleError(event);
        break;
    }
  }

  private handleSessionStart(event: PiSessionEvent & { type: "session_start" }): void {
    if (this.excludedAgents.has(event.agentId)) {
      log.debug(`Skipping experience collection for excluded agent: ${event.agentId}`);
      return;
    }

    const state: SessionState = {
      sessionId: event.sessionId,
      agentId: event.agentId,
      prompt: event.prompt,
      systemPrompt: event.systemPrompt ?? "",
      tools: event.tools,
      model: event.model,
      startTime: Date.now(),
      steps: [],
      toolCalls: [],
      decisions: [],
      errors: [],
      recoveries: [],
    };

    this.activeSessions.set(event.sessionId, state);
    log.debug(`Started experience collection for session: ${event.sessionId}`);
  }

  private handleSessionEnd(event: PiSessionEvent & { type: "session_end" }): void {
    const state = this.activeSessions.get(event.sessionId);
    if (!state) {
      return;
    }

    this.activeSessions.delete(event.sessionId);

    const duration = Date.now() - state.startTime;
    if (duration < this.minDuration) {
      log.debug(`Skipping experience for short session: ${event.sessionId} (${duration}ms)`);
      return;
    }

    this.collectExperience(state, event).catch((err) => {
      log.error(`Failed to collect experience for session ${event.sessionId}: ${err}`);
    });
  }

  private handleToolCall(event: PiSessionEvent & { type: "tool_call" }): void {
    const state = this.activeSessions.get(event.sessionId);
    if (!state) {
      return;
    }

    const toolCall: ToolCallRecord = {
      tool: event.tool,
      input: event.input,
      output: event.output,
      timestamp: Date.now(),
      duration: event.duration,
      success: event.success,
      error: event.error,
    };

    state.toolCalls.push(toolCall);
  }

  private handleDecision(event: PiSessionEvent & { type: "decision" }): void {
    const state = this.activeSessions.get(event.sessionId);
    if (!state) {
      return;
    }

    const decision: DecisionPoint = {
      id: `decision-${state.decisions.length + 1}`,
      context: event.context,
      options: event.options,
      chosen: event.chosen,
      reason: event.reason,
      timestamp: Date.now(),
    };

    state.decisions.push(decision);
  }

  private handleError(event: PiSessionEvent & { type: "error" }): void {
    const state = this.activeSessions.get(event.sessionId);
    if (!state) {
      return;
    }

    const error: ErrorRecord = {
      id: `error-${state.errors.length + 1}`,
      error: event.error,
      stack: event.stack,
      timestamp: Date.now(),
      recovered: event.recovered,
      recoveryAction: event.recoveryAction,
    };

    state.errors.push(error);

    if (event.recovered && event.recoveryAction) {
      const recovery: RecoveryAction = {
        errorId: error.id,
        action: event.recoveryAction,
        success: true,
        timestamp: Date.now(),
      };
      state.recoveries.push(recovery);
    }
  }

  private async collectExperience(state: SessionState, endEvent: PiSessionEvent & { type: "session_end" }): Promise<void> {
    if (!this.evolutionEngine) {
      log.debug("Evolution engine not set, skipping experience collection");
      return;
    }

    const experience = await this.evolutionEngine.collectExperience({
      taskId: state.sessionId,
      agentType: state.agentId,
      prompt: state.prompt,
      systemPrompt: state.systemPrompt,
      tools: state.tools,
      model: state.model,
      steps: state.steps,
      toolCalls: state.toolCalls,
      decisions: state.decisions,
      errors: state.errors,
      recoveries: state.recoveries,
      outcome: {
        status: endEvent.status as ExperienceType,
        tokensUsed: endEvent.tokensUsed,
        duration: endEvent.duration,
        userInterventions: endEvent.userInterventions,
      },
    });

    log.debug(`Collected experience ${experience.id} for session ${state.sessionId}`);
  }

  getSessionState(sessionId: string): SessionState | undefined {
    return this.activeSessions.get(sessionId);
  }

  getActiveSessionCount(): number {
    return this.activeSessions.size;
  }
}

let globalCollector: PiExperienceCollector | null = null;

export function getPiExperienceCollector(): PiExperienceCollector {
  if (!globalCollector) {
    globalCollector = new PiExperienceCollector();
  }
  return globalCollector;
}

export function setPiExperienceCollector(collector: PiExperienceCollector): void {
  globalCollector = collector;
}
