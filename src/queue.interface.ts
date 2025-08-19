import { Logger } from '@nestjs/common';

/**
 * Options passed by library users through QueueModule.forRoot()
 */
export interface QueueModuleOptions {
  logger?: Logger;
  concurrency?: number;
  gracefulShutdownTimeout?: number; // Graceful shutdown wait time (ms)
  enablePersistence?: boolean; // Enable state persistence
  persistencePath?: string; // State persistence file path
  processors?: QueueProcessor[]; // Job processor registration
}

/**
 * Job processor interface
 */
export interface QueueProcessor {
  name: string;
  process: (payload: any) => Promise<void>;
}

/**
 * Task priority levels
 */
export enum TaskPriority {
  LOW = 1,
  NORMAL = 5,
  HIGH = 8,
  URGENT = 10,
}

/**
 * Interface for managing tasks within the queue
 */
export interface Task<T> {
  id: string; // Unique task ID
  payload: T;
  jobName: string; // Job name to execute
  resolve: () => void;
  reject: (reason?: any) => void;
  retries: number;
  priority: TaskPriority;
  promise: Promise<void>; // Promise for tracking task completion
  createdAt: Date; // Task creation time
  delay?: number; // Delay time (ms)
  scheduledAt?: Date; // Scheduled execution time
  queueName?: string; // Queue name (for delayed tasks)
}

/**
 * Queue status information
 */
export interface QueueStats {
  queueName: string;
  pendingTasks: number;
  activeTasks: number;
  totalTasks: number;
  delayedTasks: number; // Number of delayed tasks
}

/**
 * Delayed task information
 */
export interface DelayedTaskInfo {
  id: string;
  queueName: string;
  scheduledAt: Date;
  remainingDelay: number; // Remaining delay time (ms)
}
