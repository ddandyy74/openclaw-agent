/**
 * Task Queue Implementation
 */

import type { Task, TaskDefinition, TaskStatus, ITaskQueue } from "./index.js";

export class TaskQueue implements ITaskQueue {
  private tasks: Map<string, Task> = new Map();
  private queue: string[] = [];

  async enqueue(taskDef: TaskDefinition): Promise<string> {
    const task: Task = {
      definition: taskDef,
      status: "pending",
      createdAt: Date.now(),
      retryCount: 0,
    };

    this.tasks.set(taskDef.id, task);
    
    if (taskDef.priority === "urgent") {
      this.queue.unshift(taskDef.id);
    } else if (taskDef.priority === "high") {
      const firstNormalOrLow = this.queue.findIndex(
        (id) => {
          const priority = this.tasks.get(id)?.definition.priority;
          return priority === "normal" || priority === "low";
        }
      );
      if (firstNormalOrLow >= 0) {
        this.queue.splice(firstNormalOrLow, 0, taskDef.id);
      } else {
        this.queue.push(taskDef.id);
      }
    } else if (taskDef.priority === "normal") {
      const firstLow = this.queue.findIndex(
        (id) => this.tasks.get(id)?.definition.priority === "low"
      );
      if (firstLow >= 0) {
        this.queue.splice(firstLow, 0, taskDef.id);
      } else {
        this.queue.push(taskDef.id);
      }
    } else {
      this.queue.push(taskDef.id);
    }

    return taskDef.id;
  }

  async dequeue(): Promise<Task | undefined> {
    while (this.queue.length > 0) {
      const taskId = this.queue.shift()!;
      const task = this.tasks.get(taskId);
      
      if (task && task.status === "pending") {
        if (this.canRun(task)) {
          task.status = "running";
          task.startedAt = Date.now();
          return task;
        }
      }
    }
    
    return undefined;
  }

  async peek(): Promise<Task | undefined> {
    if (this.queue.length === 0) {
      return undefined;
    }
    
    const taskId = this.queue[0];
    return this.tasks.get(taskId);
  }

  async size(): Promise<number> {
    return this.queue.length;
  }

  async remove(taskId: string): Promise<void> {
    const index = this.queue.indexOf(taskId);
    if (index >= 0) {
      this.queue.splice(index, 1);
    }
    this.tasks.delete(taskId);
  }

  async update(task: Task): Promise<void> {
    this.tasks.set(task.definition.id, task);
  }

  async get(taskId: string): Promise<Task | undefined> {
    return this.tasks.get(taskId);
  }

  async list(filter?: { status?: TaskStatus }): Promise<Task[]> {
    let tasks = Array.from(this.tasks.values());

    if (filter?.status) {
      tasks = tasks.filter((t) => t.status === filter.status);
    }

    return tasks;
  }

  getPendingTasks(): Task[] {
    return Array.from(this.tasks.values()).filter(
      (t) => t.status === "pending"
    );
  }

  getRunningTasks(): Task[] {
    return Array.from(this.tasks.values()).filter(
      (t) => t.status === "running"
    );
  }

  getDependencies(taskId: string): string[] {
    const task = this.tasks.get(taskId);
    return task?.definition.dependencies ?? [];
  }

  areDependenciesMet(taskId: string): boolean {
    const dependencies = this.getDependencies(taskId);
    
    for (const depId of dependencies) {
      const depTask = this.tasks.get(depId);
      if (!depTask || depTask.status !== "completed") {
        return false;
      }
    }
    
    return true;
  }

  private canRun(task: Task): boolean {
    return this.areDependenciesMet(task.definition.id);
  }
}
