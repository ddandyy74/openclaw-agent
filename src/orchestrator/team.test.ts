import { describe, it, expect, beforeEach, vi } from "vitest";
import { Team, type TeamMember, type TeamConfig, type TeamDecision } from "./team.js";

describe("Team", () => {
  let team: Team;

  beforeEach(() => {
    team = new Team();
  });

  describe("createTeam", () => {
    it("should create a team with default config", async () => {
      const teamInfo = await team.createTeam("Test Team", "teammate");

      expect(teamInfo.id).toBeDefined();
      expect(teamInfo.name).toBe("Test Team");
      expect(teamInfo.mode).toBe("teammate");
      expect(teamInfo.members).toEqual([]);
      expect(teamInfo.createdAt).toBeDefined();
    });

    it("should create a team with custom config", async () => {
      const config: Partial<TeamConfig> = {
        maxMembers: 5,
        autoDisband: false,
        idleTimeout: 7200000,
        leaderElection: "auto",
        consensusThreshold: 0.7,
      };

      const teamInfo = await team.createTeam("Custom Team", "swarm", config);

      expect(teamInfo.id).toBeDefined();
      expect(teamInfo.mode).toBe("swarm");
    });

    it("should create multiple teams", async () => {
      const team1 = await team.createTeam("Team 1", "teammate");
      const team2 = await team.createTeam("Team 2", "coordinator-worker");

      expect(team1.id).not.toBe(team2.id);

      const teams = await team.listTeams();
      expect(teams).toHaveLength(2);
    });
  });

  describe("deleteTeam", () => {
    it("should delete a team", async () => {
      const teamInfo = await team.createTeam("Test Team", "teammate");
      await team.deleteTeam(teamInfo.id);

      const deleted = await team.getTeam(teamInfo.id);
      expect(deleted).toBeUndefined();
    });

    it("should throw error for non-existent team", async () => {
      await expect(team.deleteTeam("non-existent")).rejects.toThrow("not found");
    });
  });

  describe("getTeam", () => {
    it("should return team info", async () => {
      const created = await team.createTeam("Test Team", "teammate");
      const retrieved = await team.getTeam(created.id);

      expect(retrieved).toEqual(created);
    });

    it("should return undefined for non-existent team", async () => {
      const retrieved = await team.getTeam("non-existent");
      expect(retrieved).toBeUndefined();
    });
  });

  describe("listTeams", () => {
    it("should list all teams", async () => {
      await team.createTeam("Team 1", "teammate");
      await team.createTeam("Team 2", "coordinator-worker");

      const teams = await team.listTeams();
      expect(teams).toHaveLength(2);
    });

    it("should filter teams by mode", async () => {
      await team.createTeam("Team 1", "teammate");
      await team.createTeam("Team 2", "coordinator-worker");

      const teammateTeams = await team.listTeams({ mode: "teammate" });
      expect(teammateTeams).toHaveLength(1);
      expect(teammateTeams[0].mode).toBe("teammate");
    });
  });

  describe("addMember", () => {
    let teamId: string;

    beforeEach(async () => {
      const teamInfo = await team.createTeam("Test Team", "teammate");
      teamId = teamInfo.id;
    });

    it("should add a member to the team", async () => {
      const member = await team.addMember(teamId, "agent-1", "member", ["code", "test"]);

      expect(member.agentId).toBe("agent-1");
      expect(member.role).toBe("member");
      expect(member.capabilities).toEqual(["code", "test"]);
      expect(member.status).toBe("online");

      const members = await team.getMembers(teamId);
      expect(members).toHaveLength(1);
    });

    it("should add member to team members list", async () => {
      await team.addMember(teamId, "agent-1");

      const teamInfo = await team.getTeam(teamId);
      expect(teamInfo?.members).toContain("agent-1");
    });

    it("should throw error for non-existent team", async () => {
      await expect(team.addMember("non-existent", "agent-1")).rejects.toThrow("not found");
    });

    it("should throw error for duplicate member", async () => {
      await team.addMember(teamId, "agent-1");
      await expect(team.addMember(teamId, "agent-1")).rejects.toThrow("already a member");
    });

    it("should throw error when team is full", async () => {
      const smallTeam = await team.createTeam("Small Team", "teammate", { maxMembers: 1 });
      await team.addMember(smallTeam.id, "agent-1");

      await expect(team.addMember(smallTeam.id, "agent-2")).rejects.toThrow("is full");
    });
  });

  describe("removeMember", () => {
    let teamId: string;

    beforeEach(async () => {
      const teamInfo = await team.createTeam("Test Team", "teammate");
      teamId = teamInfo.id;
      await team.addMember(teamId, "agent-1");
      await team.addMember(teamId, "agent-2");
    });

    it("should remove a member from the team", async () => {
      await team.removeMember(teamId, "agent-1");

      const members = await team.getMembers(teamId);
      expect(members).toHaveLength(1);
      expect(members[0].agentId).toBe("agent-2");
    });

    it("should update team members list", async () => {
      await team.removeMember(teamId, "agent-1");

      const teamInfo = await team.getTeam(teamId);
      expect(teamInfo?.members).not.toContain("agent-1");
    });

    it("should throw error for non-existent member", async () => {
      await expect(team.removeMember(teamId, "non-existent")).rejects.toThrow("not a member");
    });

    it("should auto-elect new leader when leader leaves", async () => {
      const autoTeamInfo = await team.createTeam("Auto Team", "teammate", { leaderElection: "auto" });
      await team.addMember(autoTeamInfo.id, "agent-1");
      await team.addMember(autoTeamInfo.id, "agent-2");
      
      await team.setLeader(autoTeamInfo.id, "agent-1");
      await team.removeMember(autoTeamInfo.id, "agent-1");

      const leader = await team.getLeader(autoTeamInfo.id);
      expect(leader).toBe("agent-2");
    });
  });

  describe("setLeader", () => {
    let teamId: string;

    beforeEach(async () => {
      const teamInfo = await team.createTeam("Test Team", "teammate");
      teamId = teamInfo.id;
      await team.addMember(teamId, "agent-1");
      await team.addMember(teamId, "agent-2");
    });

    it("should set the leader", async () => {
      await team.setLeader(teamId, "agent-1");

      const leader = await team.getLeader(teamId);
      expect(leader).toBe("agent-1");
    });

    it("should update team leaderId", async () => {
      await team.setLeader(teamId, "agent-1");

      const teamInfo = await team.getTeam(teamId);
      expect(teamInfo?.leaderId).toBe("agent-1");
    });

    it("should update member role to leader", async () => {
      await team.setLeader(teamId, "agent-1");

      const member = await team.getMember(teamId, "agent-1");
      expect(member?.role).toBe("leader");
    });

    it("should demote previous leader", async () => {
      await team.setLeader(teamId, "agent-1");
      await team.setLeader(teamId, "agent-2");

      const previousLeader = await team.getMember(teamId, "agent-1");
      expect(previousLeader?.role).toBe("member");
    });

    it("should throw error for non-member", async () => {
      await expect(team.setLeader(teamId, "non-member")).rejects.toThrow("not a member");
    });
  });

  describe("proposeDecision", () => {
    let teamId: string;

    beforeEach(async () => {
      const teamInfo = await team.createTeam("Test Team", "teammate");
      teamId = teamInfo.id;
      await team.addMember(teamId, "agent-1");
    });

    it("should create a decision proposal", async () => {
      const decision = await team.proposeDecision(teamId, "Approve feature X", "agent-1");

      expect(decision.id).toBeDefined();
      expect(decision.teamId).toBe(teamId);
      expect(decision.proposal).toBe("Approve feature X");
      expect(decision.proposer).toBe("agent-1");
      expect(decision.status).toBe("pending");
      expect(decision.votes.size).toBe(0);
    });

    it("should set default expiration", async () => {
      const decision = await team.proposeDecision(teamId, "Test", "agent-1");

      expect(decision.expiresAt).toBeGreaterThan(Date.now());
    });

    it("should throw error for non-member proposer", async () => {
      await expect(team.proposeDecision(teamId, "Test", "non-member")).rejects.toThrow("not a member");
    });
  });

  describe("vote", () => {
    let teamId: string;
    let decisionId: string;

    beforeEach(async () => {
      const teamInfo = await team.createTeam("Test Team", "teammate", { consensusThreshold: 0.6 });
      teamId = teamInfo.id;
      await team.addMember(teamId, "agent-1");
      await team.addMember(teamId, "agent-2");
      await team.addMember(teamId, "agent-3");
      await team.addMember(teamId, "agent-4");
      await team.addMember(teamId, "agent-5");

      const decision = await team.proposeDecision(teamId, "Test proposal", "agent-1");
      decisionId = decision.id;
    });

    it("should record a vote", async () => {
      const updated = await team.vote(teamId, decisionId, "agent-1", true);

      expect(updated.votes.get("agent-1")).toBe(true);
    });

    it("should approve decision when consensus reached", async () => {
      await team.vote(teamId, decisionId, "agent-1", true);
      await team.vote(teamId, decisionId, "agent-2", true);
      const updated = await team.vote(teamId, decisionId, "agent-3", true);

      expect(updated.status).toBe("approved");
      expect(updated.result).toBe(true);
    });

    it("should reject decision when enough votes against", async () => {
      await team.vote(teamId, decisionId, "agent-1", false);
      await team.vote(teamId, decisionId, "agent-2", false);
      const updated = await team.vote(teamId, decisionId, "agent-3", false);

      expect(updated.status).toBe("rejected");
      expect(updated.result).toBe(false);
    });

    it("should throw error for non-member vote", async () => {
      await expect(team.vote(teamId, decisionId, "non-member", true)).rejects.toThrow("not a member");
    });

    it("should throw error for expired decision", async () => {
      const expiredDecision = await team.proposeDecision(teamId, "Expired", "agent-1", -1000);

      await expect(team.vote(teamId, expiredDecision.id, "agent-1", true)).rejects.toThrow("expired");
    });
  });

  describe("getDecision", () => {
    it("should return decision by id", async () => {
      const teamInfo = await team.createTeam("Test", "teammate");
      await team.addMember(teamInfo.id, "agent-1");

      const decision = await team.proposeDecision(teamInfo.id, "Test", "agent-1");
      const retrieved = await team.getDecision(teamInfo.id, decision.id);

      expect(retrieved).toEqual(decision);
    });
  });

  describe("getPendingDecisions", () => {
    it("should return only pending decisions", async () => {
      const teamInfo = await team.createTeam("Test", "teammate", { consensusThreshold: 0.7 });
      await team.addMember(teamInfo.id, "agent-1");
      await team.addMember(teamInfo.id, "agent-2");

      const decision1 = await team.proposeDecision(teamInfo.id, "Decision 1", "agent-1");
      const decision2 = await team.proposeDecision(teamInfo.id, "Decision 2", "agent-1");

      await team.vote(teamInfo.id, decision1.id, "agent-1", true);
      await team.vote(teamInfo.id, decision1.id, "agent-2", true);

      const pending = await team.getPendingDecisions(teamInfo.id);
      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe(decision2.id);
    });
  });

  describe("updateMemberStatus", () => {
    it("should update member status", async () => {
      const teamInfo = await team.createTeam("Test", "teammate");
      await team.addMember(teamInfo.id, "agent-1");

      await team.updateMemberStatus(teamInfo.id, "agent-1", "busy");

      const member = await team.getMember(teamInfo.id, "agent-1");
      expect(member?.status).toBe("busy");
    });
  });

  describe("heartbeat", () => {
    it("should update member status to online", async () => {
      const teamInfo = await team.createTeam("Test", "teammate");
      await team.addMember(teamInfo.id, "agent-1");

      await team.updateMemberStatus(teamInfo.id, "agent-1", "offline");
      await team.heartbeat(teamInfo.id, "agent-1");

      const member = await team.getMember(teamInfo.id, "agent-1");
      expect(member?.status).toBe("online");
    });
  });

  describe("getTeamStats", () => {
    it("should return team statistics", async () => {
      const teamInfo = await team.createTeam("Test", "teammate", { consensusThreshold: 0.7 });
      await team.addMember(teamInfo.id, "agent-1");
      await team.addMember(teamInfo.id, "agent-2");
      await team.addMember(teamInfo.id, "agent-3");
      await team.updateMemberStatus(teamInfo.id, "agent-2", "offline");

      const decision = await team.proposeDecision(teamInfo.id, "Test", "agent-1");
      await team.vote(teamInfo.id, decision.id, "agent-1", true);
      await team.vote(teamInfo.id, decision.id, "agent-2", true);
      await team.vote(teamInfo.id, decision.id, "agent-3", true);

      const stats = await team.getTeamStats(teamInfo.id);

      expect(stats.memberCount).toBe(3);
      expect(stats.onlineMembers).toBe(2);
      expect(stats.totalDecisions).toBe(1);
      expect(stats.approvedDecisions).toBe(1);
    });
  });

  describe("event handlers", () => {
    it("should call onMemberJoined handler", async () => {
      const handler = { onMemberJoined: vi.fn() };
      team.setEventHandler(handler);

      const teamInfo = await team.createTeam("Test", "teammate");
      await team.addMember(teamInfo.id, "agent-1");

      expect(handler.onMemberJoined).toHaveBeenCalledWith(
        teamInfo.id,
        expect.objectContaining({ agentId: "agent-1" })
      );
    });

    it("should call onLeaderChanged handler", async () => {
      const handler = { onLeaderChanged: vi.fn() };
      team.setEventHandler(handler);

      const teamInfo = await team.createTeam("Test", "teammate");
      await team.addMember(teamInfo.id, "agent-1");
      await team.setLeader(teamInfo.id, "agent-1");

      expect(handler.onLeaderChanged).toHaveBeenCalledWith(teamInfo.id, "agent-1", undefined);
    });

    it("should call onDecisionMade handler", async () => {
      const handler = { onDecisionMade: vi.fn() };
      team.setEventHandler(handler);

      const teamInfo = await team.createTeam("Test", "teammate", { consensusThreshold: 0.7 });
      await team.addMember(teamInfo.id, "agent-1");
      await team.addMember(teamInfo.id, "agent-2");
      await team.addMember(teamInfo.id, "agent-3");

      const decision = await team.proposeDecision(teamInfo.id, "Test", "agent-1");
      await team.vote(teamInfo.id, decision.id, "agent-1", true);
      await team.vote(teamInfo.id, decision.id, "agent-2", true);
      await team.vote(teamInfo.id, decision.id, "agent-3", true);

      expect(handler.onDecisionMade).toHaveBeenCalled();
    });
  });
});
