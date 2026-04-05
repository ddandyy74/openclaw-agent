import { describe, it, expect } from "vitest";
import type {
  WorkflowDefinition,
  WorkflowNode,
  NodeType,
  TaskNodeConfig,
  ParallelNodeConfig,
  SequentialNodeConfig,
  ConditionNodeConfig,
  LoopNodeConfig,
} from "./types.js";

describe("Workflow Types", () => {
  describe("WorkflowNode", () => {
    it("should create a valid task node", () => {
      const node: WorkflowNode = {
        id: "task-1",
        type: "task",
        name: "Execute Task",
        dependencies: [],
        config: {
          type: "task",
          prompt: "Do something",
          agentRole: "worker",
        },
      };

      expect(node.type).toBe("task");
      expect(node.id).toBe("task-1");
      const config = node.config as TaskNodeConfig;
      expect(config.prompt).toBe("Do something");
    });

    it("should create a valid parallel node", () => {
      const node: WorkflowNode = {
        id: "parallel-1",
        type: "parallel",
        name: "Parallel Execution",
        dependencies: [],
        config: {
          type: "parallel",
          branches: [
            {
              id: "branch-1",
              type: "task",
              name: "Branch 1",
              dependencies: [],
              config: { type: "task", prompt: "Branch 1" },
            },
            {
              id: "branch-2",
              type: "task",
              name: "Branch 2",
              dependencies: [],
              config: { type: "task", prompt: "Branch 2" },
            },
          ],
        },
      };

      expect(node.type).toBe("parallel");
      const config = node.config as ParallelNodeConfig;
      expect(config.branches).toHaveLength(2);
    });

    it("should create a valid sequential node", () => {
      const node: WorkflowNode = {
        id: "sequential-1",
        type: "sequential",
        name: "Sequential Execution",
        dependencies: [],
        config: {
          type: "sequential",
          steps: [
            {
              id: "step-1",
              type: "task",
              name: "Step 1",
              dependencies: [],
              config: { type: "task", prompt: "Step 1" },
            },
            {
              id: "step-2",
              type: "task",
              name: "Step 2",
              dependencies: ["step-1"],
              config: { type: "task", prompt: "Step 2" },
            },
          ],
        },
      };

      expect(node.type).toBe("sequential");
      const config = node.config as SequentialNodeConfig;
      expect(config.steps).toHaveLength(2);
    });

    it("should create a valid condition node", () => {
      const node: WorkflowNode = {
        id: "condition-1",
        type: "condition",
        name: "Conditional Execution",
        dependencies: [],
        config: {
          type: "condition",
          expression: "variables.count > 10",
          thenBranch: {
            id: "then-1",
            type: "task",
            name: "Then Branch",
            dependencies: [],
            config: { type: "task", prompt: "Do this" },
          },
          elseBranch: {
            id: "else-1",
            type: "task",
            name: "Else Branch",
            dependencies: [],
            config: { type: "task", prompt: "Do that" },
          },
        },
      };

      expect(node.type).toBe("condition");
      const config = node.config as ConditionNodeConfig;
      expect(config.expression).toBe("variables.count > 10");
      expect(config.thenBranch).toBeDefined();
      expect(config.elseBranch).toBeDefined();
    });

    it("should create a valid loop node", () => {
      const node: WorkflowNode = {
        id: "loop-1",
        type: "loop",
        name: "Loop Execution",
        dependencies: [],
        config: {
          type: "loop",
          iteratorExpression: "variables.items",
          itemVariable: "item",
          body: {
            id: "loop-body",
            type: "task",
            name: "Loop Body",
            dependencies: [],
            config: { type: "task", prompt: "Process ${item}" },
          },
          maxIterations: 100,
        },
      };

      expect(node.type).toBe("loop");
      const config = node.config as LoopNodeConfig;
      expect(config.iteratorExpression).toBe("variables.items");
      expect(config.itemVariable).toBe("item");
      expect(config.maxIterations).toBe(100);
    });
  });

  describe("WorkflowDefinition", () => {
    it("should create a valid workflow definition", () => {
      const workflow: WorkflowDefinition = {
        id: "workflow-1",
        name: "Test Workflow",
        version: "1.0.0",
        description: "A test workflow",
        nodes: [
          {
            id: "start",
            type: "task",
            name: "Start",
            dependencies: [],
            config: { type: "task", prompt: "Start" },
          },
          {
            id: "end",
            type: "task",
            name: "End",
            dependencies: ["start"],
            config: { type: "task", prompt: "End" },
          },
        ],
        variables: {
          input: "",
        },
        triggers: [
          {
            type: "manual",
            config: {},
            enabled: true,
          },
        ],
      };

      expect(workflow.id).toBe("workflow-1");
      expect(workflow.nodes).toHaveLength(2);
      expect(workflow.variables).toBeDefined();
      expect(workflow.triggers).toHaveLength(1);
    });
  });

  describe("NodeType", () => {
    it("should support all node types", () => {
      const types: NodeType[] = [
        "task",
        "parallel",
        "sequential",
        "condition",
        "loop",
        "subworkflow",
      ];

      expect(types).toHaveLength(6);
    });
  });

  describe("Node dependencies", () => {
    it("should support empty dependencies", () => {
      const node: WorkflowNode = {
        id: "no-deps",
        type: "task",
        name: "No Dependencies",
        dependencies: [],
        config: { type: "task", prompt: "Test" },
      };

      expect(node.dependencies).toHaveLength(0);
    });

    it("should support multiple dependencies", () => {
      const node: WorkflowNode = {
        id: "multi-deps",
        type: "task",
        name: "Multiple Dependencies",
        dependencies: ["dep-1", "dep-2", "dep-3"],
        config: { type: "task", prompt: "Test" },
      };

      expect(node.dependencies).toHaveLength(3);
      expect(node.dependencies).toContain("dep-1");
      expect(node.dependencies).toContain("dep-2");
      expect(node.dependencies).toContain("dep-3");
    });
  });
});
