import { describe, it, expect } from "vitest";
import { analyzeConflicts } from "@/lib/scheduling/conflict-analyzer";
import type { ScheduleProposal } from "@/types/schedule";
import type { Task } from "@/types/task";

describe("analyzeConflicts", () => {
  const window = {
    startTime: "2026-10-25T09:00:00.000Z",
    endTime: "2026-10-25T17:00:00.000Z",
  };

  it("returns zero conflicts and accurate zero summary for a conflict-free proposal", () => {
    const tasks: Task[] = [
      {
        id: "t1",
        title: "Task 1",
        durationMinutes: 60,
        priority: "high",
        createdAt: "2026-10-24T00:00:00.000Z",
      },
    ];

    const proposal: ScheduleProposal = {
      window,
      scheduledBlocks: [
        {
          taskId: "t1",
          taskTitle: "Task 1",
          startTime: "2026-10-25T09:00:00.000Z",
          endTime: "2026-10-25T10:00:00.000Z",
          durationMinutes: 60,
          priority: "high",
        },
      ],
      unscheduledTasks: [],
      metrics: {
        totalScheduledMinutes: 60,
        totalUnscheduledMinutes: 0,
      },
    };

    const result = analyzeConflicts(proposal, tasks);

    expect(result.hasConflicts).toBe(false);
    expect(result.conflicts).toHaveLength(0);
    expect(result.summary).toEqual({
      totalConflicts: 0,
      overlapCount: 0,
      deadlineMissCount: 0,
      unscheduledCount: 0,
      outsideWindowCount: 0,
    });
  });

  it("detects an overlapping pair with sorted task IDs, error severity, and deterministic conflict ID", () => {
    const tasks: Task[] = [
      { id: "task-z", title: "Task Z", durationMinutes: 60, priority: "medium", createdAt: "2026-10-24T00:00:00Z" },
      { id: "task-a", title: "Task A", durationMinutes: 60, priority: "urgent", createdAt: "2026-10-24T00:00:00Z" },
    ];

    const proposal: ScheduleProposal = {
      window,
      scheduledBlocks: [
        {
          taskId: "task-z",
          taskTitle: "Task Z",
          startTime: "2026-10-25T09:00:00.000Z",
          endTime: "2026-10-25T10:00:00.000Z",
          durationMinutes: 60,
          priority: "medium",
        },
        {
          taskId: "task-a",
          taskTitle: "Task A",
          startTime: "2026-10-25T09:30:00.000Z", // Overlaps by 30 mins
          endTime: "2026-10-25T10:30:00.000Z",
          durationMinutes: 60,
          priority: "urgent",
        },
      ],
      unscheduledTasks: [],
      metrics: { totalScheduledMinutes: 120, totalUnscheduledMinutes: 0 },
    };

    const result = analyzeConflicts(proposal, tasks);

    expect(result.hasConflicts).toBe(true);
    expect(result.summary.totalConflicts).toBe(1);
    expect(result.summary.overlapCount).toBe(1);

    const overlap = result.conflicts[0];
    expect(overlap.id).toBe("overlap:task-a:task-z"); // Deterministically sorted IDs
    expect(overlap.type).toBe("overlap");
    expect(overlap.severity).toBe("error");
    expect(overlap.taskIds).toEqual(["task-a", "task-z"]);
    expect(overlap.message).toContain('Tasks "Task Z" and "Task A" overlap by 30m');
  });

  it("treats adjacent blocks where end equals start as non-overlapping", () => {
    const tasks: Task[] = [
      { id: "t1", title: "T1", durationMinutes: 60, priority: "low", createdAt: "2026-10-24T00:00:00Z" },
      { id: "t2", title: "T2", durationMinutes: 60, priority: "low", createdAt: "2026-10-24T00:00:00Z" },
    ];

    const proposal: ScheduleProposal = {
      window,
      scheduledBlocks: [
        {
          taskId: "t1",
          taskTitle: "T1",
          startTime: "2026-10-25T09:00:00.000Z",
          endTime: "2026-10-25T10:00:00.000Z", // Finishes at 10:00
          durationMinutes: 60,
          priority: "low",
        },
        {
          taskId: "t2",
          taskTitle: "T2",
          startTime: "2026-10-25T10:00:00.000Z", // Starts exactly at 10:00
          endTime: "2026-10-25T11:00:00.000Z",
          durationMinutes: 60,
          priority: "low",
        },
      ],
      unscheduledTasks: [],
      metrics: { totalScheduledMinutes: 120, totalUnscheduledMinutes: 0 },
    };

    const result = analyzeConflicts(proposal, tasks);
    expect(result.hasConflicts).toBe(false);
    expect(result.conflicts).toHaveLength(0);
  });

  it("flags a scheduled block that finishes after its task deadline", () => {
    const tasks: Task[] = [
      {
        id: "t1",
        title: "Report Filing",
        durationMinutes: 60,
        priority: "urgent",
        deadline: "2026-10-25T09:30:00.000Z", // Deadline at 09:30
        createdAt: "2026-10-24T00:00:00Z",
      },
    ];

    const proposal: ScheduleProposal = {
      window,
      scheduledBlocks: [
        {
          taskId: "t1",
          taskTitle: "Report Filing",
          startTime: "2026-10-25T09:00:00.000Z",
          endTime: "2026-10-25T10:00:00.000Z", // Overruns deadline by 30 mins
          durationMinutes: 60,
          priority: "urgent",
        },
      ],
      unscheduledTasks: [],
      metrics: { totalScheduledMinutes: 60, totalUnscheduledMinutes: 0 },
    };

    const result = analyzeConflicts(proposal, tasks);

    expect(result.hasConflicts).toBe(true);
    expect(result.summary.deadlineMissCount).toBe(1);

    const deadlineConflict = result.conflicts[0];
    expect(deadlineConflict.id).toBe("deadline_miss:t1");
    expect(deadlineConflict.type).toBe("deadline_miss");
    expect(deadlineConflict.severity).toBe("error");
    expect(deadlineConflict.taskIds).toEqual(["t1"]);
    expect(deadlineConflict.message).toContain('30m past its deadline');
  });

  it("flags unscheduled tasks with warning severity and preserves specific unscheduled reasons", () => {
    const tasks: Task[] = [
      { id: "t1", title: "Big Project", durationMinutes: 600, priority: "urgent", createdAt: "2026-10-24T00:00:00Z" },
      { id: "t2", title: "Tight Deadline", durationMinutes: 60, priority: "high", deadline: "2026-10-25T09:10:00Z", createdAt: "2026-10-24T00:00:00Z" },
    ];

    const proposal: ScheduleProposal = {
      window,
      scheduledBlocks: [],
      unscheduledTasks: [
        {
          taskId: "t1",
          taskTitle: "Big Project",
          durationMinutes: 600,
          priority: "urgent",
          reason: "exceeds_window_capacity",
        },
        {
          taskId: "t2",
          taskTitle: "Tight Deadline",
          durationMinutes: 60,
          priority: "high",
          reason: "deadline_unreachable",
        },
      ],
      metrics: { totalScheduledMinutes: 0, totalUnscheduledMinutes: 660 },
    };

    const result = analyzeConflicts(proposal, tasks);

    expect(result.hasConflicts).toBe(true);
    expect(result.summary.unscheduledCount).toBe(2);
    expect(result.conflicts).toHaveLength(2);

    expect(result.conflicts[0]).toEqual(
      expect.objectContaining({
        id: "unscheduled_task:t1",
        type: "unscheduled_task",
        severity: "warning",
        taskIds: ["t1"],
        message: expect.stringContaining("exceeds remaining window capacity"),
      })
    );

    expect(result.conflicts[1]).toEqual(
      expect.objectContaining({
        id: "unscheduled_task:t2",
        type: "unscheduled_task",
        severity: "warning",
        taskIds: ["t2"],
        message: expect.stringContaining("deadline cannot be reached"),
      })
    );
  });

  it("detects blocks scheduled outside the planning window with error severity", () => {
    const tasks: Task[] = [
      { id: "t1", title: "Early Bird", durationMinutes: 60, priority: "medium", createdAt: "2026-10-24T00:00:00Z" },
      { id: "t2", title: "Late Night", durationMinutes: 60, priority: "medium", createdAt: "2026-10-24T00:00:00Z" },
    ];

    const proposal: ScheduleProposal = {
      window, // 09:00 - 17:00
      scheduledBlocks: [
        {
          taskId: "t1",
          taskTitle: "Early Bird",
          startTime: "2026-10-25T08:00:00.000Z", // Before 09:00
          endTime: "2026-10-25T09:00:00.000Z",
          durationMinutes: 60,
          priority: "medium",
        },
        {
          taskId: "t2",
          taskTitle: "Late Night",
          startTime: "2026-10-25T17:00:00.000Z",
          endTime: "2026-10-25T18:00:00.000Z", // Past 17:00
          durationMinutes: 60,
          priority: "medium",
        },
      ],
      unscheduledTasks: [],
      metrics: { totalScheduledMinutes: 120, totalUnscheduledMinutes: 0 },
    };

    const result = analyzeConflicts(proposal, tasks);

    expect(result.hasConflicts).toBe(true);
    expect(result.summary.outsideWindowCount).toBe(2);
    expect(result.conflicts[0].type).toBe("outside_window");
    expect(result.conflicts[0].severity).toBe("error");
    expect(result.conflicts[1].type).toBe("outside_window");
  });

  it("accurately aggregates multiple mixed conflict types and total count", () => {
    const tasks: Task[] = [
      { id: "t1", title: "T1", durationMinutes: 60, priority: "high", createdAt: "2026-10-24T00:00:00Z" },
      { id: "t2", title: "T2", durationMinutes: 60, priority: "high", deadline: "2026-10-25T09:30:00Z", createdAt: "2026-10-24T00:00:00Z" },
      { id: "t3", title: "T3", durationMinutes: 30, priority: "low", createdAt: "2026-10-24T00:00:00Z" },
    ];

    const proposal: ScheduleProposal = {
      window,
      scheduledBlocks: [
        // Overlap pair (t1 & t2)
        { taskId: "t1", taskTitle: "T1", startTime: "2026-10-25T09:00:00Z", endTime: "2026-10-25T10:00:00Z", durationMinutes: 60, priority: "high" },
        // t2 also misses deadline (finish 10:00 vs deadline 09:30)
        { taskId: "t2", taskTitle: "T2", startTime: "2026-10-25T09:00:00Z", endTime: "2026-10-25T10:00:00Z", durationMinutes: 60, priority: "high" },
      ],
      unscheduledTasks: [
        { taskId: "t3", taskTitle: "T3", durationMinutes: 30, priority: "low", reason: "exceeds_window_capacity" },
      ],
      metrics: { totalScheduledMinutes: 120, totalUnscheduledMinutes: 30 },
    };

    const result = analyzeConflicts(proposal, tasks);

    expect(result.hasConflicts).toBe(true);
    expect(result.summary.overlapCount).toBe(1);
    expect(result.summary.deadlineMissCount).toBe(1);
    expect(result.summary.unscheduledCount).toBe(1);
    expect(result.summary.totalConflicts).toBe(3);
    expect(result.conflicts).toHaveLength(3);
  });

  it("handles missing task references defensively without crashing or inventing deadlines", () => {
    const tasks: Task[] = []; // Empty tasks array (block references unknown task)

    const proposal: ScheduleProposal = {
      window,
      scheduledBlocks: [
        {
          taskId: "unknown-task-id",
          taskTitle: "Ghost Task",
          startTime: "2026-10-25T09:00:00.000Z",
          endTime: "2026-10-25T10:00:00.000Z",
          durationMinutes: 60,
          priority: "low",
        },
      ],
      unscheduledTasks: [],
      metrics: { totalScheduledMinutes: 60, totalUnscheduledMinutes: 0 },
    };

    expect(() => analyzeConflicts(proposal, tasks)).not.toThrow();
    const result = analyzeConflicts(proposal, tasks);
    expect(result.hasConflicts).toBe(false);
  });

  it("guarantees deep immutability when passed frozen objects and arrays", () => {
    const frozenTasks = Object.freeze([
      Object.freeze({
        id: "t1",
        title: "Frozen Task",
        durationMinutes: 60,
        priority: "medium" as const,
        deadline: "2026-10-25T11:00:00.000Z",
        createdAt: "2026-10-24T00:00:00.000Z",
      }),
    ]);

    const frozenProposal = Object.freeze({
      window: Object.freeze({
        startTime: "2026-10-25T09:00:00.000Z",
        endTime: "2026-10-25T17:00:00.000Z",
      }),
      scheduledBlocks: Object.freeze([
        Object.freeze({
          taskId: "t1",
          taskTitle: "Frozen Task",
          startTime: "2026-10-25T09:00:00.000Z",
          endTime: "2026-10-25T10:00:00.000Z",
          durationMinutes: 60,
          priority: "medium" as const,
        }),
      ]),
      unscheduledTasks: Object.freeze([]),
      metrics: Object.freeze({
        totalScheduledMinutes: 60,
        totalUnscheduledMinutes: 0,
      }),
    }) as unknown as ScheduleProposal;

    expect(() => analyzeConflicts(frozenProposal, frozenTasks)).not.toThrow();
  });

  it("produces deterministic output across repeated calls", () => {
    const tasks: Task[] = [
      { id: "a", title: "A", durationMinutes: 60, priority: "high", createdAt: "2026-10-24T00:00:00Z" },
      { id: "b", title: "B", durationMinutes: 60, priority: "high", createdAt: "2026-10-24T00:00:00Z" },
    ];

    const proposal: ScheduleProposal = {
      window,
      scheduledBlocks: [
        { taskId: "b", taskTitle: "B", startTime: "2026-10-25T09:00:00Z", endTime: "2026-10-25T10:00:00Z", durationMinutes: 60, priority: "high" },
        { taskId: "a", taskTitle: "A", startTime: "2026-10-25T09:30:00Z", endTime: "2026-10-25T10:30:00Z", durationMinutes: 60, priority: "high" },
      ],
      unscheduledTasks: [],
      metrics: { totalScheduledMinutes: 120, totalUnscheduledMinutes: 0 },
    };

    const firstRun = analyzeConflicts(proposal, tasks);
    const secondRun = analyzeConflicts(proposal, tasks);

    expect(firstRun).toEqual(secondRun);
  });
});

