/**
 * Mailbox Types
 * 
 * Core types for the inter-agent messaging system.
 */

export type MessageType = "direct" | "broadcast" | "multicast" | "request" | "response";

export type MessagePriority = "low" | "normal" | "high" | "urgent";

export type MessageStatus = "pending" | "delivered" | "read" | "processed" | "failed";

export interface MailboxMessage {
  id: string;
  from: string;
  to: string | string[];
  type: MessageType;
  priority: MessagePriority;
  subject?: string;
  body: unknown;
  correlationId?: string;
  replyTo?: string;
  createdAt: number;
  expiresAt?: number;
  metadata?: Record<string, unknown>;
}

export interface Mailbox {
  agentId: string;
  path: string;
  messages: MailboxMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface MessageFilter {
  from?: string | string[];
  type?: MessageType | MessageType[];
  priority?: MessagePriority | MessagePriority[];
  subject?: string | RegExp;
  status?: MessageStatus | MessageStatus[];
  since?: number;
  until?: number;
  limit?: number;
}

export interface MessageHandler {
  (message: MailboxMessage): Promise<void> | void;
}

export interface Subscription {
  id: string;
  agentId: string;
  filter?: MessageFilter;
  handler: MessageHandler;
  createdAt: number;
}

export interface MailboxStats {
  totalMessages: number;
  pendingMessages: number;
  processedMessages: number;
  failedMessages: number;
  averageProcessingTime: number;
  oldestPending?: number;
}

export interface MailboxConfig {
  basePath: string;
  maxMessages: number;
  messageTtl: number;
  persistenceEnabled: boolean;
  persistenceInterval: number;
  lockTimeout: number;
}

export interface IMailbox {
  send(to: string, message: Omit<MailboxMessage, "id" | "from" | "createdAt">): Promise<void>;
  receive(filter?: MessageFilter): Promise<MailboxMessage[]>;
  subscribe(handler: MessageHandler, filter?: MessageFilter): Promise<string>;
  unsubscribe(subscriptionId: string): Promise<void>;
  broadcast(teamId: string, message: Omit<MailboxMessage, "id" | "from" | "createdAt" | "to">): Promise<void>;
  markProcessed(messageId: string): Promise<void>;
  getStats(): Promise<MailboxStats>;
}

export interface IMailboxManager {
  createMailbox(agentId: string): Promise<Mailbox>;
  deleteMailbox(agentId: string): Promise<void>;
  getMailbox(agentId: string): Promise<Mailbox | undefined>;
  listMailboxes(): Promise<Mailbox[]>;
  
  sendMessage(from: string, to: string | string[], message: Omit<MailboxMessage, "id" | "from" | "createdAt" | "to">): Promise<void>;
  getMessages(agentId: string, filter?: MessageFilter): Promise<MailboxMessage[]>;
  markProcessed(agentId: string, messageId: string): Promise<void>;
  
  subscribe(agentId: string, handler: MessageHandler, filter?: MessageFilter): Promise<string>;
  unsubscribe(subscriptionId: string): Promise<void>;
  
  broadcast(from: string, teamId: string, message: Omit<MailboxMessage, "id" | "from" | "createdAt" | "to">): Promise<void>;
  
  getStats(agentId: string): Promise<MailboxStats>;
  pruneExpired(): Promise<number>;
}
