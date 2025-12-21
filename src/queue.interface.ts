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
  limiter?: RateLimiterOptions; // Rate limiting configuration
  deadLetter?: DeadLetterOptions; // Dead letter queue configuration
}

/**
 * Rate limiter configuration
 */
export interface RateLimiterOptions {
  max: number; // Max tasks allowed within duration
  duration: number; // Window size in ms
  groupKey?: string; // Optional payload key for group-based limiting
}

/**
 * Dead letter queue configuration
 */
export interface DeadLetterOptions {
  queueName: string; // DLQ queue name
  jobName?: string; // Optional DLQ job name override
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
 * Backoff strategy types
 */
export type BackoffType = 'fixed' | 'exponential';

/**
 * Backoff configuration
 */
export interface BackoffOptions {
  type?: BackoffType;
  delay: number; // Base delay in ms
  maxDelay?: number; // Optional max delay cap in ms
}

/**
 * Interface for managing tasks within the queue
 */
export interface Task<T> {
  id: string; // Unique task ID
  payload: T;
  jobName: string; // Job name to execute
  jobId?: string; // Optional dedupe key
  resolve: () => void;
  reject: (reason?: any) => void;
  retries: number;
  maxRetries: number;
  attemptsMade: number;
  priority: TaskPriority;
  backoff?: BackoffOptions;
  timeoutMs?: number;
  promise: Promise<void>; // Promise for tracking task completion
  createdAt: Date; // Task creation time
  delay?: number; // Delay time (ms)
  scheduledAt?: Date; // Scheduled execution time
  queueName?: string; // Queue name (for delayed tasks)
  deadLettered?: boolean; // Task moved to dead letter queue
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

/**
 * Processor management interface
 */
export interface ProcessorManagement {
  registerProcessor(
    name: string,
    processor: (payload: any) => Promise<void>
  ): boolean;
  updateProcessor(
    name: string,
    processor: (payload: any) => Promise<void>
  ): boolean;
  unregisterProcessor(name: string): boolean;
  hasProcessor(name: string): boolean;
  getRegisteredProcessors(): string[];
  getProcessorInfo(name: string): ProcessorInfo | null;
  clearAllQueues(): number;
  clearQueue(queueName: string): number;
  getTaskById(taskId: string): Task<any> | null;
  getTaskStatus(taskId: string): TaskStatus & { taskId: string };
  getTasksByQueue(queueName: string): Task<any>[];
  getActiveTasksByQueue(queueName: string): Task<any>[];
  cancelByJobId(queueName: string, jobId: string): boolean;
}

/**
 * Enqueue options interface
 */
export interface EnqueueOptions {
  retries?: number;
  priority?: TaskPriority;
  delay?: number;
  backoff?: BackoffOptions;
  timeoutMs?: number;
  jobId?: string;
  dedupe?: 'drop' | 'replace';
}

/**
 * Event payload interfaces
 */
export interface QueueTaskEvent {
  queueName: string;
  task: Task<any>;
}

export interface QueueTaskFailedEvent extends QueueTaskEvent {
  error: Error;
}

/**
 * Processor info interface
 */
export interface ProcessorInfo {
  name: string;
  registered: boolean;
}

/**
 * Task status types
 */
export type TaskStatusType =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'delayed'
  | 'not_found';

/**
 * Base task status information
 */
export interface BaseTaskStatus {
  status: TaskStatusType;
  queueName?: string;
  jobName?: string;
  priority?: TaskPriority;
  createdAt?: Date;
  retries?: number;
}

/**
 * Pending task status
 */
export interface PendingTaskStatus extends BaseTaskStatus {
  status: 'pending';
  queueName: string;
  jobName: string;
  priority: TaskPriority;
  createdAt: Date;
  retries: number;
}

/**
 * Processing task status
 */
export interface ProcessingTaskStatus extends BaseTaskStatus {
  status: 'processing';
  queueName: string;
  jobName: string;
  priority: TaskPriority;
  createdAt: Date;
  retries: number;
  startedAt: Date;
}

/**
 * Completed task status
 */
export interface CompletedTaskStatus extends BaseTaskStatus {
  status: 'completed';
  queueName: string;
  jobName: string;
  priority: TaskPriority;
  createdAt: Date;
  completedAt: Date;
  result?: any;
}

/**
 * Failed task status
 */
export interface FailedTaskStatus extends BaseTaskStatus {
  status: 'failed';
  queueName: string;
  jobName: string;
  priority: TaskPriority;
  createdAt: Date;
  failedAt: Date;
  error: string;
  retries: number;
}

/**
 * Cancelled task status
 */
export interface CancelledTaskStatus extends BaseTaskStatus {
  status: 'cancelled';
  queueName: string;
  jobName: string;
  priority: TaskPriority;
  createdAt: Date;
  cancelledAt: Date;
}

/**
 * Delayed task status
 */
export interface DelayedTaskStatus extends BaseTaskStatus {
  status: 'delayed';
  queueName: string;
  jobName: string;
  priority: TaskPriority;
  createdAt: Date;
  scheduledAt: Date;
  delay: number;
}

/**
 * Not found task status
 */
export interface NotFoundTaskStatus {
  status: 'not_found';
}

/**
 * Task status information (union type)
 */
export type TaskStatus =
  | PendingTaskStatus
  | ProcessingTaskStatus
  | CompletedTaskStatus
  | FailedTaskStatus
  | CancelledTaskStatus
  | DelayedTaskStatus
  | NotFoundTaskStatus;
