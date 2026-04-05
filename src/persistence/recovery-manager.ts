/**
 * Recovery Manager Implementation
 * 
 * Manages recovery points and recovery plans for:
 * - System crash recovery
 * - Agent state restoration
 * - Workflow resumption
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type {
  IRecoveryManager,
  RecoveryPoint,
  RecoveryPlan,
  RecoveryStep,
  PersistenceScope,
  StateSnapshot,
} from "./types.js";
import { FileStateStore } from "./state-store.js";

type RecoveryFile = {
  version: string;
  recoveryPoints: RecoveryPoint[];
  updatedAt: number;
};

type RecoveryContext = {
  agentId?: string;
  sessionId?: string;
  workflowId?: string;
  metadata?: Record<string, unknown>;
};

export class RecoveryManager implements IRecoveryManager {
  private basePath: string;
  private stateStore: FileStateStore;
  private recoveryPoints: Map<string, RecoveryPoint> = new Map();
  private dirty = false;

  constructor(options: { basePath: string; stateStore?: FileStateStore }) {
    this.basePath = options.basePath;
    this.stateStore = options.stateStore ?? new FileStateStore({ basePath: options.basePath });
    this.ensureDirectory();
    this.loadRecoveryPoints();
  }

  private ensureDirectory(): void {
    if (!fs.existsSync(this.basePath)) {
      fs.mkdirSync(this.basePath, { recursive: true });
    }
  }

  private getRecoveryPath(): string {
    return path.join(this.basePath, "recovery", "recovery-points.json");
  }

  private loadRecoveryPoints(): void {
    const filePath = this.getRecoveryPath();
    
    try {
      if (!fs.existsSync(filePath)) {
        return;
      }

      const content = fs.readFileSync(filePath, "utf-8");
      const file: RecoveryFile = JSON.parse(content);

      for (const point of file.recoveryPoints) {
        // Skip expired recovery points
        if (point.metadata?.expiresAt && typeof point.metadata.expiresAt === "number") {
          if (point.metadata.expiresAt < Date.now()) {
            continue;
          }
        }
        this.recoveryPoints.set(point.id, point);
      }
    } catch {
      // File doesn't exist or is corrupted, start fresh
    }
  }

  private saveRecoveryPoints(): void {
    const filePath = this.getRecoveryPath();
    const dir = path.dirname(filePath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const points = Array.from(this.recoveryPoints.values());

    const file: RecoveryFile = {
      version: "1.0.0",
      recoveryPoints: points,
      updatedAt: Date.now(),
    };

    fs.writeFileSync(filePath, JSON.stringify(file, null, 2), "utf-8");
  }

  private generateId(): string {
    return `recovery-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  }

  private getScopeKey(scope: PersistenceScope, scopeId: string): string {
    return `${scope}:${scopeId}`;
  }

  async createRecoveryPoint(
    type: RecoveryPoint["type"],
    scope: PersistenceScope,
    scopeId: string,
    context?: RecoveryContext
  ): Promise<RecoveryPoint> {
    // Collect state from the state store
    const data = await this.collectState(scope, scopeId);

    const point: RecoveryPoint = {
      id: this.generateId(),
      type,
      scope,
      scopeId,
      timestamp: Date.now(),
      data,
      metadata: {
        ...context?.metadata,
        agentId: context?.agentId,
        sessionId: context?.sessionId,
        workflowId: context?.workflowId,
      },
    };

    this.recoveryPoints.set(point.id, point);
    this.saveRecoveryPoints();

    return point;
  }

  private async collectState(
    scope: PersistenceScope,
    scopeId: string
  ): Promise<Record<string, unknown>> {
    const data: Record<string, unknown> = {};

    // Get all keys with the scope prefix
    const keys = await this.stateStore.list("", scope, scopeId);

    for (const key of keys) {
      const value = await this.stateStore.get(key, scope, scopeId);
      if (value !== undefined) {
        data[key] = value;
      }
    }

    return data;
  }

  async loadRecoveryPoint(recoveryPointId: string): Promise<RecoveryPoint | undefined> {
    return this.recoveryPoints.get(recoveryPointId);
  }

  async listRecoveryPoints(
    scope?: PersistenceScope,
    scopeId?: string
  ): Promise<RecoveryPoint[]> {
    const points: RecoveryPoint[] = [];

    for (const point of this.recoveryPoints.values()) {
      if (scope && point.scope !== scope) {
        continue;
      }
      if (scopeId && point.scopeId !== scopeId) {
        continue;
      }

      // Filter out expired points
      if (point.metadata?.expiresAt && typeof point.metadata.expiresAt === "number") {
        if (point.metadata.expiresAt < Date.now()) {
          continue;
        }
      }

      points.push(point);
    }

    return points.sort((a, b) => b.timestamp - a.timestamp);
  }

  async createRecoveryPlan(recoveryPointId: string): Promise<RecoveryPlan> {
    const point = this.recoveryPoints.get(recoveryPointId);
    if (!point) {
      throw new Error(`Recovery point not found: ${recoveryPointId}`);
    }

    const steps: RecoveryStep[] = [];
    let order = 1;

    // Step 1: Restore state
    steps.push({
      order: order++,
      action: "restore_state",
      target: `${point.scope}:${point.scopeId}`,
      params: {
        recoveryPointId: point.id,
        data: point.data,
        scope: point.scope,
        scopeId: point.scopeId,
      },
    });

    // Step 2: Restart agent if applicable
    if (point.metadata?.agentId) {
      steps.push({
        order: order++,
        action: "restart_agent",
        target: point.metadata.agentId as string,
        params: {
          scope: point.scope,
          scopeId: point.scopeId,
        },
      });
    }

    // Step 3: Resume workflow if applicable
    if (point.metadata?.workflowId) {
      steps.push({
        order: order++,
        action: "resume_workflow",
        target: point.metadata.workflowId as string,
        params: {
          scope: point.scope,
          scopeId: point.scopeId,
        },
      });
    }

    // Determine risk level
    const age = Date.now() - point.timestamp;
    const riskLevel = this.assessRiskLevel(point, age);

    return {
      recoveryPointId,
      steps,
      estimatedDuration: steps.length * 5000, // 5 seconds per step estimate
      riskLevel,
    };
  }

  private assessRiskLevel(point: RecoveryPoint, age: number): "low" | "medium" | "high" {
    // Newer recovery points are less risky
    if (age < 5 * 60 * 1000) {
      // 5 minutes
      return "low";
    }
    if (age < 30 * 60 * 1000) {
      // 30 minutes
      return "medium";
    }
    return "high";
  }

  async executeRecoveryPlan(plan: RecoveryPlan): Promise<void> {
    // Sort steps by order
    const sortedSteps = [...plan.steps].sort((a, b) => a.order - b.order);

    for (const step of sortedSteps) {
      await this.executeRecoveryStep(step);
    }
  }

  private async executeRecoveryStep(step: RecoveryStep): Promise<void> {
    switch (step.action) {
      case "restore_state":
        await this.restoreState(step.params);
        break;
      case "restart_agent":
        // This would integrate with AgentManager
        // For now, just update state
        await this.stateStore.set(
          `agent:${step.target}:status`,
          "restarted",
          "agent",
          step.target
        );
        break;
      case "resume_workflow":
        // This would integrate with WorkflowEngine
        // For now, just update state
        await this.stateStore.set(
          `workflow:${step.target}:status`,
          "resumed",
          "workflow",
          step.target
        );
        break;
      case "replay_events":
        // Event replay would need event store integration
        break;
      default:
        throw new Error(`Unknown recovery action: ${step.action}`);
    }
  }

  private async restoreState(params: Record<string, unknown>): Promise<void> {
    const { data, scope, scopeId } = params as {
      data: Record<string, unknown>;
      scope?: PersistenceScope;
      scopeId?: string;
    };

    if (!data) {
      return;
    }

    // Clear existing state
    if (scope && scopeId) {
      await this.stateStore.clear(scope, scopeId);
    }

    // Restore state
    for (const [key, value] of Object.entries(data)) {
      await this.stateStore.set(key, value, scope, scopeId);
    }
  }

  async deleteRecoveryPoint(recoveryPointId: string): Promise<void> {
    this.recoveryPoints.delete(recoveryPointId);
    this.saveRecoveryPoints();
  }

  async pruneExpiredRecoveryPoints(): Promise<number> {
    const toDelete: string[] = [];

    for (const [id, point] of this.recoveryPoints) {
      if (point.metadata?.expiresAt && typeof point.metadata.expiresAt === "number") {
        if (point.metadata.expiresAt < Date.now()) {
          toDelete.push(id);
        }
      }
    }

    for (const id of toDelete) {
      this.recoveryPoints.delete(id);
    }

    if (toDelete.length > 0) {
      this.saveRecoveryPoints();
    }

    return toDelete.length;
  }

  async createSnapshot(
    scope: PersistenceScope,
    scopeId: string
  ): Promise<StateSnapshot> {
    const data = await this.collectState(scope, scopeId);

    return {
      id: `snapshot-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
      scope,
      scopeId,
      timestamp: Date.now(),
      version: "1.0.0",
      data,
      checksum: this.calculateChecksum(data),
    };
  }

  async restoreFromSnapshot(snapshot: StateSnapshot): Promise<void> {
    // Verify checksum
    const checksum = this.calculateChecksum(snapshot.data);
    if (checksum !== snapshot.checksum) {
      throw new Error("Snapshot checksum mismatch - data may be corrupted");
    }

    await this.restoreState({
      data: snapshot.data,
      scope: snapshot.scope,
      scopeId: snapshot.scopeId,
    });
  }

  private calculateChecksum(data: Record<string, unknown>): string {
    const content = JSON.stringify(data, Object.keys(data).sort());
    return crypto.createHash("sha256").update(content).digest("hex");
  }

  async getRecoveryStats(): Promise<{
    totalRecoveryPoints: number;
    byType: Record<string, number>;
    byScope: Record<string, number>;
    oldestPoint?: number;
    newestPoint?: number;
  }> {
    const byType: Record<string, number> = {};
    const byScope: Record<string, number> = {};
    let oldest: number | undefined;
    let newest: number | undefined;

    for (const point of this.recoveryPoints.values()) {
      byType[point.type] = (byType[point.type] ?? 0) + 1;
      byScope[point.scope] = (byScope[point.scope] ?? 0) + 1;

      if (!oldest || point.timestamp < oldest) {
        oldest = point.timestamp;
      }
      if (!newest || point.timestamp > newest) {
        newest = point.timestamp;
      }
    }

    return {
      totalRecoveryPoints: this.recoveryPoints.size,
      byType,
      byScope,
      oldestPoint: oldest,
      newestPoint: newest,
    };
  }

  flush(): void {
    if (this.dirty) {
      this.saveRecoveryPoints();
      this.dirty = false;
    }
  }

  close(): void {
    this.flush();
    this.recoveryPoints.clear();
    this.stateStore.close();
  }
}

export function createRecoveryManager(options: {
  basePath: string;
  stateStore?: FileStateStore;
}): RecoveryManager {
  return new RecoveryManager(options);
}
