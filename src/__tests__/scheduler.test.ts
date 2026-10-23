import { describe, it, expect } from "vitest";
import { generateScheduleProposal } from "@/lib/scheduling/scheduler";
import { InvalidPlanningWindowError } from "@/types/schedule";
import type { Task } from "@/types/task";

describe("generateScheduleProposal (EDF-P Greedy Scheduler)", () => {
  const defaultWindow = {
    startTime: "2026-10-25T09:00:00.000Z",
    endTime: "2026-10-25T17:00:00.000Z", // 8 hours = 480 mins
  };

  it("schedules a feasible day sequentially without gaps or overlaps", () => {
    const tasks: Task[] = [
      {
        id: "task-1",
        title: "Morning Planning",
        durationMinutes: 60,
        priority: "high",
        createdAt: "2026-10-24T12:00:00.000Z",
      },
      {
        id: "task-2",
        title: "Deep Work Coding",
        durationMinutes: 120,
        priority: "urgent",
        createdAt: "2026-10-24T12:00:00.000Z",
      },
      {
        id: "task-3",
        title: "Team Sync",
        durationMinutes: 30,
        priority: "medium",
        createdAt: "2026-10-24T12:00:00.000Z",
      },
    ];

    const proposal = generateScheduleProposal(defaultWindow, tasks);

    // Urgent task-2 (120m) -> High task-1 (60m) -> Medium task-3 (30m)
    expect(proposal.unscheduledTasks).toHaveLength(0);
    expect(proposal.scheduledBlocks).toHaveLength(3);

    expect(proposal.scheduledBlocks[0]).toEqual({
      taskId: "task-2",
      taskTitle: "Deep Work Coding",
      startTime: "2026-10-25T09:00:00.000Z",
      endTime: "2026-10-25T11:00:00.000Z",
      durationMinutes: 120,
      priority: "urgent",
    });

    expect(proposal.scheduledBlocks[1]).toEqual({
      taskId: "task-1",
      taskTitle: "Morning Planning",
      startTime: "2026-10-25T11:00:00.000Z",
      endTime: "2026-10-25T12:00:00.000Z",
      durationMinutes: 60,
      priority: "high",
    });

    expect(proposal.scheduledBlocks[2]).toEqual({
      taskId: "task-3",
      taskTitle: "Team Sync",
      startTime: "2026-10-25T12:00:00.000Z",
      endTime: "2026-10-25T12:30:00.000Z",
      durationMinutes: 30,
      priority: "medium",
    });

    expect(proposal.metrics.totalScheduledMinutes).toBe(210);
    expect(proposal.metrics.totalUnscheduledMinutes).toBe(0);
  });

  it("normalizes output window timestamps to standard UTC ISO strings", () => {
    const localWindow = {
      startTime: "2026-10-25T11:00:00+02:00", // 09:00:00.000Z
      endTime: "2026-10-25T19:00:00+02:00",   // 17:00:00.000Z
    };

    const proposal = generateScheduleProposal(localWindow, []);
    expect(proposal.window.startTime).toBe("2026-10-25T09:00:00.000Z");
    expect(proposal.window.endTime).toBe("2026-10-25T17:00:00.000Z");
  });

  it("schedules a task when finish time exactly equals the deadline (boundary equality)", () => {
    const tasks: Task[] = [
      {
        id: "exact-deadline",
        title: "Exact Deadline Task",
        durationMinutes: 60,
        priority: "medium",
        deadline: "2026-10-25T10:00:00.000Z", // finishes exactly at 10:00:00
        createdAt: "2026-10-24T12:00:00.000Z",
      },
    ];

    const proposal = generateScheduleProposal(defaultWindow, tasks);
    expect(proposal.scheduledBlocks).toHaveLength(1);
    expect(proposal.unscheduledTasks).toHaveLength(0);
    expect(proposal.scheduledBlocks[0].endTime).toBe("2026-10-25T10:00:00.000Z");
  });

  it("marks a task as deadline_unreachable if it finishes after deadline and does not advance cursor", () => {
    const tasks: Task[] = [
      {
        id: "missed-task",
        title: "Impossible Deadline Task",
        durationMinutes: 90,
        priority: "urgent",
        deadline: "2026-10-25T10:00:00.000Z", // needs 90 mins from 09:00 -> 10:30 > 10:00
        createdAt: "2026-10-24T12:00:00.000Z",
      },
      {
        id: "following-task",
        title: "Feasible Following Task",
        durationMinutes: 30,
        priority: "medium",
        createdAt: "2026-10-24T12:00:00.000Z",
      },
    ];

    const proposal = generateScheduleProposal(defaultWindow, tasks);

    expect(proposal.unscheduledTasks).toHaveLength(1);
    expect(proposal.unscheduledTasks[0]).toEqual({
      taskId: "missed-task",
      taskTitle: "Impossible Deadline Task",
      durationMinutes: 90,
      priority: "urgent",
      reason: "deadline_unreachable",
    });

    // Following task must be scheduled starting at the UNCHANGED cursor (09:00:00)
    expect(proposal.scheduledBlocks).toHaveLength(1);
    expect(proposal.scheduledBlocks[0]).toEqual({
      taskId: "following-task",
      taskTitle: "Feasible Following Task",
      startTime: "2026-10-25T09:00:00.000Z",
      endTime: "2026-10-25T09:30:00.000Z",
      durationMinutes: 30,
      priority: "medium",
    });

    expect(proposal.metrics.totalScheduledMinutes).toBe(30);
    expect(proposal.metrics.totalUnscheduledMinutes).toBe(90);
  });

  it("marks a task as exceeds_window_capacity if it exceeds window end and schedules feasible subsequent task", () => {
    const smallWindow = {
      startTime: "2026-10-25T09:00:00.000Z",
      endTime: "2026-10-25T10:00:00.000Z", // 60 mins total
    };

    const tasks: Task[] = [
      {
        id: "oversized-task",
        title: "Oversized Task",
        durationMinutes: 120, // Cannot fit
        priority: "urgent",
        createdAt: "2026-10-24T12:00:00.000Z",
      },
      {
        id: "small-task",
        title: "Small Task",
        durationMinutes: 45, // Fits
        priority: "low",
        createdAt: "2026-10-24T12:00:00.000Z",
      },
    ];

    const proposal = generateScheduleProposal(smallWindow, tasks);

    expect(proposal.unscheduledTasks).toHaveLength(1);
    expect(proposal.unscheduledTasks[0]).toEqual({
      taskId: "oversized-task",
      taskTitle: "Oversized Task",
      durationMinutes: 120,
      priority: "urgent",
      reason: "exceeds_window_capacity",
    });

    expect(proposal.scheduledBlocks).toHaveLength(1);
    expect(proposal.scheduledBlocks[0].taskId).toBe("small-task");
    expect(proposal.scheduledBlocks[0].startTime).toBe("2026-10-25T09:00:00.000Z");
    expect(proposal.scheduledBlocks[0].endTime).toBe("2026-10-25T09:45:00.000Z");

    expect(proposal.metrics.totalScheduledMinutes).toBe(45);
    expect(proposal.metrics.totalUnscheduledMinutes).toBe(120);
  });

  it("strictly implements EDF-P tie-breaking hierarchy", () => {
    const window = {
      startTime: "2026-10-25T09:00:00.000Z",
      endTime: "2026-10-25T18:00:00.000Z",
    };

    const tasks: Task[] = [
      // No deadline, low priority
      { id: "e", title: "No deadline low", durationMinutes: 15, priority: "low", createdAt: "2026-10-24T00:00:00Z" },
      // No deadline, urgent priority
      { id: "d", title: "No deadline urgent", durationMinutes: 15, priority: "urgent", createdAt: "2026-10-24T00:00:00Z" },
      // Earlier deadline, low priority
      { id: "a", title: "Earlier deadline", durationMinutes: 15, priority: "low", deadline: "2026-10-25T12:00:00Z", createdAt: "2026-10-24T00:00:00Z" },
      // Later deadline, urgent priority
      { id: "b", title: "Later deadline urgent", durationMinutes: 15, priority: "urgent", deadline: "2026-10-25T14:00:00Z", createdAt: "2026-10-24T00:00:00Z" },
      // Same deadline as 'a', higher priority
      { id: "c", title: "Earlier deadline high", durationMinutes: 15, priority: "high", deadline: "2026-10-25T12:00:00Z", createdAt: "2026-10-24T00:00:00Z" },
      // Identical deadline, priority, duration -> broken by ID ('id-1' vs 'id-2')
      { id: "id-2", title: "Tie id-2", durationMinutes: 20, priority: "medium", deadline: "2026-10-25T16:00:00Z", createdAt: "2026-10-24T00:00:00Z" },
      { id: "id-1", title: "Tie id-1", durationMinutes: 20, priority: "medium", deadline: "2026-10-25T16:00:00Z", createdAt: "2026-10-24T00:00:00Z" },
    ];

    const proposal = generateScheduleProposal(window, tasks);
    const scheduledIds = proposal.scheduledBlocks.map((b) => b.taskId);

    // Expected order:
    // 1. 'c' (deadline 12:00, high)
    // 2. 'a' (deadline 12:00, low)
    // 3. 'b' (deadline 14:00, urgent)
    // 4. 'id-1' (deadline 16:00, medium, id 'id-1')
    // 5. 'id-2' (deadline 16:00, medium, id 'id-2')
    // 6. 'd' (no deadline, urgent)
    // 7. 'e' (no deadline, low)
    expect(scheduledIds).toEqual(["c", "a", "b", "id-1", "id-2", "d", "e"]);
  });

  it("is 100% deterministic regardless of input array permutation", () => {
    const tasks: Task[] = [
      { id: "t1", title: "Task 1", durationMinutes: 30, priority: "medium", createdAt: "2026-10-24T00:00:00Z" },
      { id: "t2", title: "Task 2", durationMinutes: 45, priority: "urgent", createdAt: "2026-10-24T00:00:00Z" },
      { id: "t3", title: "Task 3", durationMinutes: 15, priority: "high", deadline: "2026-10-25T11:00:00Z", createdAt: "2026-10-24T00:00:00Z" },
    ];

    const baseline = generateScheduleProposal(defaultWindow, tasks);

    // Test multiple random permutations
    for (let i = 0; i < 5; i++) {
      const shuffled = [...tasks].sort(() => Math.random() - 0.5);
      const result = generateScheduleProposal(defaultWindow, shuffled);
      expect(result).toEqual(baseline);
    }
  });

  it("does not mutate the input tasks array or task objects", () => {
    const tasks: readonly Task[] = Object.freeze([
      Object.freeze({
        id: "t1",
        title: "Immutable Task",
        durationMinutes: 30,
        priority: "high" as const,
        createdAt: "2026-10-24T00:00:00.000Z",
      }),
      Object.freeze({
        id: "t2",
        title: "Immutable Task 2",
        durationMinutes: 45,
        priority: "medium" as const,
        createdAt: "2026-10-24T00:00:00.000Z",
      }),
    ]);

    // Should not throw mutation error on frozen array / objects
    expect(() => generateScheduleProposal(defaultWindow, tasks)).not.toThrow();
  });

  describe("window validation", () => {
    it("throws InvalidPlanningWindowError if endTime is equal to startTime", () => {
      const window = {
        startTime: "2026-10-25T09:00:00.000Z",
        endTime: "2026-10-25T09:00:00.000Z",
      };
      expect(() => generateScheduleProposal(window, [])).toThrow(
        InvalidPlanningWindowError
      );
    });

    it("throws InvalidPlanningWindowError if endTime is before startTime", () => {
      const window = {
        startTime: "2026-10-25T17:00:00.000Z",
        endTime: "2026-10-25T09:00:00.000Z",
      };
      expect(() => generateScheduleProposal(window, [])).toThrow(
        InvalidPlanningWindowError
      );
    });

    it("throws InvalidPlanningWindowError on malformed timestamp string", () => {
      const window = {
        startTime: "not-a-timestamp",
        endTime: "2026-10-25T17:00:00.000Z",
      };
      expect(() => generateScheduleProposal(window, [])).toThrow(
        InvalidPlanningWindowError
      );
    });

    it("throws InvalidPlanningWindowError on impossible calendar dates", () => {
      const window = {
        startTime: "2026-02-30T09:00:00.000Z",
        endTime: "2026-02-30T17:00:00.000Z",
      };
      expect(() => generateScheduleProposal(window, [])).toThrow(
        InvalidPlanningWindowError
      );
    });
  });
});
