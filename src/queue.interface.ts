import { Logger } from '@nestjs/common';

/**
 * 라이브러리 사용자가 QueueModule.forRoot()를 통해 전달할 옵션
 */
export interface QueueModuleOptions {
  logger?: Logger;
  concurrency?: number;
}

/**
 * 작업 우선순위 레벨
 */
export enum TaskPriority {
  LOW = 1,
  NORMAL = 5,
  HIGH = 8,
  URGENT = 10,
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
  priority: TaskPriority; // 우선순위 추가
}
