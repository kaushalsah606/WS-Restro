import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.service';
import { redisOptions } from '../redis/redis.module';
import { QUEUES } from './queue.constants';

const defaultJobOptions = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 2000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

/** BullMQ background job queues (Redis-backed). */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        connection: { ...redisOptions(config.get('REDIS_URL')), maxRetriesPerRequest: null },
        prefix: 'pos:bull',
        defaultJobOptions,
      }),
    }),
    BullModule.registerQueue(
      { name: QUEUES.PRINT },
      { name: QUEUES.INVENTORY },
      { name: QUEUES.NOTIFICATIONS },
      { name: QUEUES.SCHEDULED },
      { name: QUEUES.SEARCH },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
