import { z } from "zod";
import type { Task, TaskPriority, ValidationResult, ValidationError } from "@/types/task";

export const TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const;

/**
 * Validates and normalizes an ISO 8601 date string, rejecting impossible calendar dates.
 * Returns UTC ISO 8601 string if valid.
 */
function parseAndValidateIsoDate(val: unknown): { valid: true; utcIso?: string } | { valid: false; message: string } {
  if (val === undefined || val === null || val === "") {
    return { valid: true, utcIso: undefined };
  }

  if (typeof val !== "string") {
    return { valid: false, message: "Deadline must be an ISO 8601 string" };
  }

  const trimmed = val.trim();
  const isoPattern = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
  if (!isoPattern.test(trimmed)) {
    return { valid: false, message: "Deadline must be a valid ISO 8601 timestamp" };
  }

  const parsed = new Date(trimmed);
  if (isNaN(parsed.getTime())) {
    return { valid: false, message: "Deadline must be a valid calendar date" };
  }

  // Reject impossible dates that JS Date rolls over (e.g. 2026-02-30)
  const [yearStr, monthStr, dayStr] = trimmed.split("T")[0].split("-");
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  const utcYear = parsed.getUTCFullYear();
  const utcMonth = parsed.getUTCMonth() + 1;
  const utcDay = parsed.getUTCDate();

  if (trimmed.endsWith("Z") || !trimmed.includes("T") || trimmed.includes("+00:00") || trimmed.includes("-00:00")) {
    if (utcYear !== year || utcMonth !== month || utcDay !== day) {
      return { valid: false, message: "Deadline specifies an impossible calendar date" };
    }
  } else {
    const testDate = new Date(year, month - 1, day);
    if (
      testDate.getFullYear() !== year ||
      testDate.getMonth() + 1 !== month ||
      testDate.getDate() !== day
    ) {
      return { valid: false, message: "Deadline specifies an impossible calendar date" };
    }
  }

  return { valid: true, utcIso: parsed.toISOString() };
}

/**
 * Validates createdAt timestamp string without calendar date rollover.
 */
function parseAndValidateCreatedAt(val: unknown): { valid: true; utcIso: string } | { valid: false; message: string } {
  if (typeof val !== "string") {
    return { valid: false, message: "createdAt must be an ISO 8601 string" };
  }

  const trimmed = val.trim();
  const parsed = new Date(trimmed);
  if (isNaN(parsed.getTime())) {
    return { valid: false, message: "createdAt must be a valid ISO 8601 timestamp" };
  }

  return { valid: true, utcIso: parsed.toISOString() };
}

/**
 * Common schema fields for Task
 */
const taskTitleSchema = z
  .custom<string>((val) => typeof val === "string", {
    message: "Title must be a string",
  })
  .transform((val) => val.trim())
  .refine((val) => val.length > 0, {
    message: "Title cannot be empty or whitespace only",
  })
  .refine((val) => val.length <= 200, {
    message: "Title cannot exceed 200 characters",
  });

const taskDurationSchema = z
  .custom<number>(
    (val) => typeof val === "number" && !isNaN(val) && isFinite(val),
    {
      message: "Duration must be an integer number of minutes",
    }
  )
  .refine((val) => Number.isInteger(val), {
    message: "Duration must be an integer",
  })
  .refine((val) => val >= 1, {
    message: "Duration must be at least 1 minute",
  })
  .refine((val) => val <= 1440, {
    message: "Duration cannot exceed 1440 minutes (24 hours)",
  });

const taskPrioritySchema = z
  .custom<TaskPriority>(
    (val) => val === undefined || (typeof val === "string" && (TASK_PRIORITIES as readonly string[]).includes(val)),
    {
      message: "Priority must be one of: 'low', 'medium', 'high', 'urgent'",
    }
  )
  .optional()
  .transform((val) => (val ?? "medium") as TaskPriority);

const taskDeadlineSchema = z.custom<unknown>().transform((val, ctx) => {
  const result = parseAndValidateIsoDate(val);
  if (!result.valid) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: result.message,
    });
    return undefined;
  }
  return result.utcIso;
});

/**
 * Schema for creating a new Task from untrusted input.
 */
export const createTaskSchema = z
  .object({
    id: z
      .custom<unknown>((val) => val === undefined || (typeof val === "string" && val.trim().length > 0), {
        message: "ID cannot be empty",
      })
      .optional()
      .transform((val) => (typeof val === "string" && val.trim().length > 0 ? val.trim() : crypto.randomUUID())),
    title: taskTitleSchema,
    durationMinutes: taskDurationSchema,
    priority: taskPrioritySchema,
    deadline: taskDeadlineSchema.optional(),
    createdAt: z
      .custom<unknown>()
      .optional()
      .transform((val, ctx) => {
        if (val === undefined || val === null || val === "") {
          return new Date().toISOString();
        }
        const result = parseAndValidateCreatedAt(val);
        if (!result.valid) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: result.message,
          });
          return "";
        }
        return result.utcIso;
      }),
  })
  .transform((data) => {
    const res: Task = {
      id: data.id ?? crypto.randomUUID(),
      title: data.title,
      durationMinutes: data.durationMinutes,
      priority: data.priority,
      createdAt: data.createdAt ?? new Date().toISOString(),
    };
    if (data.deadline !== undefined) {
      res.deadline = data.deadline;
    }
    return res;
  });

/**
 * Schema for validating an existing Task record.
 */
export const existingTaskSchema = z
  .object({
    id: z
      .custom<string>(
        (val) => typeof val === "string" && val.trim().length > 0,
        { message: "ID cannot be empty" }
      )
      .transform((val) => val.trim()),
    title: taskTitleSchema,
    durationMinutes: taskDurationSchema,
    priority: taskPrioritySchema,
    deadline: taskDeadlineSchema.optional(),
    createdAt: z.custom<string>().transform((val, ctx) => {
      const result = parseAndValidateCreatedAt(val);
      if (!result.valid) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: result.message,
        });
        return "";
      }
      return result.utcIso;
    }),
  })
  .transform((data) => {
    const res: Task = {
      id: data.id,
      title: data.title,
      durationMinutes: data.durationMinutes,
      priority: data.priority,
      createdAt: data.createdAt,
    };
    if (data.deadline !== undefined) {
      res.deadline = data.deadline;
    }
    return res;
  });

/**
 * Helper to map Zod error issues to simple, field-level actionable errors.
 */
function formatZodErrors(issues: z.ZodIssue[]): ValidationError[] {
  return issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join(".") : "root",
    message: issue.message,
  }));
}

/**
 * Validates untrusted task input for creation or intake.
 */
export function validateTask(input: unknown): ValidationResult<Task> {
  const result = createTaskSchema.safeParse(input);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, errors: formatZodErrors(result.error.issues) };
}

/**
 * Validates an existing task record.
 */
export function validateExistingTask(input: unknown): ValidationResult<Task> {
  const result = existingTaskSchema.safeParse(input);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, errors: formatZodErrors(result.error.issues) };
}

