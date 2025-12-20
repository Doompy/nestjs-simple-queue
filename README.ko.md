# NestJS Simple Queue (한국어)

[![npm version](https://badge.fury.io/js/nestjs-simple-queue.svg)](https://badge.fury.io/js/nestjs-simple-queue)
[![npm downloads](https://img.shields.io/npm/dm/nestjs-simple-queue.svg)](https://www.npmjs.com/package/nestjs-simple-queue)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![CI/CD Status](https://github.com/Doompy/nestjs-simple-queue/workflows/CI%2FCD%20Pipeline/badge.svg)](https://github.com/Doompy/nestjs-simple-queue/actions)

NestJS Simple Queue는 NestJS 서비스 내부에서 사용할 수 있는 가볍고 간단한 인메모리 큐입니다. 재시도, 우선순위, 지연 실행 같은 핵심 기능에 집중하면서 API를 작고 쉽게 유지합니다.

## 주요 기능

- `@QueueJob` 기반의 선언적 프로세서 등록
- 재시도, 우선순위, 지연 실행
- 재시도 백오프 및 작업 타임아웃
- 설정 가능한 동시성 및 안전한 종료 처리
- 작업 라이프사이클 이벤트 훅 (시작, 성공, 실패, 취소)
- 선택적 상태 저장(재시작 시 복원)

---

## 언제 쓰면 좋나요?

**nestjs-simple-queue가 잘 맞는 경우**

- 단일 NestJS 서비스 내부에서 백그라운드 작업이 필요할 때
- Redis 없이 재시도/지연/우선순위를 구현하고 싶을 때
- 종료/재시작 시 동작이 예측 가능해야 할 때
- 큐 로직을 도메인 코드 가까이에 두고 싶을 때

**Bull/BullMQ가 더 나은 경우**

- 여러 프로세스/머신에 분산 워커가 필요할 때
- 수평 확장이 필수일 때
- 대시보드/고급 모니터링이 필요할 때
- Redis 기반의 강한 내구성이 필요할 때

---

## 비교 (Bull/BullMQ)

| Feature | nestjs-simple-queue | Bull / BullMQ |
|------|---------------------|---------------|
| 외부 의존성 | 없음 | Redis |
| 영속성 | 선택적(파일 기반) | Redis |
| 분산 워커 | ❌ | ✅ |
| 셋업 난이도 | 매우 낮음 | 중간 |
| 최적 사용처 | 서비스 내부 작업 | 대규모 작업 시스템 |

---

## 요구 사항

- Node.js 20+ (NestJS 8~11에서 테스트)
- `@nestjs/common`, `@nestjs/event-emitter` (peer deps)

## 설치

```bash
npm install nestjs-simple-queue
```

## 빠른 시작

### 1) 프로세서 정의

```typescript
import { Injectable } from '@nestjs/common';
import { QueueJob } from 'nestjs-simple-queue';

@Injectable()
export class EmailProcessor {
  constructor(private readonly emailService: EmailService) {}

  @QueueJob('send-welcome-email')
  async sendWelcomeEmail(payload: { email: string; name: string }) {
    await this.emailService.send(payload.email, `Welcome ${payload.name}!`, 'Thanks for joining.');
  }

  @QueueJob('send-reset-email')
  async sendResetEmail(payload: { email: string; token: string }) {
    await this.emailService.send(payload.email, 'Password reset', `Your token: ${payload.token}`);
  }
}
```

### 2) 모듈 등록

```typescript
import { Module } from '@nestjs/common';
import { QueueModule } from 'nestjs-simple-queue';
import { EmailProcessor } from './processors/email.processor';

@Module({
  imports: [
    QueueModule.forRoot({ concurrency: 5 }),
    QueueModule.forProcessors([EmailProcessor]),
  ],
})
export class AppModule {}
```

### 3) 작업 enqueue

```typescript
import { Injectable } from '@nestjs/common';
import { QueueService, TaskPriority } from 'nestjs-simple-queue';

@Injectable()
export class TaskService {
  constructor(private readonly queueService: QueueService) {}

  async sendWelcome(email: string, name: string) {
    await this.queueService.enqueue(
      'email-queue',
      'send-welcome-email',
      { email, name },
      { retries: 2, priority: TaskPriority.HIGH }
    );
  }

  async remindInAnHour(email: string) {
    return this.queueService.enqueue(
      'email-queue',
      'send-reset-email',
      { email, token: 'generated-token' },
      { delay: 60 * 60 * 1000 }
    );
  }

  async sendWithBackoff(email: string) {
    return this.queueService.enqueue(
      'email-queue',
      'send-welcome-email',
      { email, name: 'Backoff User' },
      {
        retries: 3,
        backoff: { type: 'exponential', delay: 500, maxDelay: 10_000 },
        timeoutMs: 5_000,
      }
    );
  }
}
```

## 유용한 패턴

### 동적 프로세서

```typescript
@Injectable()
export class DynamicTasks implements OnModuleInit {
  constructor(private readonly queueService: QueueService) {}

  onModuleInit() {
    this.queueService.registerProcessor('ad-hoc', async (payload) => {
      await doSomething(payload);
    });
  }
}
```

### 지연 및 취소

```typescript
const taskId = await queueService.enqueue('email-queue', 'send-welcome-email', data, { delay: 5000 });
queueService.cancelTask('email-queue', taskId);
```

### 영속성 + 안전한 종료

```typescript
QueueModule.forRoot({
  enablePersistence: true,
  persistencePath: './queue-state.json',
  gracefulShutdownTimeout: 30_000,
});
```

## 설정 참고

`QueueModule.forRoot` 옵션:

- `concurrency` (number) - 큐당 동시 처리 수 (기본값: 1)
- `gracefulShutdownTimeout` (ms) - 종료 대기 시간 (기본값: 30_000)
- `enablePersistence` (boolean) - 상태 저장/복원 (기본값: false)
- `persistencePath` (string) - 상태 파일 경로 (기본값: `./queue-state.json`)
- `processors` (array) - 정적 프로세서 리스트
- `logger` - 커스텀 로거

## Enqueue 옵션

`queueService.enqueue` 옵션:

- `retries` (number) - 재시도 횟수 (기본값: 0)
- `backoff` (object) - 재시도 백오프: `{ type: 'fixed' | 'exponential', delay, maxDelay? }`
- `timeoutMs` (number) - 해당 시간 초과 시 실패 처리 (기본값: 비활성)
- `priority` (TaskPriority) - 우선순위 (기본값: `NORMAL`)
- `delay` (ms) - 지연 실행 시간 (기본값: 0)

## 운영 참고

- 기본은 인메모리 큐입니다.
- 재시작 후 작업 복원이 필요하면 영속성을 켜세요.
- I/O 중심 작업에 적합합니다.
- CPU를 오래 쓰는 작업은 피하세요.

## 개발

```bash
npm test -- --runInBand
```

## License

MIT
