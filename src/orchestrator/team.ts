/**
 * Team Manager
 * 
 * Manages teams of agents working together in peer-to-peer collaboration mode.
 */

import type { CollaborationMode, TeamInfo } from "../orchestrator/types.js";

export type TeamRole = "leader" | "member" | "specialist" | "observer";

export type TeamStatus = "forming" | "active" | "idle" | "disbanded";

export type TeamMember = {
  agentId: string;
  role: TeamRole;
  capabilities: string[];
  joinedAt: number;
  lastActive: number;
  status: "online" | "offline" | "busy";
  metadata?: Record<string, unknown>;
};

export type TeamConfig = {
  maxMembers: number;
  autoDisband: boolean;
  idleTimeout: number;
  leaderElection: "manual" | "auto" | "rotation";
  consensusThreshold: number;
  messageRetention: number;
};

export type TeamDecision = {
  id: string;
  teamId: string;
  proposal: string;
  proposer: string;
  votes: Map<string, boolean>;
  status: "pending" | "approved" | "rejected" | "expired";
  createdAt: number;
  expiresAt: number;
  result?: boolean;
};

export type TeamEvent = {
  id: string;
  teamId: string;
  type: "team_created" | "member_joined" | "member_left" | "leader_changed" | "decision_made" | "team_disbanded";
  data: Record<string, unknown>;
  timestamp: number;
};

export type TeamEventHandler = {
  onMemberJoined?: (teamId: string, member: TeamMember) => void;
  onMemberLeft?: (teamId: string, agentId: string) => void;
  onLeaderChanged?: (teamId: string, newLeaderId: string, oldLeaderId?: string) => void;
  onDecisionMade?: (teamId: string, decision: TeamDecision) => void;
  onTeamDisbanded?: (teamId: string, reason: string) => void;
};

export interface ITeamManager {
  createTeam(name: string, mode: CollaborationMode, config?: Partial<TeamConfig>): Promise<TeamInfo>;
  deleteTeam(teamId: string): Promise<void>;
  getTeam(teamId: string): Promise<TeamInfo | undefined>;
  listTeams(filter?: { status?: TeamStatus; mode?: CollaborationMode }): Promise<TeamInfo[]>;
  
  addMember(teamId: string, agentId: string, role?: TeamRole, capabilities?: string[]): Promise<TeamMember>;
  removeMember(teamId: string, agentId: string): Promise<void>;
  getMembers(teamId: string): Promise<TeamMember[]>;
  getMember(teamId: string, agentId: string): Promise<TeamMember | undefined>;
  
  setLeader(teamId: string, agentId: string): Promise<void>;
  getLeader(teamId: string): Promise<string | undefined>;
  
  proposeDecision(teamId: string, proposal: string, proposer: string, expiresIn?: number): Promise<TeamDecision>;
  vote(teamId: string, decisionId: string, agentId: string, vote: boolean): Promise<TeamDecision>;
  getDecision(teamId: string, decisionId: string): Promise<TeamDecision | undefined>;
  getPendingDecisions(teamId: string): Promise<TeamDecision[]>;
  
  updateMemberStatus(teamId: string, agentId: string, status: TeamMember["status"]): Promise<void>;
  heartbeat(teamId: string, agentId: string): Promise<void>;
  
  setEventHandler(handler: TeamEventHandler): void;
  getTeamStats(teamId: string): Promise<TeamStats>;
}

export type TeamStats = {
  memberCount: number;
  activeMembers: number;
  onlineMembers: number;
  pendingDecisions: number;
  totalDecisions: number;
  approvedDecisions: number;
  rejectedDecisions: number;
  uptime: number;
  lastActivity: number;
};

export class Team implements ITeamManager {
  private teams: Map<string, TeamInfo> = new Map();
  private members: Map<string, Map<string, TeamMember>> = new Map();
  private decisions: Map<string, Map<string, TeamDecision>> = new Map();
  private events: TeamEvent[] = [];
  private config: Map<string, TeamConfig> = new Map();
  private handler: TeamEventHandler = {};

  private defaultConfig: TeamConfig = {
    maxMembers: 10,
    autoDisband: true,
    idleTimeout: 3600000,
    leaderElection: "manual",
    consensusThreshold: 0.5,
    messageRetention: 86400000,
  };

  async createTeam(
    name: string,
    mode: CollaborationMode,
    config?: Partial<TeamConfig>
  ): Promise<TeamInfo> {
    const teamId = `team-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const teamConfig = { ...this.defaultConfig, ...config };

    const team: TeamInfo = {
      id: teamId,
      name,
      mode,
      members: [],
      createdAt: Date.now(),
    };

    this.teams.set(teamId, team);
    this.members.set(teamId, new Map());
    this.decisions.set(teamId, new Map());
    this.config.set(teamId, teamConfig);

    this.emitEvent(teamId, "team_created", { name, mode });

    return team;
  }

  async deleteTeam(teamId: string): Promise<void> {
    const team = this.teams.get(teamId);
    if (!team) {
      throw new Error(`Team ${teamId} not found`);
    }

    this.emitEvent(teamId, "team_disbanded", { reason: "deleted" });

    if (this.handler.onTeamDisbanded) {
      this.handler.onTeamDisbanded(teamId, "deleted");
    }

    this.teams.delete(teamId);
    this.members.delete(teamId);
    this.decisions.delete(teamId);
    this.config.delete(teamId);
  }

  async getTeam(teamId: string): Promise<TeamInfo | undefined> {
    return this.teams.get(teamId);
  }

  async listTeams(filter?: { status?: TeamStatus; mode?: CollaborationMode }): Promise<TeamInfo[]> {
    let teams = Array.from(this.teams.values());

    if (filter?.mode) {
      teams = teams.filter((t) => t.mode === filter.mode);
    }

    return teams;
  }

  async addMember(
    teamId: string,
    agentId: string,
    role: TeamRole = "member",
    capabilities: string[] = []
  ): Promise<TeamMember> {
    const team = this.teams.get(teamId);
    if (!team) {
      throw new Error(`Team ${teamId} not found`);
    }

    const config = this.config.get(teamId);
    const teamMembers = this.members.get(teamId);

    if (!teamMembers) {
      throw new Error(`Team members map not found for ${teamId}`);
    }

    if (teamMembers.size >= (config?.maxMembers ?? 10)) {
      throw new Error(`Team ${teamId} is full`);
    }

    if (teamMembers.has(agentId)) {
      throw new Error(`Agent ${agentId} is already a member of team ${teamId}`);
    }

    const member: TeamMember = {
      agentId,
      role,
      capabilities,
      joinedAt: Date.now(),
      lastActive: Date.now(),
      status: "online",
    };

    teamMembers.set(agentId, member);
    team.members.push(agentId);

    this.emitEvent(teamId, "member_joined", { agentId, role, capabilities });

    if (this.handler.onMemberJoined) {
      this.handler.onMemberJoined(teamId, member);
    }

    return member;
  }

  async removeMember(teamId: string, agentId: string): Promise<void> {
    const team = this.teams.get(teamId);
    if (!team) {
      throw new Error(`Team ${teamId} not found`);
    }

    const teamMembers = this.members.get(teamId);
    if (!teamMembers || !teamMembers.has(agentId)) {
      throw new Error(`Agent ${agentId} is not a member of team ${teamId}`);
    }

    const wasLeader = team.leaderId === agentId;
    teamMembers.delete(agentId);
    team.members = team.members.filter((id) => id !== agentId);

    this.emitEvent(teamId, "member_left", { agentId, wasLeader });

    if (this.handler.onMemberLeft) {
      this.handler.onMemberLeft(teamId, agentId);
    }

    if (wasLeader) {
      const config = this.config.get(teamId);
      if (config?.leaderElection === "auto" && team.members.length > 0) {
        const newLeader = team.members[0];
        await this.setLeader(teamId, newLeader);
      } else {
        team.leaderId = undefined;
      }
    }

    const config = this.config.get(teamId);
    if (config?.autoDisband && team.members.length === 0) {
      await this.deleteTeam(teamId);
    }
  }

  async getMembers(teamId: string): Promise<TeamMember[]> {
    const teamMembers = this.members.get(teamId);
    if (!teamMembers) {
      return [];
    }
    return Array.from(teamMembers.values());
  }

  async getMember(teamId: string, agentId: string): Promise<TeamMember | undefined> {
    const teamMembers = this.members.get(teamId);
    if (!teamMembers) {
      return undefined;
    }
    return teamMembers.get(agentId);
  }

  async setLeader(teamId: string, agentId: string): Promise<void> {
    const team = this.teams.get(teamId);
    if (!team) {
      throw new Error(`Team ${teamId} not found`);
    }

    const teamMembers = this.members.get(teamId);
    if (!teamMembers || !teamMembers.has(agentId)) {
      throw new Error(`Agent ${agentId} is not a member of team ${teamId}`);
    }

    const oldLeaderId = team.leaderId;
    team.leaderId = agentId;

    const member = teamMembers.get(agentId);
    if (member) {
      member.role = "leader";
    }

    if (oldLeaderId) {
      const oldLeader = teamMembers.get(oldLeaderId);
      if (oldLeader) {
        oldLeader.role = "member";
      }
    }

    this.emitEvent(teamId, "leader_changed", { newLeader: agentId, oldLeader: oldLeaderId });

    if (this.handler.onLeaderChanged) {
      this.handler.onLeaderChanged(teamId, agentId, oldLeaderId);
    }
  }

  async getLeader(teamId: string): Promise<string | undefined> {
    const team = this.teams.get(teamId);
    return team?.leaderId;
  }

  async proposeDecision(
    teamId: string,
    proposal: string,
    proposer: string,
    expiresIn: number = 3600000
  ): Promise<TeamDecision> {
    const team = this.teams.get(teamId);
    if (!team) {
      throw new Error(`Team ${teamId} not found`);
    }

    const teamMembers = this.members.get(teamId);
    if (!teamMembers || !teamMembers.has(proposer)) {
      throw new Error(`Agent ${proposer} is not a member of team ${teamId}`);
    }

    const decisionId = `decision-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const decision: TeamDecision = {
      id: decisionId,
      teamId,
      proposal,
      proposer,
      votes: new Map(),
      status: "pending",
      createdAt: Date.now(),
      expiresAt: Date.now() + expiresIn,
    };

    const teamDecisions = this.decisions.get(teamId);
    if (teamDecisions) {
      teamDecisions.set(decisionId, decision);
    }

    return decision;
  }

  async vote(
    teamId: string,
    decisionId: string,
    agentId: string,
    vote: boolean
  ): Promise<TeamDecision> {
    const team = this.teams.get(teamId);
    if (!team) {
      throw new Error(`Team ${teamId} not found`);
    }

    const teamMembers = this.members.get(teamId);
    if (!teamMembers || !teamMembers.has(agentId)) {
      throw new Error(`Agent ${agentId} is not a member of team ${teamId}`);
    }

    const teamDecisions = this.decisions.get(teamId);
    if (!teamDecisions) {
      throw new Error(`Team ${teamId} has no decisions`);
    }

    const decision = teamDecisions.get(decisionId);
    if (!decision) {
      throw new Error(`Decision ${decisionId} not found`);
    }

    if (decision.status !== "pending") {
      throw new Error(`Decision ${decisionId} is already ${decision.status}`);
    }

    if (Date.now() > decision.expiresAt) {
      decision.status = "expired";
      throw new Error(`Decision ${decisionId} has expired`);
    }

    decision.votes.set(agentId, vote);

    const config = this.config.get(teamId);
    const threshold = config?.consensusThreshold ?? 0.5;
    const totalMembers = team.members.length;
    const votesFor = Array.from(decision.votes.values()).filter((v) => v).length;
    const votesAgainst = Array.from(decision.votes.values()).filter((v) => !v).length;

    if (votesFor / totalMembers >= threshold) {
      decision.status = "approved";
      decision.result = true;
      this.emitEvent(teamId, "decision_made", { decisionId, result: true });
    } else if (votesAgainst / totalMembers > 1 - threshold) {
      decision.status = "rejected";
      decision.result = false;
      this.emitEvent(teamId, "decision_made", { decisionId, result: false });
    }

    if (this.handler.onDecisionMade && decision.status !== "pending") {
      this.handler.onDecisionMade(teamId, decision);
    }

    return decision;
  }

  async getDecision(teamId: string, decisionId: string): Promise<TeamDecision | undefined> {
    const teamDecisions = this.decisions.get(teamId);
    if (!teamDecisions) {
      return undefined;
    }
    return teamDecisions.get(decisionId);
  }

  async getPendingDecisions(teamId: string): Promise<TeamDecision[]> {
    const teamDecisions = this.decisions.get(teamId);
    if (!teamDecisions) {
      return [];
    }

    const now = Date.now();
    const pending: TeamDecision[] = [];

    for (const decision of teamDecisions.values()) {
      if (decision.status === "pending") {
        if (now > decision.expiresAt) {
          decision.status = "expired";
        } else {
          pending.push(decision);
        }
      }
    }

    return pending;
  }

  async updateMemberStatus(teamId: string, agentId: string, status: TeamMember["status"]): Promise<void> {
    const teamMembers = this.members.get(teamId);
    if (!teamMembers) {
      throw new Error(`Team ${teamId} not found`);
    }

    const member = teamMembers.get(agentId);
    if (!member) {
      throw new Error(`Agent ${agentId} is not a member of team ${teamId}`);
    }

    member.status = status;
    member.lastActive = Date.now();
  }

  async heartbeat(teamId: string, agentId: string): Promise<void> {
    await this.updateMemberStatus(teamId, agentId, "online");
  }

  setEventHandler(handler: TeamEventHandler): void {
    this.handler = { ...this.handler, ...handler };
  }

  async getTeamStats(teamId: string): Promise<TeamStats> {
    const team = this.teams.get(teamId);
    if (!team) {
      throw new Error(`Team ${teamId} not found`);
    }

    const teamMembers = this.members.get(teamId);
    const teamDecisions = this.decisions.get(teamId);

    const members = teamMembers ? Array.from(teamMembers.values()) : [];
    const decisions = teamDecisions ? Array.from(teamDecisions.values()) : [];

    return {
      memberCount: members.length,
      activeMembers: members.filter((m) => m.status !== "offline").length,
      onlineMembers: members.filter((m) => m.status === "online").length,
      pendingDecisions: decisions.filter((d) => d.status === "pending").length,
      totalDecisions: decisions.length,
      approvedDecisions: decisions.filter((d) => d.status === "approved").length,
      rejectedDecisions: decisions.filter((d) => d.status === "rejected").length,
      uptime: Date.now() - team.createdAt,
      lastActivity: Math.max(...members.map((m) => m.lastActive), 0),
    };
  }

  private emitEvent(teamId: string, type: TeamEvent["type"], data: Record<string, unknown>): void {
    const event: TeamEvent = {
      id: `event-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      teamId,
      type,
      data,
      timestamp: Date.now(),
    };

    this.events.push(event);

    const config = this.config.get(teamId);
    const retention = config?.messageRetention ?? 86400000;
    const cutoff = Date.now() - retention;
    this.events = this.events.filter((e) => e.timestamp > cutoff);
  }

  getEvents(teamId: string, since?: number): TeamEvent[] {
    let events = this.events.filter((e) => e.teamId === teamId);
    if (since) {
      events = events.filter((e) => e.timestamp >= since);
    }
    return events;
  }
}
