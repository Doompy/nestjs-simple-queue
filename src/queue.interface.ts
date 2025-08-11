import { Logger } from "@nestjs/common";

/**
 * 라이브러리 사용자가 QueueModule.forRoot()를 통해 전달할 옵션
 */
export interface QueueModuleOptions {
  logger?: Logger;
  concurrency?: number;
}

/**
 * 큐 내부에서 작업을 관리하기 위한 인터페이스
 */
export interface Task<T> {
  payload: T;
  taskFunction: (payload: T) => Promise<void>;
  resolve: () => void;
  reject: (reason?: any) => void;
  retries: number;
}
