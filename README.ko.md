# NestJS Simple Queue (한국어)

[![npm version](https://badge.fury.io/js/nestjs-simple-queue.svg)](https://badge.fury.io/js/nestjs-simple-queue)
[![npm downloads](https://img.shields.io/npm/dm/nestjs-simple-queue.svg)](https://www.npmjs.com/package/nestjs-simple-queue)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![CI/CD Status](https://github.com/Doompy/nestjs-simple-queue/workflows/CI%2FCD%20Pipeline/badge.svg)](https://github.com/Doompy/nestjs-simple-queue/actions)

NestJS용 예측 가능한 인프로세스 작업 큐 — Redis 없이, 워커 없이, 놀랄 일 없이.

NestJS Simple Queue는 NestJS 서비스 내부에서 사용할 수 있는 가볍고 간단한 인메모리 큐입니다. 재시도, 우선순위, 지연 실행 같은 핵심 기능에 집중하면서 API를 작고 쉽게 유지합니다.

## 주요 기능

- `@QueueJob` 기반의 선언적 프로세서 등록
- 재시도, 우선순위, 지연 실행
- 재시도 백오프 및 작업 타임아웃
- 설정 가능한 동시성 및 안전한 종료 처리
- 작업 라이프사이클 이벤트 훅 (시작, 성공, 실패, 취소)
- JobId 기반 중복 제거 (`drop` / `replace`)
- 선택적 상태 저장(재시작 시 복원)
- 큐별 처리량 제한 (groupKey 지원)
- DLQ(실패 작업 보관 큐) 지원

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
- `limiter` (object) - 처리량 제한 설정 (아래 참고)
- `deadLetter` (object) - DLQ 설정 (아래 참고)
- `logger` - 커스텀 로거

## Enqueue 옵션

`queueService.enqueue` 옵션:

- `retries` (number) - 재시도 횟수 (기본값: 0)
- `backoff` (object) - 재시도 백오프: `{ type: 'fixed' | 'exponential', delay, maxDelay? }`
- `timeoutMs` (number) - 해당 시간 초과 시 실패 처리 (기본값: 비활성)
- `priority` (TaskPriority) - 우선순위 (기본값: `NORMAL`)
- `delay` (ms) - 지연 실행 시간 (기본값: 0)
- `jobId` (string) - 큐 범위 dedupe 키 (선택)
- `dedupe` (`drop` | `replace`) - `jobId` 중복 시 동작 (기본값: `drop`)

## JobId dedupe

`jobId`로 큐 내 pending/delayed 작업 중복을 제어할 수 있습니다:

```ts
const taskId = await queueService.enqueue('email-queue', 'send-reset-email', payload, {
  jobId: 'user:123:reset-password',
  dedupe: 'replace',
});
```

동작:

- dedupe는 **pending + delayed**에만 적용됩니다(실행 중 제외).
- `drop`: 기존 `taskId`를 반환하고 enqueue를 건너뜁니다.
- `replace`: 동일 `jobId`의 pending/delayed를 취소한 뒤 새 작업을 enqueue 합니다.
- 동일 `jobId`가 이미 실행 중이면 `drop`처럼 동작합니다.

jobId로 취소:

```ts
queueService.cancelByJobId('email-queue', 'user:123:reset-password');
```

## 처리 보장과 실패 동작

이 라이브러리는 **exactly-once**를 제공하지 않습니다. 재시도/타임아웃으로
중복 실행이 발생할 수 있고, 크래시 시 상태 저장이 되지 않으면 유실될 수 있습니다.

핵심 동작:

- 작업은 실행 시작 시점에 대기열에서 제거됩니다.
- 성공은 프로세서가 정상적으로 종료될 때 확정됩니다.
- 실패는 예외 발생 또는 타임아웃 시점에 확정됩니다.
- `cancelTask()`는 대기/지연 작업만 제거하며 실행 중인 작업은 중단되지 않습니다.
- 종료 시 상태 저장이 **먼저** 실행되고 그 다음 실행 중 작업을 기다리므로,
  저장 이후에 완료된 작업은 상태 파일에 반영되지 않습니다.

| 상황 | 동작 | 비고 |
|---|---|---|
| 성공 | 작업 완료 후 resolve | 프로세서 종료 후 성공 처리 |
| 프로세서 예외 | 재시도 있으면 재큐잉, 없으면 실패 | 재시도 시 중복 실행 가능 |
| 타임아웃 | 타임아웃 시점에 실패 처리 | 프로세서는 중단되지 않아 부수효과가 발생할 수 있음 |
| `cancelTask()` | 대기/지연 작업만 제거 | 실행 중 작업은 계속 실행됨 |
| persistence 재시작 | 대기/지연 작업만 복원 | 실행 중이던 작업은 복원되지 않음 |
| 크래시(SIGKILL/OOM) | 상태 저장 실패 가능 | 작업 유실 또는 부분 실행 가능 |

## 처리량 제한 (Rate limiting)

큐 단위 처리량 제한:

```typescript
QueueModule.forRoot({
  limiter: { max: 100, duration: 1000 }, // 초당 100개
});
```

그룹 기반 제한 (예: 사용자 단위):

```typescript
QueueModule.forRoot({
  limiter: { max: 10, duration: 1000, groupKey: 'userId' },
});
```

`groupKey`는 점 표기법(`user.id`)도 지원합니다.

처리량 제한 동작:

- 제한은 **enqueue**가 아니라 실행 시작 시점에 적용됩니다.
- `groupKey` 값이 없으면 큐 단위 제한으로 fallback 됩니다.
- 그룹 간 공정성 보장은 없으며, head-of-line blocking이 발생할 수 있습니다.

## DLQ (Dead Letter Queue)

재시도 소진 후 실패한 작업을 별도 큐로 이동합니다:

```typescript
QueueModule.forRoot({
  deadLetter: { queueName: 'dlq' },
});
```

기본 DLQ 작업 이름은 `<jobName>:deadletter`이며 해당 이름의 프로세서를 등록하세요:

```typescript
QueueModule.forRoot({
  deadLetter: { queueName: 'dlq' },
  processors: [
    {
      name: 'send-email:deadletter',
      process: async (payload) => {
        console.log(payload.originalPayload, payload.error);
      },
    },
  ],
});
```

원하면 DLQ job 이름을 지정할 수 있습니다:

```typescript
QueueModule.forRoot({
  deadLetter: { queueName: 'dlq', jobName: 'dlq-handler' },
});
```

## 운영 참고

- 기본은 인메모리 큐입니다.
- 재시작 후 작업 복원이 필요하면 영속성을 켜세요.
- 영속성은 종료 시 JSON 파일 1개를 저장합니다(파일 락/원자적 rename 없음).
- 저장 대상은 대기/지연 작업이며, 실행 중 작업은 포함되지 않습니다.
- I/O 중심 작업에 적합합니다.
- CPU를 오래 쓰는 작업은 피하세요.

## 파일 기반 persistence의 리스크와 권장 운영

파일 기반 persistence는 단순함을 우선합니다. 아래 한계를 고려하세요:

- **단일 인스턴스 전제.** 여러 프로세스/파드가 같은 `persistencePath`를 쓰면
  상태 파일 손상 또는 경합이 발생할 수 있습니다.
- **크래시 리스크.** 강제 종료 시 저장이 누락되어 작업이 유실될 수 있습니다.
- **I/O 비용.** 큐가 커질수록 파일 크기와 복구 시간이 증가합니다.

권장:

- 인스턴스별 로컬 디스크 경로를 사용하세요(공유 볼륨 금지).
- 디렉터리/파일 권한을 제한하세요.
- 멀티 인스턴스나 강한 내구성이 필요하면 Redis 기반 큐를 고려하세요.

## 개발

```bash
npm test -- --runInBand
```

## License

MIT
