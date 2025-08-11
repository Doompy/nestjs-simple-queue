import { Test, TestingModule } from "@nestjs/testing";
import { EventEmitter2, EventEmitterModule } from "@nestjs/event-emitter";
import { QueueService } from "./queue.service";
import { QueueModule } from "./queue.module";

// --- 테스트 최상위 그룹 ---
describe("QueueService", () => {
  // --- 동시성과 크게 관계 없는 일반적인 테스트들 ---
  describe("General Functionality", () => {
    let service: QueueService;
    let eventEmitter: EventEmitter2;
    let emitSpy: jest.SpyInstance;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [QueueModule.forRoot()],
      }).compile();

      service = module.get<QueueService>(QueueService);
      eventEmitter = module.get<EventEmitter2>(EventEmitter2);
      emitSpy = jest.spyOn(eventEmitter, "emit");
    });

    // 💡 afterEach는 그대로 유지하여 테스트 간섭을 막습니다.
    afterEach(() => {
      eventEmitter.removeAllListeners();
    });

    it("should be defined", () => {
      expect(service).toBeDefined();
    });

    it("should enqueue a task and process it successfully", async () => {
      const mockTaskFunction = jest.fn().mockResolvedValue(undefined);
      const payload = { data: "test-payload" };

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

      await service.enqueue("test-queue", payload, mockTaskFunction);
      await taskCompleted;

      expect(mockTaskFunction).toHaveBeenCalledTimes(1);
      expect(mockTaskFunction).toHaveBeenCalledWith(payload);
    }, 10000); // 타임아웃을 10초로 증가

    it("should retry a failed task for the specified number of times", async () => {
      const mockTaskFunction = jest
        .fn()
        .mockRejectedValueOnce(new Error("First failure"))
        .mockRejectedValueOnce(new Error("Second failure"))
        .mockResolvedValue(undefined);
      const payload = { data: "retry-test" };

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
        .enqueue("retry-queue", payload, mockTaskFunction, {
          retries: 2,
        })
        .catch(() => {});

      await retriesCompleted;

      expect(mockTaskFunction).toHaveBeenCalledTimes(3);
    }, 10000); // 타임아웃을 10초로 증가

    it("should emit a success event when a task is processed successfully", async () => {
      const mockTaskFunction = jest.fn().mockResolvedValue(undefined);
      const payload = { data: "success-event-test" };
      const queueName = "event-success-queue";

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
        "queue.task.success",
        expect.objectContaining({
          queueName,
          task: expect.objectContaining({ payload }),
        })
      );
    }, 10000); // 타임아웃을 10초로 증가

    it("should emit a failed event when a task fails", async () => {
      const error = new Error("Task failed deliberately");
      const mockTaskFunction = jest.fn().mockRejectedValue(error);
      const payload = { data: "failure-event-test" };
      const queueName = "event-fail-queue";

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
        "queue.task.failed",
        expect.objectContaining({
          queueName,
          task: expect.objectContaining({ payload }),
          error,
        })
      );
    }, 10000); // 타임아웃을 10초로 증가
  });

  // --- 동시성 > 1 (병렬 처리) 환경에서의 테스트들 ---
  describe("when concurrency is greater than 1 (Concurrent Processing)", () => {
    let service: QueueService;

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        imports: [QueueModule.forRoot({ concurrency: 5 })],
      }).compile();
      service = module.get<QueueService>(QueueService);
    });

    it("should process tasks concurrently up to the concurrency limit", async () => {
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
          service.enqueue("concurrent-queue", { i }, mockTaskFunction)
        );
      }

      await Promise.all(tasks);

      expect(mockTaskFunction).toHaveBeenCalledTimes(10);
      expect(maxConcurrent).toBe(5);
    }, 10000); // 타임아웃을 10초로 증가
  });
});
