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
} from './queue.interface';

@Injectable()
export class QueueService
  implements OnApplicationShutdown, OnModuleInit, ProcessorManagement
{
  private readonly logger: Logger;
  private queues = new Map<string, Task<any>[]>();
  private currentTasks = new Map<string, Task<any>[]>(); // 큐 이름당 실행 중인 작업 배열
  private delayedTasks = new Map<string, Task<any>>(); // 지연된 작업들
  private readonly concurrency: number;
  private activeTasks = new Map<string, number>();
  private readonly gracefulShutdownTimeout: number;
  private readonly enablePersistence: boolean;
  private readonly persistencePath: string;
  private isShuttingDown = false;
  private processors = new Map<string, (payload: any) => Promise<void>>(); // Job 프로세서 맵

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

    // Job 프로세서 등록
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
    options?: {
      retries?: number;
      priority?: TaskPriority;
      delay?: number; // 지연 시간 (ms)
    }
  ): Promise<string> {
    // taskId를 반환하도록 변경
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

    const retries = options?.retries || 0;
    const priority = options?.priority || TaskPriority.NORMAL;
    const delay = options?.delay || 0;

    const taskId = this.generateTaskId();
    const createdAt = new Date();
    const scheduledAt =
      delay > 0 ? new Date(createdAt.getTime() + delay) : undefined;

    // Job 프로세서 확인
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
      priority,
      promise: taskPromise,
      createdAt,
      delay,
      scheduledAt,
    };

    if (delay > 0) {
      // 지연된 작업 처리 - 큐 이름을 taskData에 저장
      taskData.queueName = queueName;
      this.delayedTasks.set(taskId, taskData);
      this.eventEmitter.emit('queue.task.delayed', {
        queueName,
        task: taskData,
      });

      // 지연 시간 후에 큐에 추가
      setTimeout(() => {
        this.addDelayedTaskToQueue(queueName, taskData);
      }, delay);
    } else {
      // 즉시 큐에 추가
      queue.push(taskData);
      this.eventEmitter.emit('queue.task.added', { queueName, task: taskData });
      setImmediate(() => this.processQueue(queueName));
    }

    return taskId; // taskId 반환
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
        } catch (error) {
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
      } catch (error) {
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
      this.eventEmitter.emit('queue.task.processing', { queueName, task });

      // Find processor by jobName
      const processor = this.processors.get(task.jobName);
      if (!processor) {
        throw new Error(`Processor not found for job: ${task.jobName}`);
      }

      await processor(task.payload);
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
        this.queues.get(queueName)?.unshift(task); // Only unshift if queue exists
      } else {
        try {
          task.reject(error);
        } catch (rejectionError) {
          // Promise rejection 에러를 무시 (이미 처리된 Promise일 수 있음)
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

      return {
        ...serializedTask,
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
