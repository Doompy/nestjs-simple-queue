import {
  Injectable,
  Inject,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as fs from 'fs';
import * as path from 'path';
import {
  QueueModuleOptions,
  Task,
  TaskPriority,
  QueueStats,
  DelayedTaskInfo,
  ProcessorManagement,
  TaskStatus,
  EnqueueOptions,
  RateLimiterOptions,
} from './queue.interface';

@Injectable()
export class QueueService
  implements OnApplicationShutdown, OnModuleInit, ProcessorManagement
{
  private readonly logger: Logger;
  private queues = new Map<string, Task<any>[]>();
  private currentTasks = new Map<string, Task<any>[]>(); // Running tasks per queue
  private delayedTasks = new Map<string, Task<any>>(); // Delayed tasks
  private readonly concurrency: number;
  private activeTasks = new Map<string, number>();
  private readonly gracefulShutdownTimeout: number;
  private readonly enablePersistence: boolean;
  private readonly persistencePath: string;
  private readonly limiter?: RateLimiterOptions;
  private isShuttingDown = false;
  private processors = new Map<string, (payload: any) => Promise<void>>(); // Job processor map
  private rateLimitState = new Map<string, number[]>();
  private rateLimitTimers = new Map<string, NodeJS.Timeout>();

  private ensureQueueInitialized(queueName: string): void {
    if (!this.queues.has(queueName)) {
      this.queues.set(queueName, []);
    }

    if (!this.activeTasks.has(queueName)) {
      this.activeTasks.set(queueName, 0);
    }

    if (!this.currentTasks.has(queueName)) {
      this.currentTasks.set(queueName, []);
    }
  }

  constructor(
    @Inject('QUEUE_OPTIONS') private options: QueueModuleOptions,
    private eventEmitter: EventEmitter2
  ) {
    this.logger = options.logger || new Logger(QueueService.name);
    this.concurrency = options.concurrency || 1;
    this.gracefulShutdownTimeout = options.gracefulShutdownTimeout || 30000;
    this.enablePersistence = options.enablePersistence || false;
    this.persistencePath = options.persistencePath || './queue-state.json';
    this.limiter = options.limiter;

    // Register job processors
    if (options.processors) {
      for (const processor of options.processors) {
        this.processors.set(processor.name, processor.process);
      }
    }
  }

  async onModuleInit() {
    if (this.enablePersistence) {
      await this.loadPersistedState();
    }
  }

  async enqueue<T>(
    queueName: string,
    jobName: string,
    payload: T,
    options?: EnqueueOptions
  ): Promise<string> {
    // Return taskId to the caller
    if (this.isShuttingDown) {
      throw new Error(
        'Queue service is shutting down. Cannot enqueue new tasks.'
      );
    }

    let queue = this.queues.get(queueName);
    if (!queue) {
      queue = [];
      this.queues.set(queueName, queue);
      this.activeTasks.set(queueName, 0);
      this.currentTasks.set(queueName, []);
    }

    let taskResolve: () => void;
    let taskReject: (reason?: any) => void;

    const taskPromise = new Promise<void>((resolve, reject) => {
      taskResolve = resolve;
      taskReject = reject;
    });
    taskPromise.catch(() => {
      // Prevent unhandled rejection warnings; task failures are handled via events/logging.
    });

    const retries = options?.retries || 0;
    const priority = options?.priority || TaskPriority.NORMAL;
    const delay = options?.delay || 0;
    const backoff = options?.backoff;
    const timeoutMs = options?.timeoutMs;

    const taskId = this.generateTaskId();
    const createdAt = new Date();
    const scheduledAt =
      delay > 0 ? new Date(createdAt.getTime() + delay) : undefined;

    // Validate job processor
    const processor = this.processors.get(jobName);
    if (!processor) {
      throw new Error(
        `Job processor '${jobName}' not found. Please register it in QueueModule.forRoot()`
      );
    }

    const taskData: Task<T> = {
      id: taskId,
      payload,
      jobName,
      resolve: taskResolve!,
      reject: taskReject!,
      retries,
      maxRetries: retries,
      attemptsMade: 0,
      priority,
      backoff,
      timeoutMs,
      promise: taskPromise,
      createdAt,
      delay,
      scheduledAt,
    };

    if (delay > 0) {
      // Handle delayed task - persist queue name on task data
      taskData.queueName = queueName;
      this.delayedTasks.set(taskId, taskData);
      this.eventEmitter.emit('queue.task.delayed', {
        queueName,
        task: taskData,
      });

      // Add to queue after delay
      setTimeout(() => {
        this.addDelayedTaskToQueue(queueName, taskData);
      }, delay);
    } else {
      // Add to queue immediately
      queue.push(taskData);
      this.eventEmitter.emit('queue.task.added', { queueName, task: taskData });
      setImmediate(() => this.processQueue(queueName));
    }

    return taskId; // Return taskId
  }

  /**
   * Add delayed task to queue
   */
  private addDelayedTaskToQueue(queueName: string, task: Task<any>): void {
    const queue = this.queues.get(queueName);
    if (queue && this.delayedTasks.has(task.id)) {
      this.delayedTasks.delete(task.id);
      queue.push(task);
      this.eventEmitter.emit('queue.task.added', { queueName, task });
      this.processQueue(queueName);
    }
  }

  /**
   * Cancel a task
   */
  cancelTask(queueName: string, taskId: string): boolean {
    // Cancel pending task in queue
    const queue = this.queues.get(queueName);
    if (queue) {
      const taskIndex = queue.findIndex((task) => task.id === taskId);
      if (taskIndex !== -1) {
        const task = queue.splice(taskIndex, 1)[0];
        try {
          task.reject(new Error('Task cancelled'));
        } catch {
          // Ignore Promise reject errors (Promise might already be handled)
        }
        this.eventEmitter.emit('queue.task.cancelled', { queueName, task });
        return true;
      }
    }

    // Cancel delayed task
    const delayedTask = this.delayedTasks.get(taskId);
    if (delayedTask && delayedTask.scheduledAt) {
      this.delayedTasks.delete(taskId);
      try {
        delayedTask.reject(new Error('Task cancelled'));
      } catch {
        // Ignore Promise reject errors (Promise might already be handled)
      }
      this.eventEmitter.emit('queue.task.cancelled', {
        queueName: delayedTask.queueName || queueName,
        task: delayedTask,
      });
      return true;
    }

    return false;
  }

  /**
   * Get list of delayed tasks
   */
  getDelayedTasks(): DelayedTaskInfo[] {
    const delayedTasks: DelayedTaskInfo[] = [];

    for (const [taskId, task] of this.delayedTasks) {
      if (task.scheduledAt) {
        const remainingDelay = Math.max(
          0,
          task.scheduledAt.getTime() - Date.now()
        );
        delayedTasks.push({
          id: taskId,
          queueName: task.queueName || 'unknown', // Use correct queueName
          scheduledAt: task.scheduledAt,
          remainingDelay,
        });
      }
    }

    return delayedTasks;
  }

  /**
   * Optimized queue processing logic
   * Process only one task at a time for better performance
   */
  private processQueue(queueName: string): void {
    if (this.isShuttingDown) return;

    const queue = this.queues.get(queueName);
    const active = this.activeTasks.get(queueName) || 0;

    // Check concurrency limit and if queue has tasks
    if (!queue || queue.length === 0 || active >= this.concurrency) {
      return;
    }

    const rateLimitDelay = this.getRateLimitDelay(queueName, queue[0]);
    if (rateLimitDelay > 0) {
      this.scheduleRateLimitRetry(queueName, rateLimitDelay);
      return;
    }

    // Sort once before executing task
    this.sortQueueByPriority(queue);
    const task = queue.shift();

    if (task) {
      this.runTask(queueName, task);
    }
  }

  /**
   * Sort queue by priority
   * Higher priority (10) executes before lower priority (1)
   */
  private sortQueueByPriority(queue: Task<any>[]): void {
    queue.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Improved task execution logic
   * Manage currentTasks array for concurrency handling
   */
  private async runTask(queueName: string, task: Task<any>): Promise<void> {
    this.activeTasks.set(queueName, (this.activeTasks.get(queueName) || 0) + 1);

    // Add to current running tasks array
    const runningTasks = this.currentTasks.get(queueName) || [];
    runningTasks.push(task);
    this.currentTasks.set(queueName, runningTasks);

    try {
      task.attemptsMade = (task.attemptsMade || 0) + 1;
      this.eventEmitter.emit('queue.task.processing', { queueName, task });

      // Find processor by jobName
      const processor = this.processors.get(task.jobName);
      if (!processor) {
        throw new Error(`Processor not found for job: ${task.jobName}`);
      }

      await this.executeWithTimeout(task, processor);
      task.resolve();
      this.eventEmitter.emit('queue.task.success', { queueName, task });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'An unknown error occurred';
      this.logger.error(
        `Error processing task in [${queueName}]. Retries left: ${task.retries}`,
        errorMessage
      );
      this.eventEmitter.emit('queue.task.failed', { queueName, task, error });

      if (task.retries > 0) {
        task.retries--;
        const backoffDelay = this.calculateBackoffDelay(task);
        if (backoffDelay && backoffDelay > 0) {
          task.delay = backoffDelay;
          task.scheduledAt = new Date(Date.now() + backoffDelay);
          task.queueName = queueName;
          this.delayedTasks.set(task.id, task);
          this.eventEmitter.emit('queue.task.delayed', { queueName, task });
          setTimeout(() => {
            this.addDelayedTaskToQueue(queueName, task);
          }, backoffDelay);
        } else {
          this.queues.get(queueName)?.unshift(task); // Only unshift if queue exists
        }
      } else {
        try {
          task.reject(error);
        } catch {
          // Ignore promise rejection errors (may already be handled)
        }
      }
    } finally {
      this.activeTasks.set(
        queueName,
        (this.activeTasks.get(queueName) || 1) - 1
      );

      // Remove only the specific task by ID
      const finalTasks = (this.currentTasks.get(queueName) || []).filter(
        (t) => t.id !== task.id
      );
      this.currentTasks.set(queueName, finalTasks);

      // Process next task
      this.processQueue(queueName);

      if (
        this.activeTasks.get(queueName) === 0 &&
        this.queues.get(queueName)?.length === 0
      ) {
        this.eventEmitter.emit('queue.empty', { queueName });
      }
    }
  }

  /**
   * Calculate rate limit delay for a queue
   */
  private getRateLimitDelay(queueName: string, task?: Task<any>): number {
    if (!this.limiter) return 0;

    const { max, duration } = this.limiter;
    if (max <= 0 || duration <= 0) return 0;

    const now = Date.now();
    const windowStart = now - duration;
    const key = this.getRateLimitKey(queueName, task);
    const timestamps = this.rateLimitState.get(key) || [];
    const recent = timestamps.filter((timestamp) => timestamp > windowStart);
    this.rateLimitState.set(key, recent);

    if (recent.length < max) {
      recent.push(now);
      return 0;
    }

    const earliest = Math.min(...recent);
    return Math.max(1, earliest + duration - now);
  }

  /**
   * Build a rate limit key for the queue, optionally scoped by groupKey
   */
  private getRateLimitKey(queueName: string, task?: Task<any>): string {
    if (!this.limiter?.groupKey || !task) return queueName;

    const groupKey = this.limiter.groupKey;
    const value = this.getNestedValue(task.payload, groupKey);
    if (value === undefined || value === null || value === '') {
      return queueName;
    }
    return `${queueName}:${String(value)}`;
  }

  /**
   * Read nested values from payload using dot-notation keys
   */
  private getNestedValue(payload: any, pathKey: string): any {
    if (!payload || typeof payload !== 'object') return undefined;

    return pathKey.split('.').reduce((acc: any, part) => {
      if (acc === undefined || acc === null) return undefined;
      return acc[part];
    }, payload);
  }

  /**
   * Schedule a queue processing retry when rate limited
   */
  private scheduleRateLimitRetry(queueName: string, delayMs: number): void {
    if (this.rateLimitTimers.has(queueName)) return;

    const timer = setTimeout(() => {
      this.rateLimitTimers.delete(queueName);
      this.processQueue(queueName);
    }, delayMs);
    this.rateLimitTimers.set(queueName, timer);
  }

  /**
   * Execute task with optional timeout
   */
  private async executeWithTimeout(
    task: Task<any>,
    processor: (payload: any) => Promise<void>
  ): Promise<void> {
    if (!task.timeoutMs || task.timeoutMs <= 0) {
      await processor(task.payload);
      return;
    }

    let timeoutId: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<void>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`Task timed out after ${task.timeoutMs}ms`));
      }, task.timeoutMs);
    });

    try {
      await Promise.race([processor(task.payload), timeoutPromise]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  /**
   * Calculate backoff delay for a retry
   */
  private calculateBackoffDelay(task: Task<any>): number | null {
    const backoff = task.backoff;
    if (!backoff || !backoff.delay || backoff.delay <= 0) {
      return null;
    }

    const attempt = Math.max(1, task.attemptsMade || 1);
    const baseDelay =
      backoff.type === 'exponential'
        ? backoff.delay * Math.pow(2, attempt - 1)
        : backoff.delay;

    if (backoff.maxDelay && backoff.maxDelay > 0) {
      return Math.min(baseDelay, backoff.maxDelay);
    }

    return baseDelay;
  }

  /**
   * Generate unique task ID
   */
  private generateTaskId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get queue status information
   */
  getQueueStats(queueName: string): QueueStats | null {
    const queue = this.queues.get(queueName);
    const active = this.activeTasks.get(queueName) || 0;
    const delayedCount = Array.from(this.delayedTasks.values()).filter(
      (task) => task.queueName === queueName
    ).length;

    if (!queue) return null;

    return {
      queueName,
      pendingTasks: queue.length,
      activeTasks: active,
      totalTasks: queue.length + active,
      delayedTasks: delayedCount,
    };
  }

  /**
   * Get status information for all queues
   */
  getAllQueueStats(): QueueStats[] {
    const stats: QueueStats[] = [];

    for (const [queueName] of this.queues) {
      const stat = this.getQueueStats(queueName);
      if (stat) stats.push(stat);
    }

    return stats;
  }

  /**
   * Register a processor at runtime
   * @param name - Job processor name
   * @param processor - Processor function
   * @returns true if registered successfully, false if already exists
   */
  registerProcessor(
    name: string,
    processor: (payload: any) => Promise<void>
  ): boolean {
    if (this.processors.has(name)) {
      this.logger.warn(
        `Processor '${name}' already exists. Use updateProcessor() to override.`
      );
      return false;
    }

    this.processors.set(name, processor);
    this.logger.log(`Processor '${name}' registered successfully.`);
    return true;
  }

  /**
   * Update an existing processor or register a new one
   * @param name - Job processor name
   * @param processor - Processor function
   * @returns true if updated/registered successfully
   */
  updateProcessor(
    name: string,
    processor: (payload: any) => Promise<void>
  ): boolean {
    const existed = this.processors.has(name);
    this.processors.set(name, processor);

    if (existed) {
      this.logger.log(`Processor '${name}' updated successfully.`);
    } else {
      this.logger.log(`Processor '${name}' registered successfully.`);
    }

    return true;
  }

  /**
   * Remove a processor
   * @param name - Job processor name
   * @returns true if removed successfully, false if not found
   */
  unregisterProcessor(name: string): boolean {
    const removed = this.processors.delete(name);
    if (removed) {
      this.logger.log(`Processor '${name}' unregistered successfully.`);
    } else {
      this.logger.warn(`Processor '${name}' not found.`);
    }
    return removed;
  }

  /**
   * Check if a processor is registered
   * @param name - Job processor name
   * @returns true if processor exists
   */
  hasProcessor(name: string): boolean {
    return this.processors.has(name);
  }

  /**
   * Get all registered processor names
   * @returns Array of processor names
   */
  getRegisteredProcessors(): string[] {
    return Array.from(this.processors.keys());
  }

  /**
   * Get processor information
   * @param name - Job processor name
   * @returns Processor info or null if not found
   */
  getProcessorInfo(name: string): { name: string; registered: boolean } | null {
    return this.processors.has(name) ? { name, registered: true } : null;
  }

  /**
   * Clear all queues
   * @returns Number of cleared tasks
   */
  clearAllQueues(): number {
    let totalCleared = 0;

    for (const [queueName, queue] of this.queues) {
      totalCleared += queue.length;
      queue.length = 0;
      this.activeTasks.set(queueName, 0);
      this.currentTasks.set(queueName, []);
    }

    // Clear delayed tasks
    const delayedCount = this.delayedTasks.size;
    this.delayedTasks.clear();
    this.rateLimitState.clear();
    for (const timer of this.rateLimitTimers.values()) {
      clearTimeout(timer);
    }
    this.rateLimitTimers.clear();

    this.logger.log(
      `Cleared all queues. Removed ${totalCleared + delayedCount} tasks`
    );
    return totalCleared + delayedCount;
  }

  /**
   * Clear specific queue
   * @param queueName - Name of queue to clear
   * @returns Number of cleared tasks
   */
  clearQueue(queueName: string): number {
    const queue = this.queues.get(queueName);
    if (!queue) {
      return 0;
    }

    const clearedCount = queue.length;
    queue.length = 0;
    this.activeTasks.set(queueName, 0);
    this.currentTasks.set(queueName, []);

    // Clear delayed tasks for this queue
    let delayedCount = 0;
    for (const [taskId, task] of this.delayedTasks) {
      if (task.queueName === queueName) {
        this.delayedTasks.delete(taskId);
        delayedCount++;
      }
    }
    for (const key of this.rateLimitState.keys()) {
      if (key === queueName || key.startsWith(`${queueName}:`)) {
        this.rateLimitState.delete(key);
      }
    }
    const timer = this.rateLimitTimers.get(queueName);
    if (timer) {
      clearTimeout(timer);
      this.rateLimitTimers.delete(queueName);
    }

    this.logger.log(
      `Cleared queue '${queueName}'. Removed ${clearedCount + delayedCount} tasks`
    );
    return clearedCount + delayedCount;
  }

  /**
   * Get task by ID
   * @param taskId - Task ID to find
   * @returns Task if found, null otherwise
   */
  getTaskById(taskId: string): Task<any> | null {
    // Check in active queues
    for (const [, queue] of this.queues) {
      const task = queue.find((t) => t.id === taskId);
      if (task) {
        return task;
      }
    }

    // Check in delayed tasks
    const delayedTask = this.delayedTasks.get(taskId);
    if (delayedTask) {
      return delayedTask;
    }

    // Check in current running tasks
    for (const [, tasks] of this.currentTasks) {
      const task = tasks.find((t) => t.id === taskId);
      if (task) {
        return task;
      }
    }

    return null;
  }

  /**
   * Get task status
   * @param taskId - Task ID
   * @returns Task status information with taskId
   */
  getTaskStatus(taskId: string): TaskStatus & { taskId: string } {
    const task = this.getTaskById(taskId);

    if (!task) {
      return { status: 'not_found', taskId };
    }

    // Check if it's a delayed task
    if (this.delayedTasks.has(taskId)) {
      const delayedTask = this.delayedTasks.get(taskId)!;
      return {
        status: 'delayed',
        taskId,
        queueName: delayedTask.queueName || 'default',
        jobName: delayedTask.jobName,
        priority: delayedTask.priority,
        createdAt: delayedTask.createdAt,
        scheduledAt: delayedTask.scheduledAt!,
        delay: delayedTask.scheduledAt
          ? Math.max(0, delayedTask.scheduledAt.getTime() - Date.now())
          : 0,
      };
    }

    // Check if it's currently processing
    for (const [queueName, tasks] of this.currentTasks) {
      const processingTask = tasks.find((t) => t.id === taskId);
      if (processingTask) {
        return {
          status: 'processing',
          taskId,
          queueName,
          jobName: processingTask.jobName,
          priority: processingTask.priority,
          createdAt: processingTask.createdAt,
          retries: processingTask.retries,
          startedAt: processingTask.createdAt, // For now, using createdAt as startedAt
        };
      }
    }

    // Check if it's pending in a queue
    for (const [queueName, queue] of this.queues) {
      const pendingTask = queue.find((t) => t.id === taskId);
      if (pendingTask) {
        return {
          status: 'pending',
          taskId,
          queueName,
          jobName: pendingTask.jobName,
          priority: pendingTask.priority,
          createdAt: pendingTask.createdAt,
          retries: pendingTask.retries,
        };
      }
    }

    // If not found in any active state, it might be completed/failed/cancelled
    return {
      status: 'not_found',
      taskId,
    };
  }

  /**
   * Get tasks by queue
   * @param queueName - Queue name
   * @returns Array of tasks in the queue
   */
  getTasksByQueue(queueName: string): Task<any>[] {
    const queue = this.queues.get(queueName);
    return queue ? [...queue] : [];
  }

  /**
   * Get active tasks by queue
   * @param queueName - Queue name
   * @returns Array of currently processing tasks
   */
  getActiveTasksByQueue(queueName: string): Task<any>[] {
    const tasks = this.currentTasks.get(queueName);
    return tasks ? [...tasks] : [];
  }

  /**
   * State persistence - Save state
   */
  private async savePersistedState(): Promise<void> {
    if (!this.enablePersistence) return;

    try {
      // Store only serializable data, excluding functions
      const serializableQueues = Array.from(this.queues.entries()).map(
        ([queueName, tasks]) => [
          queueName,
          tasks.map((task) => this.serializeTask(task)),
        ]
      );

      const serializableDelayedTasks = Array.from(
        this.delayedTasks.entries()
      ).map(([taskId, task]) => [taskId, this.serializeTask(task)]);

      const state = {
        queues: serializableQueues,
        delayedTasks: serializableDelayedTasks,
        timestamp: new Date().toISOString(),
      };

      const dir = path.dirname(this.persistencePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(this.persistencePath, JSON.stringify(state, null, 2));
      this.logger.log(`Queue state saved to ${this.persistencePath}`);
    } catch (error) {
      this.logger.error('Failed to save queue state:', error);
    }
  }

  /**
   * Convert Task object to serializable format
   */
  private serializeTask(task: Task<any>): any {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { resolve, reject, promise, ...serializableTask } = task;
    return serializableTask;
  }

  /**
   * Restore serialized Task to executable Task
   */
  private async deserializeTask(
    serializedTask: any
  ): Promise<Task<any> | null> {
    try {
      const { jobName } = serializedTask;

      // Check Job processor
      const processor = this.processors.get(jobName);
      if (!processor) {
        this.logger.warn(
          `Job processor '${jobName}' not found during deserialization. Skipping task.`
        );
        return null;
      }

      // Recreate Promise and resolve/reject functions
      let taskResolve: () => void;
      let taskReject: (reason?: any) => void;

      const taskPromise = new Promise<void>((resolve, reject) => {
        taskResolve = resolve;
        taskReject = reject;
      });
      taskPromise.catch(() => {
        // Prevent unhandled rejection warnings; task failures are handled via events/logging.
      });

      return {
        ...serializedTask,
        retries:
          typeof serializedTask.retries === 'number'
            ? serializedTask.retries
            : 0,
        maxRetries:
          typeof serializedTask.maxRetries === 'number'
            ? serializedTask.maxRetries
            : typeof serializedTask.retries === 'number'
              ? serializedTask.retries
              : 0,
        attemptsMade:
          typeof serializedTask.attemptsMade === 'number'
            ? serializedTask.attemptsMade
            : 0,
        resolve: taskResolve!,
        reject: taskReject!,
        promise: taskPromise,
        createdAt: new Date(serializedTask.createdAt),
        scheduledAt: serializedTask.scheduledAt
          ? new Date(serializedTask.scheduledAt)
          : undefined,
      };
    } catch (error) {
      this.logger.error('Failed to deserialize task:', error);
      return null;
    }
  }

  /**
   * State persistence - Restore state
   */
  private async loadPersistedState(): Promise<void> {
    if (!this.enablePersistence || !fs.existsSync(this.persistencePath)) {
      return;
    }

    try {
      const stateData = fs.readFileSync(this.persistencePath, 'utf8');
      const state = JSON.parse(stateData);

      // Restore queue state (don't restore running tasks)
      if (state.queues) {
        for (const [queueName, serializedTasks] of state.queues) {
          const queue: Task<any>[] = [];

          if (Array.isArray(serializedTasks)) {
            for (const serializedTask of serializedTasks) {
              const task = await this.deserializeTask(serializedTask);
              if (task) {
                task.queueName = queueName;
                queue.push(task);
              }
            }

            // Ensure restored tasks respect priority ordering
            this.sortQueueByPriority(queue);
          }

          this.queues.set(queueName, queue);
          this.activeTasks.set(queueName, 0);
          this.currentTasks.set(queueName, []);

          if (queue.length > 0) {
            setImmediate(() => this.processQueue(queueName));
          }
        }
      }

      // Restore delayed tasks and reset timers
      if (state.delayedTasks) {
        for (const [taskId, taskData] of state.delayedTasks) {
          if (!taskData.scheduledAt) {
            continue;
          }

          const deserializedTask = await this.deserializeTask(taskData);
          if (!deserializedTask) {
            continue;
          }

          const queueName = taskData.queueName || 'default';
          deserializedTask.queueName = queueName;

          this.ensureQueueInitialized(queueName);

          const scheduledTime = new Date(taskData.scheduledAt);
          const now = new Date();
          const remainingDelay = scheduledTime.getTime() - now.getTime();

          if (remainingDelay > 0) {
            // Restore delayed task that hasn't reached execution time yet
            this.delayedTasks.set(taskId, {
              ...deserializedTask,
              scheduledAt: scheduledTime,
            });

            // Reset timer
            setTimeout(() => {
              this.addDelayedTaskToQueue(queueName, deserializedTask);
            }, remainingDelay);

            this.logger.log(
              `Restored delayed task ${taskId} with ${remainingDelay}ms remaining`
            );
          } else {
            // Add overdue delayed task to queue immediately
            const queue = this.queues.get(queueName) || [];
            queue.push(deserializedTask);
            this.sortQueueByPriority(queue);
            this.queues.set(queueName, queue);

            this.logger.log(
              `Restored overdue delayed task ${taskId} to queue immediately`
            );
            this.processQueue(queueName);
          }
        }
      }

      this.logger.log(`Queue state loaded from ${this.persistencePath}`);
    } catch (error) {
      this.logger.error('Failed to load queue state:', error);
    }
  }

  /**
   * Graceful Shutdown implementation
   * Wait for running tasks to complete when application shuts down
   */
  async onApplicationShutdown(signal?: string): Promise<void> {
    this.logger.log(
      `Application is shutting down (signal: ${signal}). Waiting for active tasks to complete...`
    );

    this.isShuttingDown = true;

    // Save state
    if (this.enablePersistence) {
      await this.savePersistedState();
    }

    // Collect all running tasks from all queues
    const activePromises: Promise<void>[] = [];

    for (const [, tasks] of this.currentTasks) {
      for (const task of tasks) {
        activePromises.push(task.promise);
      }
    }

    if (activePromises.length > 0) {
      this.logger.log(
        `Waiting for ${activePromises.length} active tasks to complete...`
      );

      try {
        // Wait for all tasks to complete with timeout
        await Promise.race([
          Promise.allSettled(activePromises),
          new Promise((resolve) =>
            setTimeout(resolve, this.gracefulShutdownTimeout)
          ),
        ]);

        this.logger.log('All active tasks have been completed or timed out.');
      } catch (error) {
        this.logger.error('Error during graceful shutdown:', error);
      }
    } else {
      this.logger.log('No active tasks found.');
    }

    this.logger.log('Queue service shutdown completed.');
  }
}
