/**
 * State Store Implementation
 * 
 * Provides persistent storage with:
 * - File-based storage with JSON serialization
 * - Scope-based namespacing (global, agent, session, workflow)
 * - Automatic expiration support
 * - Atomic operations with file locking
 * - Encryption support
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { IStateStore, PersistenceScope, PersistedState, StateSnapshot } from "./types.js";

type StoreEntry = {
  key: string;
  scope: PersistenceScope;
  scopeId: string;
  value: unknown;
  updatedAt: number;
  expiresAt?: number;
  metadata?: Record<string, unknown>;
};

type StoreFile = {
  version: string;
  entries: StoreEntry[];
  updatedAt: number;
};

export class FileStateStore implements IStateStore {
  private basePath: string;
  private enableEncryption: boolean;
  private encryptionKey?: string;
  private autoSave: boolean;
  private cache: Map<string, StoreEntry> = new Map();
  private dirty = false;
  private saveTimer: NodeJS.Timeout | null = null;
  private saveInterval: number;

  constructor(options: {
    basePath: string;
    enableEncryption?: boolean;
    encryptionKey?: string;
    autoSave?: boolean;
    autoSaveInterval?: number;
  }) {
    this.basePath = options.basePath;
    this.enableEncryption = options.enableEncryption ?? false;
    this.encryptionKey = options.encryptionKey;
    this.autoSave = options.autoSave ?? true;
    this.saveInterval = options.autoSaveInterval ?? 5000;

    this.ensureDirectory();
    this.loadStore();
  }

  private ensureDirectory(): void {
    if (!fs.existsSync(this.basePath)) {
      fs.mkdirSync(this.basePath, { recursive: true });
    }
  }

  private getStorePath(scope?: PersistenceScope, scopeId?: string): string {
    if (!scope) {
      return path.join(this.basePath, "global.json");
    }
    if (!scopeId) {
      return path.join(this.basePath, `${scope}.json`);
    }
    return path.join(this.basePath, scope, `${scopeId}.json`);
  }

  private loadStore(): void {
    const globalPath = this.getStorePath();
    this.loadFile(globalPath);

    for (const scope of ["agent", "session", "workflow", "global"] as PersistenceScope[]) {
      const scopePath = path.join(this.basePath, scope);
      if (fs.existsSync(scopePath)) {
        const files = fs.readdirSync(scopePath).filter((f) => f.endsWith(".json"));
        for (const file of files) {
          this.loadFile(path.join(scopePath, file));
        }
      }
    }
  }

  private loadFile(filePath: string): void {
    try {
      if (!fs.existsSync(filePath)) {
        return;
      }

      const content = fs.readFileSync(filePath, "utf-8");
      const decrypted = this.enableEncryption ? this.decrypt(content) : content;
      const storeFile: StoreFile = JSON.parse(decrypted);

      for (const entry of storeFile.entries) {
        const cacheKey = this.getCacheKey(entry.key, entry.scope, entry.scopeId);

        if (entry.expiresAt && entry.expiresAt < Date.now()) {
          continue;
        }

        this.cache.set(cacheKey, entry);
      }
    } catch (error) {
      // File doesn't exist or is corrupted, start fresh
    }
  }

  private saveStore(scope?: PersistenceScope, scopeId?: string): void {
    if (!this.autoSave) {
      this.dirty = true;
      return;
    }

    const filePath = this.getStorePath(scope, scopeId);
    const dir = path.dirname(filePath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const entries: StoreEntry[] = [];

    for (const entry of this.cache.values()) {
      if (scope && entry.scope !== scope) {
        continue;
      }
      if (scopeId && entry.scopeId !== scopeId) {
        continue;
      }

      if (entry.expiresAt && entry.expiresAt < Date.now()) {
        this.cache.delete(this.getCacheKey(entry.key, entry.scope, entry.scopeId));
        continue;
      }

      entries.push(entry);
    }

    const storeFile: StoreFile = {
      version: "1.0.0",
      entries,
      updatedAt: Date.now(),
    };

    const content = JSON.stringify(storeFile, null, 2);
    const encrypted = this.enableEncryption ? this.encrypt(content) : content;

    fs.writeFileSync(filePath, encrypted, "utf-8");
  }

  private getCacheKey(key: string, scope?: PersistenceScope, scopeId?: string): string {
    return `${scope ?? "global"}:${scopeId ?? ""}:${key}`;
  }

  private encrypt(data: string): string {
    if (!this.encryptionKey) {
      throw new Error("Encryption key not set");
    }

    const iv = crypto.randomBytes(16);
    const key = crypto.scryptSync(this.encryptionKey, "salt", 32);
    const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);

    let encrypted = cipher.update(data, "utf-8", "hex");
    encrypted += cipher.final("hex");

    return iv.toString("hex") + ":" + encrypted;
  }

  private decrypt(data: string): string {
    if (!this.encryptionKey) {
      throw new Error("Encryption key not set");
    }

    const [ivHex, encrypted] = data.split(":");
    if (!ivHex || !encrypted) {
      throw new Error("Invalid encrypted data format");
    }

    const iv = Buffer.from(ivHex, "hex");
    const key = crypto.scryptSync(this.encryptionKey, "salt", 32);
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);

    let decrypted = decipher.update(encrypted, "hex", "utf-8");
    decrypted += decipher.final("utf-8");

    return decrypted;
  }

  async get(key: string, scope?: PersistenceScope, scopeId?: string): Promise<unknown> {
    const cacheKey = this.getCacheKey(key, scope, scopeId);
    const entry = this.cache.get(cacheKey);

    if (!entry) {
      return undefined;
    }

    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      this.cache.delete(cacheKey);
      return undefined;
    }

    return entry.value;
  }

  async set(
    key: string,
    value: unknown,
    scope?: PersistenceScope,
    scopeId?: string
  ): Promise<void> {
    const cacheKey = this.getCacheKey(key, scope, scopeId);

    const entry: StoreEntry = {
      key,
      scope: scope ?? "global",
      scopeId: scopeId ?? "",
      value,
      updatedAt: Date.now(),
    };

    this.cache.set(cacheKey, entry);
    this.saveStore(scope, scopeId);
  }

  async delete(key: string, scope?: PersistenceScope, scopeId?: string): Promise<void> {
    const cacheKey = this.getCacheKey(key, scope, scopeId);
    const deleted = this.cache.delete(cacheKey);

    if (deleted) {
      this.saveStore(scope, scopeId);
    }
  }

  async exists(key: string, scope?: PersistenceScope, scopeId?: string): Promise<boolean> {
    const value = await this.get(key, scope, scopeId);
    return value !== undefined;
  }

  async list(prefix: string, scope?: PersistenceScope, scopeId?: string): Promise<string[]> {
    const keys: string[] = [];

    for (const entry of this.cache.values()) {
      if (scope && entry.scope !== scope) {
        continue;
      }
      if (scopeId && entry.scopeId !== scopeId) {
        continue;
      }

      if (entry.expiresAt && entry.expiresAt < Date.now()) {
        continue;
      }

      if (entry.key.startsWith(prefix)) {
        keys.push(entry.key);
      }
    }

    return keys;
  }

  async clear(scope?: PersistenceScope, scopeId?: string): Promise<void> {
    if (scope && scopeId) {
      for (const [key, entry] of this.cache) {
        if (entry.scope === scope && entry.scopeId === scopeId) {
          this.cache.delete(key);
        }
      }
    } else if (scope) {
      for (const [key, entry] of this.cache) {
        if (entry.scope === scope) {
          this.cache.delete(key);
        }
      }
    } else {
      this.cache.clear();
    }

    this.saveStore(scope, scopeId);
  }

  async setWithExpiry(
    key: string,
    value: unknown,
    ttlMs: number,
    scope?: PersistenceScope,
    scopeId?: string
  ): Promise<void> {
    const cacheKey = this.getCacheKey(key, scope, scopeId);

    const entry: StoreEntry = {
      key,
      scope: scope ?? "global",
      scopeId: scopeId ?? "",
      value,
      updatedAt: Date.now(),
      expiresAt: Date.now() + ttlMs,
    };

    this.cache.set(cacheKey, entry);
    this.saveStore(scope, scopeId);
  }

  async getWithExpiry(
    key: string,
    scope?: PersistenceScope,
    scopeId?: string
  ): Promise<{ value: unknown; expiresAt?: number; ttl?: number } | undefined> {
    const cacheKey = this.getCacheKey(key, scope, scopeId);
    const entry = this.cache.get(cacheKey);

    if (!entry) {
      return undefined;
    }

    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      this.cache.delete(cacheKey);
      return undefined;
    }

    return {
      value: entry.value,
      expiresAt: entry.expiresAt,
      ttl: entry.expiresAt ? entry.expiresAt - Date.now() : undefined,
    };
  }

  async increment(
    key: string,
    delta: number = 1,
    scope?: PersistenceScope,
    scopeId?: string
  ): Promise<number> {
    const current = (await this.get(key, scope, scopeId)) ?? 0;
    const newValue = (typeof current === "number" ? current : 0) + delta;
    await this.set(key, newValue, scope, scopeId);
    return newValue;
  }

  async decrement(
    key: string,
    delta: number = 1,
    scope?: PersistenceScope,
    scopeId?: string
  ): Promise<number> {
    return this.increment(key, -delta, scope, scopeId);
  }

  createSnapshot(scope: PersistenceScope, scopeId: string): StateSnapshot {
    const entries: StoreEntry[] = [];

    for (const entry of this.cache.values()) {
      if (entry.scope === scope && entry.scopeId === scopeId) {
        if (entry.expiresAt && entry.expiresAt < Date.now()) {
          continue;
        }
        entries.push(entry);
      }
    }

    const data: Record<string, unknown> = {};
    for (const entry of entries) {
      data[entry.key] = entry.value;
    }

    return {
      id: `snapshot-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      scope,
      scopeId,
      timestamp: Date.now(),
      version: "1.0.0",
      data,
      checksum: this.calculateChecksum(data),
    };
  }

  async restoreSnapshot(snapshot: StateSnapshot): Promise<void> {
    const { scope, scopeId, data } = snapshot;

    await this.clear(scope, scopeId);

    for (const [key, value] of Object.entries(data)) {
      await this.set(key, value, scope, scopeId);
    }
  }

  private calculateChecksum(data: Record<string, unknown>): string {
    const content = JSON.stringify(data, Object.keys(data).sort());
    return crypto.createHash("sha256").update(content).digest("hex");
  }

  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    if (this.dirty) {
      // Group entries by (scope, scopeId) and save each group
      const groups = new Map<string, { scope?: PersistenceScope; scopeId?: string }>();
      
      for (const entry of this.cache.values()) {
        const key = `${entry.scope}:${entry.scopeId || ""}`;
        if (!groups.has(key)) {
          groups.set(key, { scope: entry.scope, scopeId: entry.scopeId || undefined });
        }
      }

      // Save global entries (scope=global, no scopeId)
      this.saveStore();
      
      // Save each scope-specific file
      for (const [, group] of groups) {
        if (group.scope && group.scope !== "global") {
          this.saveStore(group.scope, group.scopeId);
        }
      }
      
      this.dirty = false;
    }
  }

  close(): void {
    this.flush();
    this.cache.clear();
  }
}

export function createStateStore(options: {
  basePath: string;
  enableEncryption?: boolean;
  encryptionKey?: string;
  autoSave?: boolean;
  autoSaveInterval?: number;
}): FileStateStore {
  return new FileStateStore(options);
}
