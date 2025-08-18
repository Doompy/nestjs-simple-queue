import { Injectable, Inject, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { QueueModuleOptions, Task, TaskPriority } from './queue.interface';

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
    options?: { retries?: number; priority?: TaskPriority }
  ): Promise<void> {
    let queue = this.queues.get(queueName);
    if (!queue) {
      queue = [];
      this.queues.set(queueName, queue);
      this.activeTasks.set(queueName, 0);
    }

    const taskPromise = new Promise<void>((resolve, reject) => {
      const retries = options?.retries || 0;
      const priority = options?.priority || TaskPriority.NORMAL;
      const taskData = {
        payload,
        taskFunction,
        resolve,
        reject,
        retries,
        priority,
      };
      queue.push(taskData);
      this.eventEmitter.emit('queue.task.added', { queueName, task: taskData });
    });

    // 다음 tick에서 큐 처리 (모든 작업이 추가된 후 우선순위 정렬 적용)
    setImmediate(() => this.processQueue(queueName));

    return taskPromise;
  }

  private processQueue(queueName: string): void {
    const queue = this.queues.get(queueName);
    const active = this.activeTasks.get(queueName) || 0;

    if (!queue) return;

    // 동시성 제한을 체크하면서 작업을 실행
    while (queue.length > 0 && active < this.concurrency) {
      // 매번 우선순위로 정렬 (큐 상태가 변경될 수 있으므로)
      this.sortQueueByPriority(queue);

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

  /**
   * 큐를 우선순위에 따라 정렬
   * 높은 우선순위(10)가 낮은 우선순위(1)보다 먼저 실행됨
   */
  private sortQueueByPriority(queue: Task<any>[]): void {
    queue.sort((a, b) => b.priority - a.priority);
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
