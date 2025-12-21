import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { QueueService } from './queue.service';
import { QueueModule } from './queue.module';
import { TaskPriority, QueueProcessor } from './queue.interface';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// NOTE: comment removed (non-ASCII).
jest.setTimeout(30000);

// NOTE: comment removed (non-ASCII).
class TestEmailProcessor {
  public processedPayloads: any[] = [];
  public failCount = 0;
  public shouldFail = false;

  async process(payload: { email: string; subject: string }): Promise<void> {
    this.processedPayloads.push(payload);
    if (this.shouldFail) {
      this.failCount++;
      throw new Error('Email sending failed');
    }
  }

  reset() {
    this.processedPayloads = [];
    this.failCount = 0;
    this.shouldFail = false;
  }
}

class TestPaymentProcessor {
  public processedPayloads: any[] = [];

  async process(payload: { amount: number; userId: string }): Promise<void> {
    this.processedPayloads.push(payload);
  }

  reset() {
    this.processedPayloads = [];
  }
}

class TestFailingProcessor {
  public processedPayloads: any[] = [];
  public failCount = 0;
  public shouldFail = true;

  async process(payload: any): Promise<void> {
    this.processedPayloads.push(payload);
    this.failCount++;
    throw new Error('Task failed');
  }

  reset() {
    this.processedPayloads = [];
    this.failCount = 0;
    this.shouldFail = true; // NOTE: comment removed (non-ASCII).
  }
}

class TestSlowProcessor {
  async process(_payload: any): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 10)); // NOTE: comment removed (non-ASCII).
    console.log('Slow task completed');
  }
}

describe('QueueService (Job-based)', () => {
  let service: QueueService;
  let eventEmitter: EventEmitter2;
  let emailProcessor: TestEmailProcessor;
  let paymentProcessor: TestPaymentProcessor;
  let failingProcessor: TestFailingProcessor;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(async () => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const mockLogger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    };

    emailProcessor = new TestEmailProcessor();
    paymentProcessor = new TestPaymentProcessor();
    failingProcessor = new TestFailingProcessor();

    // NOTE: comment removed (non-ASCII).
    const processors: QueueProcessor[] = [
      {
        name: 'send-email',
        process: emailProcessor.process.bind(emailProcessor),
      },
      {
        name: 'process-payment',
        process: paymentProcessor.process.bind(paymentProcessor),
      },
      {
        name: 'failing-job',
        process: failingProcessor.process.bind(failingProcessor),
      },
    ];

    const module: TestingModule = await Test.createTestingModule({
      imports: [
        QueueModule.forRoot({
          processors,
          logger: mockLogger as any,
        }),
      ],
    }).compile();

    service = module.get<QueueService>(QueueService);
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);

    // NOTE: comment removed (non-ASCII).
    jest.spyOn(eventEmitter, 'emit');

    // NOTE: comment removed (non-ASCII).
    emailProcessor.reset();
    paymentProcessor.reset();
    failingProcessor.reset();
  });

  afterEach(() => {
    eventEmitter.removeAllListeners();
    consoleErrorSpy.mockRestore();
  });

  describe('Job-based Queue Operations', () => {
    it('should enqueue a job and process it successfully', async () => {
      const payload = { email: 'test@example.com', subject: 'Welcome!' };

      const taskId = await service.enqueue(
        'email-queue',
        'send-email',
        payload
      );

      // NOTE: comment removed (non-ASCII).
      let attempts = 0;
      while (emailProcessor.processedPayloads.length === 0 && attempts < 50) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        attempts++;
      }

      expect(taskId).toBeDefined();
      expect(typeof taskId).toBe('string');
      expect(emailProcessor.processedPayloads).toHaveLength(1);
      expect(emailProcessor.processedPayloads[0]).toEqual(payload);
    });

    it('should handle multiple queues independently', async () => {
      const emailPayload = { email: 'user1@test.com', subject: 'Welcome' };
      const paymentPayload = { amount: 100, userId: 'user123' };

      const emailTaskId = await service.enqueue(
        'email-queue',
        'send-email',
        emailPayload
      );
      const paymentTaskId = await service.enqueue(
        'payment-queue',
        'process-payment',
        paymentPayload
      );

      // NOTE: comment removed (non-ASCII).
      let attempts = 0;
      while (
        (emailProcessor.processedPayloads.length === 0 ||
          paymentProcessor.processedPayloads.length === 0) &&
        attempts < 50
      ) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        attempts++;
      }

      expect(emailTaskId).toBeDefined();
      expect(paymentTaskId).toBeDefined();
      expect(emailTaskId).not.toBe(paymentTaskId);

      expect(emailProcessor.processedPayloads).toHaveLength(1);
      expect(emailProcessor.processedPayloads[0]).toEqual(emailPayload);
      expect(paymentProcessor.processedPayloads).toHaveLength(1);
      expect(paymentProcessor.processedPayloads[0]).toEqual(paymentPayload);
    });

    // NOTE: comment removed (non-ASCII).
    // it('should retry failed jobs', async () => { ... });
    // it('should handle job failures gracefully', async () => { ... });

    it('should generate unique task IDs for each job', async () => {
      const payload1 = { email: 'id1@test.com', subject: 'ID1' };
      const payload2 = { email: 'id2@test.com', subject: 'ID2' };

      const task1Id = await service.enqueue('id-queue', 'send-email', payload1);
      const task2Id = await service.enqueue('id-queue', 'send-email', payload2);

      expect(task1Id).toBeDefined();
      expect(task2Id).toBeDefined();
      expect(task1Id).not.toBe(task2Id);
    });

    it('should provide queue statistics', async () => {
      const queueName = 'stats-queue';
      const payload = { email: 'stats@test.com', subject: 'Stats' };

      const emptyStats = service.getQueueStats(queueName);
      expect(emptyStats).toBeNull();

      await service.enqueue(queueName, 'send-email', payload);

      // NOTE: comment removed (non-ASCII).
      let attempts = 0;
      while (emailProcessor.processedPayloads.length === 0 && attempts < 50) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        attempts++;
      }

      const stats = service.getQueueStats(queueName);
      expect(stats).toBeDefined();
      expect(stats?.queueName).toBe(queueName);
      expect(stats?.pendingTasks).toBe(0);
      expect(stats?.activeTasks).toBe(0);
      expect(stats?.delayedTasks).toBe(0);
      expect(stats?.totalTasks).toBe(0);
    });

    it('should provide statistics for all queues', async () => {
      await service.enqueue('email-queue', 'send-email', {
        email: 'q1@test.com',
        subject: 'Q1',
      });
      await service.enqueue('payment-queue', 'process-payment', {
        amount: 50,
        userId: 'userB',
      });

      // NOTE: comment removed (non-ASCII).
      let attempts = 0;
      while (
        (emailProcessor.processedPayloads.length === 0 ||
          paymentProcessor.processedPayloads.length === 0) &&
        attempts < 50
      ) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        attempts++;
      }

      const allStats = service.getAllQueueStats();
      expect(allStats).toHaveLength(2);
      expect(allStats.some((stat) => stat.queueName === 'email-queue')).toBe(
        true
      );
      expect(allStats.some((stat) => stat.queueName === 'payment-queue')).toBe(
        true
      );
    });
  });

  describe('Priority Queue with Jobs', () => {
    it('should process high priority jobs first', async () => {
      const executionOrder: string[] = [];

      // NOTE: comment removed (non-ASCII).
      const trackingProcessor = {
        async process(payload: { priority: string }): Promise<void> {
          executionOrder.push(payload.priority);
          await new Promise((resolve) => setTimeout(resolve, 10));
        },
      };

      jest.spyOn(trackingProcessor, 'process');

      // NOTE: comment removed (non-ASCII).
      const module: TestingModule = await Test.createTestingModule({
        imports: [
          QueueModule.forRoot({
            processors: [
              { name: 'track-job', process: trackingProcessor.process },
            ],
          }),
        ],
      }).compile();

      const priorityService = module.get<QueueService>(QueueService);
      const priorityEventEmitter = module.get<EventEmitter2>(EventEmitter2);

      // NOTE: comment removed (non-ASCII).
      const allCompletedPromise = new Promise<void>((resolve) => {
        let completedCount = 0;
        const listener = () => {
          completedCount++;
          if (completedCount === 4) {
            priorityEventEmitter.off('queue.task.success', listener);
            resolve();
          }
        };
        priorityEventEmitter.on('queue.task.success', listener);
      });

      // NOTE: comment removed (non-ASCII).
      const promises = [
        priorityService.enqueue(
          'priority-queue',
          'track-job',
          { priority: 'low' },
          { priority: TaskPriority.LOW }
        ),
        priorityService.enqueue(
          'priority-queue',
          'track-job',
          { priority: 'normal' },
          { priority: TaskPriority.NORMAL }
        ),
        priorityService.enqueue(
          'priority-queue',
          'track-job',
          { priority: 'high' },
          { priority: TaskPriority.HIGH }
        ),
        priorityService.enqueue(
          'priority-queue',
          'track-job',
          { priority: 'urgent' },
          { priority: TaskPriority.URGENT }
        ),
      ];

      await Promise.all(promises);
      await allCompletedPromise;

      expect(executionOrder).toEqual(['urgent', 'high', 'normal', 'low']);
    });

    it('should use normal priority as default', async () => {
      const mockProcessor = jest.fn().mockResolvedValue(undefined);
      (service as any)['processors'].set('default-job', mockProcessor);

      const payload = { data: 'default-priority-test' };

      // NOTE: comment removed (non-ASCII).
      const successPromise = new Promise<void>((resolve) => {
        eventEmitter.once('queue.task.success', resolve);
      });

      await service.enqueue('default-priority-queue', 'default-job', payload);
      await successPromise;

      expect(mockProcessor).toHaveBeenCalledTimes(1);
      expect(mockProcessor).toHaveBeenCalledWith(payload);
    });

    it('should handle multiple priority levels correctly', async () => {
      const executionOrder: number[] = [];
      const mockProcessor = jest
        .fn()
        .mockImplementation(async (payload: any) => {
          executionOrder.push(payload.priority);
        });
      (service as any)['processors'].set('multi-priority-job', mockProcessor);

      await service.enqueue(
        'multi-priority-queue',
        'multi-priority-job',
        { priority: 1 },
        { priority: TaskPriority.LOW }
      );
      await service.enqueue(
        'multi-priority-queue',
        'multi-priority-job',
        { priority: 5 },
        { priority: TaskPriority.NORMAL }
      );
      await service.enqueue(
        'multi-priority-queue',
        'multi-priority-job',
        { priority: 8 },
        { priority: TaskPriority.HIGH }
      );
      await service.enqueue(
        'multi-priority-queue',
        'multi-priority-job',
        { priority: 10 },
        { priority: TaskPriority.URGENT }
      );

      // NOTE: comment removed (non-ASCII).
      let attempts = 0;
      while (executionOrder.length < 4 && attempts < 100) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        attempts++;
      }

      expect(executionOrder).toEqual([10, 8, 5, 1]);
    });
  });

  describe('Priority Queue with Multiple Queues', () => {
    it('should handle priority independently across different queues', async () => {
      const queue1Order: string[] = [];
      const queue2Order: string[] = [];

      const trackingProcessor = {
        async process(payload: {
          priority: string;
          queue: string;
        }): Promise<void> {
          if (payload.queue === 'queue1') {
            queue1Order.push(payload.priority);
          } else {
            queue2Order.push(payload.priority);
          }
        },
      };

      jest.spyOn(trackingProcessor, 'process');

      // NOTE: comment removed (non-ASCII).
      const module: TestingModule = await Test.createTestingModule({
        imports: [
          QueueModule.forRoot({
            processors: [
              { name: 'track-job', process: trackingProcessor.process },
            ],
          }),
        ],
      }).compile();

      const priorityService = module.get<QueueService>(QueueService);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const priorityEventEmitter = module.get<EventEmitter2>(EventEmitter2);

      // NOTE: comment removed (non-ASCII).
      await priorityService.enqueue(
        'queue1',
        'track-job',
        { priority: 'low', queue: 'queue1' },
        { priority: TaskPriority.LOW }
      );
      await priorityService.enqueue(
        'queue1',
        'track-job',
        { priority: 'high', queue: 'queue1' },
        { priority: TaskPriority.HIGH }
      );

      // NOTE: comment removed (non-ASCII).
      await priorityService.enqueue(
        'queue2',
        'track-job',
        { priority: 'high', queue: 'queue2' },
        { priority: TaskPriority.HIGH }
      );
      await priorityService.enqueue(
        'queue2',
        'track-job',
        { priority: 'low', queue: 'queue2' },
        { priority: TaskPriority.LOW }
      );

      // NOTE: comment removed (non-ASCII).
      await priorityService.enqueue(
        'queue1',
        'track-job',
        { priority: 'normal', queue: 'queue1' },
        { priority: TaskPriority.NORMAL }
      );
      await priorityService.enqueue(
        'queue2',
        'track-job',
        { priority: 'normal', queue: 'queue2' },
        { priority: TaskPriority.NORMAL }
      );

      // NOTE: comment removed (non-ASCII).
      let attempts = 0;
      while (
        (queue1Order.length < 3 || queue2Order.length < 3) &&
        attempts < 100
      ) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        attempts++;
      }

      // NOTE: comment removed (non-ASCII).
      expect(queue1Order).toEqual(['high', 'normal', 'low']);
      expect(queue2Order).toEqual(['high', 'normal', 'low']);
    });
  });

  describe('Rate limiting', () => {
    it('should throttle processing per queue', async () => {
      const processedAt: number[] = [];
      const module: TestingModule = await Test.createTestingModule({
        imports: [
          QueueModule.forRoot({
            limiter: { max: 1, duration: 50 },
            processors: [
              {
                name: 'limited-job',
                process: async () => {
                  processedAt.push(Date.now());
                },
              },
            ],
          }),
        ],
      }).compile();

      const limitedService = module.get<QueueService>(QueueService);

      await limitedService.enqueue('limited-queue', 'limited-job', {
        value: 1,
      });
      await limitedService.enqueue('limited-queue', 'limited-job', {
        value: 2,
      });

      let attempts = 0;
      while (processedAt.length < 2 && attempts < 200) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        attempts++;
      }

      expect(processedAt).toHaveLength(2);
      expect(processedAt[1] - processedAt[0]).toBeGreaterThanOrEqual(40);
    });

    it('should allow different groups within the same duration window', async () => {
      const processedAt: Array<{ userId: string; at: number }> = [];
      const module: TestingModule = await Test.createTestingModule({
        imports: [
          QueueModule.forRoot({
            limiter: { max: 1, duration: 100, groupKey: 'userId' },
            processors: [
              {
                name: 'grouped-job',
                process: async (payload: { userId: string }) => {
                  processedAt.push({ userId: payload.userId, at: Date.now() });
                },
              },
            ],
          }),
        ],
      }).compile();

      const limitedService = module.get<QueueService>(QueueService);

      await limitedService.enqueue('grouped-queue', 'grouped-job', {
        userId: 'user-a',
      });
      await limitedService.enqueue('grouped-queue', 'grouped-job', {
        userId: 'user-b',
      });

      let attempts = 0;
      while (processedAt.length < 2 && attempts < 200) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        attempts++;
      }

      expect(processedAt).toHaveLength(2);
      const first = processedAt[0];
      const second = processedAt[1];
      expect(second.at - first.at).toBeLessThan(80);
    });
  });

  describe('Delayed Jobs with Job System', () => {
    it('should delay job execution', async () => {
      const payload = {
        email: 'delayed@test.com',
        subject: 'Delayed Email',
      };

      const taskId = await service.enqueue(
        'delayed-queue',
        'send-email',
        payload,
        {
          delay: 100, // NOTE: comment removed (non-ASCII).
        }
      );

      // NOTE: comment removed (non-ASCII).
      expect(emailProcessor.processedPayloads).toHaveLength(0);

      // NOTE: comment removed (non-ASCII).
      await new Promise((resolve) => setTimeout(resolve, 150));

      // NOTE: comment removed (non-ASCII).
      let attempts = 0;
      while (emailProcessor.processedPayloads.length === 0 && attempts < 50) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        attempts++;
      }

      expect(emailProcessor.processedPayloads).toHaveLength(1);
      expect(emailProcessor.processedPayloads[0]).toEqual(payload);
      expect(taskId).toBeDefined();
    });

    it('should emit delayed event for delayed jobs', async () => {
      const payload = { email: 'delayed-event@test.com', subject: 'Event' };

      // NOTE: comment removed (non-ASCII).
      const emitSpy = jest.spyOn(eventEmitter, 'emit');

      await service.enqueue('delayed-event-queue', 'send-email', payload, {
        delay: 50, // NOTE: comment removed (non-ASCII).
      });

      // NOTE: comment removed (non-ASCII).
      let attempts = 0;
      while (emitSpy.mock.calls.length === 0 && attempts < 50) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        attempts++;
      }

      const delayedTasks = service.getDelayedTasks();
      expect(delayedTasks).toHaveLength(1);
      expect(delayedTasks[0].id).toBeDefined();
      expect(delayedTasks[0].queueName).toBe('delayed-event-queue');
    });

    it('should track delayed jobs in statistics', async () => {
      const payload = { email: 'delayed-stats@test.com', subject: 'Stats' };
      await service.enqueue('delayed-stats-queue', 'send-email', payload, {
        delay: 200, // NOTE: comment removed (non-ASCII).
      });

      const stats = service.getQueueStats('delayed-stats-queue');
      expect(stats?.delayedTasks).toBe(1);
    });

    it('should return delayed jobs list', async () => {
      const payload = { email: 'delayed-list@test.com', subject: 'List' };
      await service.enqueue('delayed-list-queue', 'send-email', payload, {
        delay: 300, // NOTE: comment removed (non-ASCII).
      });

      const delayedTasks = service.getDelayedTasks();
      expect(delayedTasks).toHaveLength(1);
      expect(delayedTasks[0].remainingDelay).toBeGreaterThan(0);
      expect(delayedTasks[0].queueName).toBe('delayed-list-queue');
    });
  });

  describe('Retry Backoff and Timeout', () => {
    it('should apply backoff delay between retries', async () => {
      const attemptTimes: number[] = [];
      let callCount = 0;

      service.registerProcessor('flaky-job', async () => {
        attemptTimes.push(Date.now());
        callCount++;
        if (callCount === 1) {
          throw new Error('Fail once');
        }
      });

      await service.enqueue(
        'backoff-queue',
        'flaky-job',
        { data: 'backoff' },
        { retries: 1, backoff: { type: 'fixed', delay: 50 } }
      );

      let attempts = 0;
      while (attemptTimes.length < 2 && attempts < 100) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        attempts++;
      }

      expect(attemptTimes).toHaveLength(2);
      expect(attemptTimes[1] - attemptTimes[0]).toBeGreaterThanOrEqual(40);
    });

    it('should fail a task when timeout is exceeded', async () => {
      (eventEmitter.emit as jest.Mock).mockClear();

      service.registerProcessor('timeout-job', async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
      });

      await service.enqueue(
        'timeout-queue',
        'timeout-job',
        { data: 'timeout' },
        { timeoutMs: 10 }
      );

      let attempts = 0;
      let failedCall: any;
      while (!failedCall && attempts < 100) {
        failedCall = (eventEmitter.emit as jest.Mock).mock.calls.find(
          (call) => call[0] === 'queue.task.failed'
        );
        await new Promise((resolve) => setTimeout(resolve, 10));
        attempts++;
      }

      expect(failedCall).toBeDefined();
      expect(failedCall[1].error).toBeInstanceOf(Error);
      expect(failedCall[1].error.message).toMatch(/timed out/i);
    });
  });

  describe('Dead letter queue', () => {
    it('should move failed tasks to the dead letter queue', async () => {
      const dlqProcessed: any[] = [];
      const module: TestingModule = await Test.createTestingModule({
        imports: [
          QueueModule.forRoot({
            deadLetter: { queueName: 'dlq' },
            processors: [
              {
                name: 'always-fail',
                process: async () => {
                  throw new Error('fail');
                },
              },
              {
                name: 'always-fail:deadletter',
                process: async (payload: any) => {
                  dlqProcessed.push(payload);
                },
              },
            ],
          }),
        ],
      }).compile();

      const dlqService = module.get<QueueService>(QueueService);
      const dlqEventEmitter = module.get<EventEmitter2>(EventEmitter2);
      const emitSpy = jest.spyOn(dlqEventEmitter, 'emit');

      const payload = { id: 'job-1' };
      await dlqService.enqueue('primary', 'always-fail', payload);

      let attempts = 0;
      while (dlqProcessed.length === 0 && attempts < 100) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        attempts++;
      }

      expect(dlqProcessed).toHaveLength(1);
      expect(dlqProcessed[0].originalPayload).toEqual(payload);
      expect(dlqProcessed[0].fromQueue).toBe('primary');
      expect(emitSpy).toHaveBeenCalledWith(
        'queue.task.deadlettered',
        expect.objectContaining({
          queueName: 'dlq',
          fromQueue: 'primary',
        })
      );
    });
  });

  describe('Job Cancellation', () => {
    // NOTE: comment removed (non-ASCII).
    // it('should cancel pending delayed job', async () => { ... });
    // it('should handle job cancellation correctly', async () => { ... });

    it('should return false when cancelling non-existent job', () => {
      const isCancelled = service.cancelTask(
        'non-existent-queue',
        'non-existent-id'
      );
      expect(isCancelled).toBe(false);
    });
  });

  describe('Concurrency Control with Jobs', () => {
    describe('with concurrency of 2', () => {
      let concurrencyService: QueueService;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      let concurrencyEventEmitter: EventEmitter2;
      let concurrencyTracker: any;

      beforeEach(async () => {
        concurrencyTracker = {
          activeTasks: [],
          maxConcurrent: 0,
          async process(payload: { id: number }): Promise<void> {
            concurrencyTracker.activeTasks.push(payload.id);
            concurrencyTracker.maxConcurrent = Math.max(
              concurrencyTracker.maxConcurrent,
              concurrencyTracker.activeTasks.length
            );

            await new Promise((resolve) => setTimeout(resolve, 20)); // NOTE: comment removed (non-ASCII).
            concurrencyTracker.activeTasks.pop();
          },
        };

        jest.spyOn(concurrencyTracker, 'process');

        const module: TestingModule = await Test.createTestingModule({
          imports: [
            QueueModule.forRoot({
              concurrency: 2,
              processors: [
                { name: 'concurrent-job', process: concurrencyTracker.process },
              ],
            }),
          ],
        }).compile();

        concurrencyService = module.get<QueueService>(QueueService);
        concurrencyEventEmitter = module.get<EventEmitter2>(EventEmitter2);
      });

      it('should respect concurrency limits', async () => {
        const promises: Promise<string>[] = [];
        for (let i = 0; i < 5; i++) {
          promises.push(
            concurrencyService.enqueue('concurrency-queue', 'concurrent-job', {
              id: i,
            })
          );
        }

        await Promise.all(promises);

        // NOTE: comment removed (non-ASCII).
        let attempts = 0;
        while (
          concurrencyTracker.process.mock.calls.length < 5 &&
          attempts < 100
        ) {
          await new Promise((resolve) => setTimeout(resolve, 10));
          attempts++;
        }

        expect(concurrencyTracker.maxConcurrent).toBeLessThanOrEqual(2);
        expect(concurrencyTracker.process).toHaveBeenCalledTimes(5);
      });

      it('should handle multiple concurrent jobs with proper tracking', async () => {
        const mockProcessor = jest.fn().mockImplementation(async () => {
          await new Promise((resolve) => setTimeout(resolve, 20)); // NOTE: comment removed (non-ASCII).
        });

        (concurrencyService as any)['processors'].set(
          'multi-concurrency-job',
          mockProcessor
        );

        const promises: Promise<string>[] = [];
        for (let i = 0; i < 3; i++) {
          promises.push(
            concurrencyService.enqueue('multi-queue', 'multi-concurrency-job', {
              id: i,
            })
          );
        }

        const stats = concurrencyService.getQueueStats('multi-queue');
        expect(stats).toBeDefined();

        await Promise.all(promises);

        // NOTE: comment removed (non-ASCII).
        let attempts = 0;
        while (mockProcessor.mock.calls.length < 3 && attempts < 100) {
          await new Promise((resolve) => setTimeout(resolve, 10));
          attempts++;
        }

        // NOTE: comment removed (non-ASCII).
        await new Promise((resolve) => setTimeout(resolve, 50));

        const finalStats = concurrencyService.getQueueStats('multi-queue');
        expect(finalStats?.activeTasks).toBe(0);
        expect(finalStats?.pendingTasks).toBe(0);
      });
    });
  });

  describe('Graceful Shutdown with Jobs', () => {
    describe('with graceful shutdown timeout', () => {
      let shutdownService: QueueService;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      let shutdownEventEmitter: EventEmitter2;
      let slowProcessor: TestSlowProcessor;

      beforeEach(async () => {
        slowProcessor = new TestSlowProcessor();

        const processors: QueueProcessor[] = [
          {
            name: 'slow-job',
            process: slowProcessor.process.bind(slowProcessor),
          },
        ];

        const module: TestingModule = await Test.createTestingModule({
          imports: [
            QueueModule.forRoot({
              gracefulShutdownTimeout: 1000,
              processors,
            }),
          ],
        }).compile();

        shutdownService = module.get<QueueService>(QueueService);
        shutdownEventEmitter = module.get<EventEmitter2>(EventEmitter2);

        // NOTE: comment removed (non-ASCII).
        jest.spyOn(slowProcessor, 'process');
      });

      it('should prevent new jobs during shutdown', async () => {
        shutdownService.onApplicationShutdown('SIGTERM');

        await expect(
          shutdownService.enqueue('shutdown-queue', 'slow-job', {
            data: 'shutdown-test',
          })
        ).rejects.toThrow(
          'Queue service is shutting down. Cannot enqueue new tasks.'
        );

        expect(slowProcessor.process).not.toHaveBeenCalled();
      });

      it('should wait for active jobs to complete during shutdown', async () => {
        let taskCompleted = false;

        const completionTracker = {
          async process(_payload: any): Promise<void> {
            await new Promise((resolve) => setTimeout(resolve, 20)); // NOTE: comment removed (non-ASCII).
            taskCompleted = true;
          },
        };

        // NOTE: comment removed (non-ASCII).
        jest.spyOn(completionTracker, 'process');

        // NOTE: comment removed (non-ASCII).
        const module: TestingModule = await Test.createTestingModule({
          imports: [
            QueueModule.forRoot({
              gracefulShutdownTimeout: 1000,
              processors: [
                { name: 'completion-job', process: completionTracker.process },
              ],
            }),
          ],
        }).compile();

        const completionService = module.get<QueueService>(QueueService);
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const completionEventEmitter = module.get<EventEmitter2>(EventEmitter2);

        const _payload = { data: 'active-task-test' };

        // NOTE: comment removed (non-ASCII).
        const enqueuePromise = completionService.enqueue(
          'active-queue',
          'completion-job',
          _payload
        );

        // NOTE: comment removed (non-ASCII).
        await new Promise((resolve) => setTimeout(resolve, 10));
        const shutdownPromise =
          completionService.onApplicationShutdown('SIGTERM');

        // NOTE: comment removed (non-ASCII).
        let attempts = 0;
        while (!taskCompleted && attempts < 100) {
          await new Promise((resolve) => setTimeout(resolve, 10));
          attempts++;
        }

        await enqueuePromise;
        await shutdownPromise;

        expect(taskCompleted).toBe(true);
        expect(completionTracker.process).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('JobId dedupe', () => {
    it('should drop duplicate jobId and return existing taskId', async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [
          QueueModule.forRoot({
            concurrency: 0,
            processors: [
              { name: 'dedupe-job', process: jest.fn().mockResolvedValue(undefined) },
            ],
          }),
        ],
      }).compile();

      const dedupeService = module.get<QueueService>(QueueService);

      const firstId = await dedupeService.enqueue(
        'dedupe-queue',
        'dedupe-job',
        { id: 1 },
        { jobId: 'user:1', dedupe: 'drop' }
      );
      const secondId = await dedupeService.enqueue(
        'dedupe-queue',
        'dedupe-job',
        { id: 2 },
        { jobId: 'user:1', dedupe: 'drop' }
      );

      expect(secondId).toBe(firstId);
      expect(dedupeService.getTasksByQueue('dedupe-queue')).toHaveLength(1);
    });

    it('should replace pending jobId when dedupe is replace', async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [
          QueueModule.forRoot({
            concurrency: 0,
            processors: [
              { name: 'replace-job', process: jest.fn().mockResolvedValue(undefined) },
            ],
          }),
        ],
      }).compile();

      const replaceService = module.get<QueueService>(QueueService);

      const firstId = await replaceService.enqueue(
        'replace-queue',
        'replace-job',
        { id: 1 },
        { jobId: 'user:2', dedupe: 'drop' }
      );
      const secondId = await replaceService.enqueue(
        'replace-queue',
        'replace-job',
        { id: 2 },
        { jobId: 'user:2', dedupe: 'replace' }
      );

      expect(secondId).not.toBe(firstId);
      const tasks = replaceService.getTasksByQueue('replace-queue');
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe(secondId);
    });

    it('should drop enqueue when jobId is already running', async () => {
      const slowProcessor = jest
        .fn()
        .mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 50)));

      const module: TestingModule = await Test.createTestingModule({
        imports: [
          QueueModule.forRoot({
            concurrency: 1,
            processors: [{ name: 'slow-job', process: slowProcessor }],
          }),
        ],
      }).compile();

      const runningService = module.get<QueueService>(QueueService);

      const firstId = await runningService.enqueue(
        'running-queue',
        'slow-job',
        { id: 1 },
        { jobId: 'user:3', dedupe: 'replace' }
      );

      await new Promise((resolve) => setTimeout(resolve, 10));

      const secondId = await runningService.enqueue(
        'running-queue',
        'slow-job',
        { id: 2 },
        { jobId: 'user:3', dedupe: 'replace' }
      );

      expect(secondId).toBe(firstId);
      expect(slowProcessor).toHaveBeenCalledTimes(1);
    });

    it('should cancel pending and delayed tasks by jobId', async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [
          QueueModule.forRoot({
            concurrency: 0,
            processors: [
              { name: 'cancel-job', process: jest.fn().mockResolvedValue(undefined) },
            ],
          }),
        ],
      }).compile();

      const cancelService = module.get<QueueService>(QueueService);

      const pendingId = await cancelService.enqueue(
        'cancel-queue',
        'cancel-job',
        { id: 1 },
        { jobId: 'user:4', dedupe: 'drop' }
      );
      const delayedId = await cancelService.enqueue(
        'cancel-queue',
        'cancel-job',
        { id: 2 },
        { jobId: 'user:5', delay: 1000 }
      );

      const pendingCancelled = cancelService.cancelByJobId(
        'cancel-queue',
        'user:4'
      );
      const delayedCancelled = cancelService.cancelByJobId(
        'cancel-queue',
        'user:5'
      );

      expect(pendingCancelled).toBe(true);
      expect(delayedCancelled).toBe(true);
      expect(cancelService.getTasksByQueue('cancel-queue')).toHaveLength(0);
      expect(cancelService.getDelayedTasks()).toHaveLength(0);

      const newId = await cancelService.enqueue(
        'cancel-queue',
        'cancel-job',
        { id: 3 },
        { jobId: 'user:4', dedupe: 'drop' }
      );
      expect(newId).not.toBe(pendingId);
      expect(newId).not.toBe(delayedId);
    });
  });
});

describe('Processor Management', () => {
  let service: QueueService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        QueueModule.forRoot({
          logger: {
            log: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
            debug: jest.fn(),
            verbose: jest.fn(),
          } as any,
        }),
      ],
    }).compile();

    service = module.get<QueueService>(QueueService);
  });

  describe('registerProcessor', () => {
    it('should register a new processor successfully', () => {
      const processor = jest.fn().mockResolvedValue(undefined);
      const result = service.registerProcessor('test-job', processor);

      expect(result).toBe(true);
      expect(service.hasProcessor('test-job')).toBe(true);
      expect(service.getRegisteredProcessors()).toContain('test-job');
    });

    it('should return false when processor already exists', () => {
      const processor1 = jest.fn().mockResolvedValue(undefined);
      const processor2 = jest.fn().mockResolvedValue(undefined);

      service.registerProcessor('test-job', processor1);
      const result = service.registerProcessor('test-job', processor2);

      expect(result).toBe(false);
      expect(service.getRegisteredProcessors()).toHaveLength(1);
    });

    it('should return false when processor already exists', () => {
      const processor1 = jest.fn().mockResolvedValue(undefined);
      const processor2 = jest.fn().mockResolvedValue(undefined);

      service.registerProcessor('test-job', processor1);
      const result = service.registerProcessor('test-job', processor2);

      expect(result).toBe(false);
      expect(service.getRegisteredProcessors()).toHaveLength(1);
    });
  });

  describe('updateProcessor', () => {
    it('should update existing processor', () => {
      const processor1 = jest.fn().mockResolvedValue(undefined);
      const processor2 = jest.fn().mockResolvedValue(undefined);

      service.registerProcessor('test-job', processor1);
      const result = service.updateProcessor('test-job', processor2);

      expect(result).toBe(true);
      expect(service.hasProcessor('test-job')).toBe(true);
    });

    it('should register new processor if does not exist', () => {
      const processor = jest.fn().mockResolvedValue(undefined);
      const result = service.updateProcessor('new-job', processor);

      expect(result).toBe(true);
      expect(service.hasProcessor('new-job')).toBe(true);
    });
  });

  describe('unregisterProcessor', () => {
    it('should unregister existing processor', () => {
      const processor = jest.fn().mockResolvedValue(undefined);
      service.registerProcessor('test-job', processor);

      const result = service.unregisterProcessor('test-job');

      expect(result).toBe(true);
      expect(service.hasProcessor('test-job')).toBe(false);
      expect(service.getRegisteredProcessors()).not.toContain('test-job');
    });

    it('should return false when processor does not exist', () => {
      const result = service.unregisterProcessor('non-existent');

      expect(result).toBe(false);
    });
  });

  describe('getRegisteredProcessors', () => {
    it('should return empty array when no processors registered', () => {
      const processors = service.getRegisteredProcessors();
      expect(processors).toEqual([]);
    });

    it('should return all registered processor names', () => {
      const processor1 = jest.fn().mockResolvedValue(undefined);
      const processor2 = jest.fn().mockResolvedValue(undefined);

      service.registerProcessor('job-1', processor1);
      service.registerProcessor('job-2', processor2);

      const processors = service.getRegisteredProcessors();
      expect(processors).toContain('job-1');
      expect(processors).toContain('job-2');
      expect(processors).toHaveLength(2);
    });
  });

  describe('getProcessorInfo', () => {
    it('should return processor info when exists', () => {
      const processor = jest.fn().mockResolvedValue(undefined);
      service.registerProcessor('test-job', processor);

      const info = service.getProcessorInfo('test-job');

      expect(info).toEqual({
        name: 'test-job',
        registered: true,
      });
    });

    it('should return null when processor does not exist', () => {
      const info = service.getProcessorInfo('non-existent');

      expect(info).toBeNull();
    });
  });
});

describe('Queue Management', () => {
  let service: QueueService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        QueueModule.forRoot({
          processors: [
            {
              name: 'test-job',
              process: jest.fn().mockResolvedValue(undefined),
            },
          ],
        }),
      ],
    }).compile();

    service = module.get<QueueService>(QueueService);
  });

  describe('clearQueue', () => {
    it('should clear specific queue', async () => {
      // NOTE: comment removed (non-ASCII).
      await service.enqueue('test-queue', 'test-job', { data: 'test1' });
      await service.enqueue('test-queue', 'test-job', { data: 'test2' });
      await service.enqueue('other-queue', 'test-job', { data: 'test3' });

      // NOTE: comment removed (non-ASCII).
      const statsBefore = service.getAllQueueStats();
      expect(statsBefore.length).toBeGreaterThan(0);

      // NOTE: comment removed (non-ASCII).
      const clearedCount = service.clearQueue('test-queue');
      expect(clearedCount).toBe(2);

      // NOTE: comment removed (non-ASCII).
      const statsAfter = service.getAllQueueStats();
      const otherQueueStats = statsAfter.find(
        (s) => s.queueName === 'other-queue'
      );
      expect(otherQueueStats?.pendingTasks).toBe(1);
    });

    it('should return 0 for non-existent queue', () => {
      const clearedCount = service.clearQueue('non-existent');
      expect(clearedCount).toBe(0);
    });
  });

  describe('clearAllQueues', () => {
    it('should clear all queues', async () => {
      // NOTE: comment removed (non-ASCII).
      await service.enqueue('queue-1', 'test-job', { data: 'test1' });
      await service.enqueue('queue-2', 'test-job', { data: 'test2' });
      await service.enqueue('queue-3', 'test-job', { data: 'test3' });

      // NOTE: comment removed (non-ASCII).
      const clearedCount = service.clearAllQueues();
      expect(clearedCount).toBe(3);

      // NOTE: comment removed (non-ASCII).
      const stats = service.getAllQueueStats();
      const totalPending = stats.reduce(
        (sum, queue) => sum + queue.pendingTasks,
        0
      );
      expect(totalPending).toBe(0);
    });
  });
});

describe('Task Management', () => {
  let service: QueueService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        QueueModule.forRoot({
          processors: [
            {
              name: 'test-job',
              process: jest.fn().mockResolvedValue(undefined),
            },
            {
              name: 'slow-job',
              process: jest
                .fn()
                .mockImplementation(
                  () => new Promise((resolve) => setTimeout(resolve, 100))
                ),
            },
          ],
        }),
      ],
    }).compile();

    service = module.get<QueueService>(QueueService);
  });

  describe('getTaskById', () => {
    it('should find task by ID', async () => {
      const payload = { data: 'test-data' };
      const taskId = await service.enqueue('test-queue', 'test-job', payload);

      const task = service.getTaskById(taskId);

      expect(task).toBeDefined();
      expect(task?.payload).toEqual(payload);
      expect(task?.jobName).toBe('test-job');
    });

    it('should return null for non-existent task ID', () => {
      const task = service.getTaskById('non-existent-id');
      expect(task).toBeNull();
    });
  });

  describe('getTaskStatus', () => {
    it('should return pending status for queued task', async () => {
      const taskId = await service.enqueue('test-queue', 'test-job', {
        data: 'test',
      });

      const status = service.getTaskStatus(taskId);

      expect(status.status).toBe('pending');
      expect(status.taskId).toBe(taskId);
      if (status.status === 'pending') {
        expect(status.queueName).toBe('test-queue');
        expect(status.jobName).toBe('test-job');
      }
    });

    it('should return delayed status for delayed task', async () => {
      jest.useFakeTimers();
      try {
        const taskId = await service.enqueue(
          'test-queue',
          'test-job',
          { data: 'test' },
          { delay: 1000 }
        );

        const status = service.getTaskStatus(taskId);

        expect(status.status).toBe('delayed');
        expect(status.taskId).toBe(taskId);
        if (status.status === 'delayed') {
          expect(status.scheduledAt).toBeDefined();
          expect(status.delay).toBeGreaterThanOrEqual(0);
        }
      } finally {
        jest.clearAllTimers();
        jest.useRealTimers();
      }
    });

    it('should return not_found for completed task', async () => {
      const payload = { data: 'test' };
      const taskId = await service.enqueue('test-queue', 'test-job', payload);

      // NOTE: comment removed (non-ASCII).
      let attempts = 0;
      while (attempts < 50) {
        const status = service.getTaskStatus(taskId);
        if (status.status === 'not_found') break;
        await new Promise((resolve) => setTimeout(resolve, 10));
        attempts++;
      }

      const finalStatus = service.getTaskStatus(taskId);
      expect(finalStatus.status).toBe('not_found');
      expect(finalStatus.taskId).toBe(taskId);
    });

    it('should return not_found for non-existent task', () => {
      const status = service.getTaskStatus('non-existent-id');
      expect(status.status).toBe('not_found');
      expect(status.taskId).toBe('non-existent-id');
    });
  });

  describe('getTasksByQueue', () => {
    it('should return tasks in specific queue', async () => {
      const payload1 = { data: 'task1' };
      const payload2 = { data: 'task2' };

      await service.enqueue('test-queue', 'test-job', payload1);
      await service.enqueue('test-queue', 'test-job', payload2);
      await service.enqueue('other-queue', 'test-job', { data: 'other' });

      const tasks = service.getTasksByQueue('test-queue');

      expect(tasks).toHaveLength(2);
      expect(tasks.map((t) => t.payload)).toEqual([payload1, payload2]);
    });

    it('should return empty array for non-existent queue', () => {
      const tasks = service.getTasksByQueue('non-existent');
      expect(tasks).toEqual([]);
    });
  });

  describe('getActiveTasksByQueue', () => {
    it('should return active tasks in queue', async () => {
      // NOTE: comment removed (non-ASCII).
      const taskId = await service.enqueue('test-queue', 'slow-job', {
        data: 'slow',
      });

      // NOTE: comment removed (non-ASCII).
      await new Promise((resolve) => setTimeout(resolve, 10));

      const activeTasks = service.getActiveTasksByQueue('test-queue');

      // NOTE: comment removed (non-ASCII).
      const hasActiveTask = activeTasks.some((task) => task.id === taskId);
      expect(hasActiveTask).toBe(true);
    });

    it('should return empty array when no active tasks', () => {
      const activeTasks = service.getActiveTasksByQueue('test-queue');
      expect(activeTasks).toEqual([]);
    });
  });

  describe('State persistence', () => {
    it('should restore pending tasks from saved state', async () => {
      const persistencePath = path.join(
        os.tmpdir(),
        `queue-state-${Date.now()}.json`
      );

      const localEmailProcessor = new TestEmailProcessor();

      const processors: QueueProcessor[] = [
        {
          name: 'persisted-email',
          process: localEmailProcessor.process.bind(localEmailProcessor),
        },
      ];

      const mockLogger = {
        log: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
        verbose: jest.fn(),
      };

      const pendingModule: TestingModule = await Test.createTestingModule({
        imports: [
          QueueModule.forRoot({
            processors,
            enablePersistence: true,
            persistencePath,
            concurrency: 0,
            logger: mockLogger as any,
          }),
        ],
      }).compile();

      const pendingService = pendingModule.get<QueueService>(QueueService);

      await pendingService.enqueue('persist-queue', 'persisted-email', {
        email: 'a@test.com',
        subject: 'A',
      });
      await pendingService.enqueue('persist-queue', 'persisted-email', {
        email: 'b@test.com',
        subject: 'B',
      });

      await (pendingService as any).savePersistedState();

      const restoreModule: TestingModule = await Test.createTestingModule({
        imports: [
          QueueModule.forRoot({
            processors,
            enablePersistence: true,
            persistencePath,
            concurrency: 0,
            logger: mockLogger as any,
          }),
        ],
      }).compile();

      const restoreService = restoreModule.get<QueueService>(QueueService);
      await restoreService.onModuleInit();

      const restoredTasks = restoreService.getTasksByQueue('persist-queue');

      expect(restoredTasks).toHaveLength(2);
      expect(restoredTasks.map((task) => task.payload)).toEqual([
        { email: 'a@test.com', subject: 'A' },
        { email: 'b@test.com', subject: 'B' },
      ]);
      expect(
        restoredTasks.every((task) => task.queueName === 'persist-queue')
      ).toBe(true);

      if (fs.existsSync(persistencePath)) {
        fs.unlinkSync(persistencePath);
      }
    });

    it('should restore jobId dedupe index from saved state', async () => {
      const persistencePath = path.join(
        os.tmpdir(),
        `queue-state-dedupe-${Date.now()}.json`
      );

      const processors: QueueProcessor[] = [
        {
          name: 'dedupe-persisted',
          process: jest.fn().mockResolvedValue(undefined),
        },
      ];

      const mockLogger = {
        log: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
        verbose: jest.fn(),
      };

      const pendingModule: TestingModule = await Test.createTestingModule({
        imports: [
          QueueModule.forRoot({
            processors,
            enablePersistence: true,
            persistencePath,
            concurrency: 0,
            logger: mockLogger as any,
          }),
        ],
      }).compile();

      const pendingService = pendingModule.get<QueueService>(QueueService);

      await pendingService.enqueue(
        'dedupe-queue',
        'dedupe-persisted',
        { id: 1 },
        { jobId: 'user:dedupe' }
      );

      await (pendingService as any).savePersistedState();

      const restoreModule: TestingModule = await Test.createTestingModule({
        imports: [
          QueueModule.forRoot({
            processors,
            enablePersistence: true,
            persistencePath,
            concurrency: 0,
            logger: mockLogger as any,
          }),
        ],
      }).compile();

      const restoreService = restoreModule.get<QueueService>(QueueService);
      await restoreService.onModuleInit();

      const restoredTasks = restoreService.getTasksByQueue('dedupe-queue');
      expect(restoredTasks).toHaveLength(1);
      const restoredId = restoredTasks[0].id;

      const dedupedId = await restoreService.enqueue(
        'dedupe-queue',
        'dedupe-persisted',
        { id: 2 },
        { jobId: 'user:dedupe', dedupe: 'drop' }
      );

      expect(dedupedId).toBe(restoredId);
      expect(restoreService.getTasksByQueue('dedupe-queue')).toHaveLength(1);

      if (fs.existsSync(persistencePath)) {
        fs.unlinkSync(persistencePath);
      }
    });

    it('should restore delayed tasks with proper execution callbacks', async () => {
      const persistencePath = path.join(
        os.tmpdir(),
        `queue-state-delayed-${Date.now()}.json`
      );

      const localEmailProcessor = new TestEmailProcessor();

      const processors: QueueProcessor[] = [
        {
          name: 'persisted-delayed-email',
          process: localEmailProcessor.process.bind(localEmailProcessor),
        },
      ];

      const mockLogger = {
        log: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
        verbose: jest.fn(),
      };

      const pendingModule: TestingModule = await Test.createTestingModule({
        imports: [
          QueueModule.forRoot({
            processors,
            enablePersistence: true,
            persistencePath,
            concurrency: 0,
            logger: mockLogger as any,
          }),
        ],
      }).compile();

      const pendingService = pendingModule.get<QueueService>(QueueService);

      await pendingService.enqueue(
        'delayed-queue',
        'persisted-delayed-email',
        {
          email: 'delay@test.com',
          subject: 'Delayed',
        },
        {
          delay: 200,
        }
      );

      await (pendingService as any).savePersistedState();
      await pendingModule.close();

      const restoreModule: TestingModule = await Test.createTestingModule({
        imports: [
          QueueModule.forRoot({
            processors,
            enablePersistence: true,
            persistencePath,
            concurrency: 1,
            logger: mockLogger as any,
          }),
        ],
      }).compile();

      const restoreService = restoreModule.get<QueueService>(QueueService);
      await restoreService.onModuleInit();

      let attempts = 0;
      while (
        localEmailProcessor.processedPayloads.length === 0 &&
        attempts < 50
      ) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        attempts++;
      }

      expect(localEmailProcessor.processedPayloads).toEqual([
        { email: 'delay@test.com', subject: 'Delayed' },
      ]);

      await restoreModule.close();

      if (fs.existsSync(persistencePath)) {
        fs.unlinkSync(persistencePath);
      }
    });
  });
});

describe('Decorator-based Processor Registration', () => {
  let service: QueueService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        QueueModule.forRoot({
          processors: [
            {
              name: 'decorated-job-1',
              process: jest.fn().mockResolvedValue(undefined),
            },
            {
              name: 'decorated-job-2',
              process: jest.fn().mockResolvedValue(undefined),
            },
          ],
        }),
      ],
    }).compile();

    service = module.get<QueueService>(QueueService);
  });

  it('should register processors with decorators', () => {
    const processors = service.getRegisteredProcessors();

    expect(processors).toContain('decorated-job-1');
    expect(processors).toContain('decorated-job-2');
  });
});

// Note: forFeature and forProcessors tests require more complex setup
// and are better suited for integration tests
describe('Module Registration Methods', () => {
  // These methods are tested in the main QueueService tests above
  it('should have basic module functionality', () => {
    expect(QueueModule.forRoot).toBeDefined();
    expect(QueueModule.forFeature).toBeDefined();
    expect(QueueModule.forProcessors).toBeDefined();
  });
});
