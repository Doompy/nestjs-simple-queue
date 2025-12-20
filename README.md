# NestJS Simple Queue

[![npm version](https://badge.fury.io/js/nestjs-simple-queue.svg)](https://badge.fury.io/js/nestjs-simple-queue)
[![npm downloads](https://img.shields.io/npm/dm/nestjs-simple-queue.svg)](https://www.npmjs.com/package/nestjs-simple-queue)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![CI/CD Status](https://github.com/Doompy/nestjs-simple-queue/workflows/CI%2FCD%20Pipeline/badge.svg)](https://github.com/Doompy/nestjs-simple-queue/actions)

NestJS Simple Queue is a lightweight, in-memory task queue for NestJS services. It focuses on predictable job handling (retries, priorities, delays) while keeping the API small and easy to learn. You can start with a couple of processors and grow to multiple queues without changing your application structure.

## Features

- Declarative processor registration with `@QueueJob`
- Optional persistence to survive restarts
- Delayed jobs, cancellation, and priority ordering
- Retry backoff and per-task timeouts
- Configurable concurrency with graceful shutdown handling
- Event hooks for task lifecycle events (start, success, failure, cancellation)

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

- Node.js 16+ (tested with NestJS 8–11)
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
- `logger` - optional custom logger implementation

## Enqueue options

`queueService.enqueue` accepts these per-task options:

- `retries` (number) - number of retry attempts (default: 0)
- `backoff` (object) - retry backoff config: `{ type: 'fixed' | 'exponential', delay, maxDelay? }`
- `timeoutMs` (number) - fail the task if it runs longer than this (default: disabled)
- `priority` (TaskPriority) - priority ordering (default: `NORMAL`)
- `delay` (ms) - schedule the task after a delay (default: 0)

## Production notes

- Jobs are kept in memory by default.
- Enable persistence if jobs must survive restarts.
- Designed for I/O-bound background tasks.
- Avoid long-running CPU-bound jobs.

## Development

Run the test suite locally:

```bash
npm test -- --runInBand
```

## License

MIT