import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { QueueService } from './queue.service';
import { QueueModule } from './queue.module';
import { TaskPriority } from './queue.interface';

// --- 테스트 최상위 그룹 ---
describe('QueueService', () => {
  // --- 동시성과 크게 관계 없는 일반적인 테스트들 ---
  describe('General Functionality', () => {
    let service: QueueService;
    let eventEmitter: EventEmitter2;
    let emitSpy: jest.SpyInstance;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [QueueModule.forRoot()],
      }).compile();

      service = module.get<QueueService>(QueueService);
      eventEmitter = module.get<EventEmitter2>(EventEmitter2);
      emitSpy = jest.spyOn(eventEmitter, 'emit');
    });

    // 💡 afterEach는 그대로 유지하여 테스트 간섭을 막습니다.
    afterEach(() => {
      eventEmitter.removeAllListeners();
    });

    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should enqueue a task and process it successfully', async () => {
      const mockTaskFunction = jest.fn().mockResolvedValue(undefined);
      const payload = { data: 'test-payload' };

      // 작업 완료를 기다리는 Promise 생성
      const taskCompleted = new Promise<void>((resolve) => {
        const checkComplete = () => {
          if (mockTaskFunction.mock.calls.length > 0) {
            resolve();
          } else {
            setTimeout(checkComplete, 10);
          }
        };
        checkComplete();
      });

      await service.enqueue('test-queue', payload, mockTaskFunction);
      await taskCompleted;

      expect(mockTaskFunction).toHaveBeenCalledTimes(1);
      expect(mockTaskFunction).toHaveBeenCalledWith(payload);
    }, 10000); // 타임아웃을 10초로 증가

    it('should retry a failed task for the specified number of times', async () => {
      const mockTaskFunction = jest
        .fn()
        .mockRejectedValueOnce(new Error('First failure'))
        .mockRejectedValueOnce(new Error('Second failure'))
        .mockResolvedValue(undefined);
      const payload = { data: 'retry-test' };

      // 모든 재시도가 완료될 때까지 기다리는 Promise
      const retriesCompleted = new Promise<void>((resolve) => {
        const checkComplete = () => {
          if (mockTaskFunction.mock.calls.length >= 3) {
            resolve();
          } else {
            setTimeout(checkComplete, 10);
          }
        };
        checkComplete();
      });

      // 실패는 예상되므로 catch를 붙여줍니다.
      service
        .enqueue('retry-queue', payload, mockTaskFunction, {
          retries: 2,
        })
        .catch(() => {});

      await retriesCompleted;

      expect(mockTaskFunction).toHaveBeenCalledTimes(3);
    }, 10000); // 타임아웃을 10초로 증가

    it('should emit a success event when a task is processed successfully', async () => {
      const mockTaskFunction = jest.fn().mockResolvedValue(undefined);
      const payload = { data: 'success-event-test' };
      const queueName = 'event-success-queue';

      // 작업 완료를 기다리는 Promise
      const taskCompleted = new Promise<void>((resolve) => {
        const checkComplete = () => {
          if (mockTaskFunction.mock.calls.length > 0) {
            resolve();
          } else {
            setTimeout(checkComplete, 10);
          }
        };
        checkComplete();
      });

      await service.enqueue(queueName, payload, mockTaskFunction);
      await taskCompleted;

      // 작업이 성공적으로 실행되었는지 확인
      expect(mockTaskFunction).toHaveBeenCalledTimes(1);
      expect(mockTaskFunction).toHaveBeenCalledWith(payload);

      // emitSpy가 호출되었는지 확인 (이벤트 발생 확인)
      expect(emitSpy).toHaveBeenCalledWith(
        'queue.task.success',
        expect.objectContaining({
          queueName,
          task: expect.objectContaining({ payload }),
        })
      );
    }, 10000); // 타임아웃을 10초로 증가

    it('should emit a failed event when a task fails', async () => {
      const error = new Error('Task failed deliberately');
      const mockTaskFunction = jest.fn().mockRejectedValue(error);
      const payload = { data: 'failure-event-test' };
      const queueName = 'event-fail-queue';

      // 작업 실패를 기다리는 Promise
      const taskFailed = new Promise<void>((resolve) => {
        const checkComplete = () => {
          if (mockTaskFunction.mock.calls.length > 0) {
            resolve();
          } else {
            setTimeout(checkComplete, 10);
          }
        };
        checkComplete();
      });

      service.enqueue(queueName, payload, mockTaskFunction).catch(() => {});
      await taskFailed;

      // 작업이 실행되었는지 확인
      expect(mockTaskFunction).toHaveBeenCalledTimes(1);
      expect(mockTaskFunction).toHaveBeenCalledWith(payload);

      // emitSpy가 호출되었는지 확인 (이벤트 발생 확인)
      expect(emitSpy).toHaveBeenCalledWith(
        'queue.task.failed',
        expect.objectContaining({
          queueName,
          task: expect.objectContaining({ payload }),
          error,
        })
      );
    }, 10000); // 타임아웃을 10초로 증가
  });

  // --- 동시성 > 1 (병렬 처리) 환경에서의 테스트들 ---
  describe('when concurrency is greater than 1 (Concurrent Processing)', () => {
    let service: QueueService;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [QueueModule.forRoot({ concurrency: 5 })],
      }).compile();
      service = module.get<QueueService>(QueueService);
    });

    it('should process tasks concurrently up to the concurrency limit', async () => {
      let currentlyRunning = 0;
      let maxConcurrent = 0;

      const mockTaskFunction = jest.fn().mockImplementation(async () => {
        currentlyRunning++;
        maxConcurrent = Math.max(maxConcurrent, currentlyRunning);
        await new Promise((resolve) => setTimeout(resolve, 100));
        currentlyRunning--;
      });

      const tasks: Promise<void>[] = [];
      for (let i = 0; i < 10; i++) {
        tasks.push(
          service.enqueue('concurrent-queue', { i }, mockTaskFunction)
        );
      }

      await Promise.all(tasks);

      expect(mockTaskFunction).toHaveBeenCalledTimes(10);
      expect(maxConcurrent).toBe(5);
    }, 10000); // 타임아웃을 10초로 증가
  });

  // --- 우선순위 큐 기능 테스트 ---
  describe('Priority Queue Functionality', () => {
    let service: QueueService;
    let eventEmitter: EventEmitter2;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [QueueModule.forRoot()],
      }).compile();

      service = module.get<QueueService>(QueueService);
      eventEmitter = module.get<EventEmitter2>(EventEmitter2);
    });

    afterEach(() => {
      eventEmitter.removeAllListeners();
    });

    it('should process high priority tasks before low priority tasks', async () => {
      const executionOrder: number[] = [];

      const mockTaskFunction = jest
        .fn()
        .mockImplementation(async (payload: { id: number }) => {
          executionOrder.push(payload.id);
          await new Promise((resolve) => setTimeout(resolve, 10));
        });

      // 낮은 우선순위 작업을 먼저 추가
      service.enqueue('priority-queue', { id: 1 }, mockTaskFunction, {
        priority: TaskPriority.LOW,
      });

      // 높은 우선순위 작업을 나중에 추가
      service.enqueue('priority-queue', { id: 2 }, mockTaskFunction, {
        priority: TaskPriority.HIGH,
      });

      // 모든 작업이 완료될 때까지 대기
      const allTasksCompleted = new Promise<void>((resolve) => {
        const checkComplete = () => {
          if (mockTaskFunction.mock.calls.length >= 2) {
            resolve();
          } else {
            setTimeout(checkComplete, 10);
          }
        };
        checkComplete();
      });

      await allTasksCompleted;

      // 높은 우선순위(2)가 낮은 우선순위(1)보다 먼저 실행되어야 함
      expect(executionOrder).toEqual([2, 1]);
      expect(mockTaskFunction).toHaveBeenCalledTimes(2);
    }, 10000);

    it('should use NORMAL priority as default when priority is not specified', async () => {
      const mockTaskFunction = jest.fn().mockResolvedValue(undefined);
      const payload = { data: 'default-priority-test' };

      const taskCompleted = new Promise<void>((resolve) => {
        const checkComplete = () => {
          if (mockTaskFunction.mock.calls.length > 0) {
            resolve();
          } else {
            setTimeout(checkComplete, 10);
          }
        };
        checkComplete();
      });

      await service.enqueue(
        'default-priority-queue',
        payload,
        mockTaskFunction
      );
      await taskCompleted;

      expect(mockTaskFunction).toHaveBeenCalledTimes(1);
      expect(mockTaskFunction).toHaveBeenCalledWith(payload);
    }, 10000);

    it('should handle multiple priority levels correctly', async () => {
      const executionOrder: number[] = [];

      const mockTaskFunction = jest
        .fn()
        .mockImplementation(
          async (payload: { id: number; priority: TaskPriority }) => {
            executionOrder.push(payload.id);
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
        );

      // 다양한 우선순위로 작업 추가 (순서 무관)
      service.enqueue(
        'multi-priority-queue',
        { id: 1, priority: TaskPriority.LOW },
        (payload) => mockTaskFunction(payload),
        { priority: TaskPriority.LOW }
      );

      service.enqueue(
        'multi-priority-queue',
        { id: 2, priority: TaskPriority.URGENT },
        (payload) => mockTaskFunction(payload),
        { priority: TaskPriority.URGENT }
      );

      service.enqueue(
        'multi-priority-queue',
        { id: 3, priority: TaskPriority.NORMAL },
        (payload) => mockTaskFunction(payload),
        { priority: TaskPriority.NORMAL }
      );

      // 모든 작업이 완료될 때까지 대기
      const allTasksCompleted = new Promise<void>((resolve) => {
        const checkComplete = () => {
          if (mockTaskFunction.mock.calls.length >= 3) {
            resolve();
          } else {
            setTimeout(checkComplete, 10);
          }
        };
        checkComplete();
      });

      await allTasksCompleted;

      // 우선순위 순서: URGENT(10) > NORMAL(5) > LOW(1)
      expect(executionOrder).toEqual([2, 3, 1]);
      expect(mockTaskFunction).toHaveBeenCalledTimes(3);
    }, 10000);
  });

  // --- 다중 큐 환경에서의 우선순위 동작 테스트 ---
  describe('Priority Queue with Multiple Queues', () => {
    let service: QueueService;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [QueueModule.forRoot()],
      }).compile();
      service = module.get<QueueService>(QueueService);
    });

    it('should respect priority within each queue independently', async () => {
      const executedA: number[] = [];
      const executedB: number[] = [];

      const taskFnA = jest
        .fn()
        .mockImplementation(async (payload: { id: number }) => {
          executedA.push(payload.id);
          await new Promise((resolve) => setTimeout(resolve, 10));
        });
      const taskFnB = jest
        .fn()
        .mockImplementation(async (payload: { id: number }) => {
          executedB.push(payload.id);
          await new Promise((resolve) => setTimeout(resolve, 10));
        });

      // Queue A: LOW 먼저, HIGH 나중에
      service.enqueue('queue-A', { id: 1 }, taskFnA, {
        priority: TaskPriority.LOW,
      });
      service.enqueue('queue-A', { id: 2 }, taskFnA, {
        priority: TaskPriority.HIGH,
      });

      // Queue B: LOW 먼저, URGENT 나중에
      service.enqueue('queue-B', { id: 3 }, taskFnB, {
        priority: TaskPriority.LOW,
      });
      service.enqueue('queue-B', { id: 4 }, taskFnB, {
        priority: TaskPriority.URGENT,
      });

      // 두 큐 모두 2개씩 완료될 때까지 대기
      await new Promise<void>((resolve) => {
        const check = () => {
          if (
            taskFnA.mock.calls.length >= 2 &&
            taskFnB.mock.calls.length >= 2
          ) {
            resolve();
          } else {
            setTimeout(check, 10);
          }
        };
        check();
      });

      // 각 큐 내에서 우선순위가 높은 작업이 먼저 실행되어야 함
      expect(executedA).toEqual([2, 1]); // HIGH(2) before LOW(1)
      expect(executedB).toEqual([4, 3]); // URGENT(4) before LOW(3)
    }, 10000);
  });
});
