import { describe, it, expect } from "vitest";
import { validateTask, validateExistingTask } from "@/lib/validation/task";

describe("validateTask (new task intake / creation)", () => {
  it("accepts a fully valid task payload and returns normalized data", () => {
    const raw = {
      id: "custom-id-123",
      title: "  Build MCP server  ",
      durationMinutes: 45,
      priority: "high",
      deadline: "2026-10-25T15:00:00.000Z",
      createdAt: "2026-10-23T10:00:00.000Z",
    };

    const res = validateTask(raw);
    expect(res.success).toBe(true);
    if (!res.success) return;

    expect(res.data).toEqual({
      id: "custom-id-123",
      title: "Build MCP server", // trimmed
      durationMinutes: 45,
      priority: "high",
      deadline: "2026-10-25T15:00:00.000Z",
      createdAt: "2026-10-23T10:00:00.000Z",
    });
  });

  it("defaults missing priority to 'medium'", () => {
    const raw = {
      title: "Task with no priority specified",
      durationMinutes: 30,
    };

    const res = validateTask(raw);
    expect(res.success).toBe(true);
    if (!res.success) return;

    expect(res.data.priority).toBe("medium");
  });

  it("generates an id and createdAt when omitted", () => {
    const raw = {
      title: "New Task",
      durationMinutes: 15,
    };

    const before = Date.now();
    const res = validateTask(raw);
    const after = Date.now();

    expect(res.success).toBe(true);
    if (!res.success) return;

    expect(typeof res.data.id).toBe("string");
    expect(res.data.id.length).toBeGreaterThan(0);
    expect(res.data.createdAt).toBeDefined();

    const createdTime = new Date(res.data.createdAt).getTime();
    expect(createdTime).toBeGreaterThanOrEqual(before);
    expect(createdTime).toBeLessThanOrEqual(after);
  });

  it("normalizes ISO deadline timestamps to UTC ISO format", () => {
    const raw = {
      title: "Date formatting test",
      durationMinutes: 60,
      deadline: "2026-10-25T15:30:00+02:00",
    };

    const res = validateTask(raw);
    expect(res.success).toBe(true);
    if (!res.success) return;

    expect(res.data.deadline).toBe("2026-10-25T13:30:00.000Z");
  });

  it("omits deadline when not provided", () => {
    const raw = {
      title: "No deadline",
      durationMinutes: 20,
    };

    const res = validateTask(raw);
    expect(res.success).toBe(true);
    if (!res.success) return;

    expect(res.data.deadline).toBeUndefined();
    expect("deadline" in res.data).toBe(false);
  });

  describe("title validation", () => {
    it("rejects missing title", () => {
      const res = validateTask({ durationMinutes: 30 });
      expect(res.success).toBe(false);
      if (res.success) return;

      expect(res.errors).toContainEqual(
        expect.objectContaining({ field: "title" })
      );
    });

    it("rejects non-string title", () => {
      const res = validateTask({ title: 12345, durationMinutes: 30 });
      expect(res.success).toBe(false);
      if (res.success) return;

      expect(res.errors).toContainEqual(
        expect.objectContaining({ field: "title", message: "Title must be a string" })
      );
    });

    it("rejects empty string and whitespace-only titles", () => {
      const emptyRes = validateTask({ title: "", durationMinutes: 30 });
      expect(emptyRes.success).toBe(false);

      const spacesRes = validateTask({ title: "     ", durationMinutes: 30 });
      expect(spacesRes.success).toBe(false);
      if (spacesRes.success) return;

      expect(spacesRes.errors).toContainEqual(
        expect.objectContaining({
          field: "title",
          message: "Title cannot be empty or whitespace only",
        })
      );
    });

    it("rejects titles longer than 200 characters", () => {
      const longTitle = "a".repeat(201);
      const res = validateTask({ title: longTitle, durationMinutes: 30 });
      expect(res.success).toBe(false);
      if (res.success) return;

      expect(res.errors).toContainEqual(
        expect.objectContaining({
          field: "title",
          message: "Title cannot exceed 200 characters",
        })
      );
    });
  });

  describe("duration validation", () => {
    it("rejects missing duration", () => {
      const res = validateTask({ title: "Valid Title" });
      expect(res.success).toBe(false);
      if (res.success) return;

      expect(res.errors).toContainEqual(
        expect.objectContaining({ field: "durationMinutes" })
      );
    });

    it("rejects 0 and negative durations", () => {
      const zeroRes = validateTask({ title: "Valid Title", durationMinutes: 0 });
      expect(zeroRes.success).toBe(false);

      const negRes = validateTask({ title: "Valid Title", durationMinutes: -10 });
      expect(negRes.success).toBe(false);
      if (negRes.success) return;

      expect(negRes.errors).toContainEqual(
        expect.objectContaining({
          field: "durationMinutes",
          message: "Duration must be at least 1 minute",
        })
      );
    });

    it("rejects durations exceeding 1440 minutes", () => {
      const res = validateTask({ title: "Valid Title", durationMinutes: 1441 });
      expect(res.success).toBe(false);
      if (res.success) return;

      expect(res.errors).toContainEqual(
        expect.objectContaining({
          field: "durationMinutes",
          message: "Duration cannot exceed 1440 minutes (24 hours)",
        })
      );
    });

    it("accepts boundary values 1 and 1440", () => {
      const minRes = validateTask({ title: "Min", durationMinutes: 1 });
      expect(minRes.success).toBe(true);

      const maxRes = validateTask({ title: "Max", durationMinutes: 1440 });
      expect(maxRes.success).toBe(true);
    });

    it("rejects decimals, non-integers, strings, NaN, and infinity", () => {
      expect(validateTask({ title: "A", durationMinutes: 30.5 }).success).toBe(false);
      expect(validateTask({ title: "A", durationMinutes: "30" }).success).toBe(false);
      expect(validateTask({ title: "A", durationMinutes: NaN }).success).toBe(false);
      expect(validateTask({ title: "A", durationMinutes: Infinity }).success).toBe(false);
    });
  });

  describe("priority validation", () => {
    it("accepts all 4 valid priority values", () => {
      for (const p of ["low", "medium", "high", "urgent"]) {
        const res = validateTask({ title: "Task", durationMinutes: 10, priority: p });
        expect(res.success).toBe(true);
        if (res.success) {
          expect(res.data.priority).toBe(p);
        }
      }
    });

    it("rejects unknown priority values", () => {
      const res = validateTask({
        title: "Task",
        durationMinutes: 10,
        priority: "critical",
      });
      expect(res.success).toBe(false);
      if (res.success) return;

      expect(res.errors).toContainEqual(
        expect.objectContaining({
          field: "priority",
          message: "Priority must be one of: 'low', 'medium', 'high', 'urgent'",
        })
      );
    });
  });

  describe("deadline validation", () => {
    it("rejects malformed timestamp strings", () => {
      const res = validateTask({
        title: "Task",
        durationMinutes: 10,
        deadline: "not-a-timestamp",
      });
      expect(res.success).toBe(false);
      if (res.success) return;

      expect(res.errors).toContainEqual(
        expect.objectContaining({ field: "deadline" })
      );
    });

    it("rejects impossible calendar dates (e.g. February 30th)", () => {
      const res = validateTask({
        title: "Task",
        durationMinutes: 10,
        deadline: "2026-02-30T12:00:00Z",
      });
      expect(res.success).toBe(false);
      if (res.success) return;

      expect(res.errors).toContainEqual(
        expect.objectContaining({
          field: "deadline",
          message: "Deadline specifies an impossible calendar date",
        })
      );
    });
  });

  describe("ID handling", () => {
    it("rejects empty or whitespace-only IDs when provided", () => {
      const res = validateTask({
        id: "   ",
        title: "Task",
        durationMinutes: 10,
      });
      expect(res.success).toBe(false);
      if (res.success) return;

      expect(res.errors).toContainEqual(
        expect.objectContaining({
          field: "id",
          message: "ID cannot be empty",
        })
      );
    });
  });
});

describe("validateExistingTask (existing record validation)", () => {
  it("validates complete existing task without modifying id or createdAt", () => {
    const existing = {
      id: "task-existing-1",
      title: "Review architecture",
      durationMinutes: 60,
      priority: "urgent",
      createdAt: "2026-10-20T08:00:00.000Z",
    };

    const res = validateExistingTask(existing);
    expect(res.success).toBe(true);
    if (!res.success) return;

    expect(res.data.id).toBe("task-existing-1");
    expect(res.data.createdAt).toBe("2026-10-20T08:00:00.000Z");
  });

  it("fails if existing task is missing id", () => {
    const existing = {
      title: "Review architecture",
      durationMinutes: 60,
      priority: "urgent",
      createdAt: "2026-10-20T08:00:00.000Z",
    };

    const res = validateExistingTask(existing);
    expect(res.success).toBe(false);
    if (res.success) return;

    expect(res.errors).toContainEqual(
      expect.objectContaining({ field: "id" })
    );
  });

  it("fails if existing task is missing createdAt or has invalid timestamp", () => {
    const invalidTimestamp = {
      id: "task-1",
      title: "Review architecture",
      durationMinutes: 60,
      createdAt: "invalid-date-time",
    };

    const res = validateExistingTask(invalidTimestamp);
    expect(res.success).toBe(false);
    if (res.success) return;

    expect(res.errors).toContainEqual(
      expect.objectContaining({ field: "createdAt" })
    );
  });
});
