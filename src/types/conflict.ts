export type ConflictType =
  | 'overlap'
  | 'deadline_miss'
  | 'unscheduled_task'
  | 'outside_window';

export interface Conflict {
  id: string;
  type: ConflictType;
  taskIds: string[];
  severity: 'error' | 'warning';
  message: string;
  details?: Record<string, unknown>;
}

export interface ConflictSummary {
  totalConflicts: number;
  overlapCount: number;
  deadlineMissCount: number;
  unscheduledCount: number;
  outsideWindowCount: number;
}

export interface ConflictAnalysisResult {
  hasConflicts: boolean;
  conflicts: Conflict[];
  summary: ConflictSummary;
}

