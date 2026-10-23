import type { Task, TaskPriority } from "@/types/task";
import {
  PlanningWindow,
  ScheduleProposal,
  ScheduledBlock,
  UnscheduledTask,
  InvalidPlanningWindowError,
} from "@/types/schedule";

/**
 * Priority rank map for descending comparison (higher weight = higher priority).
 */
const PRIORITY_WEIGHTS: Record<TaskPriority, number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
};

/**
 * Validates an ISO 8601 date string, rejecting impossible calendar dates.
 * Returns numeric epoch milliseconds if valid, or null if invalid.
 */
function parseAndValidateWindowTimestamp(val: unknown): number | null {
  if (typeof val !== "string") {
    return null;
  }

  const trimmed = val.trim();
  const isoPattern =
    /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
  if (!isoPattern.test(trimmed)) {
    return null;
  }

  const parsed = new Date(trimmed);
  const timeMs = parsed.getTime();
  if (isNaN(timeMs)) {
    return null;
  }

  // Reject impossible calendar dates (e.g. 2026-02-30)
  const [yearStr, monthStr, dayStr] = trimmed.split("T")[0].split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  const utcYear = parsed.getUTCFullYear();
  const utcMonth = parsed.getUTCMonth() + 1;
  const utcDay = parsed.getUTCDate();

  if (
    trimmed.endsWith("Z") ||
    !trimmed.includes("T") ||
    trimmed.includes("+00:00") ||
    trimmed.includes("-00:00")
  ) {
    if (utcYear !== year || utcMonth !== month || utcDay !== day) {
      return null;
    }
  } else {
    const testDate = new Date(year, month - 1, day);
    if (
      testDate.getFullYear() !== year ||
      testDate.getMonth() + 1 !== month ||
      testDate.getDate() !== day
    ) {
      return null;
    }
  }

  return timeMs;
}

/**
 * Deterministic multi-key comparator implementing EDF-P:
 * 1. Tasks with deadlines first
 * 2. Earliest deadline ascending
 * 3. Priority descending
 * 4. Duration ascending
 * 5. Task ID lexicographically ascending
 */
function compareTasksEdfP(a: Task, b: Task): number {
  const aHasDeadline = a.deadline !== undefined;
  const bHasDeadline = b.deadline !== undefined;

  // 1. Tasks with deadlines first
  if (aHasDeadline && !bHasDeadline) return -1;
  if (!aHasDeadline && bHasDeadline) return 1;

  // 2. Earliest deadline ascending (if both have deadlines)
  if (aHasDeadline && bHasDeadline && a.deadline && b.deadline) {
    const aDeadlineMs = new Date(a.deadline).getTime();
    const bDeadlineMs = new Date(b.deadline).getTime();
    if (aDeadlineMs !== bDeadlineMs) {
      return aDeadlineMs - bDeadlineMs;
    }
  }

  // 3. Priority descending
  const priorityDiff = PRIORITY_WEIGHTS[b.priority] - PRIORITY_WEIGHTS[a.priority];
  if (priorityDiff !== 0) {
    return priorityDiff;
  }

  // 4. Duration ascending
  const durationDiff = a.durationMinutes - b.durationMinutes;
  if (durationDiff !== 0) {
    return durationDiff;
  }

  // 5. Task ID lexicographically ascending
  return a.id.localeCompare(b.id);
}

/**
 * Pure, deterministic greedy scheduler heuristic (EDF-P).
 *
 * NOTE: This is a deterministic single-pass greedy heuristic, not an optimal
 * combinatorial scheduling solver. It evaluates tasks sequentially based on EDF-P
 * priority rules.
 *
 * @param window Planning window with startTime and endTime
 * @param tasks Pre-validated tasks to schedule
 * @throws {InvalidPlanningWindowError} When timestamps are invalid or endTime <= startTime
 */
export function generateScheduleProposal(
  window: PlanningWindow,
  tasks: readonly Task[]
): ScheduleProposal {
  // Validate window
  const startMs = parseAndValidateWindowTimestamp(window.startTime);
  if (startMs === null) {
    throw new InvalidPlanningWindowError(
      `Invalid window startTime: "${window.startTime}". Must be a valid ISO 8601 timestamp.`
    );
  }

  const endMs = parseAndValidateWindowTimestamp(window.endTime);
  if (endMs === null) {
    throw new InvalidPlanningWindowError(
      `Invalid window endTime: "${window.endTime}". Must be a valid ISO 8601 timestamp.`
    );
  }

  if (endMs <= startMs) {
    throw new InvalidPlanningWindowError(
      `Invalid planning window: endTime (${window.endTime}) must be strictly after startTime (${window.startTime}).`
    );
  }

  // Clone tasks to guarantee input immutability and sort deterministically
  const sortedTasks = [...tasks].sort(compareTasksEdfP);

  const scheduledBlocks: ScheduledBlock[] = [];
  const unscheduledTasks: UnscheduledTask[] = [];

  let cursorMs = startMs;

  for (const task of sortedTasks) {
    const candidateEndMs = cursorMs + task.durationMinutes * 60 * 1000;

    // Check 1: Exceeds planning window capacity
    if (candidateEndMs > endMs) {
      unscheduledTasks.push({
        taskId: task.id,
        taskTitle: task.title,
        durationMinutes: task.durationMinutes,
        priority: task.priority,
        reason: "exceeds_window_capacity",
      });
      // Cursor remains unchanged
      continue;
    }

    // Check 2: Deadline reachable
    if (task.deadline !== undefined) {
      const deadlineMs = new Date(task.deadline).getTime();
      if (candidateEndMs > deadlineMs) {
        unscheduledTasks.push({
          taskId: task.id,
          taskTitle: task.title,
          durationMinutes: task.durationMinutes,
          priority: task.priority,
          reason: "deadline_unreachable",
        });
        // Cursor remains unchanged
        continue;
      }
    }

    // Task fits and satisfies deadline -> schedule block
    scheduledBlocks.push({
      taskId: task.id,
      taskTitle: task.title,
      startTime: new Date(cursorMs).toISOString(),
      endTime: new Date(candidateEndMs).toISOString(),
      durationMinutes: task.durationMinutes,
      priority: task.priority,
    });

    // Advance cursor
    cursorMs = candidateEndMs;
  }

  const totalScheduledMinutes = scheduledBlocks.reduce(
    (sum, block) => sum + block.durationMinutes,
    0
  );
  const totalUnscheduledMinutes = unscheduledTasks.reduce(
    (sum, task) => sum + task.durationMinutes,
    0
  );

  return {
    scheduledBlocks,
    unscheduledTasks,
    window: {
      startTime: new Date(startMs).toISOString(),
      endTime: new Date(endMs).toISOString(),
    },
    metrics: {
      totalScheduledMinutes,
      totalUnscheduledMinutes,
    },
  };
}

