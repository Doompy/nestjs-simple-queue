# NestJS Simple Queue

[![npm version](https://badge.fury.io/js/nestjs-simple-queue.svg)](https://badge.fury.io/js/nestjs-simple-queue)
[![npm downloads](https://img.shields.io/npm/dm/nestjs-simple-queue.svg)](https://www.npmjs.com/package/nestjs-simple-queue)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub stars](https://img.shields.io/github/stars/Doompy/nestjs-simple-queue.svg)](https://github.com/Doompy/nestjs-simple-queue)
[![GitHub issues](https://img.shields.io/github/issues/Doompy/nestjs-simple-queue.svg)](https://github.com/Doompy/nestjs-simple-queue/issues)
[![CI/CD Status](https://github.com/Doompy/nestjs-simple-queue/workflows/CI%2FCD%20Pipeline/badge.svg)](https://github.com/Doompy/nestjs-simple-queue/actions)

A powerful, enterprise-grade task queue service for NestJS applications. Built with **Job-based architecture** for production reliability, featuring advanced capabilities like delayed jobs, task cancellation, state persistence, graceful shutdown, and **flexible processor registration**.

## ✨ Features

- 🏗️ **Job-based Architecture**: Industry-standard processor pattern for scalable task management
- 🔄 **Retry Mechanism**: Configurable retry attempts with exponential backoff
- ⏰ **Delayed Jobs**: Schedule tasks to run after a specified delay
- 🚫 **Task Cancellation**: Cancel pending or delayed tasks
- 💾 **State Persistence**: Optional persistence to survive application restarts
- 🔝 **Priority Queue**: Process high-priority tasks first (LOW/NORMAL/HIGH/URGENT)
- ⚡ **Concurrent Processing**: Configurable concurrency limits
- 🛡️ **Graceful Shutdown**: Wait for active tasks to complete during shutdown
- 📊 **Queue Statistics**: Real-time monitoring and metrics
- 📡 **Event-Driven**: Comprehensive event emission for task lifecycle
- 🎯 **TypeScript Support**: Full TypeScript support with strict type definitions
- 🧪 **Well Tested**: Comprehensive test coverage with Jest
- 🔧 **CI/CD Ready**: Automated testing and deployment pipeline
- 🔌 **Flexible Processor Registration**: Multiple ways to register processors (static, dynamic, decorators, mixins)

## 📦 Installation

```bash
npm install nestjs-simple-queue
```

## 🚀 Quick Start

### 1. Create Job Processors

#### Method 1: Static Registration (Traditional)

```typescript
// src/processors/email.processor.ts
export class EmailProcessor {
  constructor(private emailService: EmailService) {}

  async process(payload: { email: string; subject: string; body: string }) {
    await this.emailService.send(payload.email, payload.subject, payload.body);
  }
}

// src/processors/payment.processor.ts
export class PaymentProcessor {
  constructor(private paymentService: PaymentService) {}

  async process(payload: { amount: number; userId: string }) {
    await this.paymentService.processPayment(payload.amount, payload.userId);
  }
}
```

#### Method 2: Decorator-based Registration (Recommended)

```typescript
// src/processors/email.processor.ts
import { Injectable } from '@nestjs/common';
import { QueueJob } from 'nestjs-simple-queue';

@Injectable()
export class EmailProcessor {
  constructor(private emailService: EmailService) {}

  @QueueJob('send-email')
  async sendEmail(payload: { email: string; subject: string; body: string }) {
    await this.emailService.send(payload.email, payload.subject, payload.body);
  }

  @QueueJob('send-welcome-email')
  async sendWelcomeEmail(payload: { email: string; name: string }) {
    await this.emailService.send(
      payload.email,
      `Welcome ${payload.name}!`,
      'Thank you for joining us.'
    );
  }
}

// src/processors/payment.processor.ts
import { Injectable } from '@nestjs/common';
import { QueueJob } from 'nestjs-simple-queue';

@Injectable()
export class PaymentProcessor {
  constructor(private paymentService: PaymentService) {}

  @QueueJob('process-payment')
  async processPayment(payload: { amount: number; userId: string }) {
    await this.paymentService.processPayment(payload.amount, payload.userId);
  }

  @QueueJob('refund-payment')
  async refundPayment(payload: { paymentId: string; amount: number }) {
    await this.paymentService.refund(payload.paymentId, payload.amount);
  }
}
```

### 2. Register Processors in Module

#### Method 1: Static Registration (Traditional)

```typescript
import { Module } from '@nestjs/common';
import { QueueModule } from 'nestjs-simple-queue';

@Module({
  imports: [
    QueueModule.forRoot({
      concurrency: 5,
      processors: [
        {
          name: 'send-email',
          process: (payload) =>
            new EmailProcessor(emailService).process(payload),
        },
        {
          name: 'process-payment',
          process: (payload) =>
            new PaymentProcessor(paymentService).process(payload),
        },
      ],
    }),
  ],
})
export class AppModule {}
```

#### Method 2: Decorator-based Registration (Recommended)

```typescript
import { Module } from '@nestjs/common';
import { QueueModule } from 'nestjs-simple-queue';
import { EmailProcessor, PaymentProcessor } from './processors';

@Module({
  imports: [
    QueueModule.forRoot({ concurrency: 5 }),
    QueueModule.forProcessors([EmailProcessor, PaymentProcessor]), // 데코레이터 기반 자동 등록
  ],
})
export class AppModule {}
```

#### Method 3: Feature-based Registration (Modular)

```typescript
// app.module.ts
import { Module } from '@nestjs/common';
import { QueueModule } from 'nestjs-simple-queue';

@Module({
  imports: [QueueModule.forRoot({ concurrency: 5 })],
})
export class AppModule {}

// email.module.ts
import { Module } from '@nestjs/common';
import { QueueModule } from 'nestjs-simple-queue';

@Module({
  imports: [
    QueueModule.forFeature([
      {
        name: 'send-email',
        process: (payload) =>
          new EmailProcessor(emailService).sendEmail(payload),
      },
    ]),
  ],
})
export class EmailModule {}

// payment.module.ts
import { Module } from '@nestjs/common';
import { QueueModule } from 'nestjs-simple-queue';

@Module({
  imports: [
    QueueModule.forFeature([
      {
        name: 'process-payment',
        process: (payload) =>
          new PaymentProcessor(paymentService).processPayment(payload),
      },
    ]),
  ],
})
export class PaymentModule {}
```

### 3. Enqueue Jobs

```typescript
import { Injectable } from '@nestjs/common';
import { QueueService, TaskPriority } from 'nestjs-simple-queue';

@Injectable()
export class TaskService {
  constructor(private readonly queueService: QueueService) {}

  async sendWelcomeEmail(email: string) {
    const taskId = await this.queueService.enqueue(
      'email-queue',
      'send-email',
      {
        email,
        subject: 'Welcome!',
        body: 'Thank you for joining us.',
      },
      {
        retries: 3,
        priority: TaskPriority.HIGH,
      }
    );

    console.log(`Email job enqueued with ID: ${taskId}`);
  }

  async schedulePaymentReminder(userId: string) {
    // Send reminder after 24 hours
    const taskId = await this.queueService.enqueue(
      'reminder-queue',
      'send-email',
      {
        email: 'user@example.com',
        subject: 'Payment Reminder',
        body: 'Please complete your payment.',
      },
      {
        delay: 24 * 60 * 60 * 1000, // 24 hours in ms
      }
    );

    return taskId;
  }
}
```

## 🔧 Configuration Options

```typescript
QueueModule.forRoot({
  concurrency: 5, // Number of concurrent tasks per queue (default: 1)
  gracefulShutdownTimeout: 30000, // Graceful shutdown timeout in ms (default: 30000)
  enablePersistence: true, // Enable state persistence (default: false)
  persistencePath: './queue-state.json', // Persistence file path (default: './queue-state.json')
  processors: [
    // Array of job processors
    {
      name: 'job-name',
      process: async (payload) => {
        // Your job logic here
      },
    },
  ],
  logger: customLogger, // Custom logger instance (optional)
});
```

## 📚 Advanced Features

### ⏰ Delayed Jobs

Schedule jobs to run after a specified delay:

```typescript
// Send email after 1 hour
await this.queueService.enqueue(
  'email-queue',
  'send-email',
  { email: 'user@example.com', subject: 'Delayed Email' },
  { delay: 60 * 60 * 1000 } // 1 hour in milliseconds
);

// Get list of delayed tasks
const delayedTasks = this.queueService.getDelayedTasks();
console.log(`${delayedTasks.length} tasks are scheduled`);
```

### 🚫 Task Cancellation

Cancel pending or delayed tasks:

```typescript
// Enqueue a delayed task
const taskId = await this.queueService.enqueue(
  'email-queue',
  'send-email',
  { email: 'user@example.com' },
  { delay: 60000 } // 1 minute delay
);

// Cancel the task before it executes
const cancelled = this.queueService.cancelTask('email-queue', taskId);
if (cancelled) {
  console.log('Task was successfully cancelled');
}
```

### 💾 State Persistence

Enable persistence to survive application restarts:

```typescript
QueueModule.forRoot({
  enablePersistence: true,
  persistencePath: './my-queue-state.json',
  processors: [
    // Your processors
  ],
});
```

When persistence is enabled:

- Queue state is automatically saved on application shutdown
- Delayed tasks are restored and rescheduled on startup
- Failed tasks are preserved for retry

### 📊 Queue Statistics

Monitor your queues in real-time:

```typescript
// Get statistics for a specific queue
const stats = this.queueService.getQueueStats('email-queue');
console.log(stats);
// Output: {
//   queueName: 'email-queue',
//   pendingTasks: 5,
//   activeTasks: 2,
//   totalTasks: 7,
//   delayedTasks: 3
// }

// Get statistics for all queues
const allStats = this.queueService.getAllQueueStats();
console.log(`Managing ${allStats.length} queues`);
```

### 🔝 Priority Queue

Process high-priority tasks first:

```typescript
import { TaskPriority } from 'nestjs-simple-queue';

// Urgent task (processed first)
await this.queueService.enqueue('work-queue', 'urgent-job', data, {
  priority: TaskPriority.URGENT, // 10
});

// High priority task
await this.queueService.enqueue('work-queue', 'important-job', data, {
  priority: TaskPriority.HIGH, // 8
});

// Normal priority task (default)
await this.queueService.enqueue('work-queue', 'normal-job', data, {
  priority: TaskPriority.NORMAL, // 5 (default)
});

// Low priority task (processed last)
await this.queueService.enqueue('work-queue', 'background-job', data, {
  priority: TaskPriority.LOW, // 1
});

// Execution order: urgent-job → important-job → normal-job → background-job
```

### 🔌 Flexible Processor Registration

#### Decorator-based Registration (Recommended)

Use the `@QueueJob` decorator for clean, declarative processor registration:

```typescript
import { Injectable } from '@nestjs/common';
import { QueueJob } from 'nestjs-simple-queue';

@Injectable()
export class EmailProcessor {
  constructor(private emailService: EmailService) {}

  @QueueJob('send-email')
  async sendEmail(payload: { email: string; subject: string; body: string }) {
    await this.emailService.send(payload.email, payload.subject, payload.body);
  }

  @QueueJob('send-welcome-email')
  async sendWelcomeEmail(payload: { email: string; name: string }) {
    await this.emailService.send(
      payload.email,
      `Welcome ${payload.name}!`,
      'Thank you for joining us.'
    );
  }

  @QueueJob('send-password-reset')
  async sendPasswordReset(payload: { email: string; resetToken: string }) {
    await this.emailService.send(
      payload.email,
      'Password Reset Request',
      `Your reset token is: ${payload.resetToken}`
    );
  }
}

// Register in module
import { Module } from '@nestjs/common';
import { QueueModule } from 'nestjs-simple-queue';

@Module({
  imports: [
    QueueModule.forRoot({ concurrency: 5 }),
    QueueModule.forProcessors([EmailProcessor]), // Automatically registers all @QueueJob methods
  ],
})
export class AppModule {}
```

**Benefits of Decorator-based Registration:**

- ✅ **Clean and Declarative**: Clear separation between job logic and registration
- ✅ **Type Safety**: Full TypeScript support with proper typing
- ✅ **Auto-discovery**: Methods are automatically registered based on decorators
- ✅ **Dependency Injection**: Full NestJS DI support for processor classes
- ✅ **Maintainability**: Easy to add, remove, or modify jobs
- ✅ **Testability**: Easy to unit test individual job methods

#### Dynamic Processor Registration

Register processors at runtime for dynamic functionality:

```typescript
import { Injectable, OnModuleInit } from '@nestjs/common';
import { QueueService } from 'nestjs-simple-queue';

@Injectable()
export class DynamicTaskService implements OnModuleInit {
  constructor(private readonly queueService: QueueService) {}

  onModuleInit() {
    // Register processors dynamically
    this.queueService.registerProcessor(
      'custom-notification',
      async (payload) => {
        console.log('Processing custom notification:', payload.message);
        // Custom notification logic
      }
    );

    this.queueService.registerProcessor('data-backup', async (payload) => {
      console.log('Backing up data for:', payload.database);
      // Backup logic
    });
  }

  // Register processor on demand
  async registerNewProcessor(
    jobName: string,
    processor: (payload: any) => Promise<void>
  ) {
    const success = this.queueService.registerProcessor(jobName, processor);
    if (success) {
      console.log(`Processor '${jobName}' registered successfully`);
    } else {
      console.log(`Processor '${jobName}' already exists`);
    }
  }

  // Update existing processor
  async updateProcessor(
    jobName: string,
    newProcessor: (payload: any) => Promise<void>
  ) {
    this.queueService.updateProcessor(jobName, newProcessor);
    console.log(`Processor '${jobName}' updated successfully`);
  }
}
```

#### Module-based Registration

Register processors in different modules for better organization:

```typescript
// email.module.ts
import { Module } from '@nestjs/common';
import { QueueModule } from 'nestjs-simple-queue';

@Module({
  imports: [
    QueueModule.forFeature([
      {
        name: 'send-email',
        process: (payload) => new EmailService().send(payload),
      },
      {
        name: 'send-notification',
        process: (payload) => new NotificationService().send(payload),
      },
    ]),
  ],
})
export class EmailModule {}

// payment.module.ts
import { Module } from '@nestjs/common';
import { QueueModule } from 'nestjs-simple-queue';

@Module({
  imports: [
    QueueModule.forFeature([
      {
        name: 'process-payment',
        process: (payload) => new PaymentService().process(payload),
      },
      {
        name: 'refund-payment',
        process: (payload) => new PaymentService().refund(payload),
      },
    ]),
  ],
})
export class PaymentModule {}
```

### 📡 Event Handling

Listen to comprehensive task lifecycle events:

```typescript
import { Injectable, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class QueueEventListener implements OnModuleInit {
  constructor(private readonly eventEmitter: EventEmitter2) {}

  onModuleInit() {
    // Task lifecycle events
    this.eventEmitter.on('queue.task.added', (event) => {
      console.log(`Task ${event.task.id} added to ${event.queueName}`);
    });

    this.eventEmitter.on('queue.task.processing', (event) => {
      console.log(`Processing task ${event.task.id}`);
    });

    this.eventEmitter.on('queue.task.success', (event) => {
      console.log(`Task ${event.task.id} completed successfully`);
    });

    this.eventEmitter.on('queue.task.failed', (event) => {
      console.log(`Task ${event.task.id} failed:`, event.error.message);
    });

    this.eventEmitter.on('queue.task.cancelled', (event) => {
      console.log(`Task ${event.task.id} was cancelled`);
    });

    // Delayed task events
    this.eventEmitter.on('queue.task.delayed', (event) => {
      console.log(`Task ${event.task.id} scheduled for later execution`);
    });

    // Queue events
    this.eventEmitter.on('queue.empty', (event) => {
      console.log(`Queue ${event.queueName} is now empty`);
    });
  }
}
```

## 🛡️ Graceful Shutdown

The service automatically implements graceful shutdown:

```typescript
// When your NestJS application shuts down:
// 1. New tasks are rejected
// 2. Current tasks are allowed to complete
// 3. Queue state is persisted (if enabled)
// 4. Application exits cleanly

// You can configure the shutdown timeout:
QueueModule.forRoot({
  gracefulShutdownTimeout: 60000, // Wait up to 60 seconds for tasks to complete
});
```

## 📖 API Reference

### QueueService

#### `enqueue<T>(queueName: string, jobName: string, payload: T, options?: EnqueueOptions): Promise<string>`

Enqueues a new job for processing.

**Parameters:**

- `queueName`: Unique identifier for the queue
- `jobName`: Name of the registered job processor
- `payload`: Data to be processed by the job
- `options`: Optional configuration object

**Options:**

```typescript
interface EnqueueOptions {
  retries?: number; // Number of retry attempts (default: 0)
  priority?: TaskPriority; // Task priority (default: NORMAL)
  delay?: number; // Delay in milliseconds (default: 0)
}
```

**Returns:** Promise that resolves to a unique task ID

#### **Processor Management Methods**

##### `registerProcessor(name: string, processor: (payload: any) => Promise<void>): boolean`

Registers a new processor at runtime.

**Parameters:**

- `name`: Job processor name
- `processor`: Processor function

**Returns:** `true` if registered successfully, `false` if already exists

##### `updateProcessor(name: string, processor: (payload: any) => Promise<void>): boolean`

Updates an existing processor or registers a new one.

**Returns:** `true` if updated/registered successfully

##### `unregisterProcessor(name: string): boolean`

Removes a processor.

**Returns:** `true` if removed successfully, `false` if not found

##### `hasProcessor(name: string): boolean`

Checks if a processor is registered.

**Returns:** `true` if processor exists

##### `getRegisteredProcessors(): string[]`

Gets all registered processor names.

**Returns:** Array of processor names

##### `getProcessorInfo(name: string): ProcessorInfo | null`

Gets processor information.

**Returns:** Processor info or null if not found

#### `cancelTask(queueName: string, taskId: string): boolean`

Cancels a pending or delayed task.

**Returns:** `true` if task was cancelled, `false` if task not found

#### `getQueueStats(queueName: string): QueueStats | null`

Gets statistics for a specific queue.

#### `getAllQueueStats(): QueueStats[]`

Gets statistics for all queues.

#### `getDelayedTasks(): DelayedTaskInfo[]`

Gets information about all delayed tasks.

#### **Queue Management Methods**

##### `clearAllQueues(): number`

Clears all queues and removes all pending, active, and delayed tasks.

**Returns:** Total number of tasks that were cleared

##### `clearQueue(queueName: string): number`

Clears a specific queue and removes all its tasks.

**Parameters:**

- `queueName`: Name of the queue to clear

**Returns:** Number of tasks that were cleared

#### **Task Management Methods**

##### `getTaskById(taskId: string): Task<any> | null`

Gets a specific task by its ID.

**Parameters:**

- `taskId`: Unique task identifier

**Returns:** Task object if found, null otherwise

##### `getTaskStatus(taskId: string): TaskStatus`

Gets the current status of a specific task.

**Parameters:**

- `taskId`: Unique task identifier

**Returns:** Task status information

**Task Status Types:**

The `TaskStatus` is a union type that provides type-safe access to status-specific information. The `taskId` is automatically included in the return value:

````typescript
// Union type for all possible statuses
type TaskStatus =
  | PendingTaskStatus
  | ProcessingTaskStatus
  | CompletedTaskStatus
  | FailedTaskStatus
  | CancelledTaskStatus
  | DelayedTaskStatus
  | NotFoundTaskStatus;

// The getTaskStatus method returns TaskStatus & { taskId: string }
// So taskId is always available regardless of status

// Example usage with type guards
const status = queueService.getTaskStatus('task-id');

// taskId is always available
console.log(`Querying status for task: ${status.taskId}`);

if (status.status === 'pending') {
  console.log(`Task ${status.taskId} is pending in queue ${status.queueName}`);
  console.log(`Job: ${status.jobName}, Priority: ${status.priority}`);
  console.log(`Created: ${status.createdAt}, Retries: ${status.retries}`);
} else if (status.status === 'processing') {
  console.log(`Task ${status.taskId} is currently processing`);
  console.log(`Started at: ${status.startedAt}`);
} else if (status.status === 'completed') {
  console.log(`Task ${status.taskId} completed successfully`);
  console.log(`Completed at: ${status.completedAt}`);
  console.log(`Result: ${status.result}`);
} else if (status.status === 'failed') {
  console.log(`Task ${status.taskId} failed`);
  console.log(`Error: ${status.error}`);
  console.log(`Failed at: ${status.failedAt}, Retries: ${status.retries}`);
} else if (status.status === 'delayed') {
  console.log(`Task ${status.taskId} is delayed`);
  console.log(`Scheduled at: ${status.scheduledAt}`);
  console.log(`Remaining delay: ${status.delay}ms`);
} else if (status.status === 'cancelled') {
  console.log(`Task ${status.taskId} was cancelled`);
  console.log(`Cancelled at: ${status.cancelledAt}`);
} else {
  console.log(`Task ${status.taskId} not found`);
}

**Status Type Details:**

Each status type provides specific, type-safe information:

- **`PendingTaskStatus`**: Basic task info + queue details
- **`ProcessingTaskStatus`**: Task info + processing start time
- **`CompletedTaskStatus`**: Task info + completion time and result
- **`FailedTaskStatus`**: Task info + failure time and error details
- **`CancelledTaskStatus`**: Task info + cancellation time
- **`DelayedTaskStatus`**: Task info + scheduled time and delay
- **`NotFoundTaskStatus`**: Only taskId when task doesn't exist

##### `getTasksByQueue(queueName: string): Task<any>[]`

Gets all pending tasks in a specific queue.

**Parameters:**

- `queueName`: Name of the queue

**Returns:** Array of pending tasks

##### `getActiveTasksByQueue(queueName: string): Task<any>[]`

Gets all currently processing tasks in a specific queue.

**Parameters:**

- `queueName`: Name of the queue

**Returns:** Array of active tasks

### Task Priority Levels

```typescript
enum TaskPriority {
  LOW = 1,
  NORMAL = 5, // default
  HIGH = 8,
  URGENT = 10,
}
````

### Events

The service emits the following events:

- `queue.task.added`: When a task is added to the queue
- `queue.task.delayed`: When a delayed task is scheduled
- `queue.task.processing`: When a task starts processing
- `queue.task.success`: When a task completes successfully
- `queue.task.failed`: When a task fails after all retries
- `queue.task.cancelled`: When a task is cancelled
- `queue.empty`: When a queue becomes empty

## 🔄 Migration from v1.x

### Breaking Changes in v2.0

**v2.0 introduces a Job-based architecture** that replaces the previous function-based approach. This provides better scalability, persistence support, and follows industry standards.

#### Before (v1.x)

```typescript
// Old function-based approach
await this.queueService.enqueue(
  'email-queue',
  { email: 'user@example.com' },
  async (payload) => {
    await this.emailService.send(payload.email);
  }
);
```

#### After (v2.x)

```typescript
// 1. Register processor in module
QueueModule.forRoot({
  processors: [
    {
      name: 'send-email',
      process: async (payload) => {
        await this.emailService.send(payload.email);
      },
    },
  ],
});

// 2. Use job name instead of function
await this.queueService.enqueue(
  'email-queue',
  'send-email', // Job name
  { email: 'user@example.com' }
);
```

#### Migration Steps

1. **Extract your task functions** into named processors
2. **Register processors** in `QueueModule.forRoot()`
3. **Update enqueue calls** to use job names instead of functions
4. **Update your imports** - the API signature has changed
5. **Test thoroughly** - the return value is now a task ID instead of void

#### Benefits of Migration

- ✅ **State Persistence**: Tasks survive application restarts
- ✅ **Better Performance**: No function serialization overhead
- ✅ **Delayed Jobs**: Schedule tasks for future execution
- ✅ **Task Cancellation**: Cancel pending tasks
- ✅ **Enhanced Monitoring**: Track tasks by unique IDs
- ✅ **Industry Standard**: Follows established queue patterns

## 🧪 Testing

```bash
# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

## 🔄 CI/CD

This project uses GitHub Actions for continuous integration and deployment:

### Automated Workflows

- **PR Check**: Runs on every pull request to ensure code quality
- **CI/CD Pipeline**: Runs on push to main/develop branches and tag creation
- **Security Audit**: Automated security vulnerability scanning
- **Auto-publish**: Automatic npm package publishing on version tags

### Manual Release Process

1. Update version and create tag:

   ```bash
   npm version major # or minor/patch
   git push origin main --tags
   ```

2. GitHub Actions will automatically:
   - Run all tests and checks
   - Build the project
   - Publish to npm
   - Create a GitHub release

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

If you have any questions or need help:

- 📖 Check the [documentation](https://github.com/Doompy/nestjs-simple-queue)
- 🐛 Report bugs via [GitHub Issues](https://github.com/Doompy/nestjs-simple-queue/issues)
- 💬 Ask questions in [GitHub Discussions](https://github.com/Doompy/nestjs-simple-queue/discussions)

## 📋 Version History

### v2.1.0 (Current)

**Enhanced Type Safety & Test Coverage**

- **Enhanced Task Status System**: Type-safe status management with structured status interfaces
- **Comprehensive Test Coverage**: Improved from 40.5% to 59.77% (+19.27%)
- **Enhanced TypeScript Support**: Better interface definitions and type guards
- **Code Quality**: Resolved all linter errors and improved code formatting

### v2.0.0

**BREAKING CHANGES: Job-based architecture replacing function-based tasks**

- **New Features**: Delayed jobs, task cancellation, state persistence, graceful shutdown
- **Enhanced**: Priority queue, concurrent processing, comprehensive event system
- **Migration Required**: API changes from function-based to processor-based system

### v1.x

**Function-based task processing**

- Basic retry mechanism and event emission
- Priority queue support
- Simple in-memory queue management

> **For detailed changelog and migration guide, see [GitHub Releases](https://github.com/Doompy/nestjs-simple-queue/releases)**

---

**Made with ❤️ for the NestJS community**
