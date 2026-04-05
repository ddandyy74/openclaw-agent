/**
 * Team Manager Implementation
 * 
 * Manages teams of agents for collaborative work.
 */

import type { CollaborationMode, TeamInfo } from "./types.js";
import type { ITeamManager } from "./interface.js";

export class TeamManager implements ITeamManager {
  private teams: Map<string, TeamInfo> = new Map();

  async createTeam(name: string, mode: CollaborationMode): Promise<TeamInfo> {
    const teamId = this.generateTeamId();

    const team: TeamInfo = {
      id: teamId,
      name,
      mode,
      members: [],
      createdAt: Date.now(),
    };

    this.teams.set(teamId, team);
    return team;
  }

  async deleteTeam(teamId: string): Promise<void> {
    this.teams.delete(teamId);
  }

  async getTeam(teamId: string): Promise<TeamInfo | undefined> {
    return this.teams.get(teamId);
  }

  async listTeams(): Promise<TeamInfo[]> {
    return Array.from(this.teams.values());
  }

  async addMember(teamId: string, agentId: string): Promise<void> {
    const team = this.teams.get(teamId);
    if (!team) {
      throw new Error(`Team ${teamId} not found`);
    }

    if (team.members.includes(agentId)) {
      return;
    }

    team.members.push(agentId);
  }

  async removeMember(teamId: string, agentId: string): Promise<void> {
    const team = this.teams.get(teamId);
    if (!team) {
      throw new Error(`Team ${teamId} not found`);
    }

    const index = team.members.indexOf(agentId);
    if (index >= 0) {
      team.members.splice(index, 1);
    }

    if (team.leaderId === agentId) {
      team.leaderId = undefined;
    }
  }

  async setLeader(teamId: string, agentId: string): Promise<void> {
    const team = this.teams.get(teamId);
    if (!team) {
      throw new Error(`Team ${teamId} not found`);
    }

    if (!team.members.includes(agentId)) {
      throw new Error(`Agent ${agentId} is not a member of team ${teamId}`);
    }

    team.leaderId = agentId;
  }

  async getTeamMembers(teamId: string): Promise<string[]> {
    const team = this.teams.get(teamId);
    return team?.members ?? [];
  }

  async getTeamLeader(teamId: string): Promise<string | undefined> {
    const team = this.teams.get(teamId);
    return team?.leaderId;
  }

  async isMember(teamId: string, agentId: string): Promise<boolean> {
    const team = this.teams.get(teamId);
    return team?.members.includes(agentId) ?? false;
  }

  async getTeamsByAgent(agentId: string): Promise<TeamInfo[]> {
    const teams: TeamInfo[] = [];

    for (const team of this.teams.values()) {
      if (team.members.includes(agentId)) {
        teams.push(team);
      }
    }

    return teams;
  }

  async broadcast(teamId: string, message: unknown): Promise<void> {
    const team = this.teams.get(teamId);
    if (!team) {
      throw new Error(`Team ${teamId} not found`);
    }

    // The actual broadcast is handled by the Orchestrator
    // This method just validates the team exists
  }

  private generateTeamId(): string {
    return `team-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
}
