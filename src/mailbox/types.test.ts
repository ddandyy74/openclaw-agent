import { describe, it, expect } from "vitest";
import type {
  MailboxMessage,
  MessageType,
  MessagePriority,
  MessageStatus,
  Mailbox,
  MailboxConfig,
  MessageFilter,
  Subscription,
} from "./types.js";

describe("Mailbox Types", () => {
  describe("MailboxMessage", () => {
    it("should create a valid direct message", () => {
      const message: MailboxMessage = {
        id: "msg-1",
        from: "agent-1",
        to: "agent-2",
        type: "direct",
        priority: "normal",
        subject: "Task update",
        body: { status: "completed" },
        createdAt: Date.now(),
      };

      expect(message.type).toBe("direct");
      expect(message.to).toBe("agent-2");
      expect(message.subject).toBe("Task update");
    });

    it("should create a valid broadcast message", () => {
      const message: MailboxMessage = {
        id: "msg-2",
        from: "coordinator",
        to: "team-alpha",
        type: "broadcast",
        priority: "high",
        body: { announcement: "New task available" },
        createdAt: Date.now(),
      };

      expect(message.type).toBe("broadcast");
      expect(message.priority).toBe("high");
    });

    it("should create a valid request/response pair", () => {
      const request: MailboxMessage = {
        id: "req-1",
        from: "agent-1",
        to: "agent-2",
        type: "request",
        priority: "normal",
        subject: "Need data",
        body: { query: "SELECT * FROM users" },
        createdAt: Date.now(),
      };

      const response: MailboxMessage = {
        id: "res-1",
        from: "agent-2",
        to: "agent-1",
        type: "response",
        priority: "normal",
        subject: "Re: Need data",
        body: { data: [{ id: 1, name: "User" }] },
        correlationId: "req-1",
        replyTo: "req-1",
        createdAt: Date.now(),
      };

      expect(request.type).toBe("request");
      expect(response.type).toBe("response");
      expect(response.correlationId).toBe("req-1");
    });

    it("should support all message types", () => {
      const types: MessageType[] = ["direct", "broadcast", "multicast", "request", "response"];
      expect(types).toHaveLength(5);
    });

    it("should support all priorities", () => {
      const priorities: MessagePriority[] = ["low", "normal", "high", "urgent"];
      expect(priorities).toHaveLength(4);
    });
  });

  describe("Mailbox", () => {
    it("should create a valid mailbox", () => {
      const mailbox: Mailbox = {
        agentId: "agent-1",
        path: "/tmp/mailboxes/agent-1.json",
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      expect(mailbox.agentId).toBe("agent-1");
      expect(mailbox.messages).toHaveLength(0);
    });
  });

  describe("MailboxConfig", () => {
    it("should create a valid config", () => {
      const config: MailboxConfig = {
        basePath: "/tmp/mailboxes",
        maxMessages: 1000,
        messageTtl: 86400000,
        persistenceEnabled: true,
        persistenceInterval: 60000,
        lockTimeout: 5000,
      };

      expect(config.maxMessages).toBe(1000);
      expect(config.messageTtl).toBe(86400000);
    });
  });

  describe("MessageFilter", () => {
    it("should create a valid filter", () => {
      const filter: MessageFilter = {
        from: "agent-1",
        type: "request",
        priority: "high",
        status: "pending",
        since: Date.now() - 3600000,
        limit: 10,
      };

      expect(filter.from).toBe("agent-1");
      expect(filter.type).toBe("request");
      expect(filter.limit).toBe(10);
    });

    it("should support array filters", () => {
      const filter: MessageFilter = {
        from: ["agent-1", "agent-2"],
        type: ["request", "response"],
        priority: ["high", "urgent"],
      };

      expect(Array.isArray(filter.from)).toBe(true);
      expect(Array.isArray(filter.type)).toBe(true);
      expect(Array.isArray(filter.priority)).toBe(true);
    });

    it("should support regex subject filter", () => {
      const filter: MessageFilter = {
        subject: /^Task:/,
      };

      expect(filter.subject).toBeInstanceOf(RegExp);
    });
  });

  describe("Subscription", () => {
    it("should create a valid subscription", () => {
      const subscription: Subscription = {
        id: "sub-1",
        agentId: "agent-1",
        filter: { type: "broadcast" },
        handler: async () => {},
        createdAt: Date.now(),
      };

      expect(subscription.id).toBe("sub-1");
      expect(subscription.filter?.type).toBe("broadcast");
    });
  });

  describe("Message with expiration", () => {
    it("should support message expiration", () => {
      const now = Date.now();
      const message: MailboxMessage = {
        id: "msg-exp",
        from: "agent-1",
        to: "agent-2",
        type: "direct",
        priority: "normal",
        body: { temp: true },
        createdAt: now,
        expiresAt: now + 3600000,
      };

      expect(message.expiresAt).toBeDefined();
      expect(message.expiresAt).toBeGreaterThan(message.createdAt);
    });
  });

  describe("Message with metadata", () => {
    it("should support message metadata", () => {
      const message: MailboxMessage = {
        id: "msg-meta",
        from: "agent-1",
        to: "agent-2",
        type: "direct",
        priority: "normal",
        body: {},
        createdAt: Date.now(),
        metadata: {
          taskId: "task-1",
          workflowId: "wf-1",
          retryCount: 2,
        },
      };

      expect(message.metadata).toBeDefined();
      expect(message.metadata?.taskId).toBe("task-1");
      expect(message.metadata?.retryCount).toBe(2);
    });
  });
});
