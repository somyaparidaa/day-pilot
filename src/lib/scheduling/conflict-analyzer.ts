import type { Task } from "@/types/task";
import type { ScheduleProposal, ScheduledBlock } from "@/types/schedule";
import type {
  Conflict,
  ConflictAnalysisResult,
  ConflictType,
} from "@/types/conflict";

/**
 * Parses an ISO 8601 string to numeric milliseconds or null if invalid.
 */
function parseTimestamp(val: string | undefined): number | null {
  if (!val) return null;
  const ms = new Date(val).getTime();
  return isNaN(ms) ? null : ms;
}

/**
 * Generates a stable, deterministic conflict ID for two tasks in an overlap.
 */
function generateOverlapConflictId(idA: string, idB: string): string {
  const sorted = [idA, idB].sort((a, b) => a.localeCompare(b));
  return `overlap:${sorted[0]}:${sorted[1]}`;
}

/**
 * Pure, read-only analyzer that evaluates a ScheduleProposal against the original tasks.
 *
 * Identifies:
 * 1. Overlapping scheduled blocks (strict interval intersection)
 * 2. Scheduled blocks finishing past their task's deadline
 * 3. Scheduled blocks starting before or ending after the planning window
 * 4. Unscheduled tasks with explanations
 *
 * Guarantees zero mutations on proposal, blocks, or task objects.
 */
export function analyzeConflicts(
  proposal: Readonly<ScheduleProposal>,
  tasks: readonly Task[]
): ConflictAnalysisResult {
  const conflicts: Conflict[] = [];

  // Index tasks by id for fast, safe lookup
  const taskMap = new Map<string, Task>();
  for (const t of tasks) {
    taskMap.set(t.id, t);
  }

  const windowStartMs = parseTimestamp(proposal.window.startTime);
  const windowEndMs = parseTimestamp(proposal.window.endTime);

  const blocks = proposal.scheduledBlocks;

  // 1. Detect Overlaps between scheduled block pairs
  // Strict interval overlap: max(startA, startB) < min(endA, endB)
  // Adjacent blocks (endA === startB) do NOT overlap.
  const recordedOverlapPairs = new Set<string>();

  for (let i = 0; i < blocks.length; i++) {
    const blockA = blocks[i];
    const startAMs = parseTimestamp(blockA.startTime);
    const endAMs = parseTimestamp(blockA.endTime);

    if (startAMs === null || endAMs === null) continue;

    for (let j = i + 1; j < blocks.length; j++) {
      const blockB = blocks[j];
      const startBMs = parseTimestamp(blockB.startTime);
      const endBMs = parseTimestamp(blockB.endTime);

      if (startBMs === null || endBMs === null) continue;

      const overlapStartMs = Math.max(startAMs, startBMs);
      const overlapEndMs = Math.min(endAMs, endBMs);

      if (overlapStartMs < overlapEndMs) {
        const conflictId = generateOverlapConflictId(blockA.taskId, blockB.taskId);
        if (!recordedOverlapPairs.has(conflictId)) {
          recordedOverlapPairs.add(conflictId);

          const sortedTaskIds = [blockA.taskId, blockB.taskId].sort((a, b) => a.localeCompare(b));
          const overlapMinutes = Math.round((overlapEndMs - overlapStartMs) / 60000);
          const startIso = new Date(overlapStartMs).toISOString();
          const endIso = new Date(overlapEndMs).toISOString();

          conflicts.push({
            id: conflictId,
            type: "overlap",
            taskIds: sortedTaskIds,
            severity: "error",
            message: `Tasks "${blockA.taskTitle}" and "${blockB.taskTitle}" overlap by ${overlapMinutes}m between ${startIso} and ${endIso}.`,
            details: {
              taskA: blockA.taskId,
              taskB: blockB.taskId,
              overlapStart: startIso,
              overlapEnd: endIso,
              overlapMinutes,
            },
          });
        }
      }
    }
  }

  // 2. Check for Deadline Misses and Outside Window Violations on each scheduled block
  for (const block of blocks) {
    const blockStartMs = parseTimestamp(block.startTime);
    const blockEndMs = parseTimestamp(block.endTime);

    if (blockStartMs === null || blockEndMs === null) continue;

    // Check outside planning window
    if (windowStartMs !== null && windowEndMs !== null) {
      if (blockStartMs < windowStartMs || blockEndMs > windowEndMs) {
        conflicts.push({
          id: `outside_window:${block.taskId}`,
          type: "outside_window",
          taskIds: [block.taskId],
          severity: "error",
          message: `Task "${block.taskTitle}" is scheduled outside the planning window (${new Date(blockStartMs).toISOString()} - ${new Date(blockEndMs).toISOString()}).`,
          details: {
            taskId: block.taskId,
            blockStart: block.startTime,
            blockEnd: block.endTime,
            windowStart: proposal.window.startTime,
            windowEnd: proposal.window.endTime,
          },
        });
      }
    }

    // Check deadline miss against original task record
    const task = taskMap.get(block.taskId);
    if (task && task.deadline) {
      const deadlineMs = parseTimestamp(task.deadline);
      if (deadlineMs !== null && blockEndMs > deadlineMs) {
        const overrunMinutes = Math.round((blockEndMs - deadlineMs) / 60000);
        const deadlineIso = new Date(deadlineMs).toISOString();
        const finishIso = new Date(blockEndMs).toISOString();

        conflicts.push({
          id: `deadline_miss:${block.taskId}`,
          type: "deadline_miss",
          taskIds: [block.taskId],
          severity: "error",
          message: `Task "${block.taskTitle}" finishes at ${finishIso}, which is ${overrunMinutes}m past its deadline (${deadlineIso}).`,
          details: {
            taskId: block.taskId,
            deadline: deadlineIso,
            scheduledEnd: finishIso,
            overrunMinutes,
          },
        });
      }
    }
  }

  // 3. Detect Unscheduled Tasks
  for (const unscheduled of proposal.unscheduledTasks) {
    let explanation = `Task "${unscheduled.taskTitle}" could not be scheduled.`;
    if (unscheduled.reason === "exceeds_window_capacity") {
      explanation = `Task "${unscheduled.taskTitle}" (${unscheduled.durationMinutes}m) could not be scheduled because it exceeds remaining window capacity.`;
    } else if (unscheduled.reason === "deadline_unreachable") {
      explanation = `Task "${unscheduled.taskTitle}" could not be scheduled because its deadline cannot be reached.`;
    }

    conflicts.push({
      id: `unscheduled_task:${unscheduled.taskId}`,
      type: "unscheduled_task",
      taskIds: [unscheduled.taskId],
      severity: "warning",
      message: explanation,
      details: {
        taskId: unscheduled.taskId,
        durationMinutes: unscheduled.durationMinutes,
        priority: unscheduled.priority,
        reason: unscheduled.reason,
      },
    });
  }

  // Calculate summary counts
  let overlapCount = 0;
  let deadlineMissCount = 0;
  let unscheduledCount = 0;
  let outsideWindowCount = 0;

  for (const c of conflicts) {
    if (c.type === "overlap") overlapCount++;
    else if (c.type === "deadline_miss") deadlineMissCount++;
    else if (c.type === "unscheduled_task") unscheduledCount++;
    else if (c.type === "outside_window") outsideWindowCount++;
  }

  return {
    hasConflicts: conflicts.length > 0,
    conflicts,
    summary: {
      totalConflicts: conflicts.length,
      overlapCount,
      deadlineMissCount,
      unscheduledCount,
      outsideWindowCount,
    },
  };
}

