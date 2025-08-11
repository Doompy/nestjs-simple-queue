import { Module, DynamicModule } from "@nestjs/common";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { QueueService } from "./queue.service";
import { QueueModuleOptions } from "./queue.interface";

@Module({
  imports: [EventEmitterModule.forRoot()],
})
export class QueueModule {
  static forRoot(options?: QueueModuleOptions): DynamicModule {
    return {
      module: QueueModule,
      providers: [
        {
          provide: "QUEUE_OPTIONS",
          useValue: options || {},
        },
        QueueService,
      ],
      exports: [QueueService],
    };
  }
}
