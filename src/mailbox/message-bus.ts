/**
 * Message Bus Implementation
 * 
 * Provides pub/sub messaging for inter-agent communication.
 */

import type { MailboxMessage, Subscription, MessageHandler, MessageFilter } from "./types.js";

export type BusEventType = "message" | "broadcast" | "error" | "agent_online" | "agent_offline";

export type BusEvent = {
  type: BusEventType;
  data: unknown;
  timestamp: number;
  source?: string;
};

export type BusEventHandler = (event: BusEvent) => void;

export type BusConfig = {
  maxSubscriptions: number;
  maxEventHistory: number;
  eventRetentionMs: number;
};

export interface IMessageBus {
  publish(message: MailboxMessage): Promise<void>;
  subscribe(agentId: string, handler: MessageHandler, filter?: MessageFilter): Promise<Subscription>;
  unsubscribe(subscriptionId: string): Promise<void>;
  broadcast(from: string, channel: string, message: Omit<MailboxMessage, "id" | "from" | "createdAt" | "to">): Promise<void>;
  getSubscriptions(agentId?: string): Subscription[];
  getEventHistory(since?: number): BusEvent[];
  start(): Promise<void>;
  stop(): Promise<void>;
}

export class MessageBus implements IMessageBus {
  private subscriptions: Map<string, Subscription> = new Map();
  private eventHistory: BusEvent[] = [];
  private config: BusConfig;
  private isRunning = false;
  private eventHandlers: Map<string, BusEventHandler[]> = new Map();
  private channelSubscribers: Map<string, Set<string>> = new Map();

  constructor(config: Partial<BusConfig> = {}) {
    this.config = {
      maxSubscriptions: config.maxSubscriptions ?? 1000,
      maxEventHistory: config.maxEventHistory ?? 1000,
      eventRetentionMs: config.eventRetentionMs ?? 3600000,
    };
  }

  async publish(message: MailboxMessage): Promise<void> {
    if (!this.isRunning) {
      throw new Error("Message bus is not running");
    }

    this.emitEvent("message", message, message.from);

    const matchingSubscriptions = this.findMatchingSubscriptions(message);

    for (const subscription of matchingSubscriptions) {
      try {
        await Promise.resolve(subscription.handler(message));
      } catch (error) {
        this.emitEvent("error", { error, message, subscriptionId: subscription.id }, "bus");
      }
    }
  }

  async subscribe(
    agentId: string,
    handler: MessageHandler,
    filter?: MessageFilter
  ): Promise<Subscription> {
    if (this.subscriptions.size >= this.config.maxSubscriptions) {
      throw new Error("Maximum subscriptions reached");
    }

    const subscriptionId = `sub-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const subscription: Subscription = {
      id: subscriptionId,
      agentId,
      filter,
      handler,
      createdAt: Date.now(),
    };

    this.subscriptions.set(subscriptionId, subscription);

    return subscription;
  }

  async unsubscribe(subscriptionId: string): Promise<void> {
    this.subscriptions.delete(subscriptionId);

    for (const [, subscribers] of this.channelSubscribers) {
      subscribers.delete(subscriptionId);
    }
  }

  async broadcast(
    from: string,
    channel: string,
    message: Omit<MailboxMessage, "id" | "from" | "createdAt" | "to">
  ): Promise<void> {
    if (!this.isRunning) {
      throw new Error("Message bus is not running");
    }

    const fullMessage: MailboxMessage = {
      ...message,
      id: `broadcast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      from,
      to: channel,
      createdAt: Date.now(),
    };

    this.emitEvent("broadcast", fullMessage, from);

    const channelSubscribers = this.channelSubscribers.get(channel) ?? new Set();

    for (const subscriptionId of channelSubscribers) {
      const subscription = this.subscriptions.get(subscriptionId);
      if (subscription) {
        try {
          await Promise.resolve(subscription.handler(fullMessage));
        } catch (error) {
          this.emitEvent("error", { error, message: fullMessage, subscriptionId }, "bus");
        }
      }
    }

    for (const subscription of this.subscriptions.values()) {
      if (subscription.filter?.type === "broadcast") {
        try {
          await Promise.resolve(subscription.handler(fullMessage));
        } catch (error) {
          this.emitEvent("error", { error, message: fullMessage, subscriptionId: subscription.id }, "bus");
        }
      }
    }
  }

  getSubscriptions(agentId?: string): Subscription[] {
    if (agentId) {
      return Array.from(this.subscriptions.values()).filter((sub) => sub.agentId === agentId);
    }
    return Array.from(this.subscriptions.values());
  }

  getEventHistory(since?: number): BusEvent[] {
    if (since) {
      return this.eventHistory.filter((event) => event.timestamp >= since);
    }
    return [...this.eventHistory];
  }

  async start(): Promise<void> {
    this.isRunning = true;
    this.emitEvent("agent_online", { message: "Message bus started" }, "bus");
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    this.subscriptions.clear();
    this.channelSubscribers.clear();
    this.emitEvent("agent_offline", { message: "Message bus stopped" }, "bus");
  }

  subscribeToChannel(channel: string, subscriptionId: string): void {
    if (!this.channelSubscribers.has(channel)) {
      this.channelSubscribers.set(channel, new Set());
    }
    this.channelSubscribers.get(channel)!.add(subscriptionId);
  }

  unsubscribeFromChannel(channel: string, subscriptionId: string): void {
    const subscribers = this.channelSubscribers.get(channel);
    if (subscribers) {
      subscribers.delete(subscriptionId);
      if (subscribers.size === 0) {
        this.channelSubscribers.delete(channel);
      }
    }
  }

  on(eventType: BusEventType, handler: BusEventHandler): void {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, []);
    }
    this.eventHandlers.get(eventType)!.push(handler);
  }

  off(eventType: BusEventType, handler: BusEventHandler): void {
    const handlers = this.eventHandlers.get(eventType);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index >= 0) {
        handlers.splice(index, 1);
      }
    }
  }

  private emitEvent(type: BusEventType, data: unknown, source?: string): void {
    const event: BusEvent = {
      type,
      data,
      timestamp: Date.now(),
      source,
    };

    this.eventHistory.push(event);

    if (this.eventHistory.length > this.config.maxEventHistory) {
      this.eventHistory = this.eventHistory.slice(-this.config.maxEventHistory);
    }

    this.pruneOldEvents();

    const handlers = this.eventHandlers.get(type) ?? [];
    for (const handler of handlers) {
      try {
        handler(event);
      } catch {
        // Handler error, ignore
      }
    }
  }

  private pruneOldEvents(): void {
    const cutoff = Date.now() - this.config.eventRetentionMs;
    this.eventHistory = this.eventHistory.filter((event) => event.timestamp >= cutoff);
  }

  private findMatchingSubscriptions(message: MailboxMessage): Subscription[] {
    const matching: Subscription[] = [];

    for (const subscription of this.subscriptions.values()) {
      if (this.matchesFilter(message, subscription.filter)) {
        matching.push(subscription);
      }
    }

    return matching;
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

    if (filter.subject) {
      const subjectRegex = filter.subject instanceof RegExp ? filter.subject : new RegExp(filter.subject);
      if (!message.subject || !subjectRegex.test(message.subject)) {
        return false;
      }
    }

    if (filter.since && message.createdAt < filter.since) {
      return false;
    }

    if (filter.until && message.createdAt > filter.until) {
      return false;
    }

    return true;
  }
}

export class InMemoryMessageBus implements IMessageBus {
  private subscriptions: Map<string, Subscription> = new Map();
  private isRunning = false;

  async publish(message: MailboxMessage): Promise<void> {
    if (!this.isRunning) {
      throw new Error("Message bus is not running");
    }

    for (const subscription of this.subscriptions.values()) {
      try {
        await Promise.resolve(subscription.handler(message));
      } catch {
        // Handler error, ignore
      }
    }
  }

  async subscribe(
    agentId: string,
    handler: MessageHandler,
    filter?: MessageFilter
  ): Promise<Subscription> {
    const subscriptionId = `sub-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const subscription: Subscription = {
      id: subscriptionId,
      agentId,
      filter,
      handler,
      createdAt: Date.now(),
    };

    this.subscriptions.set(subscriptionId, subscription);

    return subscription;
  }

  async unsubscribe(subscriptionId: string): Promise<void> {
    this.subscriptions.delete(subscriptionId);
  }

  async broadcast(
    from: string,
    channel: string,
    message: Omit<MailboxMessage, "id" | "from" | "createdAt" | "to">
  ): Promise<void> {
    const fullMessage: MailboxMessage = {
      ...message,
      id: `broadcast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      from,
      to: channel,
      createdAt: Date.now(),
    };

    await this.publish(fullMessage);
  }

  getSubscriptions(agentId?: string): Subscription[] {
    if (agentId) {
      return Array.from(this.subscriptions.values()).filter((sub) => sub.agentId === agentId);
    }
    return Array.from(this.subscriptions.values());
  }

  getEventHistory(_since?: number): BusEvent[] {
    return [];
  }

  async start(): Promise<void> {
    this.isRunning = true;
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    this.subscriptions.clear();
  }
}
