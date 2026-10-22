export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface Task {
  id: string;
  title: string;
  durationMinutes: number;
  priority: TaskPriority;
  deadline?: string;
  createdAt: string;
}

export interface TaskInput {
  id?: unknown;
  title?: unknown;
  durationMinutes?: unknown;
  priority?: unknown;
  deadline?: unknown;
  createdAt?: unknown;
}

export interface ValidationError {
  field: string;
  message: string;
}

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; errors: ValidationError[] };

