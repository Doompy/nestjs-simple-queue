# NestJS Simple Queue

[![npm version](https://badge.fury.io/js/nestjs-simple-queue.svg)](https://badge.fury.io/js/nestjs-simple-queue)
[![npm downloads](https://img.shields.io/npm/dm/nestjs-simple-queue.svg)](https://www.npmjs.com/package/nestjs-simple-queue)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub stars](https://img.shields.io/github/stars/Doompy/nestjs-simple-queue.svg)](https://github.com/Doompy/nestjs-simple-queue)
[![GitHub issues](https://img.shields.io/github/issues/Doompy/nestjs-simple-queue.svg)](https://github.com/Doompy/nestjs-simple-queue/issues)
[![CI/CD Status](https://github.com/Doompy/nestjs-simple-queue/workflows/CI%2FCD%20Pipeline/badge.svg)](https://github.com/Doompy/nestjs-simple-queue/actions)

A simple, generic, in-memory task queue service for NestJS applications. This library provides a lightweight solution for handling asynchronous task processing with retry mechanisms, event emission, and configurable concurrency.

## Features

- 🚀 **Simple & Lightweight**: Easy to integrate and use
- 🔄 **Retry Mechanism**: Configurable retry attempts for failed tasks
- 📡 **Event-Driven**: Built-in event emission for task lifecycle
- ⚡ **Concurrent Processing**: Configurable concurrency limits
- 🔝 **Priority Queue**: Higher-priority tasks are processed first (LOW/NORMAL/HIGH/URGENT)
- 🎯 **TypeScript Support**: Full TypeScript support with type definitions
- 🧪 **Well Tested**: Comprehensive test coverage
- 🔧 **CI/CD Ready**: Automated testing and deployment pipeline

## Installation

```bash
npm install nestjs-simple-queue
```

## Quick Start

### 1. Import the Module

```typescript
import { Module } from '@nestjs/common';
import { QueueModule } from 'nestjs-simple-queue';

@Module({
  imports: [
    QueueModule.forRoot({
      concurrency: 5, // Optional: default is 1
    }),
  ],
})
export class AppModule {}
```

### 2. Use the Service

```typescript
import { Injectable } from '@nestjs/common';
import { QueueService } from 'nestjs-simple-queue';

@Injectable()
export class TaskService {
  constructor(private readonly queueService: QueueService) {}

  async processTask(data: any) {
    // Enqueue a task with retry options
    await this.queueService.enqueue(
      'my-queue',
      data,
      async (payload) => {
        // Your task logic here
        await this.performTask(payload);
      },
      { retries: 3 }
    );
  }
}
```

### 3. Listen to Events

```typescript
import { Injectable, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class EventListenerService implements OnModuleInit {
  constructor(private readonly eventEmitter: EventEmitter2) {}

  onModuleInit() {
    // Listen to task success events
    this.eventEmitter.on('queue.task.success', (event) => {
      console.log('Task succeeded:', event);
    });

    // Listen to task failure events
    this.eventEmitter.on('queue.task.failed', (event) => {
      console.log('Task failed:', event);
    });

    // Listen to queue empty events
    this.eventEmitter.on('queue.empty', (event) => {
      console.log('Queue is empty:', event);
    });
  }
}
```

## Configuration Options

```typescript
QueueModule.forRoot({
  concurrency: 5, // Number of concurrent tasks (default: 1)
  logger: customLogger, // Custom logger instance (optional)
});
```

## API Reference

### QueueService

#### `enqueue<T>(queueName: string, payload: T, taskFunction: (payload: T) => Promise<void>, options?: { retries?: number; priority?: TaskPriority }): Promise<void>`

Enqueues a new task for processing.

- `queueName`: Unique identifier for the queue
- `payload`: Data to be processed by the task
- `taskFunction`: Async function that processes the payload
- `options.retries`: Number of retry attempts for failed tasks (default: 0)
- `options.priority`: Task priority level. Higher priority tasks are processed first. (default: `TaskPriority.NORMAL`)

##### Priority Levels

```typescript
enum TaskPriority {
  LOW = 1,
  NORMAL = 5, // default
  HIGH = 8,
  URGENT = 10,
}
```

Note: Priority is applied within each queue independently. Multiple queues do not affect each other's priority ordering.

### Events

The service emits the following events:

- `queue.task.added`: When a task is added to the queue
- `queue.task.processing`: When a task starts processing
- `queue.task.success`: When a task completes successfully
- `queue.task.failed`: When a task fails
- `queue.empty`: When a queue becomes empty

## Examples

### Basic Usage

```typescript
// Simple task processing
await this.queueService.enqueue('email-queue', emailData, async (data) => {
  await this.emailService.send(data);
});
```

### With Retry Logic

```typescript
// Task with retry attempts
await this.queueService.enqueue(
  'api-queue',
  apiData,
  async (data) => {
    await this.externalApi.call(data);
  },
  { retries: 3 }
);
```

### With Priority (Priority Queue)

```typescript
// Higher-priority tasks are processed first
import { TaskPriority } from 'nestjs-simple-queue';

await this.queueService.enqueue(
  'priority-queue',
  { id: 123 },
  async (data) => {
    await this.processImportantWork(data);
  },
  { priority: TaskPriority.HIGH }
);

// If priority is omitted, NORMAL is the default
await this.queueService.enqueue(
  'priority-queue',
  { id: 456 },
  this.processWork
);
```

### Priority with Multiple Queues

```typescript
// Priorities are enforced per queue independently
import { TaskPriority } from 'nestjs-simple-queue';

// Queue A
await this.queueService.enqueue('queue-A', { id: 1 }, this.fnA, {
  priority: TaskPriority.LOW,
});
await this.queueService.enqueue('queue-A', { id: 2 }, this.fnA, {
  priority: TaskPriority.HIGH,
});

// Queue B
await this.queueService.enqueue('queue-B', { id: 3 }, this.fnB, {
  priority: TaskPriority.LOW,
});
await this.queueService.enqueue('queue-B', { id: 4 }, this.fnB, {
  priority: TaskPriority.URGENT,
});

// Result:
// queue-A executes id:2 before id:1
// queue-B executes id:4 before id:3
```

### Multiple Queues

```typescript
// Different queues for different types of tasks
await this.queueService.enqueue(
  'image-processing',
  imageData,
  this.processImage
);
await this.queueService.enqueue('data-sync', syncData, this.syncData);
```

## Testing

```bash
# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

## CI/CD

This project uses GitHub Actions for continuous integration and deployment:

### Automated Workflows

- **PR Check**: Runs on every pull request to ensure code quality
- **CI/CD Pipeline**: Runs on push to main/develop branches and tag creation
- **Security Audit**: Automated security vulnerability scanning
- **Auto-publish**: Automatic npm package publishing on version tags

### Workflow Triggers

- **Push to main/develop**: Runs tests, linting, and security checks
- **Pull Request**: Quick validation checks
- **Version Tags (v\*)** : Full pipeline including npm publish and GitHub release

### Required Secrets

To enable automatic publishing, add these secrets to your GitHub repository:

1. **NPM_TOKEN**: Your npm authentication token
2. **GITHUB_TOKEN**: Automatically provided by GitHub

### Manual Release Process

1. Create and push a new version tag:

   ```bash
   git tag v1.0.3
   git push origin v1.0.3
   ```

2. GitHub Actions will automatically:
   - Run all tests and checks
   - Build the project
   - Publish to npm
   - Create a GitHub release

## Contributing

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

If you have any questions or need help, please open an issue on GitHub.
