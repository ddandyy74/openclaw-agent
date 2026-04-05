/**
 * Mailbox Manager Implementation
 * 
 * Manages inter-agent messaging with file-based persistence and locking.
 */

import fs from "node:fs";
import path from "node:path";
import type {
  IMailboxManager,
  Mailbox,
  MailboxMessage,
  MailboxConfig,
  MailboxStats,
  MessageFilter,
  MessageHandler,
  Subscription,
} from "./types.js";

const LOCK_RETRY_DELAY = 10;
const LOCK_TIMEOUT = 5000;

export class FileMailboxManager implements IMailboxManager {
  private basePath: string;
  private config: MailboxConfig;
  private mailboxes: Map<string, Mailbox> = new Map();
  private subscriptions: Map<string, Subscription> = new Map();
  private lockFiles: Map<string, NodeJS.Timeout> = new Map();

  constructor(config: Partial<MailboxConfig> = {}) {
    this.config = {
      basePath: config.basePath ?? path.join(process.cwd(), ".openclaw", "mailboxes"),
      maxMessages: config.maxMessages ?? 1000,
      messageTtl: config.messageTtl ?? 86400000,
      persistenceEnabled: config.persistenceEnabled ?? true,
      persistenceInterval: config.persistenceInterval ?? 60000,
      lockTimeout: config.lockTimeout ?? 5000,
    };

    this.basePath = this.config.basePath;

    if (this.config.persistenceEnabled) {
      this.ensureDirectory();
      this.loadAllMailboxes();
    }
  }

  private ensureDirectory(): void {
    if (!fs.existsSync(this.basePath)) {
      fs.mkdirSync(this.basePath, { recursive: true });
    }
  }

  private getMailboxPath(agentId: string): string {
    return path.join(this.basePath, `${agentId}.json`);
  }

  private getLockPath(agentId: string): string {
    return path.join(this.basePath, `${agentId}.lock`);
  }

  private async acquireLock(agentId: string): Promise<void> {
    const lockPath = this.getLockPath(agentId);
    const startTime = Date.now();

    while (Date.now() - startTime < LOCK_TIMEOUT) {
      try {
        fs.writeFileSync(lockPath, String(process.pid), { flag: "wx" });
        const timeout = setTimeout(() => {
          this.releaseLock(agentId);
        }, this.config.lockTimeout);
        this.lockFiles.set(agentId, timeout);
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_DELAY));
      }
    }

    throw new Error(`Failed to acquire lock for mailbox ${agentId}`);
  }

  private releaseLock(agentId: string): void {
    const lockPath = this.getLockPath(agentId);
    const timeout = this.lockFiles.get(agentId);
    
    if (timeout) {
      clearTimeout(timeout);
      this.lockFiles.delete(agentId);
    }

    try {
      fs.unlinkSync(lockPath);
    } catch {
      // Lock file may not exist
    }
  }

  private loadAllMailboxes(): void {
    try {
      const files = fs.readdirSync(this.basePath);
      for (const file of files) {
        if (file.endsWith(".json")) {
          const agentId = file.slice(0, -5);
          this.loadMailbox(agentId);
        }
      }
    } catch {
      // Directory doesn't exist yet
    }
  }

  private loadMailbox(agentId: string): void {
    const mailboxPath = this.getMailboxPath(agentId);
    try {
      const data = fs.readFileSync(mailboxPath, "utf-8");
      const mailbox: Mailbox = JSON.parse(data);
      mailbox.messages = mailbox.messages.map((msg) => ({
        ...msg,
        createdAt: msg.createdAt,
      }));
      this.mailboxes.set(agentId, mailbox);
    } catch {
      // Mailbox doesn't exist or is corrupted
    }
  }

  private saveMailbox(agentId: string): void {
    if (!this.config.persistenceEnabled) {
      return;
    }

    const mailbox = this.mailboxes.get(agentId);
    if (!mailbox) {
      return;
    }

    const mailboxPath = this.getMailboxPath(agentId);
    fs.writeFileSync(mailboxPath, JSON.stringify(mailbox, null, 2), "utf-8");
  }

  async createMailbox(agentId: string): Promise<Mailbox> {
    const existing = this.mailboxes.get(agentId);
    if (existing) {
      return existing;
    }

    const mailbox: Mailbox = {
      agentId,
      path: this.getMailboxPath(agentId),
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.mailboxes.set(agentId, mailbox);
    this.saveMailbox(agentId);

    return mailbox;
  }

  async deleteMailbox(agentId: string): Promise<void> {
    await this.acquireLock(agentId);
    try {
      this.mailboxes.delete(agentId);

      if (this.config.persistenceEnabled) {
        const mailboxPath = this.getMailboxPath(agentId);
        try {
          fs.unlinkSync(mailboxPath);
        } catch {
          // File doesn't exist
        }
      }

      for (const [subId, sub] of this.subscriptions) {
        if (sub.agentId === agentId) {
          this.subscriptions.delete(subId);
        }
      }
    } finally {
      this.releaseLock(agentId);
    }
  }

  async getMailbox(agentId: string): Promise<Mailbox | undefined> {
    return this.mailboxes.get(agentId);
  }

  async listMailboxes(): Promise<Mailbox[]> {
    return Array.from(this.mailboxes.values());
  }

  async sendMessage(
    from: string,
    to: string | string[],
    message: Omit<MailboxMessage, "id" | "from" | "createdAt" | "to">
  ): Promise<void> {
    const recipients = Array.isArray(to) ? to : [to];

    for (const recipientId of recipients) {
      await this.acquireLock(recipientId);
      try {
        let mailbox = this.mailboxes.get(recipientId);
        if (!mailbox) {
          mailbox = await this.createMailbox(recipientId);
        }

        const fullMessage: MailboxMessage = {
          ...message,
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          from,
          to: recipientId,
          createdAt: Date.now(),
        };

        mailbox.messages.push(fullMessage);
        mailbox.updatedAt = Date.now();

        if (mailbox.messages.length > this.config.maxMessages) {
          mailbox.messages = mailbox.messages.slice(-this.config.maxMessages);
        }

        this.saveMailbox(recipientId);
        this.notifySubscribers(recipientId, fullMessage);
      } finally {
        this.releaseLock(recipientId);
      }
    }
  }

  async getMessages(agentId: string, filter?: MessageFilter): Promise<MailboxMessage[]> {
    const mailbox = this.mailboxes.get(agentId);
    if (!mailbox) {
      return [];
    }

    let messages = [...mailbox.messages];

    if (filter) {
      if (filter.from) {
        const fromFilter = Array.isArray(filter.from) ? filter.from : [filter.from];
        messages = messages.filter((msg) => fromFilter.includes(msg.from));
      }

      if (filter.type) {
        const typeFilter = Array.isArray(filter.type) ? filter.type : [filter.type];
        messages = messages.filter((msg) => typeFilter.includes(msg.type));
      }

      if (filter.priority) {
        const priorityFilter = Array.isArray(filter.priority) ? filter.priority : [filter.priority];
        messages = messages.filter((msg) => priorityFilter.includes(msg.priority));
      }

      if (filter.subject) {
        const subjectRegex = filter.subject instanceof RegExp ? filter.subject : new RegExp(filter.subject);
        messages = messages.filter((msg) => msg.subject && subjectRegex.test(msg.subject));
      }

      if (filter.status) {
        const statusFilter = Array.isArray(filter.status) ? filter.status : [filter.status];
        messages = messages.filter((msg) => statusFilter.includes("pending"));
      }

      if (filter.since) {
        messages = messages.filter((msg) => msg.createdAt >= filter.since!);
      }

      if (filter.until) {
        messages = messages.filter((msg) => msg.createdAt <= filter.until!);
      }

      if (filter.limit) {
        messages = messages.slice(-filter.limit);
      }
    }

    return messages;
  }

  async markProcessed(agentId: string, messageId: string): Promise<void> {
    await this.acquireLock(agentId);
    try {
      const mailbox = this.mailboxes.get(agentId);
      if (!mailbox) {
        return;
      }

      const message = mailbox.messages.find((msg) => msg.id === messageId);
      if (message) {
        mailbox.updatedAt = Date.now();
        this.saveMailbox(agentId);
      }
    } finally {
      this.releaseLock(agentId);
    }
  }

  async subscribe(
    agentId: string,
    handler: MessageHandler,
    filter?: MessageFilter
  ): Promise<string> {
    const subscriptionId = `sub-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const subscription: Subscription = {
      id: subscriptionId,
      agentId,
      filter,
      handler,
      createdAt: Date.now(),
    };

    this.subscriptions.set(subscriptionId, subscription);

    return subscriptionId;
  }

  async unsubscribe(subscriptionId: string): Promise<void> {
    this.subscriptions.delete(subscriptionId);
  }

  async broadcast(
    from: string,
    teamId: string,
    message: Omit<MailboxMessage, "id" | "from" | "createdAt" | "to">
  ): Promise<void> {
    // Team broadcast would require integration with TeamManager
    // For now, we'll emit an event that can be handled by the team
    const broadcastMessage: MailboxMessage = {
      ...message,
      id: `broadcast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      from,
      to: teamId,
      createdAt: Date.now(),
    };

    this.notifyBroadcastSubscribers(teamId, broadcastMessage);
  }

  async getStats(agentId: string): Promise<MailboxStats> {
    const mailbox = this.mailboxes.get(agentId);
    if (!mailbox) {
      return {
        totalMessages: 0,
        pendingMessages: 0,
        processedMessages: 0,
        failedMessages: 0,
        averageProcessingTime: 0,
      };
    }

    return {
      totalMessages: mailbox.messages.length,
      pendingMessages: mailbox.messages.filter((m) => m.createdAt > Date.now() - 3600000).length,
      processedMessages: mailbox.messages.length,
      failedMessages: 0,
      averageProcessingTime: 0,
      oldestPending: mailbox.messages[0]?.createdAt,
    };
  }

  async pruneExpired(): Promise<number> {
    let pruned = 0;
    const now = Date.now();

    for (const [agentId, mailbox] of this.mailboxes) {
      const expiredMessages = mailbox.messages.filter(
        (msg) => msg.expiresAt && msg.expiresAt < now
      );

      if (expiredMessages.length > 0) {
        await this.acquireLock(agentId);
        try {
          mailbox.messages = mailbox.messages.filter(
            (msg) => !msg.expiresAt || msg.expiresAt >= now
          );
          mailbox.updatedAt = Date.now();
          this.saveMailbox(agentId);
          pruned += expiredMessages.length;
        } finally {
          this.releaseLock(agentId);
        }
      }
    }

    return pruned;
  }

  private notifySubscribers(agentId: string, message: MailboxMessage): void {
    for (const subscription of this.subscriptions.values()) {
      if (subscription.agentId === agentId) {
        if (this.matchesFilter(message, subscription.filter)) {
          try {
            subscription.handler(message);
          } catch {
            // Handler error, ignore
          }
        }
      }
    }
  }

  private notifyBroadcastSubscribers(teamId: string, message: MailboxMessage): void {
    for (const subscription of this.subscriptions.values()) {
      if (subscription.filter?.type === "broadcast") {
        try {
          subscription.handler(message);
        } catch {
          // Handler error, ignore
        }
      }
    }
  }

  private matchesFilter(message: MailboxMessage, filter?: MessageFilter): boolean {
    if (!filter) {
      return true;
    }

    if (filter.from) {
      const fromFilter = Array.isArray(filter.from) ? filter.from : [filter.from];
      if (!fromFilter.includes(message.from)) {
        return false;
      }
    }

    if (filter.type) {
      const typeFilter = Array.isArray(filter.type) ? filter.type : [filter.type];
      if (!typeFilter.includes(message.type)) {
        return false;
      }
    }

    if (filter.priority) {
      const priorityFilter = Array.isArray(filter.priority) ? filter.priority : [filter.priority];
      if (!priorityFilter.includes(message.priority)) {
        return false;
      }
    }

    return true;
  }

  shutdown(): void {
    for (const [agentId] of this.lockFiles) {
      this.releaseLock(agentId);
    }
    this.mailboxes.clear();
    this.subscriptions.clear();
  }
}
