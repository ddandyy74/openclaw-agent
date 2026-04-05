/**
 * Persistence Types
 * 
 * Core types for the state persistence system.
 */

export type StorageBackend = "file" | "sqlite" | "memory";

export type PersistenceScope = "global" | "agent" | "session" | "workflow";

export interface PersistenceConfig {
  backend: StorageBackend;
  basePath: string;
  enableEncryption: boolean;
  encryptionKey?: string;
  autoSave: boolean;
  autoSaveInterval: number;
  maxBackups: number;
}

export interface StateSnapshot {
  id: string;
  scope: PersistenceScope;
  scopeId: string;
  timestamp: number;
  version: string;
  data: Record<string, unknown>;
  checksum: string;
}

export interface PersistedState {
  key: string;
  scope: PersistenceScope;
  scopeId: string;
  value: unknown;
  updatedAt: number;
  expiresAt?: number;
  metadata?: Record<string, unknown>;
}

export interface RecoveryPoint {
  id: string;
  type: "checkpoint" | "snapshot" | "backup";
  scope: PersistenceScope;
  scopeId: string;
  timestamp: number;
  data: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface RecoveryPlan {
  recoveryPointId: string;
  steps: RecoveryStep[];
  estimatedDuration: number;
  riskLevel: "low" | "medium" | "high";
}

export interface RecoveryStep {
  order: number;
  action: "restore_state" | "restart_agent" | "resume_workflow" | "replay_events";
  target: string;
  params: Record<string, unknown>;
}

export interface IStateStore {
  get(key: string, scope?: PersistenceScope, scopeId?: string): Promise<unknown>;
  set(key: string, value: unknown, scope?: PersistenceScope, scopeId?: string): Promise<void>;
  delete(key: string, scope?: PersistenceScope, scopeId?: string): Promise<void>;
  exists(key: string, scope?: PersistenceScope, scopeId?: string): Promise<boolean>;
  list(prefix: string, scope?: PersistenceScope, scopeId?: string): Promise<string[]>;
  clear(scope?: PersistenceScope, scopeId?: string): Promise<void>;
}

export interface ICheckpointManager {
  createCheckpoint(executionId: string, nodeId: string, variables?: Record<string, unknown>, nodeStates?: Record<string, unknown>): Promise<Checkpoint>;
  loadCheckpoint(checkpointId: string): Promise<Checkpoint | undefined>;
  listCheckpoints(executionId: string): Promise<Checkpoint[]>;
  getLatestCheckpoint(executionId: string): Promise<Checkpoint | undefined>;
  deleteCheckpoint(checkpointId: string): Promise<void>;
  deleteCheckpointsForExecution(executionId: string): Promise<void>;
}

export interface IRecoveryManager {
  createRecoveryPoint(type: RecoveryPoint["type"], scope: PersistenceScope, scopeId: string): Promise<RecoveryPoint>;
  loadRecoveryPoint(recoveryPointId: string): Promise<RecoveryPoint | undefined>;
  listRecoveryPoints(scope?: PersistenceScope, scopeId?: string): Promise<RecoveryPoint[]>;
  createRecoveryPlan(recoveryPointId: string): Promise<RecoveryPlan>;
  executeRecoveryPlan(plan: RecoveryPlan): Promise<void>;
}

export interface Persistable {
  getState(): Record<string, unknown>;
  setState(state: Record<string, unknown>): Promise<void>;
  getPersistentId(): string;
}

export interface Checkpoint {
  id: string;
  executionId: string;
  nodeId: string;
  timestamp: number;
  variables: Record<string, unknown>;
  nodeStates: Record<string, unknown>;
}
