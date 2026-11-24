import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUES } from '../../infra/queue/queue.constants';
import { PrintersService } from './printers.service';

/** BullMQ worker: sends ESC/POS jobs to network printers (retries with exponential backoff). */
@Processor(QUEUES.PRINT, { concurrency: 4 })
export class PrintProcessor extends WorkerHost {
  private readonly logger = new Logger(PrintProcessor.name);

  constructor(private readonly printers: PrintersService) {
    super();
  }

  async process(job: Job<{ jobId: string }>) {
    const max = job.opts.attempts ?? 1;
    await this.printers.execute(job.data.jobId, job.attemptsMade + 1, max);
  }
}
