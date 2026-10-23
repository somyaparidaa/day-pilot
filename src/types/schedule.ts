import type { Task, TaskPriority } from '@/types/task';

export interface PlanningWindow {
  startTime: string; // ISO 8601 string
  endTime: string;   // ISO 8601 string
}

export interface ScheduledBlock {
  taskId: string;
  taskTitle: string;
  startTime: string; // UTC ISO 8601 string
  endTime: string;   // UTC ISO 8601 string
  durationMinutes: number;
  priority: TaskPriority;
}

export type UnscheduledReason =
  | 'exceeds_window_capacity' // Candidate finish time extends past window.endTime
  | 'deadline_unreachable';   // Candidate finish time extends past task.deadline

export interface UnscheduledTask {
  taskId: string;
  taskTitle: string;
  durationMinutes: number;
  priority: TaskPriority;
  reason: UnscheduledReason;
}

export interface ScheduleMetrics {
  totalScheduledMinutes: number;   // Sum of scheduled block durations
  totalUnscheduledMinutes: number; // Sum of durations of unscheduled tasks
}

export interface ScheduleProposal {
  scheduledBlocks: ScheduledBlock[];
  unscheduledTasks: UnscheduledTask[];
  window: {
    startTime: string; // UTC ISO 8601 string
    endTime: string;   // UTC ISO 8601 string
  };
  metrics: ScheduleMetrics;
}

export class InvalidPlanningWindowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPlanningWindowError';
  }
}

