# NestJS Simple Queue

[![npm version](https://badge.fury.io/js/nestjs-simple-queue.svg)](https://badge.fury.io/js/nestjs-simple-queue)
[![npm downloads](https://img.shields.io/npm/dm/nestjs-simple-queue.svg)](https://www.npmjs.com/package/nestjs-simple-queue)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![CI/CD Status](https://github.com/Doompy/nestjs-simple-queue/workflows/CI%2FCD%20Pipeline/badge.svg)](https://github.com/Doompy/nestjs-simple-queue/actions)

A predictable, in-process job queue for NestJS — no Redis, no workers, no surprises.

NestJS Simple Queue is a lightweight, in-memory task queue for NestJS services. It focuses on predictable job handling (retries, priorities, delays) while keeping the API small and easy to learn. You can start with a couple of processors and grow to multiple queues without changing your application structure.

## Features

- Declarative processor registration with `@QueueJob`
- Optional persistence to survive restarts
- Delayed jobs, cancellation, and priority ordering
- Retry backoff and per-task timeouts
- Configurable concurrency with graceful shutdown handling
- Event hooks for task lifecycle events (start, success, failure, cancellation)
- JobId-based dedupe (`drop` / `replace`)
- Per-queue rate limiting with optional group keys
- Dead letter queue (DLQ) for failed tasks

---

## When should I use this?

**nestjs-simple-queue is a good fit if:**

- You need background jobs inside a single NestJS service
- You want retries, delays, and priorities **without introducing Redis**
- You want predictable behavior during shutdowns and restarts
- You prefer keeping queue logic close to your domain code
- You want minimal setup and low operational overhead

**You may want Bull/BullMQ instead if:**

- You need distributed workers across multiple processes or machines
- You require horizontal scaling
- You need a web-based dashboard or advanced monitoring
- Your queue must survive process crashes without file-based persistence

---

## Comparison with Bull/BullMQ

| Feature | nestjs-simple-queue | Bull / BullMQ |
|------|---------------------|---------------|
| External dependency | None | Redis |
| Persistence | Optional (file-based) | Redis |
| Distributed workers | ❌ | ✅ |
| Setup complexity | Very low | Medium |
| Best use case | In-service background jobs | Large-scale job systems |

---

## Requirements

- Node.js 20+ (tested with NestJS 8–11)
- `@nestjs/common` and `@nestjs/event-emitter` as peer dependencies

## Installation

```bash
npm install nestjs-simple-queue
```

## Quick start

### 1) Define a processor

The decorator-based approach keeps your queue logic close to the business code:

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

### 2) Register processors in a module

Add the queue module once, then register processor classes. The module handles dependency injection for you.

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

### 3) Enqueue work

Inject `QueueService` and send tasks with optional priority, retries, or delay settings.

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

## Useful patterns

### Dynamic processors

Register processors at runtime if you need jobs that are discovered or configured on the fly:

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

### Delays and cancellation

```typescript
const taskId = await queueService.enqueue('email-queue', 'send-welcome-email', data, { delay: 5000 });
queueService.cancelTask('email-queue', taskId);
```

### Persistence and graceful shutdown

```typescript
QueueModule.forRoot({
  enablePersistence: true,
  persistencePath: './queue-state.json',
  gracefulShutdownTimeout: 30_000,
});
```

## Configuration reference

`QueueModule.forRoot` accepts these common options:

- `concurrency` (number) - concurrent tasks per queue (default: 1)
- `gracefulShutdownTimeout` (ms) - how long to wait before forcing shutdown (default: 30_000)
- `enablePersistence` (boolean) - save/restore queue state on shutdown/startup (default: false)
- `persistencePath` (string) - where to write the state file (default: `./queue-state.json`)
- `processors` (array) - static processor list if you prefer manual registration
- `limiter` (object) - rate limit configuration (see below)
- `deadLetter` (object) - dead letter queue configuration (see below)
- `logger` - optional custom logger implementation

## Enqueue options

`queueService.enqueue` accepts these per-task options:

- `retries` (number) - number of retry attempts (default: 0)
- `backoff` (object) - retry backoff config: `{ type: 'fixed' | 'exponential', delay, maxDelay? }`
- `timeoutMs` (number) - fail the task if it runs longer than this (default: disabled)
- `priority` (TaskPriority) - priority ordering (default: `NORMAL`)
- `delay` (ms) - schedule the task after a delay (default: 0)
- `jobId` (string) - dedupe key scoped to the queue (optional)
- `dedupe` (`drop` | `replace`) - dedupe behavior when `jobId` matches (default: `drop`)

## JobId dedupe

Use `jobId` to dedupe pending/delayed tasks within a queue:

```ts
const taskId = await queueService.enqueue('email-queue', 'send-reset-email', payload, {
  jobId: 'user:123:reset-password',
  dedupe: 'replace',
});
```

Behavior:

- Dedupe applies to **pending + delayed** tasks only (not running).
- `drop`: return the existing `taskId` and skip enqueue.
- `replace`: cancel pending/delayed tasks with the same `jobId`, then enqueue a new one.
- If a task with the same `jobId` is already running, enqueue behaves like `drop`.

To cancel by jobId:

```ts
queueService.cancelByJobId('email-queue', 'user:123:reset-password');
```

## Delivery semantics and failure behavior

This library does **not** provide exactly-once delivery. Tasks can run more
than once (retries/timeouts), and tasks can be lost if the process crashes
before state is persisted.

Key behaviors:

- A task leaves the pending queue when execution starts.
- Success is acknowledged when the processor resolves.
- Failure is acknowledged when the processor throws or a timeout fires.
- `cancelTask()` removes pending or delayed tasks only; it does not interrupt running tasks.
- During shutdown, state is saved **before** waiting for running tasks to finish, so
  completions that happen after the save are not reflected in the persisted file.

| Scenario | Behavior | Notes |
|---|---|---|
| Success | Task completes and resolves | Acknowledged after processor resolves |
| Processor throws | Retries if configured; otherwise fails | Possible duplicate execution if retries occur |
| Timeout | Task fails when timeout fires | Processor is **not** aborted; it may still run and side effects can happen |
| `cancelTask()` | Removes pending or delayed tasks only | Running tasks continue; timeout still applies |
| Restart with persistence | Pending/delayed tasks are restored | Running tasks are **not** restored |
| Crash (SIGKILL/OOM) | State may not be saved | Tasks can be lost or partially executed |

## Rate limiting

Limit throughput per queue (BullMQ style):

```typescript
QueueModule.forRoot({
  limiter: { max: 100, duration: 1000 }, // 100 jobs per second
});
```

Group-based limits (e.g. per user):

```typescript
QueueModule.forRoot({
  limiter: { max: 10, duration: 1000, groupKey: 'userId' },
});
```

`groupKey` supports dot-notation paths (e.g. `user.id`).

Rate limiting details:

- Limits are applied when **starting** a task, not at enqueue time.
- When `groupKey` is set, a missing or empty value falls back to the queue-level limiter.
- Fairness across groups is **not** guaranteed; head-of-line blocking can happen.

## Dead letter queue (DLQ)

Move failed tasks to a separate queue after retries are exhausted:

```typescript
QueueModule.forRoot({
  deadLetter: { queueName: 'dlq' },
});
```

By default, the DLQ job name becomes `<jobName>:deadletter`. Register a
processor for that name:

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

If you prefer a custom DLQ job name:

```typescript
QueueModule.forRoot({
  deadLetter: { queueName: 'dlq', jobName: 'dlq-handler' },
});
```

## Production notes

- Jobs are kept in memory by default.
- Enable persistence if jobs must survive restarts.
- Persistence writes a single JSON file on shutdown (no file locking or atomic rename).
- Pending and delayed tasks are persisted; running tasks are not.
- Designed for I/O-bound background tasks.
- Avoid long-running CPU-bound jobs.

## Persistence risks and recommended setup

File-based persistence is intentionally simple. Keep these limitations in mind:

- **Single instance only.** Multiple processes/pods pointing to the same `persistencePath`
  can corrupt the state file or race on writes.
- **Crash risks.** A hard crash can skip the shutdown save, losing queued tasks.
- **I/O cost.** Large queues make the state file large, increasing write and startup time.

Recommended:

- Use a local disk path per instance (do not share across pods).
- Ensure the process can write to the directory and file permissions are locked down.
- If you need multi-instance or strong durability, use a Redis-backed queue instead.

## Development

Run the test suite locally:

```bash
npm test -- --runInBand
```

## License

MIT
