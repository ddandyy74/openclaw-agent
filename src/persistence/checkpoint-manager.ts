/**
 * Checkpoint Manager Implementation
 * 
 * Manages workflow execution checkpoints for:
 * - Pause/resume workflows
 * - Crash recovery
 * - Long-running workflow state persistence
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { ICheckpointManager, Checkpoint } from "./types.js";

type CheckpointFile = {
  version: string;
  checkpoints: Checkpoint[];
  updatedAt: number;
};

export class CheckpointManager implements ICheckpointManager {
  private basePath: string;
  private cache: Map<string, Checkpoint> = new Map();
  private dirty = false;

  constructor(options: { basePath: string }) {
    this.basePath = options.basePath;
    this.ensureDirectory();
    this.loadAllCheckpoints();
  }

  private ensureDirectory(): void {
    if (!fs.existsSync(this.basePath)) {
      fs.mkdirSync(this.basePath, { recursive: true });
    }
  }

  private getCheckpointPath(executionId: string): string {
    return path.join(this.basePath, "checkpoints", `${executionId}.json`);
  }

  private loadAllCheckpoints(): void {
    const checkpointsDir = path.join(this.basePath, "checkpoints");
    if (!fs.existsSync(checkpointsDir)) {
      return;
    }

    const files = fs.readdirSync(checkpointsDir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      this.loadCheckpointFile(path.join(checkpointsDir, file));
    }
  }

  private loadCheckpointFile(filePath: string): void {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const file: CheckpointFile = JSON.parse(content);

      for (const checkpoint of file.checkpoints) {
        this.cache.set(checkpoint.id, checkpoint);
      }
    } catch {
      // File doesn't exist or is corrupted, skip
    }
  }

  private saveCheckpointFile(executionId: string): void {
    const filePath = this.getCheckpointPath(executionId);
    const dir = path.dirname(filePath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const checkpoints: Checkpoint[] = [];
    for (const checkpoint of this.cache.values()) {
      if (checkpoint.executionId === executionId) {
        checkpoints.push(checkpoint);
      }
    }

    const file: CheckpointFile = {
      version: "1.0.0",
      checkpoints,
      updatedAt: Date.now(),
    };

    fs.writeFileSync(filePath, JSON.stringify(file, null, 2), "utf-8");
  }

  private generateId(): string {
    return `checkpoint-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  }

  async createCheckpoint(
    executionId: string,
    nodeId: string,
    variables?: Record<string, unknown>,
    nodeStates?: Record<string, unknown>
  ): Promise<Checkpoint> {
    const checkpoint: Checkpoint = {
      id: this.generateId(),
      executionId,
      nodeId,
      timestamp: Date.now(),
      variables: variables ?? {},
      nodeStates: nodeStates ?? {},
    };

    this.cache.set(checkpoint.id, checkpoint);
    this.saveCheckpointFile(executionId);

    return checkpoint;
  }

  async loadCheckpoint(checkpointId: string): Promise<Checkpoint | undefined> {
    return this.cache.get(checkpointId);
  }

  async listCheckpoints(executionId: string): Promise<Checkpoint[]> {
    const checkpoints: Checkpoint[] = [];

    for (const checkpoint of this.cache.values()) {
      if (checkpoint.executionId === executionId) {
        checkpoints.push(checkpoint);
      }
    }

    return checkpoints.sort((a, b) => b.timestamp - a.timestamp);
  }

  async getLatestCheckpoint(executionId: string): Promise<Checkpoint | undefined> {
    const checkpoints = await this.listCheckpoints(executionId);
    return checkpoints[0];
  }

  async deleteCheckpoint(checkpointId: string): Promise<void> {
    const checkpoint = this.cache.get(checkpointId);
    if (!checkpoint) {
      return;
    }

    this.cache.delete(checkpointId);
    this.saveCheckpointFile(checkpoint.executionId);
  }

  async deleteCheckpointsForExecution(executionId: string): Promise<void> {
    const toDelete: string[] = [];

    for (const [id, checkpoint] of this.cache) {
      if (checkpoint.executionId === executionId) {
        toDelete.push(id);
      }
    }

    for (const id of toDelete) {
      this.cache.delete(id);
    }

    const filePath = this.getCheckpointPath(executionId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  async pruneOldCheckpoints(executionId: string, keepCount: number = 10): Promise<number> {
    const checkpoints = await this.listCheckpoints(executionId);
    
    if (checkpoints.length <= keepCount) {
      return 0;
    }

    const toDelete = checkpoints.slice(keepCount);
    for (const checkpoint of toDelete) {
      this.cache.delete(checkpoint.id);
    }

    this.saveCheckpointFile(executionId);
    return toDelete.length;
  }

  async validateCheckpoint(checkpointId: string): Promise<boolean> {
    const checkpoint = this.cache.get(checkpointId);
    if (!checkpoint) {
      return false;
    }

    // Basic validation
    if (!checkpoint.id || !checkpoint.executionId || !checkpoint.nodeId) {
      return false;
    }

    if (typeof checkpoint.timestamp !== "number" || checkpoint.timestamp <= 0) {
      return false;
    }

    return true;
  }

  async getCheckpointStats(): Promise<{
    totalCheckpoints: number;
    executions: string[];
    oldestCheckpoint?: number;
    newestCheckpoint?: number;
  }> {
    const executions = new Set<string>();
    let oldest: number | undefined;
    let newest: number | undefined;

    for (const checkpoint of this.cache.values()) {
      executions.add(checkpoint.executionId);

      if (!oldest || checkpoint.timestamp < oldest) {
        oldest = checkpoint.timestamp;
      }
      if (!newest || checkpoint.timestamp > newest) {
        newest = checkpoint.timestamp;
      }
    }

    return {
      totalCheckpoints: this.cache.size,
      executions: Array.from(executions),
      oldestCheckpoint: oldest,
      newestCheckpoint: newest,
    };
  }

  flush(): void {
    if (this.dirty) {
      const executions = new Set<string>();
      for (const checkpoint of this.cache.values()) {
        executions.add(checkpoint.executionId);
      }

      for (const executionId of executions) {
        this.saveCheckpointFile(executionId);
      }

      this.dirty = false;
    }
  }

  close(): void {
    this.flush();
    this.cache.clear();
  }
}

export function createCheckpointManager(options: {
  basePath: string;
}): CheckpointManager {
  return new CheckpointManager(options);
}
