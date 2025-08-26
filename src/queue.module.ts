import { Module, DynamicModule, Provider } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { QueueService } from './queue.service';
import { QueueModuleOptions } from './queue.interface';

@Module({
  imports: [EventEmitterModule.forRoot()],
})
export class QueueModule {
  static forRoot(options?: QueueModuleOptions): DynamicModule {
    return {
      module: QueueModule,
      providers: [
        {
          provide: 'QUEUE_OPTIONS',
          useValue: options || {},
        },
        QueueService,
      ],
      exports: [QueueService],
    };
  }

  /**
   * Register queue processors from different modules
   */
  static forFeature(
    processors: Array<{
      name: string;
      process: (payload: any) => Promise<void>;
    }>
  ): DynamicModule {
    const provider: Provider = {
      provide: 'QUEUE_FEATURE_PROCESSORS',
      useFactory: (queueService: QueueService) => {
        // Register processors with the queue service
        processors.forEach(({ name, process }) => {
          queueService.registerProcessor(name, process);
        });
        return 'QUEUE_FEATURE_PROCESSORS';
      },
      inject: [QueueService],
    };

    return {
      module: QueueModule,
      providers: [provider],
      exports: [provider],
    };
  }

  /**
   * Register decorator-based processors automatically
   */
  static forProcessors(processorClasses: any[]): DynamicModule {
    const providers: Provider[] = [
      ...processorClasses,
      {
        provide: 'QUEUE_DECORATOR_PROCESSORS',
        useFactory: (queueService: QueueService, ...instances: any[]) => {
          // Register processors from decorated methods
          instances.forEach((instance) => {
            if (instance.constructor.queueProcessors) {
              for (const [jobName, processorMethod] of instance.constructor
                .queueProcessors) {
                queueService.registerProcessor(
                  jobName,
                  processorMethod.bind(instance)
                );
              }
            }
          });
          return 'QUEUE_DECORATOR_PROCESSORS';
        },
        inject: [QueueService, ...processorClasses],
      },
    ];

    return {
      module: QueueModule,
      providers,
      exports: ['QUEUE_DECORATOR_PROCESSORS'],
    };
  }
}
