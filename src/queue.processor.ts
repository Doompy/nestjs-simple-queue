import { Injectable } from '@nestjs/common';

/**
 * Decorator for registering queue processors
 * @param jobName - The name of the job this processor handles
 */
export function QueueJob(jobName: string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    // Store metadata for later registration
    if (!target.constructor.queueProcessors) {
      target.constructor.queueProcessors = new Map();
    }

    target.constructor.queueProcessors.set(jobName, originalMethod);

    return descriptor;
  };
}

/**
 * Mixin for auto-registering processors
 */
export function withQueueProcessors<T extends new (...args: any[]) => {}>(
  Base: T
) {
  return class extends Base {
    registerQueueProcessors(queueService: any) {
      const processors = (this as any).constructor.queueProcessors;
      if (processors) {
        for (const [jobName, processorMethod] of processors) {
          queueService.registerProcessor(jobName, processorMethod.bind(this));
        }
      }
    }
  };
}

/**
 * Base class for queue processors
 */
@Injectable()
export class BaseQueueProcessor {
  protected queueService: any;

  setQueueService(queueService: any) {
    this.queueService = queueService;
  }
}

/**
 * Processor registry for managing processors across modules
 */
@Injectable()
export class ProcessorRegistry {
  private static instance: ProcessorRegistry;
  private processors = new Map<string, (payload: any) => Promise<void>>();

  static getInstance(): ProcessorRegistry {
    if (!ProcessorRegistry.instance) {
      ProcessorRegistry.instance = new ProcessorRegistry();
    }
    return ProcessorRegistry.instance;
  }

  register(name: string, processor: (payload: any) => Promise<void>): boolean {
    if (this.processors.has(name)) {
      return false;
    }
    this.processors.set(name, processor);
    return true;
  }

  get(name: string): ((payload: any) => Promise<void>) | undefined {
    return this.processors.get(name);
  }

  getAll(): Map<string, (payload: any) => Promise<void>> {
    return new Map(this.processors);
  }

  clear(): void {
    this.processors.clear();
  }
}
