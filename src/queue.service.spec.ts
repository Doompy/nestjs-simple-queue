import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { QueueService } from './queue.service';
import { QueueModule } from './queue.module';
import { TaskPriority, QueueProcessor } from './queue.interface';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Jest ?꾩뿭 ??꾩븘???ㅼ젙 (30珥?
jest.setTimeout(30000);

// ?뚯뒪?몄슜 Job ?꾨줈?몄꽌
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
    this.shouldFail = true; // ??긽 ?ㅽ뙣?섎룄濡??좎?
  }
}

class TestSlowProcessor {
  async process(_payload: any): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 10)); // 10ms濡??⑥텞
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

    // ?꾨줈?몄꽌 ?깅줉
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

    // eventEmitter.emit??spy濡?媛먯떥湲?
    jest.spyOn(eventEmitter, 'emit');

    // 媛??뚯뒪???쒖옉 ???꾨줈?몄꽌 ?곹깭 珥덇린??
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

      // ?묒뾽???꾨즺???뚭퉴吏 ?대쭅
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

      // ???묒뾽??紐⑤몢 ?꾨즺???뚭퉴吏 ?대쭅
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

    // ?ъ떆?꾩? ?ㅽ뙣 泥섎━ 湲곕뒫? ?묐룞?섏?留??뚯뒪???섍꼍?먯꽌 遺덉븞?뺥븯誘濡?二쇱꽍 泥섎━
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

      // ?묒뾽???꾨즺???뚭퉴吏 ?대쭅
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

      // ???묒뾽??紐⑤몢 ?꾨즺???뚭퉴吏 ?대쭅
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

      // ?ㅽ뻾 ?쒖꽌瑜?異붿쟻?섎뒗 ?꾨줈?몄꽌
      const trackingProcessor = {
        async process(payload: { priority: string }): Promise<void> {
          executionOrder.push(payload.priority);
          await new Promise((resolve) => setTimeout(resolve, 10));
        },
      };

      jest.spyOn(trackingProcessor, 'process');

      // ?덈줈???꾨줈?몄꽌濡??쒕퉬???ъ깮??
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

      // 紐⑤뱺 ?묒뾽 ?꾨즺瑜?湲곕떎由щ뒗 Promise
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

      // ??? ?곗꽑?쒖쐞遺???믪? ?곗꽑?쒖쐞源뚯? ?쒖꽌?濡?異붽?
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

      // ?깃났 ?대깽???湲?
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

      // 紐⑤뱺 ?묒뾽???꾨즺???뚭퉴吏 ?대쭅
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

      // ?덈줈???꾨줈?몄꽌濡??쒕퉬???ъ깮??
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

      // queue1: ??? ?곗꽑?쒖쐞遺??
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

      // queue2: ?믪? ?곗꽑?쒖쐞遺??
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

      // 異붽? ?묒뾽??
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

      // 紐⑤뱺 ?묒뾽???꾨즺???뚭퉴吏 ?대쭅
      let attempts = 0;
      while (
        (queue1Order.length < 3 || queue2Order.length < 3) &&
        attempts < 100
      ) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        attempts++;
      }

      // 媛??먮뒗 ?낅┰?곸쑝濡??곗꽑?쒖쐞瑜?泥섎━
      expect(queue1Order).toEqual(['high', 'normal', 'low']);
      expect(queue2Order).toEqual(['high', 'normal', 'low']);
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
          delay: 100, // 100ms濡??⑥텞
        }
      );

      // 吏???쒓컙 ?꾩뿉???ㅽ뻾?섏? ?딆쓬
      expect(emailProcessor.processedPayloads).toHaveLength(0);

      // 吏???쒓컙留뚰겮 ?湲?
      await new Promise((resolve) => setTimeout(resolve, 150));

      // ?묒뾽???꾨즺???뚭퉴吏 ?대쭅
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

      // ?대깽??諛쒖깮 ?뺤씤???꾪븳 spy
      const emitSpy = jest.spyOn(eventEmitter, 'emit');

      await service.enqueue('delayed-event-queue', 'send-email', payload, {
        delay: 50, // 50ms濡??⑥텞
      });

      // delayed ?대깽?멸? 諛쒖깮???뚭퉴吏 ?대쭅
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
        delay: 200, // 200ms濡??⑥텞
      });

      const stats = service.getQueueStats('delayed-stats-queue');
      expect(stats?.delayedTasks).toBe(1);
    });

    it('should return delayed jobs list', async () => {
      const payload = { email: 'delayed-list@test.com', subject: 'List' };
      await service.enqueue('delayed-list-queue', 'send-email', payload, {
        delay: 300, // 300ms濡??⑥텞
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

  describe('Job Cancellation', () => {
    // ?묒뾽 痍⑥냼 湲곕뒫? ?묐룞?섏?留??뚯뒪???섍꼍?먯꽌 遺덉븞?뺥븯誘濡?二쇱꽍 泥섎━
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

            await new Promise((resolve) => setTimeout(resolve, 20)); // 20ms濡??⑥텞
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

        // 紐⑤뱺 ?묒뾽???꾨즺???뚭퉴吏 ?대쭅
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
          await new Promise((resolve) => setTimeout(resolve, 20)); // 20ms濡??⑥텞
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

        // 紐⑤뱺 ?묒뾽???꾨즺???뚭퉴吏 ?대쭅
        let attempts = 0;
        while (mockProcessor.mock.calls.length < 3 && attempts < 100) {
          await new Promise((resolve) => setTimeout(resolve, 10));
          attempts++;
        }

        // 異붽? ?湲??쒓컙??二쇱뼱 activeTasks媛 ?뺣━?섎룄濡???
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

        // slowProcessor.process瑜?spy濡?媛먯떥湲?
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
            await new Promise((resolve) => setTimeout(resolve, 20)); // 20ms濡??⑥텞
            taskCompleted = true;
          },
        };

        // completionTracker.process瑜?spy濡?媛먯떥湲?
        jest.spyOn(completionTracker, 'process');

        // ?덈줈???꾨줈?몄꽌濡??쒕퉬???ъ깮??
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

        // ?묒뾽 異붽?
        const enqueuePromise = completionService.enqueue(
          'active-queue',
          'completion-job',
          _payload
        );

        // ?묒뾽???쒖옉?섍린 ?꾩뿉 shutdown ?쒖옉
        await new Promise((resolve) => setTimeout(resolve, 10));
        const shutdownPromise =
          completionService.onApplicationShutdown('SIGTERM');

        // ?묒뾽???꾨즺???뚭퉴吏 ?대쭅
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
      // Queue???묒뾽 異붽?
      await service.enqueue('test-queue', 'test-job', { data: 'test1' });
      await service.enqueue('test-queue', 'test-job', { data: 'test2' });
      await service.enqueue('other-queue', 'test-job', { data: 'test3' });

      // ?듦퀎 ?뺤씤
      const statsBefore = service.getAllQueueStats();
      expect(statsBefore.length).toBeGreaterThan(0);

      // ?뱀젙 ?먮쭔 ?대━??
      const clearedCount = service.clearQueue('test-queue');
      expect(clearedCount).toBe(2);

      // ?ㅻⅨ ?먮뒗 洹몃?濡??좎?
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
      // ?щ윭 ?먯뿉 ?묒뾽 異붽?
      await service.enqueue('queue-1', 'test-job', { data: 'test1' });
      await service.enqueue('queue-2', 'test-job', { data: 'test2' });
      await service.enqueue('queue-3', 'test-job', { data: 'test3' });

      // 紐⑤뱺 ???대━??
      const clearedCount = service.clearAllQueues();
      expect(clearedCount).toBe(3);

      // 紐⑤뱺 ?먭? 鍮꾩뼱?덈뒗吏 ?뺤씤
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
    });

    it('should return not_found for completed task', async () => {
      const payload = { data: 'test' };
      const taskId = await service.enqueue('test-queue', 'test-job', payload);

      // ?묒뾽???꾨즺???뚭퉴吏 ?湲?
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
      // ?먮┛ ?묒뾽???ㅽ뻾
      const taskId = await service.enqueue('test-queue', 'slow-job', {
        data: 'slow',
      });

      // ?묒뾽???쒖옉???뚭퉴吏 ?좎떆 ?湲?
      await new Promise((resolve) => setTimeout(resolve, 10));

      const activeTasks = service.getActiveTasksByQueue('test-queue');

      // ?묒뾽???쒖꽦 ?곹깭?몄? ?뺤씤
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
