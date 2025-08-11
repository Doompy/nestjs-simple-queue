import { Injectable, Inject, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { QueueModuleOptions, Task } from './queue.interface';

@Injectable()
export class QueueService {
  private readonly logger: Logger;
  private queues = new Map<string, Task<any>[]>();
  private currentTasks = new Map<string, Task<any>>();
  private readonly concurrency: number;
  private activeTasks = new Map<string, number>();

  constructor(
    @Inject('QUEUE_OPTIONS') private options: QueueModuleOptions,
    private eventEmitter: EventEmitter2
  ) {
    this.logger = options.logger || new Logger(QueueService.name);
    this.concurrency = options.concurrency || 1;
  }

  async enqueue<T>(
    queueName: string,
    payload: T,
    taskFunction: (payload: T) => Promise<void>,
    options?: { retries?: number }
  ): Promise<void> {
    let queue = this.queues.get(queueName);
    if (!queue) {
      queue = [];
      this.queues.set(queueName, queue);
      this.activeTasks.set(queueName, 0);
    }

    const taskPromise = new Promise<void>((resolve, reject) => {
      const retries = options?.retries || 0;
      const taskData = { payload, taskFunction, resolve, reject, retries };
      queue.push(taskData);
      this.eventEmitter.emit('queue.task.added', { queueName, task: taskData });
    });

    this.processQueue(queueName);

    return taskPromise;
  }

  private processQueue(queueName: string): void {
    const queue = this.queues.get(queueName);
    const active = this.activeTasks.get(queueName) || 0;

    if (!queue) return;

    // 동시성 제한을 체크하면서 작업을 실행
    while (queue.length > 0 && active < this.concurrency) {
      const task = queue.shift();
      if (!task) continue;

      this.runTask(queueName, task);

      // activeTasks가 업데이트되었으므로 다시 체크
      const currentActive = this.activeTasks.get(queueName) || 0;
      if (currentActive >= this.concurrency) {
        break;
      }
    }
  }

  private async runTask(queueName: string, task: Task<any>): Promise<void> {
    this.activeTasks.set(queueName, (this.activeTasks.get(queueName) || 0) + 1);
    this.currentTasks.set(queueName, task);

    try {
      this.eventEmitter.emit('queue.task.processing', { queueName, task });
      await task.taskFunction(task.payload);
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
        this.queues.get(queueName)?.unshift(task); // 큐가 존재할 때만 unshift
      } else {
        task.reject(error);
      }
    } finally {
      this.activeTasks.set(
        queueName,
        (this.activeTasks.get(queueName) || 1) - 1
      );
      this.currentTasks.delete(queueName);

      this.processQueue(queueName);

      if (
        this.activeTasks.get(queueName) === 0 &&
        this.queues.get(queueName)?.length === 0
      ) {
        this.eventEmitter.emit('queue.empty', { queueName });
      }
    }
  }
}
