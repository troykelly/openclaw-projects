/**
 * Critical Path Method (CPM) algorithm implementation
 */

/**
 * Input task node for CPM calculation
 */
export interface TaskNode {
  id: string;
  duration: number;
  dependencies: string[];
}

/**
 * Calculated task timing information
 */
export interface TaskTiming {
  id: string;
  duration: number;
  earlyStart: number;
  earlyFinish: number;
  lateStart: number;
  lateFinish: number;
  slack: number;
}

/**
 * Result of critical path calculation
 */
export interface CriticalPathResult {
  /** Ordered list of task IDs on the critical path */
  criticalPath: string[];
  /** Total project duration */
  totalDuration: number;
  /** Map of task ID to timing information */
  tasks: Map<string, TaskTiming>;
}

/**
 * Calculate the critical path using the Critical Path Method (CPM)
 *
 * Algorithm:
 * 1. Topological sort to order tasks
 * 2. Forward pass: calculate Early Start (ES) and Early Finish (EF)
 * 3. Backward pass: calculate Late Start (LS) and Late Finish (LF)
 * 4. Calculate slack: Slack = LS - ES = LF - EF
 * 5. Critical path = tasks with zero slack
 */
export function calculateCriticalPath(tasks: TaskNode[]): CriticalPathResult {
  if (tasks.length === 0) {
    return {
      criticalPath: [],
      totalDuration: 0,
      tasks: new Map(),
    };
  }

  // Build adjacency lists
  const taskMap = new Map<string, TaskNode>();
  const successors = new Map<string, string[]>();
  const predecessors = new Map<string, string[]>();

  for (const task of tasks) {
    taskMap.set(task.id, task);
    successors.set(task.id, []);
    predecessors.set(task.id, task.dependencies);

    for (const dep of task.dependencies) {
      const existing = successors.get(dep) || [];
      existing.push(task.id);
      successors.set(dep, existing);
    }
  }

  // Topological sort using Kahn's algorithm
  const inDegree = new Map<string, number>();
  for (const task of tasks) {
    inDegree.set(task.id, task.dependencies.length);
  }

  const queue: string[] = [];
  for (const task of tasks) {
    if (task.dependencies.length === 0) {
      queue.push(task.id);
    }
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);

    for (const succ of successors.get(current) || []) {
      const newDegree = (inDegree.get(succ) || 1) - 1;
      inDegree.set(succ, newDegree);
      if (newDegree === 0) {
        queue.push(succ);
      }
    }
  }

  // Initialize timing
  const timing = new Map<string, TaskTiming>();
  for (const task of tasks) {
    timing.set(task.id, {
      id: task.id,
      duration: task.duration,
      earlyStart: 0,
      earlyFinish: 0,
      lateStart: 0,
      lateFinish: 0,
      slack: 0,
    });
  }

  // Forward pass: calculate Early Start and Early Finish
  for (const taskId of sorted) {
    const task = taskMap.get(taskId)!;
    const taskTiming = timing.get(taskId)!;

    // ES = max(EF of all predecessors)
    let maxPredEF = 0;
    for (const predId of task.dependencies) {
      const predTiming = timing.get(predId);
      if (predTiming && predTiming.earlyFinish > maxPredEF) {
        maxPredEF = predTiming.earlyFinish;
      }
    }

    taskTiming.earlyStart = maxPredEF;
    taskTiming.earlyFinish = maxPredEF + task.duration;
  }

  // Find project end time (maximum EF)
  let projectEnd = 0;
  const endTasks: string[] = [];
  for (const taskId of sorted) {
    const taskTiming = timing.get(taskId)!;
    if (taskTiming.earlyFinish >= projectEnd) {
      if (taskTiming.earlyFinish > projectEnd) {
        projectEnd = taskTiming.earlyFinish;
        endTasks.length = 0;
      }
      endTasks.push(taskId);
    }
  }

  // Initialize late finish for all end tasks
  for (const taskId of endTasks) {
    const taskTiming = timing.get(taskId)!;
    taskTiming.lateFinish = projectEnd;
    taskTiming.lateStart = projectEnd - taskTiming.duration;
  }

  // Backward pass: calculate Late Start and Late Finish
  // Process in reverse topological order
  for (let i = sorted.length - 1; i >= 0; i--) {
    const taskId = sorted[i];
    const taskTiming = timing.get(taskId)!;

    // LF = min(LS of all successors)
    const succs = successors.get(taskId) || [];
    if (succs.length > 0) {
      let minSuccLS = Infinity;
      for (const succId of succs) {
        const succTiming = timing.get(succId);
        if (succTiming && succTiming.lateStart < minSuccLS) {
          minSuccLS = succTiming.lateStart;
        }
      }
      taskTiming.lateFinish = minSuccLS;
      taskTiming.lateStart = minSuccLS - taskTiming.duration;
    } else {
      // End task - already set
      if (taskTiming.lateFinish === 0) {
        taskTiming.lateFinish = projectEnd;
        taskTiming.lateStart = projectEnd - taskTiming.duration;
      }
    }

    // Calculate slack
    taskTiming.slack = taskTiming.lateStart - taskTiming.earlyStart;
  }

  // Identify critical path (tasks with zero slack)
  const criticalTasks = sorted.filter((taskId) => {
    const taskTiming = timing.get(taskId);
    return taskTiming && taskTiming.slack === 0;
  });

  return {
    criticalPath: criticalTasks,
    totalDuration: projectEnd,
    tasks: timing,
  };
}

/**
 * Convert work items to task nodes for CPM calculation
 */
export function workItemsToTaskNodes(
  items: Array<{
    id: string;
    estimate?: number;
    dependencies?: string[];
  }>
): TaskNode[] {
  return items.map((item) => ({
    id: item.id,
    duration: item.estimate || 1, // Default to 1 day if no estimate
    dependencies: item.dependencies || [],
  }));
}
