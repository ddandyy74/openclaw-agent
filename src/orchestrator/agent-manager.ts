/**
 * Agent Manager Implementation
 */

import type {
  AgentInfo,
  AgentRole,
  AgentStatus,
  Heartbeat,
  IAgentManager,
} from "./index.js";

export class AgentManager implements IAgentManager {
  private agents: Map<string, AgentInfo> = new Map();
  private heartbeatTimeout: number;

  constructor(options?: { heartbeatTimeout?: number }) {
    this.heartbeatTimeout = options?.heartbeatTimeout ?? 60000;
  }

  async registerAgent(
    info: Omit<AgentInfo, "createdAt" | "lastHeartbeat">
  ): Promise<string> {
    const agentId = info.id || this.generateAgentId();
    const now = Date.now();

    const agent: AgentInfo = {
      ...info,
      id: agentId,
      createdAt: now,
      lastHeartbeat: now,
    };

    this.agents.set(agentId, agent);
    return agentId;
  }

  async unregisterAgent(agentId: string): Promise<void> {
    this.agents.delete(agentId);
  }

  async getAgent(agentId: string): Promise<AgentInfo | undefined> {
    return this.agents.get(agentId);
  }

  async listAgents(
    filter?: { role?: AgentRole; status?: AgentStatus }
  ): Promise<AgentInfo[]> {
    let agents = Array.from(this.agents.values());

    if (filter?.role) {
      agents = agents.filter((a) => a.role === filter.role);
    }

    if (filter?.status) {
      agents = agents.filter((a) => a.status === filter.status);
    }

    return agents;
  }

  async updateAgentStatus(
    agentId: string,
    status: AgentStatus
  ): Promise<void> {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.status = status;
      agent.lastHeartbeat = Date.now();
    }
  }

  async processHeartbeat(heartbeat: Heartbeat): Promise<void> {
    const agent = this.agents.get(heartbeat.agentId);
    if (agent) {
      agent.status = heartbeat.status;
      agent.currentTasks = heartbeat.currentTasks;
      agent.lastHeartbeat = heartbeat.timestamp;
      if (heartbeat.metrics) {
        agent.metadata = {
          ...agent.metadata,
          metrics: heartbeat.metrics,
        };
      }
    }
  }

  getAvailableAgents(
    role?: AgentRole,
    maxTasks?: number
  ): AgentInfo[] {
    let agents = Array.from(this.agents.values());

    if (role) {
      agents = agents.filter((a) => a.role === role);
    }

    agents = agents.filter((a) => a.status === "idle" || a.status === "waiting");

    if (maxTasks !== undefined && maxTasks > 0) {
      agents = agents.filter((a) => a.currentTasks < maxTasks);
    } else if (maxTasks === undefined) {
      agents = agents.filter((a) => a.currentTasks < a.maxConcurrentTasks);
    }

    return agents;
  }

  checkStaleAgents(): string[] {
    const now = Date.now();
    const staleThreshold = now - this.heartbeatTimeout;
    const staleAgents: string[] = [];

    for (const [id, agent] of this.agents) {
      if (agent.lastHeartbeat < staleThreshold && agent.status !== "offline") {
        agent.status = "offline";
        staleAgents.push(id);
      }
    }

    return staleAgents;
  }

  private generateAgentId(): string {
    return `agent-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }
}
